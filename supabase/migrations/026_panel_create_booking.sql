-- ============================================================
-- 026_panel_create_booking.sql — El dueño carga un turno desde la agenda
-- ============================================================
-- PROPUESTA, SIN APLICAR: la revisa y la aplica el revisor. Correr como postgres.
--
-- Para qué: la agenda nueva tiene "+ Cargar turno" en cada horario libre y
-- "+ Nuevo turno" abajo (el jugador llamó o escribió por WhatsApp). Desde la
-- 021 el dueño no escribe directo en bookings; hoy solo puede crear bloqueos
-- (panel_create_block). Esta función es igual a esa, pero crea un turno de un
-- jugador.
--
-- Qué hace:
--   - Verifica que el que llama sea el dueño del complejo (auth.uid()).
--   - Valida con _validate_booking_slot, LA MISMA que usan las reservas
--     públicas: no en el pasado ni a más de 30 días, dentro del horario de la
--     cancha, alineado a la grilla, duración = slot_minutes, nombre (2–80) y
--     celular (8–15 dígitos), teléfono no bloqueado, máximo 3 turnos futuros
--     por celular, y que el horario tenga precio (price_total sale de
--     court_prices, no del formulario).
--   - No pide seña ni pago online: el dueño cobra en el complejo. Queda
--     'confirmed' y 'unpaid', source = 'manual'.
--   - Horario ocupado (no_overlap) → 'slot_taken'.
--   - No escribe en notification_outbox: el aviso de "nueva reserva" es para
--     las que hace el jugador; acá el que carga es el dueño.
--   - Devuelve booking_id, price_total y cancel_token (el link "Mi turno" del
--     jugador, por si el dueño se lo quiere mandar).
--
-- Grants: como las otras panel_*: nada para PUBLIC ni anon; EXECUTE para
-- authenticated (la función verifica el dueño adentro).
-- ============================================================

CREATE OR REPLACE FUNCTION public.panel_create_booking(
  p_venue_id       uuid,
  p_court_id       uuid,
  p_start          timestamptz,
  p_end            timestamptz,
  p_customer_name  text,
  p_customer_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_val          record;
  v_id           uuid;
  v_cancel_token text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venues WHERE id = p_venue_id AND owner_id = v_uid) THEN
    RETURN jsonb_build_object('error', 'not_owner');
  END IF;

  SELECT * INTO v_val
  FROM public._validate_booking_slot(
    p_court_id, p_venue_id, p_start, p_end, p_customer_name, p_customer_phone
  );
  IF v_val.error_code IS NOT NULL THEN
    RETURN jsonb_build_object('error', v_val.error_code);
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
      'booking', 'manual', 'confirmed',
      v_val.norm_name, v_val.norm_phone,
      v_val.price_total, 0, 0,
      'unpaid', v_cancel_token
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RETURN jsonb_build_object('error', 'slot_taken');
  END;

  RETURN jsonb_build_object(
    'ok',           true,
    'booking_id',   v_id,
    'price_total',  v_val.price_total,
    'cancel_token', v_cancel_token
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.panel_create_booking(uuid, uuid, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.panel_create_booking(uuid, uuid, timestamptz, timestamptz, text, text) TO authenticated;
