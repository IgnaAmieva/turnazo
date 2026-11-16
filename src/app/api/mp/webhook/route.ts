/**
 * POST /api/mp/webhook — notificaciones de Mercado Pago (tema "order").
 *
 * 1. Verifica x-signature (manifiesto con data.id, x-request-id y ts;
 *    HMAC-SHA256 con MP_WEBHOOK_SECRET; comparación en tiempo constante;
 *    ts con tolerancia de 5 minutos). Firma inválida → 401 y nada más.
 * 2. Idempotencia con webhook_events (provider, event_id).
 * 3. No confía en el body: processMpOrder consulta la orden en MP con el
 *    token del dueño y la confirma (o reembolsa) en la base.
 * 4. 200 si se procesó o no había nada que hacer; 500 si falló algo de
 *    nuestro lado (MP reintenta cada 15 minutos).
 *
 * Nunca se loguean tokens ni el body completo.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyMpSignature } from "@/lib/mp/webhook-signature";
import { processMpOrder, type ProcessOutcome } from "@/lib/mp/process-order";

export const runtime = "nodejs";

const PROVIDER = "mercadopago";

function eventStatus(outcome: ProcessOutcome): string {
  switch (outcome.outcome) {
    case "confirmed":
    case "already_confirmed":
      return "processed";
    case "refunded":
      return "refunded";
    case "mismatch":
      return "mismatch";
    case "error":
    case "refund_failed":
      return "failed";
    default:
      return "ignored";
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[mp/webhook] falta MP_WEBHOOK_SECRET");
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }

  const params = req.nextUrl.searchParams;
  const dataId = params.get("data.id") ?? params.get("data_id");
  const xRequestId = req.headers.get("x-request-id");

  const sig = verifyMpSignature({
    xSignature: req.headers.get("x-signature"),
    xRequestId,
    dataId,
    secret,
  });
  if (!sig.ok) {
    console.warn("[mp/webhook] firma rechazada:", sig.reason);
    return new NextResponse(null, { status: 401 });
  }

  // Body: solo para type / id de evento. El estado de la orden se consulta en MP.
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const data = (body.data ?? {}) as Record<string, unknown>;
  const type = params.get("type") ?? (typeof body.type === "string" ? body.type : null);
  const orderId = dataId ?? (typeof data.id === "string" ? data.id : null);

  if (type !== "order" || !orderId) {
    return NextResponse.json({ ignored: true });
  }

  const eventId = body.id !== undefined && body.id !== null
    ? String(body.id)
    : (xRequestId ?? `${orderId}:${sig.ts}`);

  const admin = createAdminClient();

  // Idempotencia: un evento ya procesado no se vuelve a procesar.
  const { data: existing, error: exErr } = await admin
    .from("webhook_events")
    .select("status")
    .eq("provider", PROVIDER)
    .eq("event_id", eventId)
    .maybeSingle();

  if (exErr) {
    console.error("[mp/webhook] webhook_events lookup failed:", exErr.message);
    return NextResponse.json({ error: "db" }, { status: 500 });
  }
  if (existing?.status === "processed" || existing?.status === "refunded") {
    return NextResponse.json({ duplicate: true });
  }
  if (!existing) {
    const { error: insErr } = await admin.from("webhook_events").insert({
      provider: PROVIDER,
      event_id: eventId,
      status:   "received",
      payload:  {
        type,
        action:     typeof body.action === "string" ? body.action : null,
        order_id:   orderId,
        request_id: xRequestId,
      },
    });
    // Carrera con otra entrega del mismo evento: seguimos, processMpOrder es idempotente.
    if (insErr && !insErr.message.includes("duplicate")) {
      console.error("[mp/webhook] webhook_events insert failed:", insErr.message);
      return NextResponse.json({ error: "db" }, { status: 500 });
    }
  }

  const outcome = await processMpOrder(orderId, "webhook");
  const status = eventStatus(outcome);

  await admin
    .from("webhook_events")
    .update({ status, processed_at: new Date().toISOString() })
    .eq("provider", PROVIDER)
    .eq("event_id", eventId);

  if (outcome.outcome === "error" || outcome.outcome === "refund_failed") {
    return NextResponse.json({ error: outcome.outcome }, { status: 500 });
  }

  return NextResponse.json({ ok: true, outcome: outcome.outcome });
}
