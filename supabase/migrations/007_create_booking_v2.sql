-- ============================================================
-- 007_create_booking_v2.sql — create_booking mejorado
-- ============================================================

-- 1. Reemplazar la constraint open_before_close para soportar
--    cierres después de medianoche (ej. open=23:00, close=00:30)
ALTER TABLE public.court_hours
  DROP CONSTRAINT open_before_close,
  ADD  CONSTRAINT open_different_from_close CHECK (open_time <> close_time);

-- 2. Función create_booking v2
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
  v_start_min     int;   -- minutos desde medianoche (Mendoza)
  v_end_min       int;   -- puede superar 1440 si cruza medianoche
  v_open_min      int;
  v_close_min     int;
  v_future_count  int;
BEGIN
  -- ── 1. Validaciones de período ────────────────────────────────
  IF p_start <= now() THEN
    RETURN jsonb_build_object('error', 'past_slot');
  END IF;
  IF p_end <= p_start THEN
    RETURN jsonb_build_object('error', 'invalid_period');
  END IF;

  -- ── 2. Normalizar y validar nombre y teléfono ─────────────────
  --    Se hace antes de cualquier consulta para fallar rápido.
  p_customer_name  := trim(p_customer_name);
  p_customer_phone := regexp_replace(p_customer_phone, '[^0-9]', '', 'g');

  IF char_length(p_customer_name) < 2 OR char_length(p_customer_name) > 80 THEN
    RETURN jsonb_build_object('error', 'invalid_name');
  END IF;
  IF char_length(p_customer_phone) < 8 OR char_length(p_customer_phone) > 15 THEN
    RETURN jsonb_build_object('error', 'invalid_phone');
  END IF;

  -- ── 3. Venue ──────────────────────────────────────────────────
  SELECT * INTO v_venue
  FROM public.venues
  WHERE id = p_venue_id AND status = 'approved';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'venue_not_found');
  END IF;
  IF v_venue.deposit_required THEN
    RETURN jsonb_build_object('error', 'deposit_required');
  END IF;

  -- ── 4. Cancha ─────────────────────────────────────────────────
  SELECT * INTO v_court
  FROM public.courts
  WHERE id = p_court_id AND venue_id = p_venue_id AND active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'court_not_found');
  END IF;

  -- ── 5. Duración exacta del slot ───────────────────────────────
  IF EXTRACT(EPOCH FROM (p_end - p_start)) / 60 != v_court.slot_minutes THEN
    RETURN jsonb_build_object('error', 'invalid_duration');
  END IF;

  -- ── 6. Horario de apertura con soporte de cruce de medianoche ─
  --
  --    Convertimos todo a "minutos desde medianoche":
  --      · close_time = '00:00:00'  → 1440 (fin de día)
  --      · close_time < open_time   → close_time + 1440 (ej. 00:30 → 1470)
  --    De esta forma v_end_min puede ser > 1440 sin problema.
  --
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
        WHEN close_time = '00:00:00'::time
          THEN 1440
        WHEN (EXTRACT(hour  FROM close_time)::int * 60
            + EXTRACT(minute FROM close_time)::int)
          < (EXTRACT(hour  FROM open_time)::int * 60
           + EXTRACT(minute FROM open_time)::int)
          THEN EXTRACT(hour  FROM close_time)::int * 60
             + EXTRACT(minute FROM close_time)::int + 1440
        ELSE
          EXTRACT(hour  FROM close_time)::int * 60
        + EXTRACT(minute FROM close_time)::int
      END
    ) >= v_end_min;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'outside_hours');
  END IF;

  -- ── 7. Alineación a la grilla ─────────────────────────────────
  --    El inicio debe ser un múltiplo de slot_minutes desde open_time.
  v_open_min := EXTRACT(hour  FROM v_court_hours.open_time)::int * 60
              + EXTRACT(minute FROM v_court_hours.open_time)::int;

  IF (v_start_min - v_open_min) % v_court.slot_minutes != 0 THEN
    RETURN jsonb_build_object('error', 'invalid_slot');
  END IF;

  -- ── 8. Teléfono bloqueado (usa el teléfono ya normalizado) ────
  PERFORM 1
  FROM public.blocked_phones
  WHERE venue_id = p_venue_id AND phone = p_customer_phone;

  IF FOUND THEN
    RETURN jsonb_build_object('error', 'phone_blocked');
  END IF;

  -- ── 9. Límite de abuso: máx 3 turnos futuros confirmados ──────
  SELECT COUNT(*) INTO v_future_count
  FROM public.bookings
  WHERE venue_id       = p_venue_id
    AND customer_phone = p_customer_phone
    AND status         = 'confirmed'
    AND lower(period)  > now();

  IF v_future_count >= 3 THEN
    RETURN jsonb_build_object('error', 'too_many_bookings');
  END IF;

  -- ── 10. Precio (obligatorio) ──────────────────────────────────
  SELECT price INTO v_price
  FROM public.court_prices
  WHERE court_id  = p_court_id
    AND weekday   = v_dow
    AND from_time <= v_start_time
    AND to_time   >  v_start_time
  LIMIT 1;

  IF v_price IS NULL THEN
    RETURN jsonb_build_object('error', 'price_not_set');
  END IF;

  -- ── 11. Token e inserción ─────────────────────────────────────
  v_cancel_token := replace(gen_random_uuid()::text, '-', '') ||
                    replace(gen_random_uuid()::text, '-', '');

  BEGIN
    INSERT INTO public.bookings (
      court_id, venue_id, period,
      kind, source, status,
      customer_name, customer_phone,
      price_total, deposit_amount, amount_paid,
      payment_status, cancel_token
    )
    VALUES (
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

  RETURN jsonb_build_object(
    'booking_id',   v_booking_id,
    'cancel_token', v_cancel_token,
    'price_total',  v_price
  );
END;
$$;
