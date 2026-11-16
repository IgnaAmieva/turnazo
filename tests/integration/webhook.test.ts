/**
 * Fase 6, Bloque 4 — confirmación del pago por webhook, con Mercado Pago simulado.
 *
 * Corre la ruta real POST /api/mp/webhook y la reconciliación de /pago contra
 * la base real (fixture propio), con mocks de:
 *   - getMpToken    → token falso (o null)
 *   - getMpOrder    → orden falsa (pagada / no pagada / con otro monto)
 *   - refundMpOrder → reembolso simulado (ok / falla)
 *   - triggerPushSend → espía
 * Nunca se llama a la API real de Mercado Pago.
 *
 * Los tests marcados "(migración 019)" necesitan confirm_order_payment en la
 * base: quedan rojos hasta que el revisor aplique 019.
 *
 * Limpieza: afterAll borra todo lo que creó el fixture (payments primero por FK).
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { NextRequest } from "next/server";
import { buildMpManifest, signMpManifest } from "@/lib/mp/webhook-signature";

// ---------------------------------------------------------------------------
// Mocks (antes de importar la ruta)
// ---------------------------------------------------------------------------

const SECRET = "whsec-test-" + randomBytes(8).toString("hex");
process.env.MP_WEBHOOK_SECRET = SECRET;

const getMpTokenMock    = vi.fn();
const getMpOrderMock    = vi.fn();
const refundMpOrderMock = vi.fn();
const pushMock          = vi.fn();

vi.mock("@/lib/mp/token", () => ({
  getMpToken: (venueId: string) => getMpTokenMock(venueId),
}));
vi.mock("@/lib/mp/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mp/orders")>();
  return {
    ...actual,
    getMpOrder:    (...args: unknown[]) => getMpOrderMock(...args),
    refundMpOrder: (...args: unknown[]) => refundMpOrderMock(...args),
  };
});
vi.mock("@/lib/push", () => ({
  triggerPushSend: async () => { pushMock(); },
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("NEXT_REDIRECT " + url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => { throw new Error("no usado"); } }));

import { POST } from "@/app/api/mp/webhook/route";
import { reconcilePaymentAction } from "@/app/actions/payment";

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!supabaseUrl || !serviceKey) throw new Error("Faltan variables de entorno de Supabase");

const db = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let ownerUserId: string;
let venueId: string;
let courtId: string;
const PRICE = 5000;
const RUN = randomBytes(4).toString("hex");
const eventIds: string[] = [];

beforeAll(async () => {
  const { data: userData, error: userErr } = await db.auth.admin.createUser({
    email:         `test-webhook-${Date.now()}@turnazo.test`,
    password:      "TestPass123!",
    email_confirm: true,
  });
  if (userErr) throw userErr;
  ownerUserId = userData.user.id;
  await db.from("profiles").upsert({ id: ownerUserId, role: "owner" });

  const { data: loc }   = await db.from("localities").select("id").eq("slug", "tunuyan").single();
  const { data: sport } = await db.from("sports").select("id").eq("slug", "padel").single();

  const { data: venue, error: venueErr } = await db
    .from("venues")
    .insert({
      owner_id: ownerUserId, name: "Test Webhook Venue", phone: "2622000000", address: "Webhook 123",
      locality_id: loc!.id, lat: -33.6, lng: -69.0, status: "approved",
    })
    .select("id")
    .single();
  if (venueErr) throw venueErr;
  venueId = venue.id;

  const { data: court, error: courtErr } = await db
    .from("courts")
    .insert({ venue_id: venueId, sport_id: sport!.id, name: "Cancha Webhook", slot_minutes: 90, active: true })
    .select("id")
    .single();
  if (courtErr) throw courtErr;
  courtId = court.id;
}, 30_000);

afterAll(async () => {
  if (venueId) {
    const { data: bs } = await db.from("bookings").select("id").eq("venue_id", venueId);
    const ids = (bs ?? []).map((b) => b.id);
    if (ids.length) await db.from("payments").delete().in("booking_id", ids);
    await db.from("bookings").delete().eq("venue_id", venueId);
    await db.from("notification_outbox").delete().eq("venue_id", venueId);
    await db.from("audit_log").delete().eq("venue_id", venueId);
    await db.from("venues").delete().eq("id", venueId);
  }
  if (eventIds.length) await db.from("webhook_events").delete().eq("provider", "mercadopago").in("event_id", eventIds);
  if (ownerUserId) {
    await db.from("profiles").delete().eq("id", ownerUserId);
    await db.auth.admin.deleteUser(ownerUserId);
  }
}, 30_000);

beforeEach(async () => {
  getMpTokenMock.mockReset();
  getMpOrderMock.mockReset();
  refundMpOrderMock.mockReset();
  pushMock.mockReset();
  getMpTokenMock.mockResolvedValue({ accessToken: "APP_USR-fake", mpUserId: "test-webhook" });
  refundMpOrderMock.mockResolvedValue({ ok: true, alreadyRefunded: false });

  const { data: bs } = await db.from("bookings").select("id").eq("venue_id", venueId);
  const ids = (bs ?? []).map((b) => b.id);
  if (ids.length) await db.from("payments").delete().in("booking_id", ids);
  await db.from("bookings").delete().eq("venue_id", venueId);
  await db.from("notification_outbox").delete().eq("venue_id", venueId);
  await db.from("audit_log").delete().eq("venue_id", venueId);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Slot N días adelante a las 08:00 Mendoza (11:00 UTC), 90 min. */
function slotAt08(daysFromNow: number) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  const start = new Date(d.getTime() + 11 * 3600 * 1000);
  const end   = new Date(start.getTime() + 90 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

let seq = 0;
function newOrderId() {
  seq += 1;
  return `ORD-${RUN}-${seq}`;
}

/** Inserta una reserva como la dejaría startPaymentAction (hold con orden) u otro estado. */
async function insertBooking(opts: {
  slot: { start: string; end: string };
  status?: "hold" | "expired" | "cancelled" | "confirmed";
  deposit?: number;
  orderId?: string | null;
  phone?: string;
  holdExpiresInMs?: number;
}) {
  const status = opts.status ?? "hold";
  const orderId = opts.orderId === undefined ? newOrderId() : opts.orderId;
  const token = randomBytes(32).toString("hex");
  const { data, error } = await db
    .from("bookings")
    .insert({
      venue_id: venueId, court_id: courtId,
      period: `[${opts.slot.start},${opts.slot.end})`,
      kind: "booking", source: "app", status,
      customer_name: "Jugador Webhook", customer_phone: opts.phone ?? "2622400400",
      price_total: PRICE, deposit_amount: opts.deposit ?? 2500, amount_paid: 0,
      payment_status: "unpaid",
      cancel_token: token,
      hold_expires_at: status === "hold"
        ? new Date(Date.now() + (opts.holdExpiresInMs ?? 10 * 60 * 1000)).toISOString()
        : new Date(Date.now() - 60 * 1000).toISOString(),
      mp_order_id: orderId,
    })
    .select("id, cancel_token, mp_order_id")
    .single();
  if (error) throw error;
  return { id: data.id as string, token: data.cancel_token as string, orderId: data.mp_order_id as string | null };
}

async function getBooking(id: string) {
  const { data, error } = await db
    .from("bookings")
    .select("id, status, payment_status, amount_paid, mp_order_id")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

async function paymentsOf(bookingId: string) {
  const { data, error } = await db.from("payments").select("*").eq("booking_id", bookingId).order("created_at");
  if (error) throw error;
  return data;
}

async function eventRow(eventId: string) {
  const { data } = await db.from("webhook_events").select("status, processed_at, payload")
    .eq("provider", "mercadopago").eq("event_id", eventId).maybeSingle();
  return data;
}

/** Orden de MP tal como la devuelve GET /v1/orders/{id}. */
function mpOrder(orderId: string, bookingId: string, opts: {
  paid?: boolean; amount?: number; currency?: string; paymentId?: string; externalReference?: string;
} = {}) {
  const amount = (opts.amount ?? 2500).toFixed(2);
  const paid = opts.paid ?? true;
  return {
    id: orderId,
    status: paid ? "processed" : "created",
    status_detail: paid ? "accredited" : undefined,
    external_reference: opts.externalReference ?? bookingId,
    total_amount: amount,
    total_paid_amount: paid ? amount : "0.00",
    currency: opts.currency ?? "ARS",
    client_token: "SECRETO-NO-GUARDAR",
    transactions: {
      payments: paid
        ? [{ id: opts.paymentId ?? `PAY-${orderId}`, amount, paid_amount: amount, status: "processed", status_detail: "accredited" }]
        : [],
    },
  };
}

type ReqOpts = {
  secret?: string;
  ts?: number;
  requestId?: string | null;
  eventId?: string | null;
  type?: string;
  body?: Record<string, unknown>;
  signature?: string | null;
};

/** Request firmado como lo manda Mercado Pago. */
function webhookRequest(orderId: string, opts: ReqOpts = {}) {
  const ts = opts.ts ?? Date.now();
  const requestId = opts.requestId === undefined ? `req-${RUN}-${randomBytes(4).toString("hex")}` : opts.requestId;
  const eventId = opts.eventId === undefined ? `evt-${RUN}-${randomBytes(4).toString("hex")}` : opts.eventId;
  if (eventId) eventIds.push(eventId);
  const type = opts.type ?? "order";

  const url = `http://localhost:3001/api/mp/webhook?data.id=${encodeURIComponent(orderId)}&type=${type}`;
  const manifest = buildMpManifest({ dataId: orderId, requestId, ts: String(ts) });
  const signature = opts.signature === undefined
    ? `ts=${ts},v1=${signMpManifest(manifest, opts.secret ?? SECRET)}`
    : opts.signature;

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature) headers["x-signature"] = signature;
  if (requestId) headers["x-request-id"] = requestId;

  const body = opts.body ?? {
    id: eventId,
    action: "order.processed",
    type,
    live_mode: false,
    data: { id: orderId, status: "processed" },
  };

  return { req: new NextRequest(url, { method: "POST", headers, body: JSON.stringify(body) }), eventId };
}

async function post(orderId: string, opts: ReqOpts = {}) {
  const { req, eventId } = webhookRequest(orderId, opts);
  const res = await POST(req);
  const json = await res.json().catch(() => null);
  return { status: res.status, json, eventId };
}

// ---------------------------------------------------------------------------
// Firma
// ---------------------------------------------------------------------------

describe("POST /api/mp/webhook — firma", () => {
  it("firma inválida → 401 y no toca nada (ni consulta MP ni registra el evento)", async () => {
    const b = await insertBooking({ slot: slotAt08(2) });
    getMpOrderMock.mockResolvedValue({ ok: true, order: mpOrder(b.orderId!, b.id) });

    const { status, eventId } = await post(b.orderId!, { secret: "otra-clave" });
    expect(status).toBe(401);
    expect(getMpOrderMock).not.toHaveBeenCalled();
    expect((await getBooking(b.id)).status).toBe("hold");
    expect(await eventRow(eventId!)).toBeNull();
  });

  it("sin x-signature → 401", async () => {
    const b = await insertBooking({ slot: slotAt08(2) });
    const { status } = await post(b.orderId!, { signature: null });
    expect(status).toBe(401);
    expect(getMpOrderMock).not.toHaveBeenCalled();
  });

  it("ts muy viejo → 401 aunque la firma sea correcta", async () => {
    const b = await insertBooking({ slot: slotAt08(2) });
    const { status } = await post(b.orderId!, { ts: Date.now() - 10 * 60 * 1000 });
    expect(status).toBe(401);
    expect(getMpOrderMock).not.toHaveBeenCalled();
  });

  it("firma válida con data.id manipulado en la query → 401", async () => {
    const b = await insertBooking({ slot: slotAt08(2) });
    const ts = Date.now();
    const requestId = `req-${RUN}-tamper`;
    // Firma sobre OTRA orden
    const manifest = buildMpManifest({ dataId: "ORD-OTRA", requestId, ts: String(ts) });
    const signature = `ts=${ts},v1=${signMpManifest(manifest, SECRET)}`;
    const { status } = await post(b.orderId!, { ts, requestId, signature });
    expect(status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Confirmación
// ---------------------------------------------------------------------------

describe("POST /api/mp/webhook — confirmación (migración 019)", () => {
  it("orden pagada: confirma la reserva, registra el pago, avisa al dueño y responde 200", async () => {
    const b = await insertBooking({ slot: slotAt08(3) });
    getMpOrderMock.mockResolvedValue({ ok: true, order: mpOrder(b.orderId!, b.id) });

    const { status, json, eventId } = await post(b.orderId!);
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, outcome: "confirmed" });

    // Se consultó la orden en MP con el token del dueño de ESE complejo
    expect(getMpTokenMock).toHaveBeenCalledWith(venueId);
    expect(getMpOrderMock).toHaveBeenCalledWith("APP_USR-fake", b.orderId);

    const row = await getBooking(b.id);
    expect(row.status).toBe("confirmed");
    expect(row.payment_status).toBe("deposit_paid");
    expect(row.amount_paid).toBe(2500);

    const pays = await paymentsOf(b.id);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ mp_order_id: b.orderId, mp_payment_id: `PAY-${b.orderId}`, amount: 2500, type: "deposit", status: "approved", platform_fee: 0, currency: "ARS" });
    // raw no guarda el client_token
    expect(JSON.stringify(pays[0].raw)).not.toContain("SECRETO-NO-GUARDAR");

    const { data: outbox } = await db.from("notification_outbox").select("type, payload").eq("venue_id", venueId);
    expect(outbox).toHaveLength(1);
    expect(outbox![0].type).toBe("payment_received");
    expect(outbox![0].payload).toMatchObject({ booking_id: b.id, amount: 2500, online: true });
    expect(pushMock).toHaveBeenCalledTimes(1);

    const ev = await eventRow(eventId!);
    expect(ev?.status).toBe("processed");
    expect(ev?.processed_at).not.toBeNull();
    expect(JSON.stringify(ev?.payload)).not.toContain("SECRETO");

    expect(refundMpOrderMock).not.toHaveBeenCalled();
  });

  it("pago total (seña = precio): payment_status 'paid' y type 'full'", async () => {
    const b = await insertBooking({ slot: slotAt08(3), deposit: PRICE });
    getMpOrderMock.mockResolvedValue({ ok: true, order: mpOrder(b.orderId!, b.id, { amount: PRICE }) });

    const { status, json } = await post(b.orderId!);
    expect(status).toBe(200);
    expect(json.outcome).toBe("confirmed");
    const row = await getBooking(b.id);
    expect(row.payment_status).toBe("paid");
    expect(row.amount_paid).toBe(PRICE);
    expect((await paymentsOf(b.id))[0].type).toBe("full");
  });

  it("evento repetido (mismo id): 200 sin volver a consultar MP ni duplicar el pago", async () => {
    const b = await insertBooking({ slot: slotAt08(4) });
    getMpOrderMock.mockResolvedValue({ ok: true, order: mpOrder(b.orderId!, b.id) });

    const first = await post(b.orderId!);
    expect(first.status).toBe(200);
    expect(getMpOrderMock).toHaveBeenCalledTimes(1);

    const again = await post(b.orderId!, { eventId: first.eventId });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ duplicate: true });
    expect(getMpOrderMock).toHaveBeenCalledTimes(1);
    expect(await paymentsOf(b.id)).toHaveLength(1);
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it("MP reenvía la misma orden con otro id de evento: already_confirmed, un solo pago y una sola notificación", async () => {
    const b = await insertBooking({ slot: slotAt08(5) });
    getMpOrderMock.mockResolvedValue({ ok: true, order: mpOrder(b.orderId!, b.id) });

    await post(b.orderId!);
    const second = await post(b.orderId!);
    expect(second.status).toBe(200);
    expect(second.json.outcome).toBe("already_confirmed");
    expect(await paymentsOf(b.id)).toHaveLength(1);
    const { data: outbox } = await db.from("notification_outbox").select("id").eq("venue_id", venueId);
    expect(outbox).toHaveLength(1);
    expect(refundMpOrderMock).not.toHaveBeenCalled();
  });

  it("pago tarde de una reserva vencida con el horario LIBRE: se confirma igual", async () => {
    const b = await insertBooking({ slot: slotAt08(6), status: "expired" });
    getMpOrderMock.mockResolvedValue({ ok: true, order: mpOrder(b.orderId!, b.id) });

    const { status, json } = await post(b.orderId!);
    expect(status).toBe(200);
    expect(json.outcome).toBe("confirmed");
    const row = await getBooking(b.id);
    expect(row.status).toBe("confirmed");
    expect(row.payment_status).toBe("deposit_paid");
    expect(refundMpOrderMock).not.toHaveBeenCalled();
  });

  it("pago tarde con el horario ya TOMADO por otro: devuelve la plata y la reserva sigue vencida", async () => {
    const slot = slotAt08(7);
    const late = await insertBooking({ slot, status: "expired" });
    const other = await insertBooking({ slot, status: "confirmed", orderId: null, phone: "2622999111" });
    getMpOrderMock.mockResolvedValue({ ok: true, order: mpOrder(late.orderId!, late.id) });

    const { status, json, eventId } = await post(late.orderId!);
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, outcome: "refunded" });

    expect(refundMpOrderMock).toHaveBeenCalledTimes(1);
    expect(refundMpOrderMock).toHaveBeenCalledWith("APP_USR-fake", late.orderId, `refund-PAY-${late.orderId}`);

    expect((await getBooking(late.id)).status).toBe("expired");
    expect((await getBooking(other.id)).status).toBe("confirmed");

    const pays = await paymentsOf(late.id);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ mp_payment_id: `PAY-${late.orderId}`, status: "refunded", amount: 2500 });
    expect(pays[0].raw).toMatchObject({ reason: "slot_taken" });

    const { data: audit } = await db.from("audit_log").select("action, entity, entity_id, new_data")
      .eq("venue_id", venueId).eq("entity", "payment");
    expect(audit).toHaveLength(1);
    expect(audit![0]).toMatchObject({ action: "refund", entity_id: late.id });
    expect(audit![0].new_data).toMatchObject({ reason: "slot_taken", mp_order_id: late.orderId });

    expect((await eventRow(eventId!))?.status).toBe("refunded");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("pago de una reserva cancelada: devuelve la plata", async () => {
    const b = await insertBooking({ slot: slotAt08(8), status: "cancelled" });
    getMpOrderMock.mockResolvedValue({ ok: true, order: mpOrder(b.orderId!, b.id) });

    const { status, json } = await post(b.orderId!);
    expect(status).toBe(200);
    expect(json.outcome).toBe("refunded");
    expect(refundMpOrderMock).toHaveBeenCalledTimes(1);
    expect((await getBooking(b.id)).status).toBe("cancelled");
    expect((await paymentsOf(b.id))[0]).toMatchObject({ status: "refunded" });
    expect((await paymentsOf(b.id))[0].raw).toMatchObject({ reason: "booking_cancelled" });
  });

  it("si el reembolso falla: 500 (MP reintenta) y queda 'refund_failed' registrado", async () => {
    const b = await insertBooking({ slot: slotAt08(9), status: "cancelled" });
    getMpOrderMock.mockResolvedValue({ ok: true, order: mpOrder(b.orderId!, b.id) });
    refundMpOrderMock.mockResolvedValue({ ok: false, status: 500, code: "internal_error", message: "x" });

    const { status, json, eventId } = await post(b.orderId!);
    expect(status).toBe(500);
    expect(json.error).toBe("refund_failed");
    expect((await paymentsOf(b.id))[0]).toMatchObject({ status: "refund_failed" });
    expect((await eventRow(eventId!))?.status).toBe("failed");

    // Reintento de MP: confirm_order_payment dice payment_already_recorded /
    // refund_failed → se vuelve a intentar el reembolso con la MISMA clave
    // de idempotencia, y el mismo pago pasa a 'refunded'.
    refundMpOrderMock.mockResolvedValue({ ok: true, alreadyRefunded: false });
    const retry = await post(b.orderId!);
    expect(retry.status).toBe(200);
    expect(retry.json.outcome).toBe("refunded");
    expect(refundMpOrderMock).toHaveBeenCalledTimes(2);
    expect(refundMpOrderMock).toHaveBeenLastCalledWith("APP_USR-fake", b.orderId, `refund-PAY-${b.orderId}`);
    const pays = await paymentsOf(b.id);
    expect(pays).toHaveLength(1);
    expect(pays[0].status).toBe("refunded");
    expect(pays[0].raw).toMatchObject({ reason: "booking_cancelled", refund_attempts: 2 });

    // Un tercer aviso ya no hace nada
    const third = await post(b.orderId!);
    expect(third.json.outcome).toBe("already_recorded");
    expect(refundMpOrderMock).toHaveBeenCalledTimes(2);
  });

  it("reconcilePaymentAction: /pago consulta la orden y confirma sin esperar el webhook", async () => {
    const b = await insertBooking({ slot: slotAt08(10) });
    getMpOrderMock.mockResolvedValue({ ok: true, order: mpOrder(b.orderId!, b.id) });

    const result = await reconcilePaymentAction(b.token);
    expect(result.state).toBe("confirmada");
    expect(getMpOrderMock).toHaveBeenCalledTimes(1);
    expect((await getBooking(b.id)).status).toBe("confirmed");
    expect(await paymentsOf(b.id)).toHaveLength(1);

    // Ya confirmada: no vuelve a consultar MP
    expect((await reconcilePaymentAction(b.token)).state).toBe("confirmada");
    expect(getMpOrderMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Verificaciones y casos sin efecto (no dependen de 019)
// ---------------------------------------------------------------------------

describe("POST /api/mp/webhook — verificaciones", () => {
  it("monto distinto al de la reserva: no confirma, no reembolsa, queda 'mismatch', en audit_log y avisa al dueño (una sola vez)", async () => {
    const b = await insertBooking({ slot: slotAt08(11) });
    getMpOrderMock.mockResolvedValue({ ok: true, order: mpOrder(b.orderId!, b.id, { amount: 1000 }) });

    const { status, json, eventId } = await post(b.orderId!);
    expect(status).toBe(200);
    expect(json.outcome).toBe("mismatch");
    expect((await getBooking(b.id)).status).toBe("hold");
    expect(await paymentsOf(b.id)).toHaveLength(0);
    expect(refundMpOrderMock).not.toHaveBeenCalled();
    expect((await eventRow(eventId!))?.status).toBe("mismatch");

    // Queda registrado para revisar a mano, sin datos del pagador
    const { data: audit } = await db.from("audit_log").select("action, entity, entity_id, new_data, profile_id")
      .eq("venue_id", venueId).eq("action", "payment_mismatch");
    expect(audit).toHaveLength(1);
    expect(audit![0]).toMatchObject({ entity: "payment", entity_id: b.id, profile_id: null });
    expect(audit![0].new_data).toMatchObject({
      booking_id: b.id, mp_order_id: b.orderId, mp_payment_id: `PAY-${b.orderId}`,
      paid_amount: 1000, expected_amount: 2500,
    });
    expect(JSON.stringify(audit![0].new_data)).not.toMatch(/payer|email|SECRETO/);

    // El dueño recibe el aviso
    const { data: outbox } = await db.from("notification_outbox").select("type, payload").eq("venue_id", venueId);
    expect(outbox).toHaveLength(1);
    expect(outbox![0].type).toBe("payment_mismatch");
    expect(outbox![0].payload).toMatchObject({ booking_id: b.id, customer_name: "Jugador Webhook", mp_order_id: b.orderId, paid_amount: 1000, expected_amount: 2500 });
    expect(typeof (outbox![0].payload as Record<string, unknown>).start).toBe("string");
    expect(pushMock).toHaveBeenCalledTimes(1);

    // MP reintenta el mismo pago: no se duplica ni el audit ni el aviso
    const again = await post(b.orderId!);
    expect(again.json.outcome).toBe("mismatch");
    const { data: audit2 } = await db.from("audit_log").select("id").eq("venue_id", venueId).eq("action", "payment_mismatch");
    expect(audit2).toHaveLength(1);
    const { data: outbox2 } = await db.from("notification_outbox").select("id").eq("venue_id", venueId);
    expect(outbox2).toHaveLength(1);
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it("moneda distinta o external_reference distinto: mismatch", async () => {
    const b = await insertBooking({ slot: slotAt08(12) });
    getMpOrderMock.mockResolvedValueOnce({ ok: true, order: mpOrder(b.orderId!, b.id, { currency: "USD" }) });
    expect((await post(b.orderId!)).json.outcome).toBe("mismatch");

    getMpOrderMock.mockResolvedValueOnce({ ok: true, order: mpOrder(b.orderId!, b.id, { externalReference: "otra-reserva" }) });
    expect((await post(b.orderId!)).json.outcome).toBe("mismatch");

    expect((await getBooking(b.id)).status).toBe("hold");
    // Misma orden, misma reserva: un solo registro
    const { data: audit } = await db.from("audit_log").select("id").eq("venue_id", venueId).eq("action", "payment_mismatch");
    expect(audit).toHaveLength(1);
  });

  it("orden todavía no pagada: 200 y la reserva sigue en hold", async () => {
    const b = await insertBooking({ slot: slotAt08(13) });
    getMpOrderMock.mockResolvedValue({ ok: true, order: mpOrder(b.orderId!, b.id, { paid: false }) });

    const { status, json, eventId } = await post(b.orderId!);
    expect(status).toBe(200);
    expect(json.outcome).toBe("not_paid");
    expect((await getBooking(b.id)).status).toBe("hold");
    expect((await eventRow(eventId!))?.status).toBe("ignored");
  });

  it("el body no manda: aunque diga 'processed', si MP dice 'created' no se confirma", async () => {
    const b = await insertBooking({ slot: slotAt08(14) });
    getMpOrderMock.mockResolvedValue({ ok: true, order: mpOrder(b.orderId!, b.id, { paid: false }) });

    const { json } = await post(b.orderId!, {
      body: { id: `evt-${RUN}-body`, type: "order", action: "order.processed",
        data: { id: b.orderId, status: "processed", status_detail: "accredited", total_paid_amount: "2500.00" } },
      eventId: `evt-${RUN}-body`,
    });
    expect(json.outcome).toBe("not_paid");
    expect((await getBooking(b.id)).status).toBe("hold");
  });

  it("orden desconocida: 200 booking_not_found sin consultar MP", async () => {
    const { status, json } = await post(`ORD-${RUN}-desconocida`);
    expect(status).toBe(200);
    expect(json.outcome).toBe("booking_not_found");
    expect(getMpOrderMock).not.toHaveBeenCalled();
  });

  it("type distinto de 'order': 200 ignorado sin registrar nada", async () => {
    const b = await insertBooking({ slot: slotAt08(15) });
    const { status, json, eventId } = await post(b.orderId!, { type: "payment" });
    expect(status).toBe(200);
    expect(json).toEqual({ ignored: true });
    expect(getMpOrderMock).not.toHaveBeenCalled();
    expect(await eventRow(eventId!)).toBeNull();
  });

  it("sin token del dueño o MP caído: 500 para que MP reintente, evento 'failed'", async () => {
    const b = await insertBooking({ slot: slotAt08(16) });

    getMpTokenMock.mockResolvedValueOnce(null);
    const noToken = await post(b.orderId!);
    expect(noToken.status).toBe(500);
    expect((await eventRow(noToken.eventId!))?.status).toBe("failed");

    getMpOrderMock.mockResolvedValueOnce({ ok: false, status: 500, code: "internal_error", message: "x" });
    const mpDown = await post(b.orderId!);
    expect(mpDown.status).toBe(500);

    expect((await getBooking(b.id)).status).toBe("hold");
  });

  it("reconcilePaymentAction con token inexistente o reserva sin orden: solo devuelve el estado", async () => {
    expect((await reconcilePaymentAction("no-existe")).state).toBe("no_encontrada");

    const b = await insertBooking({ slot: slotAt08(17), orderId: null });
    expect((await reconcilePaymentAction(b.token)).state).toBe("pendiente");
    expect(getMpOrderMock).not.toHaveBeenCalled();
  });
});
