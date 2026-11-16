-- ============================================================
-- 018_payment_rules.sql — Fase 6: reglas de cobro en la base
-- ============================================================
-- Aplica DESPUÉS de 017_phase6_mp.sql. No requiere variables nuevas.
--
-- 1. create_booking: si el complejo no permite pago en el lugar
--    (allow_pay_at_venue = false) devuelve 'pay_at_venue_not_allowed'
--    sin crear nada. Todo lo demás queda igual que en 017.
--    _validate_booking_slot no cambia: ya devuelve r_allow_pay_venue.
-- 2. Trigger BEFORE INSERT OR UPDATE en venues que hace cumplir las
--    reglas de cobro aunque alguien escriba directo en la tabla:
--      - seña o pago total ⇒ tiene que existir fila en mp_accounts
--      - seña obligatoria ⇒ allow_pay_at_venue = false (se fuerza)
--      - seña 'percent' ⇒ deposit_value entre 1 y 100
--      - seña 'fixed'   ⇒ deposit_value > 0
--      - al menos una de deposit_required / allow_full_payment /
--        allow_pay_at_venue en true
--    Solo actúa en INSERT o cuando cambia alguna de esas columnas:
--    editar nombre, dirección, etc. no dispara las reglas.
-- 3. Chequeo final: todos los complejos existentes cumplen las reglas
--    (si alguno no cumple, la migración falla y no deja nada a medias).
--
-- Orden de desconexión de MP (src/app/actions/mp.ts): primero el
-- UPDATE de venues que apaga seña/pago total (pasa el trigger porque
-- mp_accounts todavía existe) y después el DELETE de mp_accounts
-- (sin trigger). Ese orden sigue funcionando con esta migración.
-- ============================================================

-- ============================================================
-- 1. create_booking — agrega el check de pago en el lugar
-- ============================================================
-- Cuerpo idéntico al vigente (017) salvo el bloque marcado con 018.
-- Orden de los checks: deposit_required primero (como hasta ahora;
-- además seña obligatoria implica allow_pay_at_venue = false, así que
-- esos complejos siguen devolviendo 'deposit_required'), y recién
-- después 'pay_at_venue_not_allowed'.
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
  IF v_val.r_deposit_required THEN
    RETURN jsonb_build_object('error', 'deposit_required');
  END IF;

  -- 018: sin pago en el lugar, este RPC (reserva sin pago previo) no aplica.
  -- El jugador tiene que pagar online (create_booking_hold).
  IF NOT v_val.r_allow_pay_venue THEN
    RETURN jsonb_build_object('error', 'pay_at_venue_not_allowed');
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

-- Mismos grants que 017 (CREATE OR REPLACE los conserva; se repiten por claridad)
REVOKE EXECUTE ON FUNCTION public.create_booking(uuid, uuid, timestamptz, timestamptz, text, text)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_booking(uuid, uuid, timestamptz, timestamptz, text, text)
  TO anon, authenticated;

-- ============================================================
-- 2. Trigger de reglas de cobro en venues
-- ============================================================
-- Errores: ERRCODE check_violation (23514), MESSAGE = código estable
-- (lo ve el cliente en error.message), DETAIL = explicación en español.
-- SECURITY DEFINER: la consulta a mp_accounts corre como dueño de la
-- función y no depende de los permisos del rol que escribe en venues.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_venue_payment_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- Solo actúa en INSERT o si cambió alguna columna de cobro.
  -- (El trigger ya se declara UPDATE OF esas columnas; esto cubre además
  -- el caso "SET columna = mismo valor".)
  IF TG_OP = 'UPDATE'
     AND NEW.deposit_required   IS NOT DISTINCT FROM OLD.deposit_required
     AND NEW.deposit_type       IS NOT DISTINCT FROM OLD.deposit_type
     AND NEW.deposit_value      IS NOT DISTINCT FROM OLD.deposit_value
     AND NEW.allow_full_payment IS NOT DISTINCT FROM OLD.allow_full_payment
     AND NEW.allow_pay_at_venue IS NOT DISTINCT FROM OLD.allow_pay_at_venue
  THEN
    RETURN NEW;
  END IF;

  -- Seña obligatoria ⇒ no hay pago en el lugar (se fuerza, no es error)
  IF NEW.deposit_required THEN
    NEW.allow_pay_at_venue := false;
  END IF;

  -- Tipo y valor de la seña
  IF NEW.deposit_required AND NEW.deposit_type IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'deposit_type_required',
      DETAIL  = 'Con seña obligatoria hay que elegir seña fija o por porcentaje.';
  END IF;

  IF NEW.deposit_type = 'percent'
     AND (NEW.deposit_value IS NULL OR NEW.deposit_value < 1 OR NEW.deposit_value > 100) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'deposit_percent_out_of_range',
      DETAIL  = 'El porcentaje de seña debe estar entre 1 y 100.';
  END IF;

  IF NEW.deposit_type = 'fixed'
     AND (NEW.deposit_value IS NULL OR NEW.deposit_value <= 0) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'deposit_fixed_not_positive',
      DETAIL  = 'El monto de la seña debe ser mayor a 0.';
  END IF;

  -- Al menos una forma de pago activa
  IF NOT (NEW.deposit_required OR NEW.allow_full_payment OR NEW.allow_pay_at_venue) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'no_payment_method',
      DETAIL  = 'Tiene que quedar al menos una forma de pago activa.';
  END IF;

  -- Seña y pago total se cobran por Mercado Pago
  IF (NEW.deposit_required OR NEW.allow_full_payment)
     AND NOT EXISTS (SELECT 1 FROM public.mp_accounts m WHERE m.venue_id = NEW.id) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'mp_not_connected',
      DETAIL  = 'Seña y pago total requieren Mercado Pago conectado.';
  END IF;

  RETURN NEW;
END;
$$;

-- Función de trigger: ningún rol de cliente puede llamarla directamente.
-- (Postgres no exige EXECUTE al rol que dispara el trigger, así que el
-- trigger sigue funcionando para anon/authenticated/service_role.)
REVOKE EXECUTE ON FUNCTION public.enforce_venue_payment_rules()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_venues_payment_rules ON public.venues;

CREATE TRIGGER trg_venues_payment_rules
  BEFORE INSERT OR UPDATE OF
    deposit_required, deposit_type, deposit_value,
    allow_full_payment, allow_pay_at_venue
  ON public.venues
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_venue_payment_rules();

-- ============================================================
-- 3. Los complejos existentes tienen que cumplir las reglas
-- ============================================================
-- Si alguno no cumple, la migración falla acá y se revierte entera.
-- Estado verificado el 2026-11-14 (2 complejos): deposit_required=false,
-- deposit_type=null, allow_full_payment=false, allow_pay_at_venue=true.
-- ============================================================

DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT id, name
    FROM   public.venues ven
    WHERE  NOT (
      (NOT ven.deposit_required OR NOT ven.allow_pay_at_venue)
      AND (NOT ven.deposit_required OR ven.deposit_type IS NOT NULL)
      AND (ven.deposit_type IS DISTINCT FROM 'percent'
           OR ven.deposit_value BETWEEN 1 AND 100)
      AND (ven.deposit_type IS DISTINCT FROM 'fixed'
           OR ven.deposit_value > 0)
      AND (ven.deposit_required OR ven.allow_full_payment OR ven.allow_pay_at_venue)
      AND (NOT (ven.deposit_required OR ven.allow_full_payment)
           OR EXISTS (SELECT 1 FROM public.mp_accounts m WHERE m.venue_id = ven.id))
    )
  LOOP
    RAISE EXCEPTION '018: el complejo % (%) no cumple las reglas de cobro; corregirlo antes de aplicar',
      v.name, v.id;
  END LOOP;
END $$;
