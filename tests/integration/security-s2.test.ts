/**
 * Fase 7, S2 — anti-abuso: captcha (Turnstile) y límites por IP, por
 * teléfono y por token (migración 022, aplicada), con HMAC de RATE_LIMIT_SECRET.
 *
 * Turnstile se simula (lo real se prueba en turnstile-cloudflare.test.ts con
 * las claves de prueba oficiales) y la IP sale de un next/headers simulado:
 * cada test usa una IP y un teléfono al azar, así no choca con otros tests ni
 * con reservas reales. Los intentos van a un turno de ayer: pasan el
 * anti-abuso y la base los rechaza (past_slot) sin crear nada. afterAll borra
 * los contadores que crearon estos tests.
 */
import { createHmac, randomBytes, randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const rateSecret  = process.env.RATE_LIMIT_SECRET!;
if (!supabaseUrl || !serviceKey || !anonKey) throw new Error("Faltan variables de entorno");
if (!rateSecret) throw new Error("Falta RATE_LIMIT_SECRET en .env.local");

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(supabaseUrl, serviceKey, noSession);
const anon  = createClient(supabaseUrl, anonKey, noSession);

let currentIp = "";
const turnstileMock = vi.fn();
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": currentIp }) }));
vi.mock("@/lib/turnstile", () => ({ verifyTurnstile: (...a: unknown[]) => turnstileMock(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("NEXT_REDIRECT " + url); } }));
vi.mock("@/lib/push", () => ({ triggerPushSend: async () => {} }));
const signIn = vi.fn(async () => ({ error: { message: "no" } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signInWithPassword: signIn } }) }));

import { createBookingAction } from "@/app/actions/booking";
import { startPaymentAction } from "@/app/actions/payment";
import { loginAction } from "@/app/actions/auth";
import { allowReconcile, AUTH_LIMITS, BOOKING_LIMITS, RECONCILE_LIMIT } from "@/lib/abuse";
import { bookingError } from "@/lib/booking-errors";
import { normalizeArgentinePhone } from "@/lib/phone";

const VENUE_ID = "b2c3d4e5-0000-0000-0000-000000000001";
const COURT_ID = "c3d4e5f6-0000-0000-0000-000000000001";
const CAPTCHA     = bookingError("captcha_failed").message;
const UNAVAILABLE = bookingError("captcha_unavailable").message;
const TOO_MANY    = bookingError("too_many_attempts").message;

/** Ayer 08:00 Mendoza: pasa el anti-abuso y la base lo rechaza sin insertar. */
function pastSlot() {
  const d = new Date();
  d.setUTCHours(11, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 1);
  return { start: d.toISOString(), end: new Date(d.getTime() + 90 * 60_000).toISOString() };
}

const usedKeys: { bucket: string; value: string }[] = [];
const hash = (bucket: string, value: string) =>
  createHmac("sha256", rateSecret).update(`${bucket}:${value}`).digest("hex");

function randomIp(bucket: string = BOOKING_LIMITS.ip.bucket) {
  const ip = `203.0.113.${randomInt(1, 255)}-${randomBytes(3).toString("hex")}`;
  usedKeys.push({ bucket, value: ip });
  return ip;
}
function randomPhone() {
  const phone = `2622${randomInt(100000, 999999)}`;
  usedKeys.push({ bucket: BOOKING_LIMITS.phone.bucket, value: normalizeArgentinePhone(phone) });
  return phone;
}

function form(phone: string, captcha: string | null = "tok") {
  const fd = new FormData();
  fd.set("customer_name", "Test S2");
  fd.set("customer_phone", phone);
  fd.set("customer_email", "test-s2@turnazo.test");
  if (captcha !== null) fd.set("cf-turnstile-response", captcha);
  return fd;
}

const book = (phone: string, captcha: string | null = "tok") =>
  createBookingAction({ court_id: COURT_ID, venue_id: VENUE_ID, ...pastSlot() }, {}, form(phone, captcha));

async function bookingsByPhone(phone: string) {
  const { data } = await admin.from("bookings").select("id").eq("customer_phone", normalizeArgentinePhone(phone));
  return data ?? [];
}

beforeEach(() => {
  turnstileMock.mockReset();
  turnstileMock.mockResolvedValue("ok");
  signIn.mockClear();
  currentIp = randomIp();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(async () => {
  const hashes = usedKeys.map((k) => hash(k.bucket, k.value));
  if (hashes.length) await admin.from("rate_limit_hits").delete().in("key_hash", hashes);
});

// ---------------------------------------------------------------------------
describe("captcha (Turnstile)", () => {
  it("sin captcha válido no se reserva: ni create_booking ni hold ni orden de MP", async () => {
    turnstileMock.mockResolvedValue("invalid");
    const phone = randomPhone();

    expect(await book(phone, null)).toEqual({ error: CAPTCHA });
    expect(await book(phone, "token-trucho")).toEqual({ error: CAPTCHA });

    const pay = await startPaymentAction(
      { court_id: COURT_ID, venue_id: VENUE_ID, ...pastSlot(), payment_type: "deposit" }, {}, form(phone));
    expect(pay).toEqual({ error: CAPTCHA });

    expect(await bookingsByPhone(phone)).toHaveLength(0);
  });

  it("Cloudflare no responde: mensaje claro para volver a intentar, y el intento siguiente pasa", async () => {
    turnstileMock.mockResolvedValueOnce("unavailable");
    const phone = randomPhone();
    expect(await book(phone)).toEqual({ error: UNAVAILABLE });
    expect(bookingError("captcha_unavailable").action.kind).toBe("retry");
    // Cloudflare volvió: el mismo jugador sigue (la base rechaza el turno pasado, no el captcha)
    const again = await book(phone);
    expect(again.error).toBe(bookingError("past_slot").message);
  });

  it("le pasa a Cloudflare el token del formulario y la IP del cliente", async () => {
    await book(randomPhone(), "token-del-widget");
    expect(turnstileMock).toHaveBeenCalledWith("token-del-widget", currentIp);
  });

  it("con captcha válido llega a la base (que acá rechaza el turno pasado)", async () => {
    expect((await book(randomPhone())).error).toBe(bookingError("past_slot").message);
  });

  it("login: sin captcha válido no se le pide nada a Supabase", async () => {
    turnstileMock.mockResolvedValue("invalid");
    currentIp = randomIp(AUTH_LIMITS.login.bucket);
    const fd = new FormData();
    fd.set("email", "nadie@turnazo.test");
    fd.set("password", "una-contraseña");
    expect(await loginAction({}, fd)).toEqual({ error: CAPTCHA });
    expect(signIn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("límites (migración 022, HMAC con RATE_LIMIT_SECRET)", () => {
  it(`por IP: ${BOOKING_LIMITS.ip.max} intentos por hora, el siguiente se corta (con teléfonos distintos)`, async () => {
    for (let i = 0; i < BOOKING_LIMITS.ip.max; i++) {
      expect((await book(randomPhone())).error).not.toBe(TOO_MANY);
    }
    expect(await book(randomPhone())).toEqual({ error: TOO_MANY });

    // Otra IP sigue pudiendo
    currentIp = randomIp();
    expect((await book(randomPhone())).error).not.toBe(TOO_MANY);
  }, 60_000);

  it(`por teléfono: ${BOOKING_LIMITS.phone.max} intentos por día aunque cambie la IP y el formato`, async () => {
    const phone = randomPhone();
    const formats = [phone, `0${phone}`, `+54 9 ${phone}`];
    for (let i = 0; i < BOOKING_LIMITS.phone.max; i++) {
      currentIp = randomIp();
      expect((await book(formats[i % formats.length])).error).not.toBe(TOO_MANY);
    }
    currentIp = randomIp();
    expect(await book(`+54 9 ${phone}`)).toEqual({ error: TOO_MANY });
  }, 60_000);

  it("el pago online también cuenta y se corta (antes del hold y de la orden de MP)", async () => {
    const phone = randomPhone();
    for (let i = 0; i < BOOKING_LIMITS.phone.max; i++) {
      currentIp = randomIp();
      await book(phone);
    }
    currentIp = randomIp();
    const pay = await startPaymentAction(
      { court_id: COURT_ID, venue_id: VENUE_ID, ...pastSlot(), payment_type: "deposit" }, {}, form(phone));
    expect(pay).toEqual({ error: TOO_MANY });
  }, 60_000);

  it(`login: ${AUTH_LIMITS.login.max} intentos por IP en 15 minutos`, async () => {
    currentIp = randomIp(AUTH_LIMITS.login.bucket);
    const fd = new FormData();
    fd.set("email", "nadie@turnazo.test");
    fd.set("password", "una-contraseña");
    for (let i = 0; i < AUTH_LIMITS.login.max; i++) {
      expect((await loginAction({}, fd)).error).toBe("Email o contraseña incorrectos.");
    }
    expect(await loginAction({}, fd)).toEqual({ error: TOO_MANY });
    expect(signIn).toHaveBeenCalledTimes(AUTH_LIMITS.login.max);
  }, 60_000);

  it("consulta a MP desde /pago: una por reserva cada 10 s (A3)", async () => {
    const token = randomBytes(16).toString("hex");
    usedKeys.push({ bucket: RECONCILE_LIMIT.bucket, value: token });
    expect(await allowReconcile(token)).toBe(true);
    expect(await allowReconcile(token)).toBe(false);
    expect(await allowReconcile(token)).toBe(false);
  });

  it("la base no guarda la IP ni el teléfono, solo un HMAC con RATE_LIMIT_SECRET", async () => {
    const phone = randomPhone();
    await book(phone);
    const norm = normalizeArgentinePhone(phone);
    const { data } = await admin.from("rate_limit_hits").select("key_hash")
      .eq("bucket", BOOKING_LIMITS.phone.bucket).eq("key_hash", hash(BOOKING_LIMITS.phone.bucket, norm));
    expect(data).toHaveLength(1);
    expect(data![0].key_hash).toMatch(/^[0-9a-f]{64}$/);
    // Con la clave del servicio (la de la rama vieja) el hash NO coincide
    const old = createHmac("sha256", serviceKey).update(`${BOOKING_LIMITS.phone.bucket}:${norm}`).digest("hex");
    expect(data![0].key_hash).not.toBe(old);
  });

  it("anon no puede ver la tabla ni sumar/borrar contadores", async () => {
    const sel = await anon.from("rate_limit_hits").select("*");
    expect(sel.error ?? (sel.data ?? []).length === 0).toBeTruthy();

    const rpc = await anon.rpc("rate_limit_hit", {
      p_bucket: "booking_ip", p_key_hash: "0".repeat(64), p_max: 100, p_window_seconds: 60,
    });
    expect(rpc.error).toBeTruthy();

    const del = await anon.from("rate_limit_hits").delete().neq("bucket", "");
    expect(del.error).toBeTruthy();
  });
});
