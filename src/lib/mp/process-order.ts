/**
 * Núcleo compartido por el webhook (/api/mp/webhook) y la reconciliación
 * de la pantalla /pago: dado el id de una orden de Mercado Pago, consulta
 * la orden en MP con el token del dueño del complejo, verifica que esté
 * pagada y que coincida con la reserva, y la confirma en la base
 * (confirm_order_payment, migración 019). Si la reserva ya no se puede
 * confirmar (horario tomado, cancelada, cobro duplicado) devuelve la plata.
 *
 * Nunca se confía en el cuerpo del webhook: todo sale de GET /v1/orders/{id}.
 * Nunca se loguean tokens ni respuestas completas: solo ids y códigos.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { getMpToken } from "@/lib/mp/token";
import { getMpOrder, isMpOrderPaid, mpOrderPaymentId, type MpOrder } from "@/lib/mp/orders";
import { refundPayment, CANCEL_REFUND_REASONS } from "@/lib/mp/refunds";
import { triggerPushSend } from "@/lib/push";

export type ProcessOutcome =
  /** Reserva confirmada ahora */
  | { outcome: "confirmed" }
  /** Ya estaba confirmada con este pago (reintento) */
  | { outcome: "already_confirmed" }
  /** La orden todavía no está pagada (created, processing, failed, canceled…) */
  | { outcome: "not_paid"; orderStatus: string }
  /** Ninguna reserva tiene ese mp_order_id */
  | { outcome: "booking_not_found" }
  /** Pagada pero no coincide con la reserva (moneda, monto, external_reference): no se toca; queda en audit_log y se avisa al dueño */
  | { outcome: "mismatch"; detail: string }
  /** No se pudo confirmar (slot_taken / booking_cancelled / already_paid) y se devolvió la plata */
  | { outcome: "refunded"; reason: string }
  /** El pago ya estaba registrado (ej. ya reembolsado): nada que hacer */
  | { outcome: "already_recorded" }
  /** Falla nuestra o de MP: el llamador debe reintentar (webhook → 500) */
  | { outcome: "error"; detail: string }
  /** No se pudo confirmar y el reembolso falló: queda 'refund_failed' en payments; reintentar (webhook → 500, cron) */
  | { outcome: "refund_failed"; reason: string; detail: string };

const REFUND_REASONS = new Set(["slot_taken", "booking_cancelled", "already_paid", "booking_not_payable"]);

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Copia de la orden sin campos sensibles, para guardar en payments.raw. */
function sanitizeOrder(order: MpOrder): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...order };
  delete copy.client_token;
  delete copy.payer;
  return copy;
}

/** Inicio del período de una reserva (tstzrange como string de PostgREST). */
function periodStart(period: unknown): string | null {
  if (typeof period !== "string") return null;
  const inner = period.replace(/^[\[(]/, "").replace(/[\])]$/, "");
  const start = inner.slice(0, inner.indexOf(",")).trim().replace(/"/g, "");
  const d = new Date(start);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

type BookingRow = {
  id: string;
  venue_id: string;
  status: string;
  deposit_amount: number | null;
  price_total: number | null;
  mp_order_id: string | null;
  customer_name: string | null;
  period: unknown;
};

/**
 * Pago que no coincide con la reserva: la plata quedó en la cuenta del dueño
 * y la reserva no se confirmó. Queda en audit_log (`payment_mismatch`) y se
 * avisa al dueño por notification_outbox. Una sola vez por (reserva, orden):
 * si el webhook llega varias veces no se duplica.
 */
async function recordMismatch(
  admin: ReturnType<typeof createAdminClient>,
  booking: BookingRow,
  orderId: string,
  paymentId: string | null,
  paidAmount: number | null,
  detail: string,
  tag: string,
) {
  const { data: prev, error: prevErr } = await admin
    .from("audit_log")
    .select("id")
    .eq("action", "payment_mismatch")
    .eq("entity", "payment")
    .eq("entity_id", booking.id)
    .contains("new_data", { mp_order_id: orderId })
    .limit(1);
  if (prevErr) {
    console.error(tag, "mismatch lookup failed", booking.id, prevErr.message);
    return;
  }
  if (prev && prev.length > 0) return;

  const { error: auditErr } = await admin.from("audit_log").insert({
    profile_id: null,
    venue_id:   booking.venue_id,
    entity:     "payment",
    entity_id:  booking.id,
    action:     "payment_mismatch",
    new_data: {
      booking_id:      booking.id,
      mp_order_id:     orderId,
      mp_payment_id:   paymentId,
      paid_amount:     paidAmount,
      expected_amount: num(booking.deposit_amount),
      detail,
    },
  });
  if (auditErr) {
    console.error(tag, "mismatch audit insert failed", booking.id, auditErr.message);
    return;
  }

  const { error: outErr } = await admin.from("notification_outbox").insert({
    venue_id: booking.venue_id,
    type:     "payment_mismatch",
    payload: {
      booking_id:      booking.id,
      customer_name:   booking.customer_name,
      start:           periodStart(booking.period),
      mp_order_id:     orderId,
      paid_amount:     paidAmount,
      expected_amount: num(booking.deposit_amount),
    },
  });
  if (outErr) console.error(tag, "mismatch outbox insert failed", booking.id, outErr.message);
  else void triggerPushSend();
}

export async function processMpOrder(orderId: string, source: "webhook" | "reconcile"): Promise<ProcessOutcome> {
  const admin = createAdminClient();
  const tag = `[mp/${source}]`;

  // 1. Reserva por id de orden
  const { data: booking, error: bErr } = await admin
    .from("bookings")
    .select("id, venue_id, status, deposit_amount, price_total, mp_order_id, customer_name, period")
    .eq("mp_order_id", orderId)
    .maybeSingle();

  if (bErr) {
    console.error(tag, "lookup failed", orderId, bErr.message);
    return { outcome: "error", detail: "booking_lookup_failed" };
  }
  if (!booking) {
    console.warn(tag, "order without booking", orderId);
    return { outcome: "booking_not_found" };
  }

  // 2. Token del dueño de ESE complejo
  const token = await getMpToken(booking.venue_id);
  if (!token) {
    console.error(tag, "no MP token for venue", booking.venue_id, "booking", booking.id);
    return { outcome: "error", detail: "no_token" };
  }

  // 3. Estado real de la orden en MP
  const orderRes = await getMpOrder(token.accessToken, orderId);
  if (!orderRes.ok) {
    console.error(tag, "get order failed", orderId, orderRes.status, orderRes.code);
    return { outcome: "error", detail: `get_order_${orderRes.code}` };
  }
  const order = orderRes.order;

  if (!isMpOrderPaid(order)) {
    return { outcome: "not_paid", orderStatus: `${order.status}/${order.status_detail ?? ""}` };
  }

  // 4. Verificaciones: moneda, monto, external_reference, id de pago
  const paidAmount = num(order.total_paid_amount) ?? num(order.total_amount);
  const expected = num(booking.deposit_amount);
  const paymentId = mpOrderPaymentId(order);

  const problems: string[] = [];
  if (order.currency !== "ARS") problems.push(`currency=${order.currency}`);
  if (order.external_reference !== booking.id) problems.push("external_reference");
  if (paidAmount === null || expected === null || paidAmount !== expected) problems.push(`amount=${paidAmount}≠${expected}`);
  if (!paymentId) problems.push("no_payment_id");

  if (problems.length > 0) {
    const detail = problems.join(",");
    console.error(tag, "order/booking mismatch", orderId, booking.id, detail);
    await recordMismatch(admin, booking, orderId, paymentId, paidAmount, detail, tag);
    return { outcome: "mismatch", detail };
  }

  const paymentType = expected! >= Number(booking.price_total) ? "full" : "deposit";

  // 5. Confirmar en una sola transacción (migración 019)
  const { data: result, error: rpcErr } = await admin.rpc("confirm_order_payment", {
    p_booking_id:    booking.id,
    p_mp_order_id:   orderId,
    p_mp_payment_id: paymentId!,
    p_amount:        paidAmount!,
    p_raw:           sanitizeOrder(order) as never,
  });

  if (rpcErr) {
    console.error(tag, "confirm_order_payment failed", booking.id, rpcErr.message);
    return { outcome: "error", detail: "confirm_rpc_failed" };
  }

  const res = (result ?? {}) as Record<string, unknown>;

  if (res.ok === true) {
    void triggerPushSend();
    return { outcome: res.already_processed === true ? "already_confirmed" : "confirmed" };
  }

  const code = String(res.error ?? "unknown");

  if (code === "payment_already_recorded") {
    const recorded = String(res.recorded_status ?? "");
    // Devolución que falló antes: volver a intentarla (misma clave de
    // idempotencia). Si no, MP deja de reintentar y el jugador nunca cobra.
    if (recorded === "refund_failed" || recorded === "refund_pending") {
      const { data: prevPay } = await admin
        .from("payments").select("raw").eq("mp_payment_id", paymentId!).maybeSingle();
      const prevReason = String(((prevPay?.raw ?? {}) as Record<string, unknown>).reason ?? "retry");
      const retry = await refundPayment(admin, {
        bookingId: booking.id, venueId: booking.venue_id, orderId, paymentId: paymentId!,
        amount: paidAmount!, paymentType, reason: prevReason, source,
        markBookingRefunded: CANCEL_REFUND_REASONS.has(prevReason),
      });
      return retry.ok
        ? { outcome: "refunded", reason: prevReason }
        : { outcome: "refund_failed", reason: prevReason, detail: retry.code };
    }
    return { outcome: "already_recorded" };
  }

  if (code === "amount_mismatch" || code === "order_mismatch") {
    console.error(tag, "confirm rejected", booking.id, code);
    await recordMismatch(admin, booking, orderId, paymentId, paidAmount, code, tag);
    return { outcome: "mismatch", detail: code };
  }

  if (!REFUND_REASONS.has(code)) {
    console.error(tag, "confirm unexpected error", booking.id, code);
    return { outcome: "error", detail: code };
  }

  // 6. No se puede confirmar: devolver la plata y dejarlo registrado
  const refund = await refundPayment(admin, {
    bookingId: booking.id, venueId: booking.venue_id, orderId, paymentId: paymentId!,
    amount: paidAmount!, paymentType, reason: code, source,
  });

  if (!refund.ok) {
    return { outcome: "refund_failed", reason: code, detail: refund.code };
  }
  return { outcome: "refunded", reason: code };
}
