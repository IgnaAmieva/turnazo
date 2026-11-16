/**
 * Reembolso de un pago de Mercado Pago, compartido por:
 *   - el webhook / reconciliación (pago que no se puede confirmar),
 *   - la cancelación del jugador con devolución,
 *   - el cron de reintentos (/api/mp/refund-retry).
 *
 * Idempotente: la clave de idempotencia es siempre `refund-<mp_payment_id>`,
 * así que repetir el reembolso nunca devuelve la plata dos veces
 * (409 order_already_refunded / idempotency_key_already_used = éxito).
 *
 * Deja siempre rastro: fila en `payments` (status 'refunded' o
 * 'refund_failed', con `raw.reason`) y fila en `audit_log`
 * (`entity: payment`, `action: refund` / `refund_failed`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getMpToken } from "@/lib/mp/token";
import { refundMpOrder } from "@/lib/mp/orders";

export type RefundInput = {
  bookingId: string;
  venueId: string;
  orderId: string;
  paymentId: string;
  amount: number;
  /** 'deposit' | 'full' para la fila de payments si todavía no existe */
  paymentType: "deposit" | "full";
  /** slot_taken | booking_cancelled | already_paid | player_cancelled | owner_cancelled | retry */
  reason: string;
  source: string;
  /** Marcar la reserva como payment_status 'refunded' si sale bien (cancelación del jugador o del dueño) */
  markBookingRefunded?: boolean;
};

export type RefundResult =
  | { ok: true; alreadyRefunded: boolean }
  | { ok: false; code: string };

export async function refundPayment(
  admin: SupabaseClient<Database>,
  input: RefundInput,
): Promise<RefundResult> {
  const tag = `[mp/refund/${input.source}]`;

  const token = await getMpToken(input.venueId);
  const refund = token
    ? await refundMpOrder(token.accessToken, input.orderId, `refund-${input.paymentId}`)
    : ({ ok: false, status: 0, code: "no_token", message: "sin token del dueño" } as const);

  const status = refund.ok ? "refunded" : "refund_failed";

  // Conserva raw.reason original si la fila ya existía (reintento).
  const { data: existing } = await admin
    .from("payments")
    .select("raw")
    .eq("mp_payment_id", input.paymentId)
    .maybeSingle();
  const prevRaw = (existing?.raw && typeof existing.raw === "object" && !Array.isArray(existing.raw)
    ? existing.raw
    : {}) as Record<string, unknown>;

  const { error: payErr } = await admin.from("payments").upsert(
    {
      booking_id:    input.bookingId,
      mp_order_id:   input.orderId,
      mp_payment_id: input.paymentId,
      amount:        input.amount,
      type:          input.paymentType,
      status,
      platform_fee:  0,
      currency:      "ARS",
      raw: {
        ...prevRaw,
        reason:         (prevRaw.reason as string | undefined) ?? input.reason,
        refund_source:  input.source,
        refund:         refund.ok ? "ok" : { status: refund.status, code: refund.code },
        refund_attempts: Number(prevRaw.refund_attempts ?? 0) + 1,
      } as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "mp_payment_id" },
  );
  if (payErr) console.error(tag, "could not record refund", input.bookingId, payErr.message);

  if (refund.ok && input.markBookingRefunded) {
    const { error: bErr } = await admin
      .from("bookings")
      .update({ payment_status: "refunded", updated_at: new Date().toISOString() })
      .eq("id", input.bookingId);
    if (bErr) console.error(tag, "could not mark booking refunded", input.bookingId, bErr.message);
  }

  const { error: auditErr } = await admin.from("audit_log").insert({
    profile_id: null,
    venue_id:   input.venueId,
    entity:     "payment",
    entity_id:  input.bookingId,
    action:     refund.ok ? "refund" : "refund_failed",
    new_data: {
      booking_id:    input.bookingId,
      mp_order_id:   input.orderId,
      mp_payment_id: input.paymentId,
      amount:        input.amount,
      reason:        input.reason,
      source:        input.source,
      ...(refund.ok ? {} : { error: refund.code }),
    },
  });
  if (auditErr) console.error(tag, "audit_log insert failed", input.bookingId, auditErr.message);

  if (!refund.ok) {
    console.error(tag, "refund failed", input.bookingId, input.orderId, refund.status, refund.code);
    return { ok: false, code: refund.code };
  }
  return { ok: true, alreadyRefunded: refund.alreadyRefunded };
}

/** Pagos con devolución pendiente o fallida: los reintenta el cron. */
export const RETRYABLE_REFUND_STATUSES = ["refund_failed", "refund_pending"] as const;

/**
 * Motivos en los que la reserva sigue existiendo (cancelada) y, cuando la
 * devolución sale, hay que dejarla en payment_status 'refunded'. En los demás
 * (slot_taken, already_paid…) la reserva nunca se confirmó con ese pago.
 */
export const CANCEL_REFUND_REASONS = new Set(["player_cancelled", "owner_cancelled"]);

/**
 * Reintenta las devoluciones que quedaron en 'refund_failed' / 'refund_pending'.
 * Solo toma filas que no se tocaron en los últimos `minAgeMs` para no pisarse
 * con una devolución en curso.
 */
export async function retryPendingRefunds(
  admin: SupabaseClient<Database>,
  opts: { limit?: number; minAgeMs?: number } = {},
): Promise<{ attempted: number; refunded: number; failed: number }> {
  const limit = opts.limit ?? 20;
  const cutoff = new Date(Date.now() - (opts.minAgeMs ?? 2 * 60 * 1000)).toISOString();

  const { data: rows, error } = await admin
    .from("payments")
    .select("booking_id, mp_order_id, mp_payment_id, amount, type, raw, bookings(venue_id)")
    .in("status", [...RETRYABLE_REFUND_STATUSES])
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  let refunded = 0;
  let failed = 0;
  for (const row of rows ?? []) {
    const venueId = (row.bookings as { venue_id: string } | null)?.venue_id;
    if (!venueId || !row.mp_order_id) { failed++; continue; }
    const raw = (row.raw ?? {}) as Record<string, unknown>;
    const res = await refundPayment(admin, {
      bookingId:   row.booking_id,
      venueId,
      orderId:     row.mp_order_id,
      paymentId:   row.mp_payment_id,
      amount:      Number(row.amount),
      paymentType: row.type,
      reason:      String(raw.reason ?? "retry"),
      source:      "cron",
      markBookingRefunded: CANCEL_REFUND_REASONS.has(String(raw.reason)),
    });
    if (res.ok) refunded++; else failed++;
  }
  return { attempted: (rows ?? []).length, refunded, failed };
}
