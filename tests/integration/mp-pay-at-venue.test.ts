/**
 * Rediseño M3: error de Mercado Pago → "Pagar en el lugar".
 *
 * Corre las acciones reales (startPaymentAction y después createBookingAction,
 * como hace el formulario) contra la base real, con un complejo propio que
 * acepta pago total online y pago en el lugar. Mercado Pago está simulado.
 *
 * Verifica:
 *   - cuando falla el pago, el hold del intento online se libera ANTES de
 *     devolver el error, y "Pagar en el lugar" crea la reserva: para ese turno
 *     queda una sola reserva activa (el hold queda como 'expired');
 *   - si otro jugador toma el turno entre el error y "Pagar en el lugar", la
 *     reserva nueva falla con aviso (slot_taken → "Ver otros horarios"), nunca
 *     dos reservas;
 *   - si el hold no se pudo liberar, no se ofrece "Pagar en el lugar"
 *     (mp_hold_not_released): el turno sigue apartado a su nombre y se le avisa.
 *
 * Limpieza: afterAll borra el complejo, sus reservas, el outbox y el usuario.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

class RedirectSignal extends Error {
  constructor(public url: string) { super("NEXT_REDIRECT " + url); }
}

const flags = vi.hoisted(() => ({ failExpire: false }));

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new RedirectSignal(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Captcha y límites (S2) se prueban en security-s2.test.ts; acá no interfieren.
vi.mock("@/lib/abuse", () => ({ checkBookingAbuse: async () => null, checkAuthAbuse: async () => null, allowReconcile: async () => true }));
vi.mock("@/lib/push", () => ({ triggerPushSend: async () => {} }));

const getMpTokenMock = vi.fn();
vi.mock("@/lib/mp/token", () => ({ getMpToken: (venueId: string) => getMpTokenMock(venueId) }));
const createMpOrderMock = vi.fn();
vi.mock("@/lib/mp/orders", () => ({
  createMpOrder: (input: unknown) => createMpOrderMock(input),
  cancelMpOrder: vi.fn(),
  getMpOrder:    vi.fn(),
  refundMpOrder: vi.fn(),
  isMpOrderPaid: () => false,
  mpOrderPaymentId: () => null,
}));

// Cliente admin real; con flags.failExpire, el UPDATE que libera el hold falla.
vi.mock("@/lib/supabase/admin", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/supabase/admin")>();
  const failing = () => {
    const result = { data: null, count: null, error: { message: "fallo simulado" } };
    const chain: Record<string, unknown> = {
      eq: () => chain,
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result).then(ok, ko),
    };
    return chain;
  };
  return {
    createAdminClient: () => {
      const client = real.createAdminClient();
      if (!flags.failExpire) return client;
      const from = client.from.bind(client);
      (client as unknown as { from: unknown }).from = (table: string) => {
        const q = from(table as never);
        if (table !== "bookings") return q;
        const update = q.update.bind(q);
        (q as unknown as { update: unknown }).update = (vals: { status?: string }, opts?: unknown) =>
          vals?.status === "expired" ? failing() : update(vals as never, opts as never);
        return q;
      };
      return client;
    },
  };
});

import { startPaymentAction } from "@/app/actions/payment";
import { createBookingAction } from "@/app/actions/booking";
import { bookingErrorFromMessage } from "@/lib/booking-errors";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let ownerUserId: string;
let venueId: string;
let courtId: string;
const PHONE = "2622300400";
const OTHER_PHONE = "2622300401";

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3001";

  const { data: userData, error: userErr } = await db.auth.admin.createUser({
    email: `test-mp-lugar-${Date.now()}@turnazo.test`, password: "TestPass123!", email_confirm: true,
  });
  if (userErr) throw userErr;
  ownerUserId = userData.user.id;
  await db.from("profiles").upsert({ id: ownerUserId, role: "owner" });

  const { data: loc }   = await db.from("localities").select("id").eq("slug", "tunuyan").single();
  const { data: sport } = await db.from("sports").select("id").eq("slug", "padel").single();
  const { data: venue, error: venueErr } = await db.from("venues").insert({
    owner_id: ownerUserId, name: "Test MP Lugar", phone: "2622000000", address: "Lugar 123",
    locality_id: loc!.id, lat: -33.6, lng: -69.0, status: "approved",
  }).select("id").single();
  if (venueErr) throw venueErr;
  venueId = venue.id;

  const { data: court, error: courtErr } = await db.from("courts")
    .insert({ venue_id: venueId, sport_id: sport!.id, name: "Cancha Lugar", slot_minutes: 90, active: true })
    .select("id").single();
  if (courtErr) throw courtErr;
  courtId = court.id;

  await db.from("court_hours").insert(
    Array.from({ length: 7 }, (_, i) => ({ court_id: courtId, weekday: i, open_time: "08:00:00", close_time: "22:00:00" })));
  await db.from("court_prices").insert(
    Array.from({ length: 7 }, (_, i) => ({ court_id: courtId, weekday: i, from_time: "08:00:00", to_time: "22:00:00", price: 5000 })));

  const { error: mpErr } = await db.from("mp_accounts").insert({
    venue_id: venueId, mp_user_id: "test-mp-lugar", mp_email: "lugar@mp.test",
    access_token_enc: "fake:enc:token", refresh_token_enc: "fake:enc:refresh",
    expires_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
  });
  if (mpErr) throw mpErr;
  // Pago total online y pago en el lugar (como el complejo que ofrece "Pagar en el lugar")
  const { error: setErr } = await db.from("venues").update({
    deposit_required: false, allow_full_payment: true, allow_pay_at_venue: true,
  }).eq("id", venueId);
  if (setErr) throw setErr;
}, 30_000);

afterAll(async () => {
  if (venueId) {
    await db.from("bookings").delete().eq("venue_id", venueId);
    await db.from("notification_outbox").delete().eq("venue_id", venueId);
    await db.from("mp_accounts").delete().eq("venue_id", venueId);
    await db.from("audit_log").delete().eq("venue_id", venueId);
    await db.from("venues").delete().eq("id", venueId);
  }
  if (ownerUserId) {
    await db.from("profiles").delete().eq("id", ownerUserId);
    await db.auth.admin.deleteUser(ownerUserId);
  }
}, 30_000);

beforeEach(async () => {
  flags.failExpire = false;
  getMpTokenMock.mockReset();
  createMpOrderMock.mockReset();
  getMpTokenMock.mockResolvedValue({ accessToken: "APP_USR-fake", mpUserId: "test-mp-lugar" });
  createMpOrderMock.mockResolvedValue({ ok: false, status: 500, code: "internal_error", message: "simulado" });
  await db.from("bookings").delete().eq("venue_id", venueId);
});

/** Slot N días adelante a las 08:00 Mendoza (11:00 UTC), 90 min. */
function slotAt08(daysFromNow: number) {
  const d = new Date();
  d.setUTCHours(11, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return { start: d.toISOString(), end: new Date(d.getTime() + 90 * 60_000).toISOString() };
}

function form(phone = PHONE, name = "Jugador Lugar") {
  const fd = new FormData();
  fd.set("customer_name", name);
  fd.set("customer_phone", phone);
  fd.set("customer_email", "jugador.lugar@test.com");
  return fd;
}

/** Ejecuta una acción como el formulario: estado devuelto o URL de redirect. */
async function run(fn: () => Promise<{ error?: string }>) {
  try {
    return { state: await fn() };
  } catch (err) {
    if (err instanceof RedirectSignal) return { redirect: err.url };
    throw err;
  }
}

const payOnline = (slot: { start: string; end: string }) =>
  run(() => startPaymentAction({ court_id: courtId, venue_id: venueId, ...slot, payment_type: "full" }, {}, form()));
const payAtVenue = (slot: { start: string; end: string }, phone = PHONE, name?: string) =>
  run(() => createBookingAction({ court_id: courtId, venue_id: venueId, ...slot }, {}, form(phone, name)));

async function rowsFor(slot: { start: string; end: string }) {
  const { data, error } = await db.from("bookings")
    .select("id, status, customer_phone").eq("court_id", courtId).eq("period", `[${slot.start},${slot.end})`);
  if (error) throw error;
  return data;
}
const active = (rows: { status: string }[]) => rows.filter((r) => r.status === "hold" || r.status === "confirmed");

describe("error de Mercado Pago → Pagar en el lugar", () => {
  it.each([
    ["la orden de MP falla", () => {}, "mp_order_failed"],
    ["no hay token del complejo", () => getMpTokenMock.mockResolvedValue(null), "mp_token_unavailable"],
  ])("%s: el hold se libera antes del error y queda una sola reserva activa", async (_name, setup, code) => {
    setup();
    const slot = slotAt08(3);

    const online = await payOnline(slot);
    const err = bookingErrorFromMessage(online.state!.error!);
    expect(err.code).toBe(code);
    expect(err.action.kind).toBe("pay_at_venue_or_retry");
    // Al volver el error, el hold ya no ocupa el turno
    expect(active(await rowsFor(slot))).toHaveLength(0);

    const venue = await payAtVenue(slot);
    expect(venue.redirect).toMatch(/^\/turnos\//);

    const rows = await rowsFor(slot);
    expect(active(rows)).toEqual([expect.objectContaining({ status: "confirmed", customer_phone: PHONE })]);
    expect(rows.filter((r) => r.status === "expired")).toHaveLength(1); // el intento online, vencido
  });

  it("dos toques en 'Pagar en el lugar': la segunda no crea otra reserva", async () => {
    const slot = slotAt08(4);
    await payOnline(slot);
    const [a, b] = await Promise.all([payAtVenue(slot), payAtVenue(slot)]);
    const results = [a, b].map((r) => r.redirect ? "ok" : bookingErrorFromMessage(r.state!.error!).code).sort();
    expect(results).toEqual(["ok", "slot_taken"]);
    expect(active(await rowsFor(slot))).toHaveLength(1);
  });

  it("otro jugador toma el turno en el medio: la reserva falla con aviso y 'Ver otros horarios'", async () => {
    const slot = slotAt08(5);
    await payOnline(slot);
    expect((await payAtVenue(slot, OTHER_PHONE, "Otro Jugador")).redirect).toMatch(/^\/turnos\//);

    const mine = await payAtVenue(slot);
    const err = bookingErrorFromMessage(mine.state!.error!);
    expect(err.code).toBe("slot_taken");
    expect(err.action.kind).toBe("other_times");
    expect(err.message).toMatch(/ya fue reservado/);

    expect(active(await rowsFor(slot))).toEqual([expect.objectContaining({ customer_phone: OTHER_PHONE })]);
  });

  it("si el hold no se pudo liberar, no se ofrece 'Pagar en el lugar' y se avisa que el turno sigue a su nombre", async () => {
    const slot = slotAt08(6);
    flags.failExpire = true;
    const online = await payOnline(slot);
    flags.failExpire = false;

    const err = bookingErrorFromMessage(online.state!.error!);
    expect(err.code).toBe("mp_hold_not_released");
    expect(err.action.kind).toBe("wait");
    expect(err.message).toMatch(/apartado a tu nombre/);

    // El turno sigue apartado por su hold (no hay dos reservas aunque se intente igual)
    const rows = await rowsFor(slot);
    expect(active(rows)).toEqual([expect.objectContaining({ status: "hold", customer_phone: PHONE })]);
    const again = await payAtVenue(slot);
    expect(bookingErrorFromMessage(again.state!.error!).code).toBe("slot_taken");
    expect(active(await rowsFor(slot))).toHaveLength(1);
  });
});
