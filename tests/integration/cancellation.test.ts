/**
 * Fase 6, Bloque 5 — cancelación del jugador con devolución, con Mercado
 * Pago simulado (getMpToken / refundMpOrder) y la base real (fixture propio).
 *
 * Cubre:
 *   - cancelBookingAction: sin pago (igual que siempre), pago online con
 *     refund_policy 'full' dentro del plazo (devuelve), fuera del plazo o
 *     'none' (cancela sin devolver), reembolso que falla (cancela igual y
 *     queda 'refund_failed'), turno ya empezado (too_late).
 *   - /api/mp/refund-retry: reintenta los 'refund_failed' y los completa.
 *   - get_booking_by_token: refund_policy, refund_available, refund_status.
 *   - updateCancellationPolicyAction (panel): guarda + audit_log, valida,
 *     rechaza complejos ajenos.
 *
 * Los tests marcados "(migración 020)" necesitan cancel_booking_by_token v3
 * y get_booking_by_token v2: quedan rojos hasta que el revisor aplique 020.
 *
 * Limpieza: afterAll borra payments, bookings, outbox, audit_log, venue y usuarios.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks (antes de importar las acciones)
// ---------------------------------------------------------------------------

process.env.PUSH_SEND_SECRET ??= "test-push-secret";

const getMpTokenMock    = vi.fn();
const refundMpOrderMock = vi.fn();
const pushMock          = vi.fn();

vi.mock("@/lib/mp/token", () => ({
  getMpToken: (venueId: string) => getMpTokenMock(venueId),
}));
vi.mock("@/lib/mp/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mp/orders")>();
  return { ...actual, refundMpOrder: (...args: unknown[]) => refundMpOrderMock(...args) };
});
vi.mock("@/lib/push", () => ({ triggerPushSend: async () => { pushMock(); } }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("NEXT_REDIRECT " + url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// La acción del jugador corre como anon; la del panel, con la sesión del dueño.
let currentClient: SupabaseClient;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => currentClient }));

import { cancelBookingAction } from "@/app/actions/booking";
import { cancelBookingPanelAction, updateCancellationPolicyAction } from "@/app/actions/panel";
import { POST as refundRetryPOST } from "@/app/api/mp/refund-retry/route";

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!supabaseUrl || !serviceKey || !anonKey) throw new Error("Faltan variables de entorno de Supabase");

const db = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anonClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const ownerClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const otherOwnerClient = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
currentClient = anonClient;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let ownerUserId: string;
let otherOwnerId: string;
let venueId: string;
let courtId: string;
const PRICE = 5000;
const RUN = randomBytes(4).toString("hex");
const PASSWORD = "TestPass123!";

async function createOwner(client: SupabaseClient, label: string) {
  const email = `test-cancel-${label}-${Date.now()}@turnazo.test`;
  const { data, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  await db.from("profiles").upsert({ id: data.user.id, role: "owner" });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInErr) throw signInErr;
  return data.user.id;
}

beforeAll(async () => {
  ownerUserId  = await createOwner(ownerClient, "owner");
  otherOwnerId = await createOwner(otherOwnerClient, "other");

  const { data: loc }   = await db.from("localities").select("id").eq("slug", "tunuyan").single();
  const { data: sport } = await db.from("sports").select("id").eq("slug", "padel").single();

  const { data: venue, error: venueErr } = await db
    .from("venues")
    .insert({
      owner_id: ownerUserId, name: "Test Cancel Venue", phone: "2622000000", address: "Cancel 123",
      locality_id: loc!.id, lat: -33.6, lng: -69.0, status: "approved",
      cancel_limit_hours: 2, refund_policy: "full",
    })
    .select("id")
    .single();
  if (venueErr) throw venueErr;
  venueId = venue.id;

  const { data: court, error: courtErr } = await db
    .from("courts")
    .insert({ venue_id: venueId, sport_id: sport!.id, name: "Cancha Cancel", slot_minutes: 90, active: true })
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
  for (const id of [ownerUserId, otherOwnerId]) {
    if (!id) continue;
    await db.from("profiles").delete().eq("id", id);
    await db.auth.admin.deleteUser(id);
  }
}, 30_000);

beforeEach(async () => {
  currentClient = anonClient;
  getMpTokenMock.mockReset();
  refundMpOrderMock.mockReset();
  pushMock.mockReset();
  getMpTokenMock.mockResolvedValue({ accessToken: "APP_USR-fake", mpUserId: "test-cancel" });
  refundMpOrderMock.mockResolvedValue({ ok: true, alreadyRefunded: false });
  await db.from("venues").update({ cancel_limit_hours: 2, refund_policy: "full" }).eq("id", venueId);

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

let seq = 0;

/** Reserva confirmada que empieza en `startsInMs` (o a las 08:00 Mendoza dentro de N días). */
async function insertConfirmed(opts: {
  startsInMs?: number;
  daysAhead?: number;
  paidOnline?: number;    // monto acreditado por MP (crea fila en payments 'approved')
  paidManual?: number;    // marcado a mano por el dueño (sin fila en payments)
}) {
  seq += 1;
  let start: Date;
  if (opts.startsInMs !== undefined) {
    start = new Date(Date.now() + opts.startsInMs);
  } else {
    const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + (opts.daysAhead ?? 2 + seq));
    start = new Date(d.getTime() + 11 * 3600 * 1000);
  }
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  const paid = opts.paidOnline ?? opts.paidManual ?? 0;
  const token = randomBytes(32).toString("hex");
  const orderId = opts.paidOnline ? `ORD-${RUN}-${seq}` : null;

  const { data, error } = await db
    .from("bookings")
    .insert({
      venue_id: venueId, court_id: courtId,
      period: `[${start.toISOString()},${end.toISOString()})`,
      kind: "booking", source: "app", status: "confirmed",
      customer_name: "Jugador Cancel", customer_phone: `26221${String(seq).padStart(5, "0")}`,
      price_total: PRICE, deposit_amount: opts.paidOnline ?? 0, amount_paid: paid,
      payment_status: paid === 0 ? "unpaid" : paid >= PRICE ? "paid" : "deposit_paid",
      cancel_token: token, mp_order_id: orderId,
    })
    .select("id")
    .single();
  if (error) throw error;

  let paymentId: string | null = null;
  if (opts.paidOnline) {
    paymentId = `PAY-${RUN}-${seq}`;
    const { error: pErr } = await db.from("payments").insert({
      booking_id: data.id, mp_order_id: orderId, mp_payment_id: paymentId,
      amount: opts.paidOnline, type: opts.paidOnline >= PRICE ? "full" : "deposit",
      status: "approved", platform_fee: 0, currency: "ARS", raw: {},
    });
    if (pErr) throw pErr;
  }
  return { id: data.id as string, token, orderId, paymentId };
}

async function cancel(token: string) {
  return cancelBookingAction(token, {}, new FormData());
}

async function booking(id: string) {
  const { data, error } = await db.from("bookings").select("status, payment_status, amount_paid").eq("id", id).single();
  if (error) throw error;
  return data;
}

async function payment(paymentId: string) {
  const { data, error } = await db.from("payments").select("status, raw, updated_at").eq("mp_payment_id", paymentId).single();
  if (error) throw error;
  return data;
}

async function outboxCancelled(bookingId: string) {
  const { data } = await db.from("notification_outbox").select("payload")
    .eq("venue_id", venueId).eq("type", "booking_cancelled");
  return (data ?? []).map((r) => r.payload as Record<string, unknown>).find((p) => p.booking_id === bookingId) ?? null;
}

async function auditPayments() {
  const { data } = await db.from("audit_log").select("action, entity_id, new_data").eq("venue_id", venueId).eq("entity", "payment");
  return data ?? [];
}

async function callRefundRetry(secret = process.env.PUSH_SEND_SECRET!) {
  const req = new NextRequest("http://localhost:3001/api/mp/refund-retry", {
    method: "POST", headers: { "x-push-secret": secret }, body: "{}",
  });
  const res = await refundRetryPOST(req);
  return { status: res.status, json: await res.json() };
}

/**
 * El cron solo toma pagos con updated_at de hace más de 2 min. No se puede
 * "envejecer" la fila (el trigger trg_payments_updated_at pisa updated_at en
 * cada UPDATE), así que se adelanta el reloj de Date 3 min: solo Date, para
 * no tocar los timers de fetch.
 */
async function withClockAhead<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 3 * 60 * 1000);
  try { return await fn(); } finally { vi.useRealTimers(); }
}

// ---------------------------------------------------------------------------
// Sin pago online: igual que siempre
// ---------------------------------------------------------------------------

describe("cancelBookingAction — sin pago online", () => {
  it("dentro del plazo: cancela, sin devolución, avisa al dueño", async () => {
    const b = await insertConfirmed({});
    const res = await cancel(b.token);
    expect(res).toMatchObject({ success: true, refund: "none", refundAmount: 0 });
    expect((await booking(b.id)).status).toBe("cancelled");
    expect(refundMpOrderMock).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledTimes(1);
    const payload = await outboxCancelled(b.id);
    expect(payload).not.toBeNull();
  });

  it("fuera del plazo: 'Ya no es posible cancelar'", async () => {
    const b = await insertConfirmed({ startsInMs: 60 * 60 * 1000 }); // en 1 h, límite 2 h
    const res = await cancel(b.token);
    expect(res.error).toMatch(/Ya no es posible cancelar/);
    expect((await booking(b.id)).status).toBe("confirmed");
  });

  it("token inexistente", async () => {
    expect((await cancel("no-existe")).error).toMatch(/no encontrado/);
  });
});

// ---------------------------------------------------------------------------
// Con pago online (migración 020)
// ---------------------------------------------------------------------------

describe("cancelBookingAction — pago online (migración 020)", () => {
  it("refund_policy full y dentro del plazo: cancela y devuelve lo pagado (idempotente)", async () => {
    const b = await insertConfirmed({ paidOnline: 2500 });
    const res = await cancel(b.token);
    expect(res).toMatchObject({ success: true, refund: "refunded", refundAmount: 2500 });

    expect(refundMpOrderMock).toHaveBeenCalledTimes(1);
    expect(refundMpOrderMock).toHaveBeenCalledWith("APP_USR-fake", b.orderId, `refund-${b.paymentId}`);
    expect(getMpTokenMock).toHaveBeenCalledWith(venueId);

    const row = await booking(b.id);
    expect(row.status).toBe("cancelled");
    expect(row.payment_status).toBe("refunded");

    const pay = await payment(b.paymentId!);
    expect(pay.status).toBe("refunded");
    expect(pay.raw).toMatchObject({ reason: "player_cancelled", refund: "ok" });

    const audit = await auditPayments();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "refund", entity_id: b.id });
    expect(audit[0].new_data).toMatchObject({ reason: "player_cancelled", mp_payment_id: b.paymentId, amount: 2500 });

    const payload = await outboxCancelled(b.id);
    expect(payload).toMatchObject({ refund_due: true, refund_amount: 2500, amount_paid: 2500 });
    expect(pushMock).toHaveBeenCalled();

    // Segundo intento: ya no está confirmada → no se devuelve dos veces
    expect((await cancel(b.token)).error).toMatch(/no encontrado|cancelado/);
    expect(refundMpOrderMock).toHaveBeenCalledTimes(1);
  });

  it("si el reembolso falla: la reserva igual se cancela, queda 'refund_failed' y el cron lo completa", async () => {
    refundMpOrderMock.mockResolvedValueOnce({ ok: false, status: 500, code: "internal_error", message: "x" });
    const b = await insertConfirmed({ paidOnline: 2500 });

    const res = await cancel(b.token);
    expect(res).toMatchObject({ success: true, refund: "pending", refundAmount: 2500 });
    expect((await booking(b.id))).toMatchObject({ status: "cancelled", payment_status: "deposit_paid" });
    expect((await payment(b.paymentId!)).status).toBe("refund_failed");
    expect((await auditPayments()).map((a) => a.action)).toEqual(["refund_failed"]);

    // Sin secreto → 401 y nada
    expect((await callRefundRetry("mal")).status).toBe(401);

    // Recién tocada: el cron no la toma todavía (ventana de 2 min)
    // El cron barre TODOS los 'refund_failed' de la base (otros archivos de test
    // corren en paralelo): se comprueba solo el pago de este test, no los totales.
    const ownRefundCalls = () =>
      refundMpOrderMock.mock.calls.filter((c) => c[1] === b.orderId).length;
    expect(ownRefundCalls()).toBe(1);

    const early = await callRefundRetry();
    expect(early.status).toBe(200);
    expect(ownRefundCalls()).toBe(1);
    expect((await payment(b.paymentId!)).status).toBe("refund_failed");

    const retry = await withClockAhead(() => callRefundRetry());
    expect(retry.status).toBe(200);
    expect(retry.json).toMatchObject({ ok: true, failed: 0 });
    expect(ownRefundCalls()).toBe(2);
    expect(refundMpOrderMock).toHaveBeenCalledWith("APP_USR-fake", b.orderId, `refund-${b.paymentId}`);

    const pay = await payment(b.paymentId!);
    expect(pay.status).toBe("refunded");
    expect(pay.raw).toMatchObject({ reason: "player_cancelled", refund_attempts: 2 });
    expect((await booking(b.id)).payment_status).toBe("refunded");
    expect((await auditPayments()).map((a) => a.action).sort()).toEqual(["refund", "refund_failed"]);
  });

  it("refund_policy none: cancela sin devolver y el dueño se entera", async () => {
    await db.from("venues").update({ refund_policy: "none" }).eq("id", venueId);
    const b = await insertConfirmed({ paidOnline: 2500 });

    const res = await cancel(b.token);
    expect(res).toMatchObject({ success: true, refund: "none", refundAmount: 0 });
    expect(refundMpOrderMock).not.toHaveBeenCalled();
    expect((await booking(b.id))).toMatchObject({ status: "cancelled", payment_status: "deposit_paid" });
    expect((await payment(b.paymentId!)).status).toBe("approved");
    expect(await outboxCancelled(b.id)).toMatchObject({ refund_due: false, amount_paid: 2500 });
  });

  it("fuera del plazo con pago online: se puede cancelar pero sin devolución", async () => {
    const b = await insertConfirmed({ paidOnline: PRICE, startsInMs: 60 * 60 * 1000 }); // en 1 h, límite 2 h
    const res = await cancel(b.token);
    expect(res).toMatchObject({ success: true, refund: "none" });
    expect(refundMpOrderMock).not.toHaveBeenCalled();
    expect((await booking(b.id)).status).toBe("cancelled");
    expect((await payment(b.paymentId!)).status).toBe("approved");
  });

  it("turno ya empezado: no se puede cancelar", async () => {
    const b = await insertConfirmed({ paidOnline: 2500, startsInMs: -10 * 60 * 1000 });
    expect((await cancel(b.token)).error).toMatch(/Ya no es posible cancelar/);
    expect((await booking(b.id)).status).toBe("confirmed");
  });

  it("pagado a mano por el dueño (sin pago de MP): no hay nada que devolver", async () => {
    const b = await insertConfirmed({ paidManual: PRICE });
    const res = await cancel(b.token);
    expect(res).toMatchObject({ success: true, refund: "none" });
    expect(refundMpOrderMock).not.toHaveBeenCalled();
  });

  it("get_booking_by_token expone refund_policy, refund_available y refund_status", async () => {
    const b = await insertConfirmed({ paidOnline: 2500 });
    const before = (await anonClient.rpc("get_booking_by_token", { p_cancel_token: b.token })).data as Record<string, unknown>;
    expect(before).toMatchObject({ refund_policy: "full", refund_available: true, refund_status: "approved", amount_paid: 2500 });

    await cancel(b.token);
    const after = (await anonClient.rpc("get_booking_by_token", { p_cancel_token: b.token })).data as Record<string, unknown>;
    expect(after).toMatchObject({ status: "cancelled", payment_status: "refunded", refund_available: false, refund_status: "refunded" });

    const unpaid = await insertConfirmed({});
    const u = (await anonClient.rpc("get_booking_by_token", { p_cancel_token: unpaid.token })).data as Record<string, unknown>;
    expect(u).toMatchObject({ refund_available: false, refund_status: null });
  });
});

// ---------------------------------------------------------------------------
// Panel: el dueño cancela → siempre se devuelve lo pagado online
// ---------------------------------------------------------------------------

describe("cancelBookingPanelAction — cancelación del dueño", () => {
  function form(bookingId: string) {
    const fd = new FormData();
    fd.set("booking_id", bookingId);
    fd.set("venue_id", venueId);
    fd.set("date", "2027-01-04");
    return fd;
  }

  async function auditCancel(bookingId: string) {
    const { data } = await db.from("audit_log").select("new_data, profile_id")
      .eq("venue_id", venueId).eq("entity", "booking").eq("entity_id", bookingId).eq("action", "cancel");
    return data ?? [];
  }

  it("pago online, política none y fuera del plazo: devuelve todo igual (cancela el complejo)", async () => {
    await db.from("venues").update({ refund_policy: "none", cancel_limit_hours: 48 }).eq("id", venueId);
    const b = await insertConfirmed({ paidOnline: 2500, startsInMs: 60 * 60 * 1000 }); // en 1 h
    currentClient = ownerClient;

    const res = await cancelBookingPanelAction(null, form(b.id));
    expect(res).toBeNull();

    expect(refundMpOrderMock).toHaveBeenCalledTimes(1);
    expect(refundMpOrderMock).toHaveBeenCalledWith("APP_USR-fake", b.orderId, `refund-${b.paymentId}`);
    expect(await booking(b.id)).toMatchObject({ status: "cancelled", payment_status: "refunded" });

    const pay = await payment(b.paymentId!);
    expect(pay.status).toBe("refunded");
    expect(pay.raw).toMatchObject({ reason: "owner_cancelled", refund: "ok" });

    const audit = await auditCancel(b.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].profile_id).toBe(ownerUserId);
    expect(audit[0].new_data).toMatchObject({ refund: "refunded", refund_amount: 2500, mp_payment_id: b.paymentId });
    expect((await auditPayments()).map((a) => a.action)).toEqual(["refund"]);

    expect(await outboxCancelled(b.id)).toMatchObject({ cancelled_by: "owner", refund_due: true, refund_amount: 2500, refund_status: "refunded" });
    expect(pushMock).toHaveBeenCalledTimes(1);

    // Segundo intento: ya no está confirmada → no se devuelve dos veces
    expect((await cancelBookingPanelAction(null, form(b.id)))?.error).toMatch(/ya no está confirmada/);
    expect(refundMpOrderMock).toHaveBeenCalledTimes(1);
  });

  it("si el reembolso falla: cancela igual, queda 'refund_failed' y el cron lo completa", async () => {
    refundMpOrderMock.mockResolvedValueOnce({ ok: false, status: 500, code: "internal_error", message: "x" });
    const b = await insertConfirmed({ paidOnline: PRICE });
    currentClient = ownerClient;

    expect(await cancelBookingPanelAction(null, form(b.id))).toBeNull();
    expect(await booking(b.id)).toMatchObject({ status: "cancelled", payment_status: "paid" });
    expect((await payment(b.paymentId!)).status).toBe("refund_failed");
    expect((await auditCancel(b.id))[0].new_data).toMatchObject({ refund: "pending", refund_amount: PRICE });
    expect(await outboxCancelled(b.id)).toMatchObject({ cancelled_by: "owner", refund_due: true, refund_status: "pending" });

    const retry = await withClockAhead(() => callRefundRetry());
    expect(retry.json).toMatchObject({ ok: true, attempted: 1, refunded: 1, failed: 0 });
    expect(refundMpOrderMock).toHaveBeenLastCalledWith("APP_USR-fake", b.orderId, `refund-${b.paymentId}`);
    expect((await payment(b.paymentId!)).status).toBe("refunded");
    expect((await booking(b.id)).payment_status).toBe("refunded");
  });

  it("sin pago online (o pagado a mano): cancela como siempre, sin devolución", async () => {
    const unpaid = await insertConfirmed({});
    const manual = await insertConfirmed({ paidManual: PRICE });
    currentClient = ownerClient;

    expect(await cancelBookingPanelAction(null, form(unpaid.id))).toBeNull();
    expect(await cancelBookingPanelAction(null, form(manual.id))).toBeNull();
    expect(refundMpOrderMock).not.toHaveBeenCalled();
    expect((await booking(unpaid.id)).status).toBe("cancelled");
    expect((await booking(manual.id))).toMatchObject({ status: "cancelled", payment_status: "paid" });
    expect((await auditCancel(unpaid.id))[0].new_data).toMatchObject({ refund: "none", refund_amount: 0 });
    expect(await outboxCancelled(manual.id)).toMatchObject({ cancelled_by: "owner", refund_due: false, amount_paid: PRICE });
  });

  it("otro dueño no puede cancelar ni disparar la devolución", async () => {
    const b = await insertConfirmed({ paidOnline: 2500 });
    currentClient = otherOwnerClient;
    expect((await cancelBookingPanelAction(null, form(b.id)))?.error).toBe("No autorizado");
    expect(refundMpOrderMock).not.toHaveBeenCalled();
    expect(await booking(b.id)).toMatchObject({ status: "confirmed" });
    expect((await payment(b.paymentId!)).status).toBe("approved");
  });
});

// ---------------------------------------------------------------------------
// Panel: política de cancelación
// ---------------------------------------------------------------------------

describe("updateCancellationPolicyAction", () => {
  function form(hours: string, policy: string) {
    const fd = new FormData();
    fd.set("cancel_limit_hours", hours);
    fd.set("refund_policy", policy);
    return fd;
  }

  it("el dueño guarda plazo y política, con audit_log", async () => {
    currentClient = ownerClient;
    const res = await updateCancellationPolicyAction(venueId, null, form("24", "none"));
    expect(res).toEqual({});

    const { data: v } = await db.from("venues").select("cancel_limit_hours, refund_policy").eq("id", venueId).single();
    expect(v).toEqual({ cancel_limit_hours: 24, refund_policy: "none" });

    const { data: audit } = await db.from("audit_log").select("action, entity, entity_id, new_data, profile_id")
      .eq("venue_id", venueId).eq("action", "update_cancellation_policy");
    expect(audit).toHaveLength(1);
    expect(audit![0]).toMatchObject({ entity: "venue", entity_id: venueId, profile_id: ownerUserId });
    expect(audit![0].new_data).toEqual({ cancel_limit_hours: 24, refund_policy: "none" });
  });

  it("valida horas (0–168, entero) y política", async () => {
    currentClient = ownerClient;
    expect((await updateCancellationPolicyAction(venueId, null, form("200", "full")))?.fieldErrors?.cancel_limit_hours).toBeDefined();
    expect((await updateCancellationPolicyAction(venueId, null, form("-1", "full")))?.fieldErrors?.cancel_limit_hours).toBeDefined();
    expect((await updateCancellationPolicyAction(venueId, null, form("1.5", "full")))?.fieldErrors?.cancel_limit_hours).toBeDefined();
    expect((await updateCancellationPolicyAction(venueId, null, form("2", "partial")))?.fieldErrors?.refund_policy).toBeDefined();
    const { data: v } = await db.from("venues").select("cancel_limit_hours, refund_policy").eq("id", venueId).single();
    expect(v).toEqual({ cancel_limit_hours: 2, refund_policy: "full" });
  });

  it("otro dueño o anon no pueden tocar el complejo", async () => {
    currentClient = otherOwnerClient;
    expect((await updateCancellationPolicyAction(venueId, null, form("5", "none")))?.error).toBe("No autorizado");
    currentClient = anonClient;
    expect((await updateCancellationPolicyAction(venueId, null, form("5", "none")))?.error).toBe("No autenticado");
    const { data: v } = await db.from("venues").select("cancel_limit_hours, refund_policy").eq("id", venueId).single();
    expect(v).toEqual({ cancel_limit_hours: 2, refund_policy: "full" });
  });
});
