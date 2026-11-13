/**
 * Lógica de envío de notificaciones push (server-side).
 * Usado por /api/push/send y por las server actions directamente.
 */
import * as webpush from "web-push";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Configuración VAPID (lazy — se leen al primer uso)
// ---------------------------------------------------------------------------

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return;
  const pub  = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subj) {
    throw new Error("VAPID keys not configured (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT)");
  }
  webpush.setVapidDetails(subj, pub, priv);
  vapidConfigured = true;
}

// ---------------------------------------------------------------------------
// Backoff exponencial
// ---------------------------------------------------------------------------

/** Retorna los segundos a esperar según el número de intentos previos. */
export function backoffSeconds(attempts: number): number {
  // 0 intentos → 30 s, 1 → 2 min, 2 → 10 min, 3+ → 1 h
  const TABLE = [30, 120, 600, 3600];
  return TABLE[Math.min(attempts, TABLE.length - 1)];
}

export const MAX_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

export function buildPushPayload(type: string, payload: Record<string, unknown>) {
  switch (type) {
    case "booking_created":
      return {
        title: "Nuevo turno",
        body:  `${payload.customer_name ?? "Alguien"} reservó para las ${
          payload.start
            ? new Date(payload.start as string).toLocaleTimeString("es-AR", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "America/Argentina/Mendoza",
              })
            : "?"
        }`,
        url: "/panel/agenda",
        tag: `booking-${payload.booking_id}`,
      };
    case "booking_cancelled":
      return {
        title: "Turno cancelado",
        body:  `${payload.customer_name ?? "Un cliente"} canceló su turno`,
        url: "/panel/agenda",
        tag: `cancel-${payload.booking_id}`,
      };
    case "payment_received":
      return {
        title: "Pago recibido",
        body:  `${payload.customer_name ?? "Un cliente"} marcó su turno como pagado`,
        url: "/panel/agenda",
        tag: `pay-${payload.booking_id}`,
      };
    default:
      return {
        title: "Turnazo",
        body:  "Tenés una notificación nueva",
        url: "/panel/agenda",
        tag: "turnazo-notification",
      };
  }
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

interface OutboxRow {
  id: string;
  venue_id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

interface PushSubscription {
  id: string;
  profile_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

// ---------------------------------------------------------------------------
// sendPendingNotifications
// ---------------------------------------------------------------------------

/**
 * Lee notification_outbox pendientes, envía push a los dueños suscritos y
 * actualiza el estado (sent / failed + backoff).
 *
 * @param supabase  Cliente con service role (bypasa RLS).
 * @returns         Número de notificaciones procesadas.
 */
export async function sendPendingNotifications(
  supabase: SupabaseClient
): Promise<{ sent: number; failed: number; discarded: number }> {
  ensureVapid();

  const now = new Date().toISOString();

  // 0. Descartar filas obsoletas antes de procesar
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: discardedOld } = await supabase
    .from("notification_outbox")
    .update({ status: "discarded", updated_at: now }, { count: "exact" })
    .eq("status", "pending")
    .lt("created_at", cutoff24h);

  // 1. Leer filas pendientes (máx 50 por corrida)
  const { data: rows, error } = await supabase
    .from("notification_outbox")
    .select("id, venue_id, type, payload, attempts")
    .eq("status", "pending")
    .lte("next_attempt_at", now)
    .lt("attempts", MAX_ATTEMPTS)
    .order("next_attempt_at", { ascending: true })
    .limit(50);

  if (error) throw error;
  if (!rows || rows.length === 0) return { sent: 0, failed: 0, discarded: discardedOld ?? 0 };

  // 1b. Descartar filas cuyo booking_id ya no existe en la tabla bookings
  const bookingIds = (rows as OutboxRow[])
    .map((r) => r.payload.booking_id as string | undefined)
    .filter((id): id is string => !!id);

  const orphanIds = new Set<string>();
  if (bookingIds.length > 0) {
    const { data: existing } = await supabase
      .from("bookings")
      .select("id")
      .in("id", bookingIds);
    const existingSet = new Set((existing ?? []).map((b: { id: string }) => b.id));
    for (const id of bookingIds) {
      if (!existingSet.has(id)) orphanIds.add(id);
    }
  }

  const toDiscard = (rows as OutboxRow[]).filter(
    (r) => r.payload.booking_id && orphanIds.has(r.payload.booking_id as string)
  );
  let discardedOrphan = 0;
  if (toDiscard.length > 0) {
    await supabase
      .from("notification_outbox")
      .update({ status: "discarded", updated_at: now })
      .in("id", toDiscard.map((r) => r.id));
    discardedOrphan = toDiscard.length;
  }

  const discardedTotal = (discardedOld ?? 0) + discardedOrphan;
  const activeRows = (rows as OutboxRow[]).filter((r) => !toDiscard.some((d) => d.id === r.id));
  if (activeRows.length === 0) return { sent: 0, failed: 0, discarded: discardedTotal };

  let sent = 0;
  let failed = 0;

  for (const row of activeRows) {
    // 2. Buscar suscripciones del dueño del venue
    const { data: venueOwner } = await supabase
      .from("venues")
      .select("owner_id")
      .eq("id", row.venue_id)
      .single();

    if (!venueOwner) {
      await markFailed(supabase, row);
      failed++;
      continue;
    }

    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("profile_id", venueOwner.owner_id);

    if (!subscriptions || subscriptions.length === 0) {
      // Sin suscripciones: marcar como sent (no hay a quién enviar)
      await supabase
        .from("notification_outbox")
        .update({ status: "sent", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      sent++;
      continue;
    }

    const pushPayload = buildPushPayload(row.type, row.payload);
    let rowSent = false;

    for (const sub of subscriptions as PushSubscription[]) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(pushPayload)
        );
        rowSent = true;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Suscripción inválida: borrar
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
        // Si falla una suscripción pero hay otras, seguimos
      }
    }

    if (rowSent) {
      await supabase
        .from("notification_outbox")
        .update({ status: "sent", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      sent++;
    } else {
      await markFailed(supabase, row);
      failed++;
    }
  }

  return { sent, failed, discarded: discardedTotal };
}

// ---------------------------------------------------------------------------
// triggerPushSend — llamar desde server actions para envío inmediato
// ---------------------------------------------------------------------------

/**
 * Crea un cliente service-role y llama sendPendingNotifications.
 * Los errores se tragan: el turno/pago ya está guardado; el push es best-effort.
 */
export async function triggerPushSend(): Promise<void> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    const supabase = createServiceClient(url, key, { auth: { persistSession: false } });
    await sendPendingNotifications(supabase);
  } catch (err) {
    console.error("[push] triggerPushSend:", err);
  }
}

async function markFailed(supabase: SupabaseClient, row: OutboxRow) {
  const newAttempts = row.attempts + 1;
  const nextAt = new Date(
    Date.now() + backoffSeconds(newAttempts) * 1000
  ).toISOString();

  const newStatus = newAttempts >= MAX_ATTEMPTS ? "failed" : "pending";

  await supabase
    .from("notification_outbox")
    .update({
      status:          newStatus,
      attempts:        newAttempts,
      next_attempt_at: nextAt,
      updated_at:      new Date().toISOString(),
    })
    .eq("id", row.id);
}
