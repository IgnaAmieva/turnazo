-- ============================================================
-- 021_security_lockdown.sql — Fase 7, S1: cierre de C1, C2, A1, A2 y M2
-- ============================================================
-- Aplica DESPUÉS de 020_cancellation_refunds.sql. Correr como postgres.
--
-- 1. Grants mínimos: se revoca TODO de anon y authenticated en las tablas
--    de public (incluidos TRUNCATE, TRIGGER, REFERENCES) y se otorga solo
--    lo que la app usa, tabla por tabla y columna por columna. También se
--    cortan los privilegios por defecto para tablas/funciones futuras.
--    Incluye las columnas que leen las políticas RLS que aplican a cada rol
--    (si falta una, PostgREST responde "permission denied").
-- 2. C1: FK compuesta bookings(court_id, venue_id) → courts(id, venue_id).
--    Una reserva nunca puede tener una cancha de otro complejo, ni por la
--    API ni por service_role ni por un RPC.
-- 3. M2: el dueño no escribe más en bookings. Las acciones del panel pasan
--    a RPCs SECURITY DEFINER que verifican dueño, cancha y datos:
--      panel_create_block, panel_cancel_booking, panel_mark_paid,
--      panel_mark_no_show.
--    · Cancelar una reserva pagada online deja el pago en 'refund_pending'
--      en la misma transacción: la devolución la hace el servidor y, si
--      falla, el cron. No hay otro camino para cancelarla.
--    · Marcar pagado: si se pagó el total online, no se permite
--      (already_paid). Si se pagó una seña online, se registra que el resto
--      se cobró en el complejo: amount_paid = price_total (sale de la base,
--      no del formulario).
--    · Marcar ausente una reserva pagada online: solo después de que
--      empezó el turno (no_show_before_start). Antes, el camino es cancelar,
--      que devuelve la plata. Sin pago online, sigue como antes.
-- 4. A1: trigger trg_venues_status. Para anon/authenticated que no sean
--    superadmin: en INSERT status = 'pending' siempre; en UPDATE no se
--    puede cambiar status. status sale de los grants de authenticated.
-- 5. C2/A2: create_booking y create_booking_hold solo los ejecuta
--    service_role (la app los llama desde el servidor). Además
--    _validate_booking_slot rechaza turnos a más de 30 días
--    ('too_far_ahead').
--
-- Verificado antes de escribirla: 0 reservas con cancha de otro complejo
-- (2026-11-19), así que la FK compuesta valida sin tocar datos.
-- ============================================================


-- ── 1. Grants ────────────────────────────────────────────────────────────

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Tablas, secuencias y funciones nuevas ya no nacen abiertas a anon/authenticated:
-- cada migración tiene que otorgar explícitamente lo que haga falta.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- Catálogos públicos
GRANT SELECT (id, name, slug)                       ON public.localities TO anon, authenticated;
GRANT SELECT (id, name, slug, default_slot_minutes) ON public.sports     TO anon, authenticated;

-- venues: lo público (listados y página del complejo). owner_id y status los
-- leen las políticas (venues_owner_read, courts_owner_all, *_public_read).
GRANT SELECT (
  id, owner_id, name, phone, address, lat, lng, locality_id, status,
  payment_alias, payment_link,
  deposit_required, deposit_type, deposit_value, allow_full_payment, allow_pay_at_venue
) ON public.venues TO anon;

-- venues: el dueño lee todas las columnas (getOwnerVenue usa select *).
GRANT SELECT (
  id, owner_id, name, phone, address, lat, lng, locality_id, status,
  payment_alias, payment_link, whatsapp_template,
  deposit_required, deposit_type, deposit_value, allow_full_payment, allow_pay_at_venue,
  cancel_limit_hours, refund_policy, created_at, updated_at
) ON public.venues TO authenticated;
-- Alta de complejo (createVenueAction): sin status (lo fija el trigger).
GRANT INSERT (
  owner_id, name, phone, address, locality_id, lat, lng,
  payment_alias, payment_link, whatsapp_template
) ON public.venues TO authenticated;
-- Edición (updateVenueAction, updatePaymentSettingsAction,
-- updateCancellationPolicyAction): sin status ni owner_id.
GRANT UPDATE (
  name, phone, address, locality_id, lat, lng,
  payment_alias, payment_link, whatsapp_template,
  deposit_required, deposit_type, deposit_value, allow_full_payment, allow_pay_at_venue,
  cancel_limit_hours, refund_policy
) ON public.venues TO authenticated;

-- courts
GRANT SELECT (id, venue_id, sport_id, name, slot_minutes, active) ON public.courts TO anon, authenticated;
GRANT INSERT (venue_id, sport_id, name, slot_minutes, active)     ON public.courts TO authenticated;
GRANT UPDATE (sport_id, name, slot_minutes, active)               ON public.courts TO authenticated;

-- court_hours / court_prices (el panel reemplaza todo: delete + insert)
GRANT SELECT (court_id, weekday, open_time, close_time)          ON public.court_hours  TO anon;
GRANT SELECT (id, court_id, weekday, open_time, close_time)      ON public.court_hours  TO authenticated;
GRANT INSERT (court_id, weekday, open_time, close_time)          ON public.court_hours  TO authenticated;
GRANT DELETE                                                     ON public.court_hours  TO authenticated;

GRANT SELECT (court_id, weekday, from_time, to_time, price)      ON public.court_prices TO anon;
GRANT SELECT (id, court_id, weekday, from_time, to_time, price)  ON public.court_prices TO authenticated;
GRANT INSERT (court_id, weekday, from_time, to_time, price)      ON public.court_prices TO authenticated;
GRANT DELETE                                                     ON public.court_prices TO authenticated;

-- bookings: el dueño SOLO lee (agenda). Escribe por los RPCs panel_*.
-- anon no tiene nada: reserva por el servidor y consulta por los RPCs de token.
GRANT SELECT (
  id, court_id, venue_id, period, status, kind,
  customer_name, customer_phone, price_total, amount_paid, payment_status, cancel_token
) ON public.bookings TO authenticated;

-- payments: la agenda muestra lo acreditado online (embed payments(amount, status)).
GRANT SELECT (booking_id, amount, status) ON public.payments TO authenticated;

-- blocked_phones (bloquear / desbloquear desde el panel)
GRANT SELECT (id, venue_id, phone, created_at) ON public.blocked_phones TO authenticated;
GRANT INSERT (venue_id, phone)                 ON public.blocked_phones TO authenticated;
GRANT DELETE                                   ON public.blocked_phones TO authenticated;

-- mp_accounts: estado de la conexión, nunca los tokens.
GRANT SELECT (id, venue_id, mp_user_id, mp_email, expires_at) ON public.mp_accounts TO authenticated;

-- audit_log: las acciones del panel escriben su fila (política audit_log_owner_insert).
GRANT INSERT (profile_id, venue_id, entity, entity_id, action, new_data) ON public.audit_log TO authenticated;

-- push_subscriptions (POST/DELETE /api/push/subscribe; upsert por endpoint).
-- ON CONFLICT DO UPDATE exige SELECT sobre las columnas que actualiza.
-- La política push_subs_own_all limita todo a las filas propias.
GRANT SELECT (id, profile_id, endpoint, p256dh, auth, updated_at) ON public.push_subscriptions TO authenticated;
GRANT INSERT (profile_id, endpoint, p256dh, auth, updated_at)     ON public.push_subscriptions TO authenticated;
GRANT UPDATE (profile_id, endpoint, p256dh, auth, updated_at)     ON public.push_subscriptions TO authenticated;
GRANT DELETE                                                      ON public.push_subscriptions TO authenticated;

-- Sin grants para anon ni authenticated: profiles, notification_outbox,
-- recurring_bookings, webhook_events (solo service_role y funciones).


-- ── 2. C1: la cancha de una reserva es siempre de su complejo ────────────

ALTER TABLE public.courts
  ADD CONSTRAINT courts_id_venue_id_key UNIQUE (id, venue_id);

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_court_venue_fkey
  FOREIGN KEY (court_id, venue_id) REFERENCES public.courts (id, venue_id);


-- ── 3. RPCs del panel (el dueño no escribe directo en bookings) ──────────

-- 3a. Bloqueo manual de una cancha propia
CREATE OR REPLACE FUNCTION public.panel_create_block(
  p_venue_id uuid,
  p_court_id uuid,
  p_start    timestamptz,
  p_end      timestamptz,
  p_note     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_note text := coalesce(nullif(btrim(p_note), ''), 'Bloqueo');
  v_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venues WHERE id = p_venue_id AND owner_id = v_uid) THEN
    RETURN jsonb_build_object('error', 'not_owner');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.courts WHERE id = p_court_id AND venue_id = p_venue_id) THEN
    RETURN jsonb_build_object('error', 'court_not_in_venue');
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RETURN jsonb_build_object('error', 'invalid_period');
  END IF;
  IF p_end <= now() THEN
    RETURN jsonb_build_object('error', 'past_period');
  END IF;
  IF p_end - p_start > interval '7 days' THEN
    RETURN jsonb_build_object('error', 'period_too_long');
  END IF;
  IF char_length(v_note) > 80 THEN
    RETURN jsonb_build_object('error', 'invalid_note');
  END IF;

  BEGIN
    INSERT INTO public.bookings (
      court_id, venue_id, period, kind, status,
      customer_name, customer_phone, price_total, deposit_amount, amount_paid,
      payment_status, cancel_token
    ) VALUES (
      p_court_id, p_venue_id, tstzrange(p_start, p_end, '[)'), 'block', 'confirmed',
      v_note, NULL, 0, 0, 0,
      'unpaid',
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RETURN jsonb_build_object('error', 'slot_taken');
  END;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_id, 'note', v_note);
END;
$fn$;

-- 3b. Cancelar una reserva confirmada. Si tiene pago online acreditado, el
--     pago queda 'refund_pending' en la misma transacción (devolución
--     siempre, sin importar plazo ni política: cancela el complejo).
CREATE OR REPLACE FUNCTION public.panel_cancel_booking(
  p_booking_id uuid,
  p_venue_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid        uuid := auth.uid();
  v_b          record;
  v_pay        record;
  v_refund_due boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venues WHERE id = p_venue_id AND owner_id = v_uid) THEN
    RETURN jsonb_build_object('error', 'not_owner');
  END IF;

  SELECT * INTO v_b
  FROM public.bookings
  WHERE id = p_booking_id AND venue_id = p_venue_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_owner');
  END IF;
  IF v_b.status <> 'confirmed' THEN
    RETURN jsonb_build_object('error', 'not_confirmed');
  END IF;

  SELECT * INTO v_pay
  FROM public.payments
  WHERE booking_id = v_b.id AND status = 'approved'
  ORDER BY created_at DESC
  LIMIT 1;
  v_refund_due := FOUND AND v_pay.amount > 0 AND v_pay.mp_order_id IS NOT NULL;

  UPDATE public.bookings
  SET status = 'cancelled', updated_at = now()
  WHERE id = v_b.id;

  IF v_refund_due THEN
    UPDATE public.payments
    SET status     = 'refund_pending',
        raw        = coalesce(raw, '{}'::jsonb) || jsonb_build_object('reason', 'owner_cancelled'),
        updated_at = now()
    WHERE id = v_pay.id;
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'booking_id',     v_b.id,
    'customer_name',  v_b.customer_name,
    'customer_phone', v_b.customer_phone,
    'start',          lower(v_b.period),
    'amount_paid',    v_b.amount_paid,
    'refund_due',     v_refund_due,
    'refund_amount',  CASE WHEN v_refund_due THEN v_pay.amount ELSE 0 END,
    'mp_order_id',    CASE WHEN v_refund_due THEN v_pay.mp_order_id   ELSE NULL END,
    'mp_payment_id',  CASE WHEN v_refund_due THEN v_pay.mp_payment_id ELSE NULL END,
    'payment_type',   CASE WHEN v_refund_due THEN v_pay.type::text    ELSE NULL END
  );
END;
$fn$;

-- 3c. Marcar pagado (cobrado en el complejo). El monto sale de la base.
CREATE OR REPLACE FUNCTION public.panel_mark_paid(
  p_booking_id uuid,
  p_venue_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_b      record;
  v_online numeric;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venues WHERE id = p_venue_id AND owner_id = v_uid) THEN
    RETURN jsonb_build_object('error', 'not_owner');
  END IF;

  SELECT * INTO v_b
  FROM public.bookings
  WHERE id = p_booking_id AND venue_id = p_venue_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_owner');
  END IF;
  IF v_b.kind <> 'booking' OR v_b.status <> 'confirmed' THEN
    RETURN jsonb_build_object('error', 'not_confirmed');
  END IF;
  IF v_b.payment_status = 'paid' THEN
    RETURN jsonb_build_object('error', 'already_paid');
  END IF;

  SELECT coalesce(sum(amount), 0) INTO v_online
  FROM public.payments
  WHERE booking_id = v_b.id AND status = 'approved';

  UPDATE public.bookings
  SET payment_status = 'paid',
      amount_paid    = coalesce(v_b.price_total, 0),
      updated_at     = now()
  WHERE id = v_b.id;

  INSERT INTO public.notification_outbox (venue_id, type, payload)
  VALUES (
    v_b.venue_id,
    'payment_received',
    jsonb_build_object(
      'booking_id',     v_b.id,
      'customer_name',  v_b.customer_name,
      'customer_phone', v_b.customer_phone,
      'start',          lower(v_b.period),
      'price_total',    coalesce(v_b.price_total, 0)
    )
  );

  RETURN jsonb_build_object(
    'ok',          true,
    'price_total', coalesce(v_b.price_total, 0),
    'online_paid', v_online
  );
END;
$fn$;

-- 3d. Marcar ausente. Con pago online, solo una vez empezado el turno.
CREATE OR REPLACE FUNCTION public.panel_mark_no_show(
  p_booking_id uuid,
  p_venue_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_b   record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venues WHERE id = p_venue_id AND owner_id = v_uid) THEN
    RETURN jsonb_build_object('error', 'not_owner');
  END IF;

  SELECT * INTO v_b
  FROM public.bookings
  WHERE id = p_booking_id AND venue_id = p_venue_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_owner');
  END IF;
  IF v_b.kind <> 'booking' OR v_b.status <> 'confirmed' THEN
    RETURN jsonb_build_object('error', 'not_confirmed');
  END IF;

  IF lower(v_b.period) > now() AND EXISTS (
    SELECT 1 FROM public.payments
    WHERE booking_id = v_b.id AND status = 'approved' AND amount > 0
  ) THEN
    RETURN jsonb_build_object('error', 'no_show_before_start');
  END IF;

  UPDATE public.bookings
  SET status = 'no_show', updated_at = now()
  WHERE id = v_b.id;

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.panel_create_block(uuid, uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.panel_cancel_booking(uuid, uuid)                               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.panel_mark_paid(uuid, uuid)                                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.panel_mark_no_show(uuid, uuid)                                 FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.panel_create_block(uuid, uuid, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.panel_cancel_booking(uuid, uuid)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.panel_mark_paid(uuid, uuid)                                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.panel_mark_no_show(uuid, uuid)                                 TO authenticated;


-- ── 4. A1: solo superadmin (o el servidor) cambia venues.status ──────────
-- SECURITY INVOKER a propósito: current_user es el rol de la petición
-- (anon / authenticated / service_role). service_role y postgres son el
-- servidor y las migraciones: no se restringen.
CREATE OR REPLACE FUNCTION public.enforce_venue_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
BEGIN
  IF current_user = 'anon'
     OR (current_user = 'authenticated' AND public.auth_role() IS DISTINCT FROM 'superadmin') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.status := 'pending';
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION USING
        ERRCODE = 'insufficient_privilege',
        MESSAGE = 'venue_status_forbidden',
        DETAIL  = 'Solo un superadmin puede cambiar el estado del complejo.';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_venue_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_venues_status ON public.venues;
CREATE TRIGGER trg_venues_status
  BEFORE INSERT OR UPDATE ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.enforce_venue_status();


-- ── 5. C2/A2: reservar solo desde el servidor, y hasta 30 días ───────────

REVOKE EXECUTE ON FUNCTION public.create_booking(uuid, uuid, timestamptz, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_booking(uuid, uuid, timestamptz, timestamptz, text, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_booking_hold(uuid, uuid, timestamptz, timestamptz, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.create_booking_hold(uuid, uuid, timestamptz, timestamptz, text, text, text)
  TO service_role;

-- _validate_booking_slot v4: igual que la vigente + 'too_far_ahead'.
CREATE OR REPLACE FUNCTION public._validate_booking_slot(
  p_court_id       uuid,
  p_venue_id       uuid,
  p_start          timestamptz,
  p_end            timestamptz,
  p_customer_name  text,
  p_customer_phone text
)
RETURNS TABLE(
  error_code         text,
  price_total        numeric,
  norm_name          text,
  norm_phone         text,
  r_deposit_required boolean,
  r_allow_pay_venue  boolean,
  r_allow_full       boolean,
  r_dep_type         text,
  r_dep_value        numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
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
  IF p_start <= now() THEN
    RETURN QUERY SELECT 'past_slot'::text, NULL::numeric,
      NULL::text, NULL::text, NULL::bool, NULL::bool, NULL::bool,
      NULL::text, NULL::numeric;
    RETURN;
  END IF;

  IF p_start > now() + interval '30 days' THEN
    RETURN QUERY SELECT 'too_far_ahead'::text, NULL::numeric,
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

  RETURN QUERY SELECT
    NULL::text,
    v_price::numeric,
    v_norm_name,
    v_norm_phone,
    v_venue.deposit_required::bool,
    v_venue.allow_pay_at_venue::bool,
    v_venue.allow_full_payment::bool,
    v_venue.deposit_type::text,
    v_venue.deposit_value::numeric;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public._validate_booking_slot(uuid, uuid, timestamptz, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._validate_booking_slot(uuid, uuid, timestamptz, timestamptz, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
