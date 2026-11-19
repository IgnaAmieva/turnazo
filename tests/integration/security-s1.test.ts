/**
 * Fase 7, S1 — cada ataque del informe, intentado de verdad contra la base
 * con la anon key y con la sesión de un dueño ajeno. Todos tienen que fallar.
 * Requiere la migración 021 aplicada.
 *
 *   C1  reserva/bloqueo en la cancha de otro complejo
 *   C2  reservar sin login (create_booking con la anon key) + límite de 30 días
 *   A1  un dueño aprueba su propio complejo
 *   A2  holds sin login (create_booking_hold con la anon key)
 *   M2  el dueño cancela/borra una reserva pagada sin devolver la plata
 *
 * Fixtures propios (dos dueños, dos complejos, una cancha cada uno). El
 * complejo A no tiene Mercado Pago conectado: si algún pago quedara
 * 'refund_pending', nunca se llama a MP. afterAll borra todo lo creado.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!supabaseUrl || !serviceKey || !anonKey) throw new Error("Faltan variables de entorno");

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin  = createClient(supabaseUrl, serviceKey, noSession);
const anon   = createClient(supabaseUrl, anonKey, noSession);
const ownerA = createClient(supabaseUrl, anonKey, noSession);
const ownerB = createClient(supabaseUrl, anonKey, noSession);

// Las server actions usan createClient() del SSR: acá devuelve la sesión que
// el test elija (el atacante es el dueño B).
let currentClient: SupabaseClient = ownerB;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => currentClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("NEXT_REDIRECT " + url); } }));
vi.mock("@/lib/push", () => ({ triggerPushSend: async () => {} }));

import { createManualBlockAction, cancelBookingPanelAction } from "@/app/actions/panel";

const PASSWORD = "TestPass123!";
const PERMISSION_DENIED = "42501";

let ownerAId = "", ownerBId = "";
let venueA = "", venueB = "", courtA = "", courtB = "";
let localityId = "", sportId = "";
const extraVenueIds: string[] = [];

/** Turno de 90 min a las 08:00 Mendoza (11:00 UTC), N días adelante. */
function slot(daysAhead: number, hourMendoza = 8) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  const start = new Date(d.getTime() + (hourMendoza + 3) * 3600 * 1000);
  const end   = new Date(start.getTime() + 90 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function mendozaLocal(iso: string) {
  // "YYYY-MM-DDTHH:MM" en hora de Mendoza (UTC-3), como manda el form del panel
  return new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 16);
}

async function bookingsOnCourt(courtId: string) {
  const { data } = await admin.from("bookings").select("id, venue_id, status, kind").eq("court_id", courtId);
  return data ?? [];
}

async function createOwner(client: SupabaseClient, tag: string) {
  const email = `test-s1-${tag}-${Date.now()}@turnazo.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error("No se pudo crear el dueño " + tag);
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInErr) throw new Error("No se pudo iniciar sesión como " + tag);
  return data.user.id;
}

async function createVenueWithCourt(ownerId: string, name: string) {
  const { data: v, error: vErr } = await admin.from("venues").insert({
    owner_id: ownerId, name, phone: "2612000077", address: "Calle S1 123",
    lat: -33.57, lng: -69.0, locality_id: localityId, status: "approved",
  }).select("id").single();
  if (vErr || !v) throw new Error("No se pudo crear el complejo " + name);
  const { data: c, error: cErr } = await admin.from("courts").insert({
    venue_id: v.id, sport_id: sportId, name: "Cancha S1", slot_minutes: 90, active: true,
  }).select("id").single();
  if (cErr || !c) throw new Error("No se pudo crear la cancha de " + name);
  const days = [0, 1, 2, 3, 4, 5, 6];
  await admin.from("court_hours").insert(days.map((w) => ({ court_id: c.id, weekday: w, open_time: "08:00", close_time: "23:00" })));
  await admin.from("court_prices").insert(days.map((w) => ({ court_id: c.id, weekday: w, from_time: "08:00", to_time: "23:00", price: 5000 })));
  return { venueId: v.id as string, courtId: c.id as string };
}

/** Reserva confirmada pagada online (como la deja confirm_order_payment), escrita con service_role. */
async function insertPaidOnline(daysAhead: number, amount: number) {
  const { start, end } = slot(daysAhead);
  const suffix = Math.random().toString(16).slice(2, 10);
  const { data: b, error } = await admin.from("bookings").insert({
    venue_id: venueA, court_id: courtA, period: `[${start},${end})`,
    kind: "booking", source: "app", status: "confirmed",
    payment_status: amount >= 5000 ? "paid" : "deposit_paid",
    customer_name: "S1 Pagada", customer_phone: "2622777003",
    price_total: 5000, deposit_amount: amount, amount_paid: amount,
    mp_order_id: `ORD-S1-${suffix}`, cancel_token: `s1${suffix}`.padEnd(64, "0"),
  }).select("id").single();
  if (error || !b) throw new Error("No se pudo crear la reserva pagada: " + error?.message);
  await admin.from("payments").insert({
    booking_id: b.id, mp_order_id: `ORD-S1-${suffix}`, mp_payment_id: `PAY-S1-${suffix}`,
    amount, type: amount >= 5000 ? "full" : "deposit", status: "approved", platform_fee: 0, currency: "ARS", raw: {},
  });
  return { id: b.id as string, paymentId: `PAY-S1-${suffix}` };
}

async function paymentStatus(paymentId: string) {
  const { data } = await admin.from("payments").select("status").eq("mp_payment_id", paymentId).single();
  return data?.status;
}

beforeAll(async () => {
  const { data: loc } = await admin.from("localities").select("id").eq("slug", "tunuyan").single();
  const { data: sport } = await admin.from("sports").select("id").eq("slug", "padel").single();
  if (!loc || !sport) throw new Error("Faltan localidad tunuyan o deporte padel");
  localityId = loc.id;
  sportId = sport.id;

  ownerAId = await createOwner(ownerA, "a");
  ownerBId = await createOwner(ownerB, "b");
  ({ venueId: venueA, courtId: courtA } = await createVenueWithCourt(ownerAId, "S1 Complejo A"));
  ({ venueId: venueB, courtId: courtB } = await createVenueWithCourt(ownerBId, "S1 Complejo B"));
}, 60_000);

afterAll(async () => {
  // Por dueño, no solo por id: si un ataque llegara a crear un complejo (A1
  // sin la 021), también se borra.
  const owners = [ownerAId, ownerBId].filter(Boolean);
  const { data: owned } = owners.length
    ? await admin.from("venues").select("id").in("owner_id", owners)
    : { data: [] as { id: string }[] };
  const venues = [...new Set([venueA, venueB, ...extraVenueIds, ...(owned ?? []).map((v) => v.id)])].filter(Boolean);
  const courts = [courtA, courtB].filter(Boolean);
  if (courts.length) {
    const { data: bks } = await admin.from("bookings").select("id").in("court_id", courts);
    const ids = (bks ?? []).map((b) => b.id);
    if (ids.length) {
      await admin.from("payments").delete().in("booking_id", ids);
      await admin.from("audit_log").delete().in("entity_id", ids);
      await admin.from("bookings").delete().in("id", ids);
    }
  }
  if (venues.length) {
    await admin.from("notification_outbox").delete().in("venue_id", venues);
    await admin.from("audit_log").delete().in("venue_id", venues);
    await admin.from("venues").delete().in("id", venues); // courts, horarios y precios en cascada
  }
  await ownerA.auth.signOut();
  await ownerB.auth.signOut();
  if (ownerAId) await admin.auth.admin.deleteUser(ownerAId);
  if (ownerBId) await admin.auth.admin.deleteUser(ownerBId);
}, 60_000);

// ---------------------------------------------------------------------------
// C1 — cancha de otro complejo
// ---------------------------------------------------------------------------

describe("C1: una reserva nunca tiene la cancha de otro complejo", () => {
  it("el dueño B no puede insertar por la API una reserva en la cancha de A (con venue_id propio)", async () => {
    const { start, end } = slot(3);
    const { error } = await ownerB.from("bookings").insert({
      venue_id: venueB, court_id: courtA, period: `[${start},${end})`, status: "confirmed", kind: "block",
    });
    expect(error?.code).toBe(PERMISSION_DENIED);
    expect(await bookingsOnCourt(courtA)).toEqual([]);
  });

  it("panel_create_block del dueño B con la cancha de A → court_not_in_venue", async () => {
    const { start, end } = slot(3);
    const { data, error } = await ownerB.rpc("panel_create_block", {
      p_venue_id: venueB, p_court_id: courtA, p_start: start, p_end: end, p_note: "ataque",
    });
    expect(error).toBeNull();
    expect(data).toEqual({ error: "court_not_in_venue" });
    expect(await bookingsOnCourt(courtA)).toEqual([]);
  });

  it("panel_create_block del dueño B sobre el complejo de A → not_owner", async () => {
    const { start, end } = slot(3);
    const { data } = await ownerB.rpc("panel_create_block", {
      p_venue_id: venueA, p_court_id: courtA, p_start: start, p_end: end, p_note: "ataque",
    });
    expect(data).toEqual({ error: "not_owner" });
    expect(await bookingsOnCourt(courtA)).toEqual([]);
  });

  it("la acción del panel (bloqueo manual) con la cancha de A cambiada en el form → error, sin reserva", async () => {
    currentClient = ownerB;
    const { start, end } = slot(3);
    const fd = new FormData();
    fd.set("venue_id", venueB);
    fd.set("court_id", courtA);
    fd.set("start", mendozaLocal(start));
    fd.set("end", mendozaLocal(end));
    fd.set("note", "ataque");
    const res = await createManualBlockAction(null, fd);
    expect(res?.error).toBe("Esa cancha no es de este complejo.");
    expect(await bookingsOnCourt(courtA)).toEqual([]);
  });

  it("ni service_role puede guardar una reserva con cancha de A y complejo B (FK compuesta)", async () => {
    const { start, end } = slot(3);
    const { error } = await admin.from("bookings").insert({
      venue_id: venueB, court_id: courtA, period: `[${start},${end})`, status: "confirmed", kind: "block",
    });
    expect(error?.code).toBe("23503"); // foreign_key_violation
    expect(error?.message).toContain("bookings_court_venue_fkey");
    expect(await bookingsOnCourt(courtA)).toEqual([]);
  });

  it("el dueño A sí bloquea su propia cancha (por el RPC)", async () => {
    const { start, end } = slot(4);
    const { data } = await ownerA.rpc("panel_create_block", {
      p_venue_id: venueA, p_court_id: courtA, p_start: start, p_end: end, p_note: "Mantenimiento S1",
    });
    expect(data).toMatchObject({ ok: true });
    expect(await bookingsOnCourt(courtA)).toEqual([
      expect.objectContaining({ venue_id: venueA, status: "confirmed", kind: "block" }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// C2 / A2 — reservar sin pasar por el servidor
// ---------------------------------------------------------------------------

describe("C2/A2: create_booking y create_booking_hold solo desde el servidor", () => {
  it("C2: anon no puede ejecutar create_booking", async () => {
    const { start, end } = slot(5);
    const { data, error } = await anon.rpc("create_booking", {
      p_court_id: courtB, p_venue_id: venueB, p_start: start, p_end: end,
      p_customer_name: "Bot", p_customer_phone: "2610001234",
    });
    expect(error?.code).toBe(PERMISSION_DENIED);
    expect(data).toBeNull();
    expect(await bookingsOnCourt(courtB)).toEqual([]);
  });

  it("C2: un dueño logueado tampoco", async () => {
    const { start, end } = slot(5);
    const { error } = await ownerA.rpc("create_booking", {
      p_court_id: courtB, p_venue_id: venueB, p_start: start, p_end: end,
      p_customer_name: "Bot", p_customer_phone: "2610001235",
    });
    expect(error?.code).toBe(PERMISSION_DENIED);
    expect(await bookingsOnCourt(courtB)).toEqual([]);
  });

  it("A2: anon no puede ejecutar create_booking_hold", async () => {
    const { start, end } = slot(6);
    const { error } = await anon.rpc("create_booking_hold", {
      p_court_id: courtB, p_venue_id: venueB, p_start: start, p_end: end,
      p_customer_name: "Bot", p_customer_phone: "2610001236", p_payment_type: "full",
    });
    expect(error?.code).toBe(PERMISSION_DENIED);
    expect(await bookingsOnCourt(courtB)).toEqual([]);
  });

  it("anon no puede escribir bookings directo", async () => {
    const { start, end } = slot(6);
    const { error } = await anon.from("bookings").insert({
      venue_id: venueB, court_id: courtB, period: `[${start},${end})`, status: "confirmed",
    });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("el servidor no reserva a más de 30 días (too_far_ahead), sí a 29", async () => {
    const far = slot(31);
    const { data: farRes } = await admin.rpc("create_booking", {
      p_court_id: courtB, p_venue_id: venueB, p_start: far.start, p_end: far.end,
      p_customer_name: "Cliente S1", p_customer_phone: "2610009998",
    });
    expect(farRes).toEqual({ error: "too_far_ahead" });

    const near = slot(29);
    const { data: nearRes } = await admin.rpc("create_booking", {
      p_court_id: courtB, p_venue_id: venueB, p_start: near.start, p_end: near.end,
      p_customer_name: "Cliente S1", p_customer_phone: "2610009997",
    });
    expect(nearRes).toHaveProperty("booking_id");
  });
});

// ---------------------------------------------------------------------------
// A1 — autoaprobación del complejo
// ---------------------------------------------------------------------------

describe("A1: el dueño no toca venues.status", () => {
  it("no puede pasar su complejo pendiente a approved", async () => {
    const { data: v } = await admin.from("venues").insert({
      owner_id: ownerBId, name: "S1 Pendiente", phone: "2612000078", address: "Calle S1 456",
      lat: -33.57, lng: -69.0, locality_id: localityId, status: "pending",
    }).select("id").single();
    extraVenueIds.push(v!.id);

    const { error } = await ownerB.from("venues").update({ status: "approved" }).eq("id", v!.id);
    expect(error?.code).toBe(PERMISSION_DENIED);
    const { data: after } = await admin.from("venues").select("status").eq("id", v!.id).single();
    expect(after!.status).toBe("pending");
  });

  it("no puede crear un complejo ya aprobado", async () => {
    const { error } = await ownerB.from("venues").insert({
      owner_id: ownerBId, name: "S1 Fake", phone: "2612000079", address: "Calle S1 789",
      lat: -33.57, lng: -69.0, locality_id: localityId, status: "approved",
    });
    expect(error?.code).toBe(PERMISSION_DENIED);
    const { data } = await admin.from("venues").select("id").eq("name", "S1 Fake");
    expect(data).toEqual([]);
  });

  it("el alta normal (sin status) queda pending", async () => {
    const { data, error } = await ownerB.from("venues").insert({
      owner_id: ownerBId, name: "S1 Alta", phone: "2612000080", address: "Calle S1 1011",
      lat: -33.57, lng: -69.0, locality_id: localityId,
    }).select("id, status").single();
    expect(error).toBeNull();
    extraVenueIds.push(data!.id);
    expect(data!.status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// M2 — cancelar una reserva pagada sin devolver la plata
// ---------------------------------------------------------------------------

describe("M2: una reserva pagada online solo se cancela devolviendo la plata", () => {
  it("el dueño no puede cancelarla por UPDATE directo", async () => {
    const b = await insertPaidOnline(7, 5000);
    const { error } = await ownerA.from("bookings").update({ status: "cancelled" }).eq("id", b.id);
    expect(error?.code).toBe(PERMISSION_DENIED);
    const { data } = await admin.from("bookings").select("status").eq("id", b.id).single();
    expect(data!.status).toBe("confirmed");
    expect(await paymentStatus(b.paymentId)).toBe("approved");
  });

  it("el dueño no puede borrarla", async () => {
    const b = await insertPaidOnline(8, 5000);
    const { error } = await ownerA.from("bookings").delete().eq("id", b.id);
    expect(error?.code).toBe(PERMISSION_DENIED);
    const { data } = await admin.from("bookings").select("id").eq("id", b.id);
    expect(data).toHaveLength(1);
  });

  it("no puede marcarla ausente antes del turno (liberaría el horario sin devolver)", async () => {
    const b = await insertPaidOnline(9, 2500);
    const { data } = await ownerA.rpc("panel_mark_no_show", { p_booking_id: b.id, p_venue_id: venueA });
    expect(data).toEqual({ error: "no_show_before_start" });
    const { data: row } = await admin.from("bookings").select("status").eq("id", b.id).single();
    expect(row!.status).toBe("confirmed");
  });

  it("no puede marcar pagada una reserva con el total ya pagado online", async () => {
    const b = await insertPaidOnline(10, 5000);
    const { data } = await ownerA.rpc("panel_mark_paid", { p_booking_id: b.id, p_venue_id: venueA });
    expect(data).toEqual({ error: "already_paid" });
  });

  it("un dueño ajeno no puede cancelarla (ni por RPC ni por la acción)", async () => {
    const b = await insertPaidOnline(11, 5000);
    const { data } = await ownerB.rpc("panel_cancel_booking", { p_booking_id: b.id, p_venue_id: venueA });
    expect(data).toEqual({ error: "not_owner" });
    const { data: viaOwnVenue } = await ownerB.rpc("panel_cancel_booking", { p_booking_id: b.id, p_venue_id: venueB });
    expect(viaOwnVenue).toEqual({ error: "not_owner" });

    currentClient = ownerB;
    const fd = new FormData();
    fd.set("booking_id", b.id);
    fd.set("venue_id", venueA);
    expect((await cancelBookingPanelAction(null, fd))?.error).toBe("No autorizado");

    const { data: row } = await admin.from("bookings").select("status").eq("id", b.id).single();
    expect(row!.status).toBe("confirmed");
    expect(await paymentStatus(b.paymentId)).toBe("approved");
  });

  it("el camino permitido (panel_cancel_booking) deja la devolución pendiente en la misma transacción", async () => {
    const b = await insertPaidOnline(12, 5000);
    const { data } = await ownerA.rpc("panel_cancel_booking", { p_booking_id: b.id, p_venue_id: venueA });
    expect(data).toMatchObject({ ok: true, refund_due: true, refund_amount: 5000, mp_payment_id: b.paymentId });
    const { data: row } = await admin.from("bookings").select("status").eq("id", b.id).single();
    expect(row!.status).toBe("cancelled");
    expect(await paymentStatus(b.paymentId)).toBe("refund_pending");
    // Limpieza inmediata: el cron solo toma devoluciones con más de 2 minutos.
    await admin.from("payments").delete().eq("mp_payment_id", b.paymentId);
  });
});
