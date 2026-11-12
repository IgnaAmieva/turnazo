import { Page } from "@playwright/test";

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
export const OWNER_PASSWORD = "TurnazoPrueba1!";

// Supabase public constants (safe to store here — these are NEXT_PUBLIC_ values)
export const SUPABASE_URL      = "https://mysomysshywixbaamuyw.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_UgVj5Rp4lyPko1Hi1e8Hbg_N_wfHBxY";

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
 * Delete test bookings by customer_name pattern(s).
 * Uses the owner token — the owner has ALL on bookings for their venue.
 */
export async function deleteTestBookings(
  request: import("@playwright/test").APIRequestContext,
  patterns: string[] = ["E2E block*", "Audit Test*", "Test E2E"],
): Promise<void> {
  const token = await getOwnerToken(request);
  if (!token) return;
  const headers = {
    apikey:        SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Prefer:        "return=minimal",
  };
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
 * Delete blocked_phones entries for the given phones.
 */
export async function unblockTestPhones(
  request: import("@playwright/test").APIRequestContext,
  phones: string[],
): Promise<void> {
  const token = await getOwnerToken(request);
  if (!token) return;
  const headers = {
    apikey:        SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Prefer:        "return=minimal",
  };
  for (const phone of phones) {
    await request.delete(
      `${SUPABASE_URL}/rest/v1/blocked_phones?venue_id=eq.${VENUE_ID}&phone=eq.${phone}`,
      { headers }
    );
  }
}

/**
 * Create a confirmed booking via the create_booking RPC (anon user).
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
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
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
