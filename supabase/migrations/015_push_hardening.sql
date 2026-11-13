-- ============================================================
-- 015_push_hardening.sql
--
-- 1. REVOKE EXECUTE de push_send_cron() a PUBLIC/anon/authenticated.
--    Solo pg_cron (rol postgres) puede invocarla.
-- 2. pg_net: reinstalar en schema extensions (estaba en public).
-- 3. push_send_cron() lee URL y secreto desde Vault en lugar de
--    current_setting(). Configurar una vez con:
--      SELECT vault.create_secret('<url>', 'push_send_url',
--             'URL del endpoint /api/push/send');
--      SELECT vault.create_secret('<secreto>', 'push_secret',
--             'Secreto compartido header x-push-secret');
-- 4. audit_log_owner_insert idempotente (la policy ya existe desde
--    013 aplicada manualmente; el archivo 013 ahora usa DROP IF EXISTS).
-- 5. create_booking v5: sin cancel_token en el payload de outbox.
--    cancel_token sigue estando en el RETURN para el cliente; el dueño
--    no necesita verlo en la notificación.
-- ============================================================

-- ── 1. REVOKE push_send_cron ──────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.push_send_cron() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.push_send_cron() FROM anon;
REVOKE EXECUTE ON FUNCTION public.push_send_cron() FROM authenticated;

-- ── 2. pg_net → extensions schema ────────────────────────────────────────
-- DROP primero para limpiar la instalación en public;
-- los objetos de net.* se recrean automáticamente.
DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;

-- ── 3. push_send_cron() con Vault ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.push_send_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'push_send_url'
  LIMIT 1;

  IF v_url IS NULL OR v_url = '' THEN
    RETURN; -- secreto no configurado en Vault, skip silencioso
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'push_secret'
  LIMIT 1;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'content-type',  'application/json',
      'x-push-secret', coalesce(v_secret, '')
    ),
    body    := '{}'::jsonb
  );
END;
$fn$;

-- Revoke de nuevo luego del CREATE OR REPLACE (que restablece permisos)
REVOKE EXECUTE ON FUNCTION public.push_send_cron() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.push_send_cron() FROM anon;
REVOKE EXECUTE ON FUNCTION public.push_send_cron() FROM authenticated;

-- ── 4. audit_log_owner_insert idempotente ────────────────────────────────
-- La policy ya existe desde 013 aplicada manualmente.
-- Recrear idempotente para que supabase db push no falle al re-aplicar 013.
DROP POLICY IF EXISTS "audit_log_owner_insert" ON public.audit_log;
CREATE POLICY "audit_log_owner_insert" ON public.audit_log
  FOR INSERT
  WITH CHECK (
    profile_id = auth.uid()
    AND (
      venue_id IS NULL
      OR venue_id IN (SELECT id FROM public.venues WHERE owner_id = auth.uid())
    )
  );

-- ── 5. create_booking v5 — sin cancel_token en outbox ────────────────────
CREATE OR REPLACE FUNCTION public.create_booking(
  p_court_id       uuid,
  p_venue_id       uuid,
  p_start          timestamptz,
  p_end            timestamptz,
  p_customer_name  text,
  p_customer_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_venue         record;
  v_court         record;
  v_court_hours   record;
  v_price         numeric(10,2);
  v_booking_id    uuid;
  v_cancel_token  text;
  v_dow           int;
  v_start_time    time;
  v_start_min     int;
  v_end_min       int;
  v_open_min      int;
  v_start_min_eff int;
  v_price_dow     int;
  v_prev_day      boolean := false;
  v_future_count  int;
BEGIN
  IF p_start <= now() THEN
    RETURN jsonb_build_object('error', 'past_slot');
  END IF;
  IF p_end <= p_start THEN
    RETURN jsonb_build_object('error', 'invalid_period');
  END IF;

  p_customer_name  := trim(p_customer_name);
  p_customer_phone := regexp_replace(p_customer_phone, '[^0-9]', '', 'g');

  IF char_length(p_customer_name) < 2 OR char_length(p_customer_name) > 80 THEN
    RETURN jsonb_build_object('error', 'invalid_name');
  END IF;
  IF char_length(p_customer_phone) < 8 OR char_length(p_customer_phone) > 15 THEN
    RETURN jsonb_build_object('error', 'invalid_phone');
  END IF;

  SELECT * INTO v_venue
  FROM public.venues
  WHERE id = p_venue_id AND status = 'approved';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'venue_not_found');
  END IF;
  IF v_venue.deposit_required THEN
    RETURN jsonb_build_object('error', 'deposit_required');
  END IF;

  SELECT * INTO v_court
  FROM public.courts
  WHERE id = p_court_id AND venue_id = p_venue_id AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'court_not_found');
  END IF;

  IF EXTRACT(EPOCH FROM (p_end - p_start)) / 60 != v_court.slot_minutes THEN
    RETURN jsonb_build_object('error', 'invalid_duration');
  END IF;

  v_dow        := EXTRACT(dow FROM (p_start AT TIME ZONE 'America/Argentina/Mendoza'))::int;
  v_start_time := (p_start AT TIME ZONE 'America/Argentina/Mendoza')::time;
  v_start_min  := EXTRACT(hour  FROM v_start_time)::int * 60
                + EXTRACT(minute FROM v_start_time)::int;
  v_end_min    := v_start_min + v_court.slot_minutes;

  SELECT * INTO v_court_hours
  FROM public.court_hours
  WHERE court_id = p_court_id
    AND weekday  = v_dow
    AND (EXTRACT(hour  FROM open_time)::int * 60
       + EXTRACT(minute FROM open_time)::int) <= v_start_min
    AND (
      CASE
        WHEN close_time = '00:00:00'::time THEN 1440
        WHEN (EXTRACT(hour FROM close_time)::int*60 + EXTRACT(minute FROM close_time)::int)
           < (EXTRACT(hour FROM open_time)::int*60  + EXTRACT(minute FROM open_time)::int)
          THEN EXTRACT(hour FROM close_time)::int*60 + EXTRACT(minute FROM close_time)::int + 1440
        ELSE EXTRACT(hour FROM close_time)::int*60 + EXTRACT(minute FROM close_time)::int
      END
    ) >= v_end_min;

  IF NOT FOUND THEN
    SELECT * INTO v_court_hours
    FROM public.court_hours
    WHERE court_id = p_court_id
      AND weekday  = (v_dow + 6) % 7
      AND (EXTRACT(hour FROM open_time)::int*60 + EXTRACT(minute FROM open_time)::int) <= (v_start_min + 1440)
      AND (
        CASE
          WHEN close_time = '00:00:00'::time THEN 1440
          WHEN (EXTRACT(hour FROM close_time)::int*60 + EXTRACT(minute FROM close_time)::int)
             < (EXTRACT(hour FROM open_time)::int*60  + EXTRACT(minute FROM open_time)::int)
            THEN EXTRACT(hour FROM close_time)::int*60 + EXTRACT(minute FROM close_time)::int + 1440
          ELSE EXTRACT(hour FROM close_time)::int*60 + EXTRACT(minute FROM close_time)::int
        END
      ) >= (v_end_min + 1440);

    IF FOUND THEN
      v_prev_day := true;
    ELSE
      RETURN jsonb_build_object('error', 'outside_hours');
    END IF;
  END IF;

  v_start_min_eff := v_start_min + CASE WHEN v_prev_day THEN 1440 ELSE 0 END;
  v_open_min := EXTRACT(hour FROM v_court_hours.open_time)::int*60
              + EXTRACT(minute FROM v_court_hours.open_time)::int;
  IF (v_start_min_eff - v_open_min) % v_court.slot_minutes != 0 THEN
    RETURN jsonb_build_object('error', 'invalid_slot');
  END IF;

  PERFORM 1
  FROM public.blocked_phones
  WHERE venue_id = p_venue_id AND phone = p_customer_phone;
  IF FOUND THEN
    RETURN jsonb_build_object('error', 'phone_blocked');
  END IF;

  SELECT COUNT(*) INTO v_future_count
  FROM public.bookings
  WHERE venue_id       = p_venue_id
    AND customer_phone = p_customer_phone
    AND status         = 'confirmed'
    AND lower(period)  > now();
  IF v_future_count >= 3 THEN
    RETURN jsonb_build_object('error', 'too_many_bookings');
  END IF;

  v_price_dow := CASE WHEN v_prev_day THEN (v_dow + 6) % 7 ELSE v_dow END;

  SELECT price INTO v_price
  FROM public.court_prices
  WHERE court_id = p_court_id
    AND weekday  = v_price_dow
    AND (EXTRACT(hour FROM from_time)::int*60 + EXTRACT(minute FROM from_time)::int) <= v_start_min_eff
    AND (
      CASE
        WHEN to_time = '00:00:00'::time THEN 1440
        WHEN (EXTRACT(hour FROM to_time)::int*60 + EXTRACT(minute FROM to_time)::int)
          <= (EXTRACT(hour FROM from_time)::int*60 + EXTRACT(minute FROM from_time)::int)
          THEN EXTRACT(hour FROM to_time)::int*60 + EXTRACT(minute FROM to_time)::int + 1440
        ELSE EXTRACT(hour FROM to_time)::int*60 + EXTRACT(minute FROM to_time)::int
      END
    ) > v_start_min_eff
  LIMIT 1;
  IF v_price IS NULL THEN
    RETURN jsonb_build_object('error', 'price_not_set');
  END IF;

  v_cancel_token := replace(gen_random_uuid()::text, '-', '')
                 || replace(gen_random_uuid()::text, '-', '');

  BEGIN
    INSERT INTO public.bookings (
      court_id, venue_id, period,
      kind, source, status,
      customer_name, customer_phone,
      price_total, deposit_amount, amount_paid,
      payment_status, cancel_token
    ) VALUES (
      p_court_id, p_venue_id, tstzrange(p_start, p_end, '[)'),
      'booking', 'app', 'confirmed',
      p_customer_name, p_customer_phone,
      v_price, 0, 0,
      'unpaid', v_cancel_token
    )
    RETURNING id INTO v_booking_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RETURN jsonb_build_object('error', 'slot_taken');
  END;

  -- Notificación en outbox: misma transacción.
  -- cancel_token no se incluye: el dueño no lo necesita en la notificación.
  INSERT INTO public.notification_outbox (venue_id, type, payload)
  VALUES (
    p_venue_id,
    'booking_created',
    jsonb_build_object(
      'booking_id',     v_booking_id,
      'customer_name',  p_customer_name,
      'customer_phone', p_customer_phone,
      'start',          p_start,
      'end',            p_end,
      'price_total',    v_price
    )
  );

  RETURN jsonb_build_object(
    'booking_id',   v_booking_id,
    'cancel_token', v_cancel_token,
    'price_total',  v_price
  );
END;
$fn$;
