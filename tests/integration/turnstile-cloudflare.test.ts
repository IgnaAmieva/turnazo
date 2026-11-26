/**
 * S2: verificación contra el siteverify REAL de Cloudflare, SOLO con las claves
 * de prueba oficiales (nunca las reales):
 *   1x0000000000000000000000000000000AA → siempre pasa
 *   2x0000000000000000000000000000000AA → siempre falla
 *   3x0000000000000000000000000000000AA → "token ya usado"
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 * Necesita red. La acción de reserva con la clave que falla no crea nada.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("NEXT_REDIRECT " + url); } }));
vi.mock("@/lib/push", () => ({ triggerPushSend: async () => {} }));

import { verifyTurnstile } from "@/lib/turnstile";
import { createBookingAction } from "@/app/actions/booking";
import { bookingError } from "@/lib/booking-errors";

const PASS = "1x0000000000000000000000000000000AA";
const FAIL = "2x0000000000000000000000000000000AA";
const SPENT = "3x0000000000000000000000000000000AA";
/** Token que devuelven los widgets de prueba */
const DUMMY = "XXXX.DUMMY.TOKEN.XXXX";

const original = process.env.TURNSTILE_SECRET_KEY;
afterAll(() => { process.env.TURNSTILE_SECRET_KEY = original; });

describe("siteverify real con las claves de prueba de Cloudflare", () => {
  it("la que siempre pasa → ok", async () => {
    process.env.TURNSTILE_SECRET_KEY = PASS;
    expect(await verifyTurnstile(DUMMY, null)).toBe("ok");
  });

  it("la que siempre falla → invalid", async () => {
    process.env.TURNSTILE_SECRET_KEY = FAIL;
    expect(await verifyTurnstile(DUMMY, null)).toBe("invalid");
  });

  it("token ya usado → invalid", async () => {
    process.env.TURNSTILE_SECRET_KEY = SPENT;
    expect(await verifyTurnstile(DUMMY, null)).toBe("invalid");
  });

  it("reservar con la clave que siempre falla: mensaje del catálogo y no se crea nada", async () => {
    process.env.TURNSTILE_SECRET_KEY = FAIL;
    const phone = `2622${Math.floor(100000 + Math.random() * 899999)}`;
    const fd = new FormData();
    fd.set("customer_name", "Test S2 Cloudflare");
    fd.set("customer_phone", phone);
    fd.set("cf-turnstile-response", DUMMY);
    const start = new Date(Date.now() + 3 * 86400_000);
    start.setUTCHours(11, 0, 0, 0);
    const res = await createBookingAction({
      court_id: "c3d4e5f6-0000-0000-0000-000000000001",
      venue_id: "b2c3d4e5-0000-0000-0000-000000000001",
      start: start.toISOString(),
      end: new Date(start.getTime() + 90 * 60_000).toISOString(),
    }, {}, fd);
    expect(res).toEqual({ error: bookingError("captcha_failed").message });

    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } });
    const { data } = await admin.from("bookings").select("id").eq("customer_phone", `549${phone}`);
    expect(data).toEqual([]);
  });
});
