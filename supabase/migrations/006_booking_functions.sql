-- ============================================================
-- 006_booking_functions.sql — Funciones RPC para reservas
-- ============================================================

-- ------------------------------------------------------------
-- create_booking
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_booking(
  p_court_id      uuid,
  p_venue_id      uuid,
  p_start         timestamptz,
  p_end           timestamptz,
  p_customer_name text,
  p_customer_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_venue         record;
  v_court         record;
  v_court_hours   record;
  v_price         numeric(10,2);
  v_booking_id    uuid;
  v_cancel_token  text;
  v_dow           int;
  v_start_time    time;
  v_end_time      time;
BEGIN
  -- Validaciones básicas
  IF p_start <= now() THEN
    RETURN jsonb_build_object('error', 'past_slot');
  END IF;

  IF p_end <= p_start THEN
    RETURN jsonb_build_object('error', 'invalid_period');
  END IF;

  -- Venue
  SELECT * INTO v_venue
  FROM public.venues
  WHERE id = p_venue_id AND status = 'approved';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'venue_not_found');
  END IF;

  IF v_venue.deposit_required = true THEN
    RETURN jsonb_build_object('error', 'deposit_required');
  END IF;

  -- Court
  SELECT * INTO v_court
  FROM public.courts
  WHERE id = p_court_id AND venue_id = p_venue_id AND active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'court_not_found');
  END IF;

  -- Duración
  IF EXTRACT(EPOCH FROM (p_end - p_start)) / 60 != v_court.slot_minutes THEN
    RETURN jsonb_build_object('error', 'invalid_duration');
  END IF;

  -- Horario de apertura (weekday + ventana de tiempo)
  v_dow        := EXTRACT(dow FROM (p_start AT TIME ZONE 'America/Argentina/Mendoza'))::int;
  v_start_time := (p_start AT TIME ZONE 'America/Argentina/Mendoza')::time;
  v_end_time   := (p_end   AT TIME ZONE 'America/Argentina/Mendoza')::time;

  SELECT * INTO v_court_hours
  FROM public.court_hours
  WHERE court_id = p_court_id
    AND weekday = v_dow
    AND open_time  <= v_start_time
    AND close_time >= v_end_time;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'outside_hours');
  END IF;

  -- Teléfono bloqueado
  PERFORM 1
  FROM public.blocked_phones
  WHERE venue_id = p_venue_id AND phone = p_customer_phone;

  IF FOUND THEN
    RETURN jsonb_build_object('error', 'phone_blocked');
  END IF;

  -- Precio
  SELECT price INTO v_price
  FROM public.court_prices
  WHERE court_id = p_court_id
    AND weekday  = v_dow
    AND from_time <= v_start_time
    AND to_time   >  v_start_time
  LIMIT 1;

  -- Token de cancelación: gen_random_uuid() es de pg_catalog (siempre disponible)
  -- Dos UUIDs sin guiones = 64 chars hex (256 bits de entropía)
  v_cancel_token := replace(gen_random_uuid()::text, '-', '') ||
                    replace(gen_random_uuid()::text, '-', '');

  -- Insertar reserva (puede lanzar exclusion_violation si el slot está tomado)
  BEGIN
    INSERT INTO public.bookings (
      court_id,
      venue_id,
      period,
      kind,
      source,
      status,
      customer_name,
      customer_phone,
      price_total,
      deposit_amount,
      amount_paid,
      payment_status,
      cancel_token
    )
    VALUES (
      p_court_id,
      p_venue_id,
      tstzrange(p_start, p_end, '[)'),
      'booking',
      'app',
      'confirmed',
      p_customer_name,
      p_customer_phone,
      COALESCE(v_price, 0),
      0,
      0,
      'unpaid',
      v_cancel_token
    )
    RETURNING id INTO v_booking_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RETURN jsonb_build_object('error', 'slot_taken');
  END;

  RETURN jsonb_build_object(
    'booking_id',   v_booking_id,
    'cancel_token', v_cancel_token,
    'price_total',  COALESCE(v_price, 0)
  );
END;
$$;

-- ------------------------------------------------------------
-- cancel_booking_by_token
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_booking_by_token(
  p_cancel_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking record;
  v_venue   record;
BEGIN
  SELECT b.*, v.cancel_limit_hours INTO v_booking
  FROM public.bookings b
  JOIN public.venues   v ON v.id = b.venue_id
  WHERE b.cancel_token = p_cancel_token
    AND b.status = 'confirmed';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF now() > lower(v_booking.period) - (v_booking.cancel_limit_hours || ' hours')::interval THEN
    RETURN jsonb_build_object('error', 'too_late');
  END IF;

  UPDATE public.bookings
  SET status     = 'cancelled',
      updated_at = now()
  WHERE cancel_token = p_cancel_token;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ------------------------------------------------------------
-- get_booking_by_token
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_booking_by_token(
  p_cancel_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id',                b.id,
    'status',            b.status,
    'customer_name',     b.customer_name,
    'customer_phone',    b.customer_phone,
    'price_total',       b.price_total,
    'amount_paid',       b.amount_paid,
    'payment_status',    b.payment_status,
    'cancel_token',      b.cancel_token,
    'cancel_limit_hours', v.cancel_limit_hours,
    'venue_name',        v.name,
    'venue_phone',       v.phone,
    'venue_address',     v.address,
    'court_name',        c.name,
    'period_start',      lower(b.period),
    'period_end',        upper(b.period)
  )
  INTO v_result
  FROM public.bookings b
  JOIN public.venues v ON v.id = b.venue_id
  JOIN public.courts c ON c.id = b.court_id
  WHERE b.cancel_token = p_cancel_token;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------
-- Permisos
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_booking(uuid, uuid, timestamptz, timestamptz, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_booking_by_token(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_booking_by_token(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_booking(uuid, uuid, timestamptz, timestamptz, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_by_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_booking_by_token(text) TO anon, authenticated;
