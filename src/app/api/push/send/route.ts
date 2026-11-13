/**
 * POST /api/push/send
 *
 * Llamado por:
 *   - Server actions (envío inmediato después de crear/cancelar/pagar)
 *   - pg_cron cada minuto (red de seguridad para reintentos)
 *
 * Seguridad: requiere el header `x-push-secret` con el valor de
 * PUSH_SECRET. Rechaza todo lo demás con 401.
 *
 * Idempotente: procesar la misma fila dos veces no produce duplicados
 * (la primera corrida la marca como 'sent').
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPendingNotifications } from "@/lib/push";

export const runtime = "nodejs"; // web-push requiere Node.js, no Edge

export async function POST(req: NextRequest) {
  // ── Autenticación por secreto compartido ──────────────────────
  // El cron (migration 015) lee 'push_secret' de Vault y lo envía
  // en el header x-push-secret. La variable de entorno PUSH_SEND_SECRET
  // debe tener el mismo valor en Vercel.
  const secret = process.env.PUSH_SEND_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "PUSH_SEND_SECRET not configured" }, { status: 500 });
  }
  const headerSecret = req.headers.get("x-push-secret");
  if (!headerSecret || headerSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Cliente con service role (bypasa RLS) ─────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // ── Enviar notificaciones pendientes ──────────────────────────
  try {
    const result = await sendPendingNotifications(supabase);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[push/send]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// No permitir otros métodos
export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
