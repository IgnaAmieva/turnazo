-- ============================================================
-- 017_phase6_mp.sql — Fase 6: integración Mercado Pago
-- ============================================================
-- Aplica DESPUÉS de 016_outbox_discard.sql
-- Requiere pg_cron habilitado en el proyecto Supabase.
--
-- Variables de entorno requeridas (app — NO van en esta migración):
--   MP_CLIENT_ID          ID de la app MP
--   MP_CLIENT_SECRET      Secret de la app MP
--   MP_REDIRECT_URI       URL de callback OAuth (/api/mp/callback)
--   MP_WEBHOOK_SECRET     Secret para firmas HMAC de webhooks
--   MP_TOKEN_ENCRYPTION_KEY  32 bytes hex — clave AES-256-GCM
--   MP_STATE_SECRET       Clave propia para firmar OAuth state (HMAC-SHA256).
--                         DISTINTA de MP_CLIENT_SECRET para no exponer el
--                         client secret en URLs durante el flujo OAuth.
--   PLATFORM_FEE_PERCENT  Porcentaje de comisión (ej. 0.05)
-- ============================================================

-- ============================================================
-- 1. mp_accounts — agregar mp_email, renombrar columnas de tokens
-- ============================================================

ALTER TABLE public.mp_accounts
  ADD COLUMN IF NOT EXISTS mp_email text;

-- Renombrar solo si todavía se llaman sin _enc
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mp_accounts'
      AND column_name = 'access_token'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'mp_accounts'
        AND column_name = 'access_token_enc'
    ) THEN
      ALTER TABLE public.mp_accounts RENAME COLUMN access_token  TO access_token_enc;
      ALTER TABLE public.mp_accounts RENAME COLUMN refresh_token TO refresh_token_enc;
    END IF;
  END IF;
END $$;

-- REVOKE columna a columna no funciona cuando el grant fue dado a nivel de tabla.
-- Hay que revocar a nivel de tabla y luego otorgar solo columnas seguras.
-- service_role bypasa tanto RLS como ACL de columna → puede leer tokens.
REVOKE ALL ON public.mp_accounts FROM anon, authenticated;

GRANT SELECT (
  id, venue_id, mp_user_id, mp_email,
  expires_at, created_at, updated_at
) ON public.mp_accounts TO authenticated;

-- Reemplazar policies (la anterior estaba en TO PUBLIC, dejaba pasar a anon)
DROP POLICY IF EXISTS mp_accounts_owner_all      ON public.mp_accounts;
DROP POLICY IF EXISTS mp_accounts_superadmin_all ON public.mp_accounts;

-- El dueño puede ver si su complejo tiene cuenta conectada (sin tokens)
CREATE POLICY mp_accounts_owner_read ON public.mp_accounts
  FOR SELECT
  TO authenticated
  USING (
    venue_id IN (
      SELECT id FROM public.venues WHERE owner_id = auth.uid()
    )
  );

-- Los superadmin ven todas las filas (también sin tokens por el column grant)
CREATE POLICY mp_accounts_superadmin_all ON public.mp_accounts
  FOR ALL
  TO authenticated
  USING (public.auth_role() = 'superadmin'::public.user_role);

-- ============================================================
-- 2. payments — renombrar mp_preference_id → mp_order_id,
--    agregar currency
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments'
      AND column_name = 'mp_preference_id'
  ) THEN
    ALTER TABLE public.payments RENAME COLUMN mp_preference_id TO mp_order_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments'
      AND column_name = 'mp_order_id'
  ) THEN
    ALTER TABLE public.payments ADD COLUMN mp_order_id text;
  END IF;
END $$;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'ARS';

-- ============================================================
-- 3. webhook_events — agregar received_at, status, payload
--    status default = 'received' (no 'processed': se procesa después)
-- ============================================================

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS received_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS status      text         NOT NULL DEFAULT 'received',
  ADD COLUMN IF NOT EXISTS payload     jsonb        NOT NULL DEFAULT '{}';

-- ============================================================
-- 4. bookings — agregar mp_order_id
-- ============================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS mp_order_id text;

-- ============================================================
-- 5. get_court_availability — excluir holds vencidos inline
-- ============================================================
-- Parámetros: p_from, p_to (nombres originales, no cambiar).
-- Semántica: confirmed + holds vigentes. No usar NOT IN: metería
-- completed y no_show.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_court_availability(
  p_court_id uuid,
  p_from     timestamptz,
  p_to       timestamptz
)
RETURNS TABLE (period tstzrange)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT b.period
  FROM   public.bookings b
  WHERE  b.court_id = p_court_id
    AND  b.period && tstzrange(p_from, p_to)
    AND  (  b.status = 'confirmed'
         OR (b.status = 'hold' AND b.hold_expires_at > now())
         );
$$;

REVOKE EXECUTE ON FUNCTION public.get_court_availability(uuid, timestamptz, timestamptz)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_court_availability(uuid, timestamptz, timestamptz)
  TO anon, authenticated;

-- ============================================================
-- 6. expire_stale_holds + pg_cron
-- ============================================================

CREATE OR REPLACE FUNCTION public.expire_stale_holds()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $$
  UPDATE public.bookings
  SET    status = 'expired'
  WHERE  status = 'hold'
    AND  hold_expires_at < NOW();
$$;

-- Función interna: sin acceso desde ningún rol de cliente
REVOKE EXECUTE ON FUNCTION public.expire_stale_holds()
  FROM PUBLIC, anon, authenticated;

-- Cron cada minuto (cron.schedule hace upsert por nombre, es idempotente)
SELECT cron.schedule(
  'expire-holds',
  '* * * * *',
  'SELECT public.expire_stale_holds()'
);

-- ============================================================
-- 7. _validate_booking_slot — función interna compartida
-- ============================================================
-- Misma firma que create_booking (timestamptz).
-- Copia TAL CUAL las validaciones de create_booking con los
-- mismos códigos de error. NO incluye:
--   - deposit_required check (queda en create_booking)
--   - conflict count (lo resuelve el constraint no_overlap)
--   - INSERT / notification_outbox (cada caller los hace)
-- Devuelve: precio + datos de pago del complejo para que el
-- caller no necesite releer la DB.
-- ============================================================

CREATE OR REPLACE FUNCTION public._validate_booking_slot(
  p_court_id       uuid,
  p_venue_id       uuid,
  p_start          timestamptz,
  p_end            timestamptz,
  p_customer_name  text,
  p_customer_phone text
)
RETURNS TABLE (
  error_code         text,
  price_total        numeric,
  norm_name          text,
  norm_phone         text,
  r_deposit_required bool,
  r_allow_pay_venue  bool,
  r_allow_full       bool,
  r_dep_type         text,
  r_dep_value        numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_venue         record;
  v_court         record;
  v_court_hours   record;
  v_price         numeric(10,2);
  v_dow           int;
  v_start_time    time;
  v_start_min     int;
  v_end_min       int;
  v_open_min      int;
  v_start_min_eff int;
  v_price_dow     int;
  v_prev_day      boolean := false;
  v_future_count  int;
  v_norm_name     text;
  v_norm_phone    text;
BEGIN
  -- === Validaciones copiadas textualmente de create_booking ===

  IF p_start <= now() THEN
    RETURN QUERY SELECT 'past_slot'::text, NULL::numeric,
      NULL::text, NULL::text, NULL::bool, NULL::bool, NULL::bool,
      NULL::text, NULL::numeric;
    RETURN;
  END IF;

  IF p_end <= p_start THEN
    RETURN QUERY SELECT 'invalid_period'::text, NULL::numeric,
      NULL::text, NULL::text, NULL::bool, NULL::bool, NULL::bool,
      NULL::text, NULL::numeric;
    RETURN;
  END IF;

  v_norm_name  := trim(p_customer_name);
  v_norm_phone := regexp_replace(p_customer_phone, '[^0-9]', '', 'g');

  IF char_length(v_norm_name) < 2 OR char_length(v_norm_name) > 80 THEN
    RETURN QUERY SELECT 'invalid_name'::text, NULL::numeric,
      v_norm_name, v_norm_phone, NULL::bool, NULL::bool, NULL::bool,
      NULL::text, NULL::numeric;
    RETURN;
  END IF;

  IF char_length(v_norm_phone) < 8 OR char_length(v_norm_phone) > 15 THEN
    RETURN QUERY SELECT 'invalid_phone'::text, NULL::numeric,
      v_norm_name, v_norm_phone, NULL::bool, NULL::bool, NULL::bool,
      NULL::text, NULL::numeric;
    RETURN;
  END IF;

  SELECT * INTO v_venue
  FROM public.venues
  WHERE id = p_venue_id AND status = 'approved';
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'venue_not_found'::text, NULL::numeric,
      v_norm_name, v_norm_phone, NULL::bool, NULL::bool, NULL::bool,
      NULL::text, NULL::numeric;
    RETURN;
  END IF;
  -- deposit_required check se hace en el caller (create_booking)

  SELECT * INTO v_court
  FROM public.courts
  WHERE id = p_court_id AND venue_id = p_venue_id AND active = true;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'court_not_found'::text, NULL::numeric,
      v_norm_name, v_norm_phone, NULL::bool, NULL::bool, NULL::bool,
      NULL::text, NULL::numeric;
    RETURN;
  END IF;

  IF EXTRACT(EPOCH FROM (p_end - p_start)) / 60 != v_court.slot_minutes THEN
    RETURN QUERY SELECT 'invalid_duration'::text, NULL::numeric,
      v_norm_name, v_norm_phone, NULL::bool, NULL::bool, NULL::bool,
      NULL::text, NULL::numeric;
    RETURN;
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
      RETURN QUERY SELECT 'outside_hours'::text, NULL::numeric,
        v_norm_name, v_norm_phone, NULL::bool, NULL::bool, NULL::bool,
        NULL::text, NULL::numeric;
      RETURN;
    END IF;
  END IF;

  v_start_min_eff := v_start_min + CASE WHEN v_prev_day THEN 1440 ELSE 0 END;
  v_open_min := EXTRACT(hour   FROM v_court_hours.open_time)::int * 60
              + EXTRACT(minute FROM v_court_hours.open_time)::int;
  IF (v_start_min_eff - v_open_min) % v_court.slot_minutes != 0 THEN
    RETURN QUERY SELECT 'invalid_slot'::text, NULL::numeric,
      v_norm_name, v_norm_phone, NULL::bool, NULL::bool, NULL::bool,
      NULL::text, NULL::numeric;
    RETURN;
  END IF;

  PERFORM 1
  FROM public.blocked_phones
  WHERE venue_id = p_venue_id AND phone = v_norm_phone;
  IF FOUND THEN
    RETURN QUERY SELECT 'phone_blocked'::text, NULL::numeric,
      v_norm_name, v_norm_phone, NULL::bool, NULL::bool, NULL::bool,
      NULL::text, NULL::numeric;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_future_count
  FROM public.bookings
  WHERE venue_id       = p_venue_id
    AND customer_phone = v_norm_phone
    AND status         = 'confirmed'
    AND lower(period)  > now();
  IF v_future_count >= 3 THEN
    RETURN QUERY SELECT 'too_many_bookings'::text, NULL::numeric,
      v_norm_name, v_norm_phone, NULL::bool, NULL::bool, NULL::bool,
      NULL::text, NULL::numeric;
    RETURN;
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
    RETURN QUERY SELECT 'price_not_set'::text, NULL::numeric,
      v_norm_name, v_norm_phone, NULL::bool, NULL::bool, NULL::bool,
      NULL::text, NULL::numeric;
    RETURN;
  END IF;

  -- === Éxito: devolver precio + config de pago del complejo ===
  RETURN QUERY SELECT
    NULL::text,                        -- error_code
    v_price::numeric,                  -- price_total
    v_norm_name,                       -- norm_name
    v_norm_phone,                      -- norm_phone
    v_venue.deposit_required::bool,    -- r_deposit_required
    v_venue.allow_pay_at_venue::bool,  -- r_allow_pay_venue
    v_venue.allow_full_payment::bool,  -- r_allow_full
    v_venue.deposit_type::text,        -- r_dep_type
    v_venue.deposit_value::numeric;    -- r_dep_value
END;
$$;

REVOKE EXECUTE ON FUNCTION public._validate_booking_slot(uuid, uuid, timestamptz, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 8. create_booking v4 — ahora delega en _validate_booking_slot
-- ============================================================
-- Misma firma, mismo retorno. Cambios respecto a v3:
--   - Delega validaciones a _validate_booking_slot (shared)
--   - Expire stale holds antes del INSERT
-- Conserva: deposit_required check, notification_outbox INSERT.
-- ============================================================

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
SET search_path TO ''
AS $$
DECLARE
  v_val          record;
  v_booking_id   uuid;
  v_cancel_token text;
BEGIN
  -- Validaciones compartidas
  SELECT * INTO v_val
  FROM public._validate_booking_slot(
    p_court_id, p_venue_id, p_start, p_end, p_customer_name, p_customer_phone
  );

  IF v_val.error_code IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_val.error_code);
  END IF;

  -- Si el complejo requiere seña, el flujo de pago es obligatorio.
  -- allow_pay_at_venue tiene default true y dejaría saltear la seña;
  -- el check de deposit_required tiene precedencia absoluta.
  IF v_val.r_deposit_required THEN
    RETURN jsonb_build_object('error', 'deposit_required');
  END IF;

  -- Expirar holds vencidos de esta cancha antes de insertar.
  UPDATE public.bookings
  SET    status = 'expired'
  WHERE  court_id      = p_court_id
    AND  status        = 'hold'
    AND  hold_expires_at < NOW();

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
      v_val.norm_name, v_val.norm_phone,
      v_val.price_total, 0, 0,
      'unpaid', v_cancel_token
    )
    RETURNING id INTO v_booking_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RETURN jsonb_build_object('error', 'slot_taken');
  END;

  -- Notificación en outbox: misma transacción.
  -- cancel_token no se incluye: el dueño no lo necesita.
  INSERT INTO public.notification_outbox (venue_id, type, payload)
  VALUES (
    p_venue_id,
    'booking_created',
    jsonb_build_object(
      'booking_id',     v_booking_id,
      'customer_name',  v_val.norm_name,
      'customer_phone', v_val.norm_phone,
      'start',          p_start,
      'end',            p_end,
      'price_total',    v_val.price_total
    )
  );

  RETURN jsonb_build_object(
    'booking_id',   v_booking_id,
    'cancel_token', v_cancel_token,
    'price_total',  v_val.price_total
  );
END;
$$;

-- Mismos grants que las versiones anteriores
REVOKE EXECUTE ON FUNCTION public.create_booking(uuid, uuid, timestamptz, timestamptz, text, text)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_booking(uuid, uuid, timestamptz, timestamptz, text, text)
  TO anon, authenticated;

-- ============================================================
-- 9. create_booking_hold — nuevo RPC para pagos MP
-- ============================================================
-- Firma idéntica a create_booking + p_payment_type.
-- Usa _validate_booking_slot para todas las validaciones.
-- Devuelve booking_id, cancel_token, amount_to_pay, price_total, currency.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_booking_hold(
  p_court_id       uuid,
  p_venue_id       uuid,
  p_start          timestamptz,
  p_end            timestamptz,
  p_customer_name  text,
  p_customer_phone text,
  p_payment_type   text   -- 'deposit' | 'full'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_val          record;
  v_amount       numeric;
  v_booking_id   uuid;
  v_cancel_token text;
  v_hold_count   int;
BEGIN
  -- Tipo de pago válido
  IF p_payment_type NOT IN ('deposit', 'full') THEN
    RETURN jsonb_build_object('error', 'invalid_payment_type');
  END IF;

  -- Expirar holds vencidos de esta cancha antes de validar
  UPDATE public.bookings
  SET    status = 'expired'
  WHERE  court_id      = p_court_id
    AND  status        = 'hold'
    AND  hold_expires_at < NOW();

  -- Validaciones compartidas
  SELECT * INTO v_val
  FROM public._validate_booking_slot(
    p_court_id, p_venue_id, p_start, p_end, p_customer_name, p_customer_phone
  );

  IF v_val.error_code IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_val.error_code);
  END IF;

  -- Cuenta MP conectada
  IF NOT EXISTS (
    SELECT 1 FROM public.mp_accounts WHERE venue_id = p_venue_id
  ) THEN
    RETURN jsonb_build_object('error', 'mp_not_connected');
  END IF;

  -- Pago total sin allow_full_payment → error
  IF p_payment_type = 'full' AND NOT v_val.r_allow_full THEN
    RETURN jsonb_build_object('error', 'full_payment_not_allowed');
  END IF;

  -- Seña sin deposit_required → error
  IF p_payment_type = 'deposit' AND NOT v_val.r_deposit_required THEN
    RETURN jsonb_build_object('error', 'deposit_not_configured');
  END IF;

  -- Seña obligatoria pero tipo/valor no configurados
  IF p_payment_type = 'deposit'
     AND (v_val.r_dep_type IS NULL OR v_val.r_dep_value IS NULL) THEN
    RETURN jsonb_build_object('error', 'deposit_not_configured');
  END IF;

  -- 1 hold activo por teléfono por complejo
  SELECT COUNT(*) INTO v_hold_count
  FROM   public.bookings
  WHERE  venue_id       = p_venue_id
    AND  customer_phone = v_val.norm_phone
    AND  status         = 'hold'
    AND  hold_expires_at > NOW();

  IF v_hold_count >= 1 THEN
    RETURN jsonb_build_object('error', 'hold_limit_reached');
  END IF;

  -- Monto a cobrar
  IF p_payment_type = 'full' THEN
    v_amount := v_val.price_total;
  ELSIF v_val.r_dep_type = 'percent' THEN
    v_amount := ROUND(v_val.price_total * v_val.r_dep_value / 100);
  ELSE
    -- Seña fija: nunca mayor al precio total
    v_amount := LEAST(v_val.r_dep_value, v_val.price_total);
  END IF;

  v_cancel_token := replace(gen_random_uuid()::text, '-', '')
                 || replace(gen_random_uuid()::text, '-', '');

  BEGIN
    INSERT INTO public.bookings (
      court_id, venue_id, period,
      kind, source, status,
      customer_name, customer_phone,
      price_total, deposit_amount, amount_paid,
      payment_status, hold_expires_at,
      cancel_token
    ) VALUES (
      p_court_id, p_venue_id, tstzrange(p_start, p_end, '[)'),
      'booking', 'app', 'hold',
      v_val.norm_name, v_val.norm_phone,
      v_val.price_total, v_amount, 0,
      'unpaid',
      NOW() + INTERVAL '10 minutes',
      v_cancel_token
    )
    RETURNING id INTO v_booking_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RETURN jsonb_build_object('error', 'slot_taken');
  END;

  RETURN jsonb_build_object(
    'booking_id',    v_booking_id,
    'cancel_token',  v_cancel_token,
    'amount_to_pay', v_amount,
    'price_total',   v_val.price_total,
    'currency',      'ARS'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_booking_hold(uuid, uuid, timestamptz, timestamptz, text, text, text)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_booking_hold(uuid, uuid, timestamptz, timestamptz, text, text, text)
  TO anon, authenticated;
