-- ============================================================
-- BORRADOR - NO APLICADA - tiene correcciones pendientes
-- ============================================================
-- 017_phase6_mp.sql — Fase 6: integración Mercado Pago
-- ============================================================
-- Aplica DESPUÉS de 016_outbox_discard.sql
-- Requiere pg_cron habilitado en el proyecto Supabase.
-- ============================================================

-- ============================================================
-- 1. mp_accounts — agregar mp_email, cifrado a nivel columna
-- ============================================================

-- Agregar columna mp_email (puede ser null para cuentas viejas)
ALTER TABLE mp_accounts
  ADD COLUMN IF NOT EXISTS mp_email text;

-- Los tokens se guardan cifrados desde ahora (AES-256-GCM, servidor).
-- Renombramos las columnas para dejar claro que el contenido es cifrado.
-- Si ya existen con estos nombres, los ALTER son no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mp_accounts' AND column_name = 'access_token'
      AND udt_name = 'text'
  ) THEN
    -- Solo renombramos si aún no se llamaban _enc
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'mp_accounts' AND column_name = 'access_token_enc'
    ) THEN
      ALTER TABLE mp_accounts RENAME COLUMN access_token TO access_token_enc;
      ALTER TABLE mp_accounts RENAME COLUMN refresh_token TO refresh_token_enc;
    END IF;
  END IF;
END $$;

-- Revocar lectura de columnas de token a roles de cliente
-- (service_role bypasa column ACL, así que el servidor sigue pudiendo leer)
REVOKE SELECT (access_token_enc, refresh_token_enc)
  ON mp_accounts
  FROM authenticated, anon;

-- Reemplazar policy mp_accounts_owner_all por una más restrictiva:
-- el dueño puede ver su fila pero NO las columnas de token.
-- Las escrituras se hacen desde server actions con service_role.
DROP POLICY IF EXISTS mp_accounts_owner_all ON mp_accounts;

CREATE POLICY mp_accounts_owner_read ON mp_accounts
  FOR SELECT
  TO authenticated
  USING (
    venue_id IN (
      SELECT id FROM venues WHERE owner_id = auth.uid()
    )
  );

-- ============================================================
-- 2. payments — renombrar mp_preference_id → mp_order_id,
--    agregar currency
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'mp_preference_id'
  ) THEN
    ALTER TABLE payments RENAME COLUMN mp_preference_id TO mp_order_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'mp_order_id'
  ) THEN
    ALTER TABLE payments ADD COLUMN mp_order_id text;
  END IF;
END $$;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'ARS';

-- ============================================================
-- 3. webhook_events — agregar received_at, status, payload
-- ============================================================

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS received_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS status      text         NOT NULL DEFAULT 'processed',
  ADD COLUMN IF NOT EXISTS payload     jsonb        NOT NULL DEFAULT '{}';

-- ============================================================
-- 4. bookings — agregar mp_order_id
-- ============================================================

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS mp_order_id text;

-- ============================================================
-- 5. get_court_availability — excluir holds vencidos inline
-- ============================================================

CREATE OR REPLACE FUNCTION get_court_availability(
  p_court_id  uuid,
  p_day_start timestamptz,
  p_day_end   timestamptz
)
RETURNS TABLE (period tstzrange)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT b.period
  FROM   bookings b
  WHERE  b.court_id = p_court_id
    AND  b.period && tstzrange(p_day_start, p_day_end)
    AND  b.booking_status NOT IN ('cancelled', 'expired')
    -- Excluir holds vencidos inline (sin esperar al cron)
    AND  NOT (b.booking_status = 'hold' AND b.hold_expires_at < NOW());
$$;

REVOKE EXECUTE ON FUNCTION get_court_availability(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_court_availability(uuid, timestamptz, timestamptz) TO anon, authenticated;

-- ============================================================
-- 6. expire_stale_holds + pg_cron
-- ============================================================

CREATE OR REPLACE FUNCTION expire_stale_holds()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE bookings
  SET    booking_status = 'expired'
  WHERE  booking_status = 'hold'
    AND  hold_expires_at < NOW();
$$;

REVOKE EXECUTE ON FUNCTION expire_stale_holds() FROM PUBLIC;

-- Programar cron cada minuto (idempotente: ON CONFLICT DO NOTHING internamente)
SELECT cron.schedule(
  'expire-holds',
  '* * * * *',
  'SELECT expire_stale_holds()'
);

-- ============================================================
-- 7. _validate_booking_slot — función interna compartida
-- ============================================================
-- Extrae la lógica de validación de create_booking v3 para
-- que tanto create_booking v4 como create_booking_hold la usen.
-- NUNCA exponer esta función a PUBLIC.
-- ============================================================

CREATE OR REPLACE FUNCTION _validate_booking_slot(
  p_court_id   uuid,
  p_date       date,
  p_start_time time,
  p_end_time   time,
  p_name       text,
  p_phone      text
)
RETURNS TABLE (
  error_code          text,
  price_total         numeric,
  norm_name           text,
  norm_phone          text,
  r_dow               int,
  r_start_time        time,
  r_start_min_eff     int,
  r_prev_day          bool,
  r_deposit_required  bool,
  r_allow_pay_venue   bool,
  r_allow_full        bool,
  r_dep_type          text,
  r_dep_value         numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_court           record;
  v_venue           record;
  v_hour            record;
  v_dow             int;
  v_start_min       int;    -- minutos desde medianoche UTC del slot
  v_end_min         int;
  v_open_min        int;
  v_close_min       int;
  v_slot_min        int;
  v_start_min_eff   int;    -- minutos efectivos desde open_time (para alineación)
  v_prev_day        bool;   -- el slot pertenece al día anterior (cruce de medianoche)
  v_price           numeric;
  v_conflict        int;
  v_norm_name       text;
  v_norm_phone      text;
  v_start_ts        timestamptz;
  v_end_ts          timestamptz;
BEGIN
  -- Normalizar nombre y teléfono
  v_norm_name  := TRIM(p_name);
  v_norm_phone := REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g');

  -- Validación básica de inputs
  IF v_norm_name = '' OR LENGTH(v_norm_phone) < 7 THEN
    RETURN QUERY SELECT 'invalid_input'::text, NULL::numeric, v_norm_name, v_norm_phone,
                        NULL::int, NULL::time, NULL::int, NULL::bool,
                        NULL::bool, NULL::bool, NULL::bool, NULL::text, NULL::numeric;
    RETURN;
  END IF;

  -- Cargar cancha y complejo
  SELECT c.*, v.deposit_required, v.deposit_type, v.deposit_value,
              v.allow_full_payment, v.allow_pay_at_venue, v.id AS venue_id_ref
  INTO   v_court
  FROM   courts c
  JOIN   venues v ON v.id = c.venue_id
  WHERE  c.id = p_court_id AND c.active = true AND v.active = true;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'court_not_found'::text, NULL::numeric, v_norm_name, v_norm_phone,
                        NULL::int, NULL::time, NULL::int, NULL::bool,
                        NULL::bool, NULL::bool, NULL::bool, NULL::text, NULL::numeric;
    RETURN;
  END IF;

  -- Día de la semana en Mendoza (0=Domingo ... 6=Sábado)
  v_dow := EXTRACT(DOW FROM (p_date::timestamptz AT TIME ZONE 'America/Argentina/Mendoza'))::int;

  -- Buscar horario del día
  SELECT h.*
  INTO   v_hour
  FROM   court_hours h
  WHERE  h.court_id = p_court_id AND h.weekday = v_dow;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'no_schedule'::text, NULL::numeric, v_norm_name, v_norm_phone,
                        v_dow, NULL::time, NULL::int, NULL::bool,
                        NULL::bool, NULL::bool, NULL::bool, NULL::text, NULL::numeric;
    RETURN;
  END IF;

  -- Convertir tiempos a minutos desde medianoche
  v_open_min  := EXTRACT(HOUR FROM v_hour.open_time)::int * 60 + EXTRACT(MINUTE FROM v_hour.open_time)::int;
  v_close_min := EXTRACT(HOUR FROM v_hour.close_time)::int * 60 + EXTRACT(MINUTE FROM v_hour.close_time)::int;
  v_start_min := EXTRACT(HOUR FROM p_start_time)::int * 60 + EXTRACT(MINUTE FROM p_start_time)::int;
  v_end_min   := EXTRACT(HOUR FROM p_end_time)::int * 60 + EXTRACT(MINUTE FROM p_end_time)::int;
  v_slot_min  := v_court.slot_minutes;

  -- Cruce de medianoche: si close <= open, el cierre es al día siguiente
  IF v_close_min <= v_open_min THEN
    v_close_min := v_close_min + 24 * 60;
  END IF;

  -- Slots que cruzan medianoche: start_min puede ser < open_min (pertenecen al día siguiente)
  v_prev_day := false;
  IF v_start_min < v_open_min THEN
    v_start_min_eff := v_start_min + 24 * 60;
    v_prev_day := true;
  ELSE
    v_start_min_eff := v_start_min;
  END IF;

  -- Validar que el slot esté dentro del horario
  IF v_start_min_eff < v_open_min OR v_start_min_eff >= v_close_min THEN
    RETURN QUERY SELECT 'outside_hours'::text, NULL::numeric, v_norm_name, v_norm_phone,
                        v_dow, p_start_time, v_start_min_eff, v_prev_day,
                        NULL::bool, NULL::bool, NULL::bool, NULL::text, NULL::numeric;
    RETURN;
  END IF;

  -- Validar alineación de slot
  IF (v_start_min_eff - v_open_min) % v_slot_min <> 0 THEN
    RETURN QUERY SELECT 'slot_misaligned'::text, NULL::numeric, v_norm_name, v_norm_phone,
                        v_dow, p_start_time, v_start_min_eff, v_prev_day,
                        NULL::bool, NULL::bool, NULL::bool, NULL::text, NULL::numeric;
    RETURN;
  END IF;

  -- Validar duración exacta
  IF v_end_min - v_start_min <> v_slot_min AND
     (v_end_min + 24*60) - v_start_min <> v_slot_min THEN
    RETURN QUERY SELECT 'invalid_duration'::text, NULL::numeric, v_norm_name, v_norm_phone,
                        v_dow, p_start_time, v_start_min_eff, v_prev_day,
                        NULL::bool, NULL::bool, NULL::bool, NULL::text, NULL::numeric;
    RETURN;
  END IF;

  -- Construir timestamps UTC
  v_start_ts := (p_date::text || ' ' || p_start_time::text || ' America/Argentina/Mendoza')::timestamptz;
  v_end_ts   := v_start_ts + (v_slot_min * interval '1 minute');

  -- Verificar conflicto de reserva (exclusión GIST)
  SELECT COUNT(*)
  INTO   v_conflict
  FROM   bookings
  WHERE  court_id = p_court_id
    AND  booking_status NOT IN ('cancelled', 'expired')
    AND  NOT (booking_status = 'hold' AND hold_expires_at < NOW())
    AND  period && tstzrange(v_start_ts, v_end_ts);

  IF v_conflict > 0 THEN
    RETURN QUERY SELECT 'slot_taken'::text, NULL::numeric, v_norm_name, v_norm_phone,
                        v_dow, p_start_time, v_start_min_eff, v_prev_day,
                        NULL::bool, NULL::bool, NULL::bool, NULL::text, NULL::numeric;
    RETURN;
  END IF;

  -- Verificar teléfono bloqueado
  IF EXISTS (
    SELECT 1 FROM blocked_phones bp
    JOIN courts c2 ON c2.venue_id = bp.venue_id
    WHERE c2.id = p_court_id AND bp.phone = v_norm_phone
  ) THEN
    RETURN QUERY SELECT 'phone_blocked'::text, NULL::numeric, v_norm_name, v_norm_phone,
                        v_dow, p_start_time, v_start_min_eff, v_prev_day,
                        NULL::bool, NULL::bool, NULL::bool, NULL::text, NULL::numeric;
    RETURN;
  END IF;

  -- Calcular precio
  SELECT cp.price INTO v_price
  FROM   court_prices cp
  WHERE  cp.court_id = p_court_id
    AND  cp.weekday  = v_dow
    AND  v_start_min_eff >= EXTRACT(HOUR FROM cp.from_time)::int * 60 + EXTRACT(MINUTE FROM cp.from_time)::int
    AND  v_start_min_eff <  EXTRACT(HOUR FROM cp.to_time)::int * 60 + EXTRACT(MINUTE FROM cp.to_time)::int
  LIMIT 1;

  -- Éxito: retornar todos los campos necesarios
  RETURN QUERY SELECT
    NULL::text,                       -- error_code
    v_price,                          -- price_total
    v_norm_name,                      -- norm_name
    v_norm_phone,                     -- norm_phone
    v_dow,                            -- r_dow
    p_start_time,                     -- r_start_time
    v_start_min_eff,                  -- r_start_min_eff
    v_prev_day,                       -- r_prev_day
    v_court.deposit_required::bool,   -- r_deposit_required
    v_court.allow_pay_at_venue::bool, -- r_allow_pay_venue
    v_court.allow_full_payment::bool, -- r_allow_full
    v_court.deposit_type::text,       -- r_dep_type
    v_court.deposit_value::numeric;   -- r_dep_value
END;
$$;

REVOKE EXECUTE ON FUNCTION _validate_booking_slot(uuid, date, time, time, text, text) FROM PUBLIC;

-- ============================================================
-- 8. create_booking v4 — usa _validate_booking_slot
-- ============================================================
-- TODO: reescribir llamando a _validate_booking_slot() en lugar
--       de duplicar la lógica. La interfaz pública (parámetros y
--       retorno) permanece igual que v3.
-- Esta sección se completa cuando se escribe el código de la app.
-- ============================================================

-- ============================================================
-- 9. create_booking_hold — nuevo RPC para pagos MP
-- ============================================================

CREATE OR REPLACE FUNCTION create_booking_hold(
  p_court_id     uuid,
  p_date         date,
  p_start_time   time,
  p_end_time     time,
  p_name         text,
  p_phone        text,
  p_payment_type text  -- 'deposit' | 'full'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v          record;
  v_amount   numeric;
  v_booking_id uuid;
  v_start_ts timestamptz;
BEGIN
  -- Validar usando la función compartida
  SELECT * INTO v
  FROM   _validate_booking_slot(p_court_id, p_date, p_start_time, p_end_time, p_name, p_phone);

  IF v.error_code IS NOT NULL THEN
    RETURN jsonb_build_object('error', v.error_code);
  END IF;

  -- Calcular monto a cobrar
  IF p_payment_type = 'full' OR NOT v.r_deposit_required THEN
    v_amount := COALESCE(v.price_total, 0);
  ELSIF v.r_dep_type = 'percent' THEN
    v_amount := ROUND(COALESCE(v.price_total, 0) * v.r_dep_value / 100);
  ELSE  -- 'fixed'
    v_amount := v.r_dep_value;
  END IF;

  -- Construir timestamp de inicio
  v_start_ts := (p_date::text || ' ' || p_start_time::text || ' America/Argentina/Mendoza')::timestamptz;

  -- Insertar booking en estado hold
  INSERT INTO bookings (
    court_id, period, customer_name, customer_phone,
    booking_status, payment_status,
    deposit_amount, hold_expires_at,
    cancel_token
  ) VALUES (
    p_court_id,
    tstzrange(v_start_ts, v_start_ts + (
      EXTRACT(EPOCH FROM (p_end_time - p_start_time)) * interval '1 second'
    )),
    v.norm_name,
    v.norm_phone,
    'hold',
    'pending',
    v_amount,
    NOW() + INTERVAL '10 minutes',
    encode(gen_random_bytes(16), 'hex')
  )
  RETURNING id INTO v_booking_id;

  RETURN jsonb_build_object(
    'booking_id',    v_booking_id,
    'amount_to_pay', v_amount,
    'currency',      'ARS'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION create_booking_hold(uuid, date, time, time, text, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION create_booking_hold(uuid, date, time, time, text, text, text) TO anon, authenticated;
