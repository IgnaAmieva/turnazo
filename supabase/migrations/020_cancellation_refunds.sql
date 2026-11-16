-- ============================================================
-- 020_cancellation_refunds.sql — Fase 6, Bloque 5: cancelación del
-- jugador con devolución + cron de reintento de devoluciones
-- ============================================================
-- Aplica DESPUÉS de 019_confirm_order_payment.sql.
--
-- 1. cancel_booking_by_token v3
--    - Reserva sin pago online: igual que antes (too_late si pasó
--      cancel_limit_hours; cancela y avisa al dueño).
--    - Reserva pagada online (fila en payments con status 'approved'):
--        · dentro del plazo y refund_policy = 'full' → cancela y marca el
--          pago como 'refund_pending'; el servidor hace la devolución en
--          Mercado Pago (si falla, el cron la reintenta).
--        · fuera del plazo o refund_policy = 'none' → cancela SIN
--          devolución (la pantalla avisa antes de confirmar).
--        · el turno ya empezó → too_late.
--    - Devuelve: success, booking_id, venue_id, refund_due, refund_amount,
--      amount_paid, mp_order_id, mp_payment_id.
--    - notification_outbox 'booking_cancelled' ahora lleva amount_paid,
--      refund_due y refund_amount para que el aviso al dueño diga si hubo
--      devolución.
--
-- 2. get_booking_by_token v2: agrega refund_policy, refund_available
--    (hay un pago online 'approved' que se puede devolver) y refund_status
--    (estado del último pago: approved / refund_pending / refunded /
--    refund_failed / null) para que /turnos/[token] avise ANTES de
--    cancelar y muestre el resultado después.
--
-- 3. refund_retry_cron(): cada 30 minutos llama a /api/mp/refund-retry
--    con el secreto compartido de los crons (mismo header x-push-secret
--    que push_send_cron). Configurar en Vault una sola vez:
--      SELECT vault.create_secret('https://<dominio>/api/mp/refund-retry',
--             'refund_retry_url', 'URL del endpoint de reintento de devoluciones');
--    (reutiliza el secreto 'push_secret' ya creado para push_send_cron).
--
-- Probada el 2026-11-15 en una sola sentencia DO con rollback total
-- (ver ESTADO.md, Bloque 5).
-- ============================================================

-- ── 1. cancel_booking_by_token v3 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_booking_by_token(
  p_cancel_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_booking     record;
  v_pay         record;
  v_paid_online boolean := false;
  v_within      boolean;
  v_refund_due  boolean := false;
BEGIN
  SELECT b.*, v.cancel_limit_hours, v.refund_policy
  INTO v_booking
  FROM public.bookings b
  JOIN public.venues   v ON v.id = b.venue_id
  WHERE b.cancel_token = p_cancel_token
    AND b.status = 'confirmed'
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  -- Pago online que se puede devolver: fila en payments acreditada por MP.
  -- (Un "pagado" marcado a mano por el dueño no tiene fila: no hay qué devolver.)
  SELECT * INTO v_pay
  FROM public.payments
  WHERE booking_id = v_booking.id
    AND status = 'approved'
  ORDER BY created_at DESC
  LIMIT 1;
  v_paid_online := FOUND AND v_booking.amount_paid > 0;

  v_within := now() <= lower(v_booking.period) - (v_booking.cancel_limit_hours || ' hours')::interval;

  IF NOT v_paid_online THEN
    -- Sin pago online: igual que siempre.
    IF NOT v_within THEN
      RETURN jsonb_build_object('error', 'too_late');
    END IF;
  ELSE
    -- Con pago online se puede cancelar hasta que empieza el turno;
    -- la devolución depende del plazo y de la política del complejo.
    IF now() >= lower(v_booking.period) THEN
      RETURN jsonb_build_object('error', 'too_late');
    END IF;
    v_refund_due := v_within AND v_booking.refund_policy = 'full';
  END IF;

  UPDATE public.bookings
  SET status     = 'cancelled',
      updated_at = now()
  WHERE id = v_booking.id;

  IF v_refund_due THEN
    UPDATE public.payments
    SET status     = 'refund_pending',
        raw        = COALESCE(raw, '{}'::jsonb) || jsonb_build_object('reason', 'player_cancelled'),
        updated_at = now()
    WHERE id = v_pay.id;
  END IF;

  INSERT INTO public.notification_outbox (venue_id, type, payload)
  VALUES (
    v_booking.venue_id,
    'booking_cancelled',
    jsonb_build_object(
      'booking_id',     v_booking.id,
      'customer_name',  v_booking.customer_name,
      'customer_phone', v_booking.customer_phone,
      'start',          lower(v_booking.period),
      'amount_paid',    v_booking.amount_paid,
      'refund_due',     v_refund_due,
      'refund_amount',  CASE WHEN v_refund_due THEN v_pay.amount ELSE 0 END
    )
  );

  RETURN jsonb_build_object(
    'success',       true,
    'booking_id',    v_booking.id,
    'venue_id',      v_booking.venue_id,
    'amount_paid',   v_booking.amount_paid,
    'refund_due',    v_refund_due,
    'refund_amount', CASE WHEN v_refund_due THEN v_pay.amount ELSE 0 END,
    'mp_order_id',   CASE WHEN v_refund_due THEN v_pay.mp_order_id   ELSE NULL END,
    'mp_payment_id', CASE WHEN v_refund_due THEN v_pay.mp_payment_id ELSE NULL END,
    'payment_type',  CASE WHEN v_refund_due THEN v_pay.type::text    ELSE NULL END
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.cancel_booking_by_token(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cancel_booking_by_token(text) TO anon, authenticated;

-- ── 2. get_booking_by_token v2 ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_booking_by_token(
  p_cancel_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id',                 b.id,
    'status',             b.status,
    'customer_name',      b.customer_name,
    'customer_phone',     b.customer_phone,
    'price_total',        b.price_total,
    'amount_paid',        b.amount_paid,
    'payment_status',     b.payment_status,
    'cancel_token',       b.cancel_token,
    'cancel_limit_hours', v.cancel_limit_hours,
    'refund_policy',      v.refund_policy,
    'refund_available',   EXISTS (
                            SELECT 1 FROM public.payments p
                            WHERE p.booking_id = b.id AND p.status = 'approved'
                          ) AND b.amount_paid > 0,
    'refund_status',      (
                            SELECT p.status FROM public.payments p
                            WHERE p.booking_id = b.id
                            ORDER BY p.created_at DESC
                            LIMIT 1
                          ),
    'venue_name',         v.name,
    'venue_phone',        v.phone,
    'venue_address',      v.address,
    'court_name',         c.name,
    'period_start',       lower(b.period),
    'period_end',         upper(b.period)
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
$fn$;

REVOKE EXECUTE ON FUNCTION public.get_booking_by_token(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_booking_by_token(text) TO anon, authenticated;

-- ── 3. refund_retry_cron() + cron cada 30 minutos ────────────────────────
CREATE OR REPLACE FUNCTION public.refund_retry_cron()
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
  WHERE name = 'refund_retry_url'
  LIMIT 1;

  IF v_url IS NULL OR v_url = '' THEN
    RETURN; -- no configurado en Vault, skip silencioso
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

REVOKE EXECUTE ON FUNCTION public.refund_retry_cron() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('turnazo-refund-retry') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'turnazo-refund-retry'
);
SELECT cron.schedule(
  'turnazo-refund-retry',
  '*/30 * * * *',
  'SELECT public.refund_retry_cron()'
);
