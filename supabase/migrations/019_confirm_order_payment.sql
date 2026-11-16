-- ============================================================
-- 019_confirm_order_payment.sql — Fase 6, Bloque 4: confirmación del pago
-- ============================================================
-- Aplica DESPUÉS de 018_payment_rules.sql. No requiere variables nuevas.
--
-- confirm_order_payment(p_booking_id, p_mp_order_id, p_mp_payment_id,
--                       p_amount, p_raw)
--   La llama SOLO el servidor (service_role) desde el webhook de Mercado
--   Pago y desde la reconciliación de la pantalla /pago, DESPUÉS de haber
--   consultado la orden en MP y verificado estado, moneda, monto y
--   external_reference. En una sola transacción:
--
--   - Reserva ya confirmada con ESE pago → no hace nada
--     ({ ok, already_processed: true }). Idempotente ante reintentos.
--   - Reserva en hold o expired → pasa a confirmed, payment_status
--     'paid' si la seña cubre el precio total o 'deposit_paid' si no,
--     amount_paid = p_amount, fila en payments (status 'approved') y
--     fila en notification_outbox ('payment_received').
--   - El horario ya lo tomó otro (exclusion_violation del constraint
--     no_overlap) → { error: 'slot_taken' } sin tocar nada: el código
--     devuelve la plata.
--   - Reserva cancelada → { error: 'booking_cancelled' } (también se
--     devuelve la plata).
--   - Reserva confirmada con OTRO pago → { error: 'already_paid' }
--     (cobro duplicado: se devuelve).
--   - Pago ya registrado en payments pero la reserva no está confirmada
--     (ej. ya fue reembolsado) → { error: 'payment_already_recorded' }.
--   - mp_order_id distinto al de la reserva → { error: 'order_mismatch' }.
--   - Monto distinto a deposit_amount → { error: 'amount_mismatch' }
--     (defensa extra: el código ya lo verifica antes de llamar).
--
--   Probada el 2026-11-15 en una sola sentencia DO que crea la función,
--   recorre 11 escenarios (hold→deposit_paid + payments + outbox; repetido
--   → already_processed; otro pago → already_paid; cancelada; vencida con
--   horario tomado → slot_taken sin cambios; vencida con horario libre →
--   confirmed; seña = total → paid; amount_mismatch; order_mismatch;
--   booking_not_found; permisos anon/authenticated=no, service_role=sí)
--   y termina en RAISE EXCEPTION 'ROLLBACK_OK' (rollback total, nada quedó
--   en la base). Resultado: ROLLBACK_OK 1:ok 2:ok 3:ok ... 11:ok.
--   Ver ESTADO.md, Bloque 4.
-- ============================================================

CREATE OR REPLACE FUNCTION public.confirm_order_payment(
  p_booking_id    uuid,
  p_mp_order_id   text,
  p_mp_payment_id text,
  p_amount        numeric,
  p_raw           jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_b        record;
  v_pay      record;
  v_pstatus  public.payment_status;
  v_ptype    public.payment_type;
BEGIN
  IF p_booking_id IS NULL OR p_mp_order_id IS NULL OR p_mp_payment_id IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_params');
  END IF;

  -- Bloquea la reserva: dos webhooks/reconciliaciones a la vez se serializan.
  SELECT * INTO v_b
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'booking_not_found');
  END IF;

  -- Idempotencia: ¿este pago ya quedó registrado?
  SELECT * INTO v_pay
  FROM public.payments
  WHERE mp_payment_id = p_mp_payment_id;

  IF FOUND THEN
    IF v_pay.booking_id = p_booking_id AND v_b.status = 'confirmed' THEN
      RETURN jsonb_build_object(
        'ok', true,
        'already_processed', true,
        'status', v_b.status,
        'payment_status', v_b.payment_status
      );
    END IF;
    RETURN jsonb_build_object(
      'error', 'payment_already_recorded',
      'recorded_status', v_pay.status
    );
  END IF;

  IF v_b.mp_order_id IS DISTINCT FROM p_mp_order_id THEN
    RETURN jsonb_build_object('error', 'order_mismatch');
  END IF;

  IF v_b.status = 'cancelled' THEN
    RETURN jsonb_build_object('error', 'booking_cancelled');
  END IF;

  IF v_b.status = 'confirmed' THEN
    -- Confirmada con otro pago: este es un cobro duplicado
    RETURN jsonb_build_object('error', 'already_paid');
  END IF;

  IF v_b.status NOT IN ('hold', 'expired') THEN
    RETURN jsonb_build_object('error', 'booking_not_payable', 'status', v_b.status);
  END IF;

  IF p_amount IS NULL OR p_amount <= 0
     OR v_b.deposit_amount IS NULL OR p_amount <> v_b.deposit_amount THEN
    RETURN jsonb_build_object('error', 'amount_mismatch');
  END IF;

  IF v_b.deposit_amount >= v_b.price_total THEN
    v_pstatus := 'paid';
    v_ptype   := 'full';
  ELSE
    v_pstatus := 'deposit_paid';
    v_ptype   := 'deposit';
  END IF;

  -- Confirmar. Si el hold ya venció y otro tomó el horario, el constraint
  -- no_overlap (status in hold/confirmed) lo rechaza acá.
  BEGIN
    UPDATE public.bookings
    SET    status         = 'confirmed',
           payment_status = v_pstatus,
           amount_paid    = p_amount,
           updated_at     = now()
    WHERE  id = p_booking_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RETURN jsonb_build_object('error', 'slot_taken');
  END;

  INSERT INTO public.payments (
    booking_id, mp_order_id, mp_payment_id,
    amount, type, status, platform_fee, currency, raw
  ) VALUES (
    p_booking_id, p_mp_order_id, p_mp_payment_id,
    p_amount, v_ptype, 'approved', 0, 'ARS', COALESCE(p_raw, '{}'::jsonb)
  );

  INSERT INTO public.notification_outbox (venue_id, type, payload)
  VALUES (
    v_b.venue_id,
    'payment_received',
    jsonb_build_object(
      'booking_id',     p_booking_id,
      'customer_name',  v_b.customer_name,
      'customer_phone', v_b.customer_phone,
      'start',          lower(v_b.period),
      'end',            upper(v_b.period),
      'amount',         p_amount,
      'price_total',    v_b.price_total,
      'payment_status', v_pstatus,
      'online',         true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'already_processed', false,
    'status', 'confirmed',
    'payment_status', v_pstatus
  );
END;
$$;

-- Solo el servidor (service_role) puede llamarla. Nunca anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.confirm_order_payment(uuid, text, text, numeric, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirm_order_payment(uuid, text, text, numeric, jsonb)
  TO service_role;
