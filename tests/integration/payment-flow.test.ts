/**
 * Fase 6, Bloque 3 — pago del jugador, con Mercado Pago simulado.
 *
 * Corre la acción real `startPaymentAction` como jugador anónimo contra la
 * base real (fixture propio), con mocks de:
 *   - getMpToken   → token falso (o null)
 *   - createMpOrder → orden falsa (o fallo)
 *   - redirect      → lanza un sentinel con la URL
 * Nunca se llama a la API real de Mercado Pago.
 *
 * Verifica:
 *   - el monto sale de create_booking_hold (seña 50 % de $5000 = $2500; total $5000)
 *   - external_reference e idempotencia = booking_id, sin marketplace_fee
 *   - mp_order_id queda guardado y el jugador va al checkout_url
 *   - si falla la orden (o no hay token): el hold pasa a 'expired' y el
 *     horario queda libre
 *   - doble toque: una sola orden (hold_limit_reached)
 *   - mensajes para slot_taken, full_payment_not_allowed, deposit_not_configured,
 *     mp_not_connected
 *   - getPaymentStatusAction: pendiente / confirmada / vencida / no_encontrada
 *
 * Limpieza: afterAll borra todo lo que creó el fixture.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// Mocks (antes de importar la acción)
// ---------------------------------------------------------------------------

class RedirectSignal extends Error {
  constructor(public url: string) {
    super("NEXT_REDIRECT " + url);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => anonClient,
}));

const getMpTokenMock = vi.fn();
vi.mock("@/lib/mp/token", () => ({
  getMpToken: (venueId: string) => getMpTokenMock(venueId),
}));

const createMpOrderMock = vi.fn();
const cancelMpOrderMock = vi.fn();
vi.mock("@/lib/mp/orders", () => ({
  createMpOrder: (input: unknown) => createMpOrderMock(input),
  cancelMpOrder: (...args: unknown[]) => cancelMpOrderMock(...args),
  getMpOrder:    vi.fn(),
  refundMpOrder: vi.fn(),
  isMpOrderPaid: () => false,
  mpOrderPaymentId: () => null,
}));

import { startPaymentAction, getPaymentStatusAction, cancelHoldAction } from "@/app/actions/payment";

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !serviceKey || !anonKey) {
  throw new Error("Faltan variables de entorno de Supabase");
}

const db = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anonClient = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let ownerUserId: string;
let venueId: string;
let courtId: string;
const PRICE = 5000;

const PHONE = "2622300300";

const DEPOSIT_AND_FULL = {
  deposit_required:   true,
  deposit_type:       "percent" as const,
  deposit_value:      50,
  allow_full_payment: true,
  allow_pay_at_venue: false,
};

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3001";

  const { data: userData, error: userErr } = await db.auth.admin.createUser({
    email:         `test-pago-${Date.now()}@turnazo.test`,
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
      owner_id:    ownerUserId,
      name:        "Test Pago Venue",
      phone:       "2622000000",
      address:     "Pago 123",
      locality_id: loc!.id,
      lat:         -33.6,
      lng:         -69.0,
      status:      "approved",
    })
    .select("id")
    .single();
  if (venueErr) throw venueErr;
  venueId = venue.id;

  const { data: court, error: courtErr } = await db
    .from("courts")
    .insert({ venue_id: venueId, sport_id: sport!.id, name: "Cancha Pago", slot_minutes: 90, active: true })
    .select("id")
    .single();
  if (courtErr) throw courtErr;
  courtId = court.id;

  await db.from("court_hours").insert(
    Array.from({ length: 7 }, (_, i) => ({ court_id: courtId, weekday: i, open_time: "08:00:00", close_time: "22:00:00" }))
  );
  await db.from("court_prices").insert(
    Array.from({ length: 7 }, (_, i) => ({ court_id: courtId, weekday: i, from_time: "08:00:00", to_time: "22:00:00", price: PRICE }))
  );

  // Cuenta MP falsa (sin tokens reales) y después la configuración de cobro
  const { error: mpErr } = await db.from("mp_accounts").insert({
    venue_id:          venueId,
    mp_user_id:        "test-pago",
    mp_email:          "pago@mp.test",
    access_token_enc:  "fake:enc:token",
    refresh_token_enc: "fake:enc:refresh",
    expires_at:        new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
  });
  if (mpErr) throw mpErr;
  await setSettings(DEPOSIT_AND_FULL);
}, 30_000);

afterAll(async () => {
  if (venueId) {
    await db.from("bookings").delete().eq("venue_id", venueId);
    await db.from("notification_outbox").delete().eq("venue_id", venueId);
    await db.from("venues").update({ deposit_required: false, allow_full_payment: false, allow_pay_at_venue: true }).eq("id", venueId);
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
  getMpTokenMock.mockReset();
  createMpOrderMock.mockReset();
  getMpTokenMock.mockResolvedValue({ accessToken: "APP_USR-fake", mpUserId: "test-pago" });
  createMpOrderMock.mockImplementation(async (input: { externalReference: string }) => ({
    ok: true,
    orderId: "ORD-" + input.externalReference.slice(0, 8),
    checkoutUrl: "https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORD-" + input.externalReference.slice(0, 8),
  }));
  // Cada test arranca sin reservas del fixture
  await db.from("bookings").delete().eq("venue_id", venueId);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setSettings(settings: Record<string, unknown>) {
  const { error } = await db.from("venues").update(settings).eq("id", venueId);
  if (error) throw error;
}

/** Slot N días adelante a las 08:00 Mendoza (11:00 UTC), 90 min. */
function slotAt08(daysFromNow: number) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  const start = new Date(d.getTime() + 11 * 3600 * 1000);
  const end   = new Date(start.getTime() + 90 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

type Outcome =
  | { kind: "redirect"; url: string }
  | { kind: "state"; state: { error?: string; fieldErrors?: Record<string, string[]> } };

/** Ejecuta la acción tal como la llamaría el formulario. */
async function pay(
  paymentType: "deposit" | "full",
  slot: { start: string; end: string },
  fields: Record<string, string> = {},
): Promise<Outcome> {
  const formData = new FormData();
  formData.set("customer_name",  fields.customer_name  ?? "Jugador Pago");
  formData.set("customer_phone", fields.customer_phone ?? PHONE);
  formData.set("customer_email", fields.customer_email ?? "  Jugador.Pago@Test.com ");
  // Un navegador malicioso podría mandar un monto: la acción lo ignora
  formData.set("amount", "1");
  try {
    const state = await startPaymentAction(
      { court_id: courtId, venue_id: venueId, start: slot.start, end: slot.end, payment_type: paymentType },
      {},
      formData,
    );
    return { kind: "state", state };
  } catch (err) {
    if (err instanceof RedirectSignal) return { kind: "redirect", url: err.url };
    throw err;
  }
}

async function bookingsOfFixture() {
  const { data, error } = await db
    .from("bookings")
    .select("id, status, mp_order_id, deposit_amount, price_total, cancel_token, hold_expires_at, customer_phone")
    .eq("venue_id", venueId)
    .order("created_at");
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("startPaymentAction — camino feliz", () => {
  it("seña: el monto sale de la base (50 % de $5000), guarda mp_order_id y redirige al checkout", async () => {
    const outcome = await pay("deposit", slotAt08(2));

    expect(outcome.kind).toBe("redirect");
    const rows = await bookingsOfFixture();
    expect(rows).toHaveLength(1);
    const b = rows[0];
    expect(b.status).toBe("hold");
    expect(b.price_total).toBe(PRICE);
    expect(b.deposit_amount).toBe(2500);
    expect(b.mp_order_id).toBe("ORD-" + b.id.slice(0, 8));
    expect(new Date(b.hold_expires_at!).getTime()).toBeGreaterThan(Date.now() + 8 * 60 * 1000);

    expect(createMpOrderMock).toHaveBeenCalledTimes(1);
    const input = createMpOrderMock.mock.calls[0][0];
    expect(input).toMatchObject({
      accessToken:       "APP_USR-fake",
      idempotencyKey:    b.id,
      externalReference: b.id,
      amount:            2500,
      title:             "Seña de turno",
      expiresIn:         "PT10M",
      // payer.email (obligatorio en Checkout Pro): normalizado, y el nombre tal cual
      payerEmail:        "jugador.pago@test.com",
      payerName:         "Jugador Pago",
    });
    expect(input.backUrl).toBe(`${process.env.NEXT_PUBLIC_APP_URL!.replace(/\/$/, "")}/pago/${b.cancel_token}`);
    expect(input).not.toHaveProperty("marketplaceFee");

    if (outcome.kind === "redirect") {
      expect(outcome.url).toBe("https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORD-" + b.id.slice(0, 8));
    }
  });

  it("pago total: cobra el precio completo", async () => {
    const outcome = await pay("full", slotAt08(3));
    expect(outcome.kind).toBe("redirect");

    const [b] = await bookingsOfFixture();
    expect(b.deposit_amount).toBe(PRICE);
    expect(createMpOrderMock.mock.calls[0][0]).toMatchObject({ amount: PRICE, title: "Pago de turno" });
  });
});

describe("startPaymentAction — validación del formulario", () => {
  it("sin email válido no se crea ni el hold ni la orden", async () => {
    for (const customer_email of ["", "sin-arroba", "juan@"]) {
      const outcome = await pay("deposit", slotAt08(2), { customer_email });
      expect(outcome.kind).toBe("state");
      if (outcome.kind === "state") {
        expect(outcome.state.fieldErrors?.customer_email?.[0]).toMatch(/email válido/);
      }
    }
    expect(createMpOrderMock).not.toHaveBeenCalled();
    expect(await bookingsOfFixture()).toHaveLength(0);
  });
});

describe("startPaymentAction — fallos liberan el horario", () => {
  it("si falla crear la orden: hold → expired, error claro, y el horario se puede volver a reservar", async () => {
    createMpOrderMock.mockResolvedValueOnce({ ok: false, status: 400, code: "bad_request", message: "x" });
    const slot = slotAt08(4);

    const outcome = await pay("deposit", slot);
    expect(outcome.kind).toBe("state");
    if (outcome.kind === "state") {
      expect(outcome.state.error).toMatch(/No pudimos iniciar el pago/);
    }

    const rows = await bookingsOfFixture();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("expired");
    expect(rows[0].mp_order_id).toBeNull();

    // El mismo horario vuelve a estar libre
    const retry = await pay("deposit", slot, { customer_phone: "2622300301" });
    expect(retry.kind).toBe("redirect");
  });

  it("sin token del dueño: hold → expired y no se crea ninguna orden", async () => {
    getMpTokenMock.mockResolvedValueOnce(null);

    const outcome = await pay("full", slotAt08(5));
    expect(outcome.kind).toBe("state");
    if (outcome.kind === "state") {
      expect(outcome.state.error).toMatch(/Mercado Pago/);
    }
    expect(createMpOrderMock).not.toHaveBeenCalled();

    const rows = await bookingsOfFixture();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("expired");
  });
});

describe("startPaymentAction — idempotencia y errores del RPC", () => {
  it("doble toque: el segundo intento no crea otra orden (hold_limit_reached)", async () => {
    const first = await pay("deposit", slotAt08(6));
    expect(first.kind).toBe("redirect");

    const second = await pay("deposit", slotAt08(7)); // mismo teléfono, otro horario
    expect(second.kind).toBe("state");
    if (second.kind === "state") {
      expect(second.state.error).toMatch(/Ya tenés un pago en curso/);
    }

    expect(createMpOrderMock).toHaveBeenCalledTimes(1);
    const rows = await bookingsOfFixture();
    expect(rows.filter((r) => r.status === "hold")).toHaveLength(1);
  });

  it("slot_taken: el horario ya está reservado", async () => {
    const slot = slotAt08(8);
    // Reserva confirmada de otra persona en ese horario
    const { error } = await db.from("bookings").insert({
      venue_id: venueId, court_id: courtId,
      period: `[${slot.start},${slot.end})`,
      status: "confirmed", payment_status: "unpaid",
      customer_name: "Otro", customer_phone: "2622999888",
      cancel_token: randomBytes(32).toString("hex"),
      price_total: PRICE, amount_paid: 0,
    });
    expect(error).toBeNull();

    const outcome = await pay("deposit", slot);
    expect(outcome.kind).toBe("state");
    if (outcome.kind === "state") {
      expect(outcome.state.error).toMatch(/ya fue reservado/);
    }
    expect(createMpOrderMock).not.toHaveBeenCalled();
  });

  it("full_payment_not_allowed: el complejo no acepta pago total", async () => {
    await setSettings({ ...DEPOSIT_AND_FULL, allow_full_payment: false });
    try {
      const outcome = await pay("full", slotAt08(9));
      expect(outcome.kind).toBe("state");
      if (outcome.kind === "state") {
        expect(outcome.state.error).toMatch(/no acepta el pago total/);
      }
      expect(createMpOrderMock).not.toHaveBeenCalled();
      expect(await bookingsOfFixture()).toHaveLength(0);
    } finally {
      await setSettings(DEPOSIT_AND_FULL);
    }
  });

  it("deposit_not_configured: el complejo no tiene seña", async () => {
    await setSettings({ deposit_required: false, deposit_type: null, deposit_value: null, allow_full_payment: true, allow_pay_at_venue: false });
    try {
      const outcome = await pay("deposit", slotAt08(10));
      expect(outcome.kind).toBe("state");
      if (outcome.kind === "state") {
        expect(outcome.state.error).toMatch(/no tiene la seña configurada/);
      }
      expect(await bookingsOfFixture()).toHaveLength(0);
    } finally {
      await setSettings(DEPOSIT_AND_FULL);
    }
  });

  it("mp_not_connected: sin cuenta MP el RPC rechaza antes de crear nada", async () => {
    // Mismo orden que la desconexión real: primero apagar el cobro, después la cuenta
    await setSettings({ deposit_required: false, deposit_type: null, deposit_value: null, allow_full_payment: false, allow_pay_at_venue: true });
    const { error: delErr } = await db.from("mp_accounts").delete().eq("venue_id", venueId);
    expect(delErr).toBeNull();
    try {
      const outcome = await pay("full", slotAt08(11));
      expect(outcome.kind).toBe("state");
      if (outcome.kind === "state") {
        expect(outcome.state.error).toMatch(/no tiene Mercado Pago conectado/);
      }
      expect(getMpTokenMock).not.toHaveBeenCalled();
      expect(await bookingsOfFixture()).toHaveLength(0);
    } finally {
      const { error: mpErr } = await db.from("mp_accounts").insert({
        venue_id:          venueId,
        mp_user_id:        "test-pago",
        mp_email:          "pago@mp.test",
        access_token_enc:  "fake:enc:token",
        refresh_token_enc: "fake:enc:refresh",
        expires_at:        new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
      });
      if (mpErr) throw mpErr;
      await setSettings(DEPOSIT_AND_FULL);
    }
  });

  it("valida nombre y teléfono antes de tocar la base", async () => {
    const outcome = await pay("deposit", slotAt08(12), { customer_name: "X", customer_phone: "abc" });
    expect(outcome.kind).toBe("state");
    if (outcome.kind === "state") {
      expect(outcome.state.fieldErrors?.customer_name).toBeDefined();
      expect(outcome.state.fieldErrors?.customer_phone).toBeDefined();
    }
    expect(await bookingsOfFixture()).toHaveLength(0);
  });
});

describe("cancelHoldAction — 'Cancelar y elegir otro horario'", () => {
  it("libera el hold, cancela la orden en MP y vuelve a la pantalla de reserva del mismo horario", async () => {
    cancelMpOrderMock.mockResolvedValue({ ok: true, alreadyCancelled: false });
    const slot = slotAt08(16);
    await pay("deposit", slot);
    const [b] = await bookingsOfFixture();
    expect(b.status).toBe("hold");

    const fecha = slot.start.slice(0, 10); // 11:00 UTC = 08:00 Mendoza, mismo día
    await expect(cancelHoldAction(b.cancel_token!)).rejects.toThrow(
      `NEXT_REDIRECT /tunuyan/padel/${venueId}/reservar?cancha=${courtId}&inicio=${encodeURIComponent(slot.start)}&fin=${encodeURIComponent(slot.end)}&fecha=${fecha}`
    );

    const [after] = await bookingsOfFixture();
    expect(after.status).toBe("expired");
    expect(cancelMpOrderMock).toHaveBeenCalledTimes(1);
    expect(cancelMpOrderMock).toHaveBeenCalledWith("APP_USR-fake", b.mp_order_id, `cancel-${b.id}`);

    // El mismo teléfono puede volver a reservar enseguida (no hay hold_limit_reached)
    const retry = await pay("deposit", slot);
    expect(retry.kind).toBe("redirect");

    // Segundo clic sobre el hold viejo: no toca nada ni vuelve a cancelar en MP
    await expect(cancelHoldAction(b.cancel_token!)).rejects.toThrow("NEXT_REDIRECT /tunuyan/padel/");
    expect(cancelMpOrderMock).toHaveBeenCalledTimes(1);
    const rows = await bookingsOfFixture();
    expect(rows.map((r) => r.status).sort()).toEqual(["expired", "hold"]);
  });

  it("no cancela una reserva confirmada y con token inexistente va al inicio", async () => {
    await pay("deposit", slotAt08(17));
    const [b] = await bookingsOfFixture();
    await db.from("bookings").update({ status: "confirmed", payment_status: "deposit_paid", amount_paid: 2500 }).eq("id", b.id);

    await expect(cancelHoldAction(b.cancel_token!)).rejects.toThrow("NEXT_REDIRECT /tunuyan/padel/");
    expect((await bookingsOfFixture())[0].status).toBe("confirmed");
    expect(cancelMpOrderMock).not.toHaveBeenCalled();

    await expect(cancelHoldAction("token-inexistente")).rejects.toThrow("NEXT_REDIRECT /");
    await expect(cancelHoldAction("")).rejects.toThrow("NEXT_REDIRECT /");
  });
});

describe("getPaymentStatusAction — estado real de la reserva", () => {
  it("pendiente mientras el hold está vigente, confirmada cuando el webhook confirma", async () => {
    await pay("deposit", slotAt08(13));
    const [b] = await bookingsOfFixture();

    const pending = await getPaymentStatusAction(b.cancel_token!);
    expect(pending.state).toBe("pendiente");
    expect(pending.amount).toBe(2500);
    expect(new Date(pending.expiresAt!).getTime()).toBe(new Date(b.hold_expires_at!).getTime());

    // Lo que hará el webhook (Bloque 4)
    await db.from("bookings").update({ status: "confirmed", payment_status: "deposit_paid", amount_paid: 2500 }).eq("id", b.id);
    expect((await getPaymentStatusAction(b.cancel_token!)).state).toBe("confirmada");
  });

  it("vencida si el hold expiró aunque el cron todavía no lo haya marcado", async () => {
    await pay("deposit", slotAt08(14));
    const [b] = await bookingsOfFixture();

    await db.from("bookings").update({ hold_expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", b.id);
    expect((await getPaymentStatusAction(b.cancel_token!)).state).toBe("vencida");

    await db.from("bookings").update({ status: "expired" }).eq("id", b.id);
    expect((await getPaymentStatusAction(b.cancel_token!)).state).toBe("vencida");
  });

  it("cancelada y no encontrada", async () => {
    await pay("deposit", slotAt08(15));
    const [b] = await bookingsOfFixture();
    await db.from("bookings").update({ status: "cancelled" }).eq("id", b.id);
    expect((await getPaymentStatusAction(b.cancel_token!)).state).toBe("cancelada");

    expect((await getPaymentStatusAction("token-que-no-existe")).state).toBe("no_encontrada");
    expect((await getPaymentStatusAction("")).state).toBe("no_encontrada");
  });
});
