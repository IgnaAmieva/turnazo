/**
 * POST /api/mp/refund-retry
 *
 * Reintenta las devoluciones que quedaron en `payments.status`
 * 'refund_failed' o 'refund_pending'. Lo llama pg_cron cada 30 minutos
 * (migración 020, `refund_retry_cron()`), con el mismo secreto compartido
 * que el cron de push (`x-push-secret` = PUSH_SEND_SECRET).
 *
 * Idempotente: cada devolución usa la clave `refund-<mp_payment_id>`, así que
 * reintentar nunca devuelve dos veces.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { retryPendingRefunds } from "@/lib/mp/refunds";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = process.env.PUSH_SEND_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "PUSH_SEND_SECRET not configured" }, { status: 500 });
  }
  const headerSecret = req.headers.get("x-push-secret");
  if (!headerSecret || headerSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await retryPendingRefunds(createAdminClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[mp/refund-retry]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "retry_failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
