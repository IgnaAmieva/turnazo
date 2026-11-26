import path from "path";
import { Page } from "@playwright/test";

// Secretos de los tests (nunca en el repo): .env.local
process.loadEnvFile(path.join(__dirname, "../../.env.local"));

/** Collect page-level JS errors (uncaught exceptions / server component errors rendered to page) */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

/**
 * Returns a future date string YYYY-MM-DD for a weekday (Mon=1 … Fri=5).
 * Always picks the next occurrence that is at least `minDaysAhead` away.
 */
export function nextWeekday(targetDow: number, minDaysAhead = 1): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + minDaysAhead);
  while (d.getUTCDay() !== targetDow) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * "Ahora" fijo para la lista y el inicio (?_now=, solo fuera de producción):
 * un lunes futuro a las 09:00 de Mendoza. La lista muestra solo los complejos
 * con lugar, así que sin esto un test corrido de noche no ve el complejo de prueba.
 */
export const MORNING_NOW = `${nextWeekday(1, 12)}T12:00:00.000Z`;

/**
 * Build a slot URL param set for the booking form.
 * date: YYYY-MM-DD, timeHH: "10" for 10:00
 * Mendoza is UTC-3 year-round (no DST).
 */
export function slotParams(date: string, startHour: number, slotMinutes: number) {
  const [y, m, day] = date.split("-").map(Number);
  const startUtcMs = Date.UTC(y, m - 1, day, startHour + 3, 0, 0);   // UTC+3 offset for Mendoza UTC-3
  const endUtcMs   = startUtcMs + slotMinutes * 60 * 1000;
  return {
    fecha: date,
    inicio: new Date(startUtcMs).toISOString(),
    fin:    new Date(endUtcMs).toISOString(),
  };
}

/** Venue / court fixtures from the test DB */
export const VENUE_ID   = "b2c3d4e5-0000-0000-0000-000000000001";
export const COURT_ID   = "c3d4e5f6-0000-0000-0000-000000000001";
export const LOCALITY   = "tunuyan";
export const SPORT      = "padel";
export const VENUE_PATH = `/${LOCALITY}/${SPORT}/${VENUE_ID}`;

export const OWNER_EMAIL    = "dueno@turnazo.test";
/** Contraseña del dueño de prueba: E2E_OWNER_PASSWORD en .env.local. */
export const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "";
if (!OWNER_PASSWORD) throw new Error("Falta E2E_OWNER_PASSWORD en .env.local");

// Supabase public constants (safe to store here — these are NEXT_PUBLIC_ values)
export const SUPABASE_URL      = "https://mysomysshywixbaamuyw.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_UgVj5Rp4lyPko1Hi1e8Hbg_N_wfHBxY";

/**
 * service_role para preparar y limpiar datos de prueba. Desde la migración
 * 021 ni anon ni el dueño escriben directo en bookings / notification_outbox
 * ni leen audit_log.
 */
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export function serviceHeaders(): Record<string, string> {
  if (!SERVICE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en .env.local");
  return {
    apikey:         SERVICE_KEY,
    Authorization:  `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    // Supabase rechaza las claves secretas con User-Agent de navegador.
    "User-Agent":   "turnazo-e2e",
  };
}

/**
 * Login to Supabase via the REST API and return an access token.
 * Used in afterEach/afterAll hooks for direct DB cleanup without going through the app.
 */
export async function getOwnerToken(request: import("@playwright/test").APIRequestContext): Promise<string | null> {
  try {
    const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      data: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
    });
    if (!res.ok()) return null;
    const body = await res.json() as { access_token?: string };
    return body.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Delete test bookings by customer_name pattern(s), only on the fixture venue.
 * Uses service_role (the owner has no DELETE on bookings since migration 021).
 */
export async function deleteTestBookings(
  request: import("@playwright/test").APIRequestContext,
  patterns: string[] = ["E2E block*", "Audit Test*", "Test E2E"],
): Promise<void> {
  const headers = { ...serviceHeaders(), Prefer: "return=minimal" };
  for (const pattern of patterns) {
    const op   = pattern.includes("*") ? "like" : "eq";
    const encoded = encodeURIComponent(pattern.replace(/\*/g, "*"));
    await request.delete(
      `${SUPABASE_URL}/rest/v1/bookings?venue_id=eq.${VENUE_ID}&customer_name=${op}.${encoded}`,
      { headers }
    );
  }
}

/**
 * Delete notification_outbox rows for the fixture venue (service_role).
 * Call in afterAll alongside deleteTestBookings to keep the table clean.
 */
export async function deleteTestOutboxRows(
  request: import("@playwright/test").APIRequestContext,
): Promise<void> {
  await request.delete(
    `${SUPABASE_URL}/rest/v1/notification_outbox?venue_id=eq.${VENUE_ID}`,
    { headers: { ...serviceHeaders(), Prefer: "return=minimal" } }
  );
}

/**
 * Delete blocked_phones entries for the given phones (fixture venue, service_role).
 */
export async function unblockTestPhones(
  request: import("@playwright/test").APIRequestContext,
  phones: string[],
): Promise<void> {
  const headers = { ...serviceHeaders(), Prefer: "return=minimal" };
  for (const phone of phones) {
    await request.delete(
      `${SUPABASE_URL}/rest/v1/blocked_phones?venue_id=eq.${VENUE_ID}&phone=eq.${phone}`,
      { headers }
    );
  }
}

/**
 * Create a confirmed booking via the create_booking RPC (service_role: since
 * migration 021 only the server can call it).
 * date: YYYY-MM-DD, mendozaHour/mendozaMin: Mendoza local time.
 * Slot must align with the court's slot_minutes grid from open_time.
 * Returns the booking_id or null if creation failed.
 */
export async function createTestBooking(
  request:      import("@playwright/test").APIRequestContext,
  date:         string,
  mendozaHour:  number,
  mendozaMin:   number,
  name:         string,
  phone:        string,
): Promise<string | null> {
  const [y, m, d] = date.split("-").map(Number);
  const startUtcMs = Date.UTC(y, m - 1, d, mendozaHour + 3, mendozaMin, 0);
  const endUtcMs   = startUtcMs + 90 * 60 * 1000;
  try {
    const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/create_booking`, {
      headers: serviceHeaders(),
      data: {
        p_court_id:       COURT_ID,
        p_venue_id:       VENUE_ID,
        p_start:          new Date(startUtcMs).toISOString(),
        p_end:            new Date(endUtcMs).toISOString(),
        p_customer_name:  name,
        p_customer_phone: phone,
      },
    });
    const body = await res.json() as { booking_id?: string; error?: string };
    return body.booking_id ?? null;
  } catch {
    return null;
  }
}

export const SUPERADMIN_EMAIL = "superadmin@turnazo.test";

/**
 * Sesión del superadmin de prueba SIN contraseña: link mágico de un solo uso
 * generado con service_role (como iniciar sesión) y la cookie escrita por el
 * mismo @supabase/ssr que usa la app (encoding y partes iguales).
 */
export async function superadminCookies(baseURL = "http://localhost:3001") {
  const { createClient } = await import("@supabase/supabase-js");
  const { createServerClient } = await import("@supabase/ssr");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: SUPERADMIN_EMAIL });
  if (error || !link.properties?.hashed_token) throw new Error("No se pudo generar la sesión del superadmin de prueba");
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: otp, error: otpErr } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (otpErr || !otp.session) throw new Error("No se pudo abrir la sesión del superadmin de prueba");

  const jar: { name: string; value: string }[] = [];
  const ssr = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => jar,
      setAll: (list) => { for (const c of list) { const i = jar.findIndex((j) => j.name === c.name); if (i >= 0) jar.splice(i, 1); if (c.value) jar.push({ name: c.name, value: c.value }); } },
    },
  });
  await ssr.auth.setSession({ access_token: otp.session.access_token, refresh_token: otp.session.refresh_token });
  const url = new URL(baseURL);
  return {
    accessToken: otp.session.access_token,
    cookies: jar.map((c) => ({ name: c.name, value: c.value, domain: url.hostname, path: "/", httpOnly: false, secure: false, sameSite: "Lax" as const })),
  };
}

/** Contraste entre el color del texto del elemento y el fondo opaco más cercano. */
export async function contrastOf(el: import("@playwright/test").Locator): Promise<number> {
  return el.evaluate((node) => {
    const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    let bgEl: Element | null = node;
    let bg = "";
    while (bgEl) {
      const c = getComputedStyle(bgEl).backgroundColor;
      const parts = rgb(c);
      if (parts.length === 3 || (parts.length === 4 && parts[3] === 1)) { bg = c; break; }
      bgEl = bgEl.parentElement;
    }
    let opacity = 1;
    for (let e: Element | null = node; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
    if (opacity < 1) return 0; // un texto semitransparente no cuenta como legible
    const [a, b] = [lum(rgb(getComputedStyle(node).color)), lum(rgb(bg))].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
}
