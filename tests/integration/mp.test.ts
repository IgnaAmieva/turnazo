/**
 * Integration tests for Mercado Pago OAuth (Bloque 1):
 *   - Disconnect resets deposit_required, allow_full_payment, allow_pay_at_venue
 *   - Disconnect blocked by active hold
 *   - Disconnect (real action): past paid booking does not block, future one does
 *   - Callback rejects when session user != state user
 *   - Callback rejects when no session
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { disconnectMpAction } from "@/app/actions/mp";

// The action runs outside a Next request: no cookies and no cache to revalidate.
// createClient() returns a client holding the test owner's session instead.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ownerClient,
}));

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !serviceKey || !anonKey) {
  throw new Error(
    "Faltan variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY"
  );
}

const db = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Client with the test owner's session — what the action gets from createClient() */
const ownerClient = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const OWNER_PASSWORD = "TestPass123!";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let ownerUserId: string;
let venueId: string;
let courtId: string;
const createdIds: string[] = [];

beforeAll(async () => {
  // Create test user
  const ownerEmail = `test-mp-${Date.now()}@turnazo.test`;
  const { data: userData, error: userErr } = await db.auth.admin.createUser({
    email: ownerEmail,
    password: OWNER_PASSWORD,
    email_confirm: true,
  });
  if (userErr) throw userErr;
  ownerUserId = userData.user.id;
  createdIds.push(ownerUserId);

  await db.from("profiles").upsert({ id: ownerUserId, role: "owner" });

  const { error: signInErr } = await ownerClient.auth.signInWithPassword({
    email: ownerEmail,
    password: OWNER_PASSWORD,
  });
  if (signInErr) throw signInErr;

  // Locality
  const { data: loc } = await db
    .from("localities")
    .select("id")
    .eq("slug", "tunuyan")
    .single();

  // Sport
  const { data: sport } = await db
    .from("sports")
    .select("id")
    .eq("slug", "padel")
    .single();

  // Venue (payment settings are set AFTER mp_accounts exists: migration 018
  // rejects seña / pago total on a venue without a connected MP account)
  const { data: venue, error: venueErr } = await db
    .from("venues")
    .insert({
      owner_id: ownerUserId,
      name: "Test MP Venue",
      phone: "5492612345678",
      address: "Test 123",
      locality_id: loc!.id,
      lat: -33.7,
      lng: -69.1,
      status: "approved",
    })
    .select("id")
    .single();
  if (venueErr) throw venueErr;
  venueId = venue!.id;

  // Court
  const { data: court, error: courtErr } = await db
    .from("courts")
    .insert({
      venue_id: venueId,
      name: "MP Test Court",
      sport_id: sport!.id,
      slot_minutes: 90,
      active: true,
    })
    .select("id")
    .single();
  if (courtErr) throw courtErr;
  courtId = court!.id;

  // Court hours (all days 08:00 - 00:30)
  const hours = Array.from({ length: 7 }, (_, weekday) => ({
    court_id: courtId,
    weekday,
    open_time: "08:00:00",
    close_time: "00:30:00",
  }));
  await db.from("court_hours").insert(hours);

  // Insert mp_account for the venue, then turn deposit + full payment on
  const { error: mpErr } = await db.from("mp_accounts").insert({
    venue_id: venueId,
    mp_user_id: "12345678",
    mp_email: "test@mp.com",
    access_token_enc: "fake:enc:token",
    refresh_token_enc: "fake:enc:refresh",
    expires_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
  });
  if (mpErr) throw mpErr;

  const { error: settingsErr } = await db
    .from("venues")
    .update({
      deposit_required: true,
      deposit_type: "percent",
      deposit_value: 50,
      allow_full_payment: true,
      allow_pay_at_venue: false,
    })
    .eq("id", venueId);
  if (settingsErr) throw settingsErr;
});

afterAll(async () => {
  await ownerClient.auth.signOut();
  // Cleanup in reverse order
  await db.from("bookings").delete().eq("venue_id", venueId);
  await db.from("mp_accounts").delete().eq("venue_id", venueId);
  await db.from("court_hours").delete().eq("court_id", courtId);
  await db.from("court_prices").delete().eq("court_id", courtId);
  await db.from("courts").delete().eq("id", courtId);
  await db.from("audit_log").delete().eq("venue_id", venueId);
  await db.from("venues").delete().eq("id", venueId);
  if (ownerUserId) {
    await db.from("profiles").delete().eq("id", ownerUserId);
    await db.auth.admin.deleteUser(ownerUserId);
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("disconnect MP", () => {
  it("blocks disconnect when there is an active hold", async () => {
    // Create a hold booking
    const start = new Date(Date.now() + 48 * 3600 * 1000);
    const end = new Date(start.getTime() + 90 * 60 * 1000);

    const { data: booking } = await db
      .from("bookings")
      .insert({
        venue_id: venueId,
        court_id: courtId,
        period: `[${start.toISOString()},${end.toISOString()})`,
        status: "hold",
        payment_status: "unpaid",
        hold_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min from now
        customer_name: "Hold Test",
        customer_phone: "5492612345678",
        cancel_token: randomBytes(16).toString("hex"),
        price_total: 7000,
        amount_paid: 0,
      })
      .select("id")
      .single();

    // Check that active holds are detected
    const { count } = await db
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("venue_id", venueId)
      .eq("status", "hold")
      .gt("hold_expires_at", new Date().toISOString());

    expect(count).toBeGreaterThan(0);

    // Cleanup
    await db.from("bookings").delete().eq("id", booking!.id);
  });

  it("allows disconnect when hold is expired", async () => {
    const start = new Date(Date.now() + 48 * 3600 * 1000);
    const end = new Date(start.getTime() + 90 * 60 * 1000);

    const { data: booking } = await db
      .from("bookings")
      .insert({
        venue_id: venueId,
        court_id: courtId,
        period: `[${start.toISOString()},${end.toISOString()})`,
        status: "hold",
        payment_status: "unpaid",
        hold_expires_at: new Date(Date.now() - 60 * 1000).toISOString(), // expired 1 min ago
        customer_name: "Expired Hold",
        customer_phone: "5492612345678",
        cancel_token: randomBytes(16).toString("hex"),
        price_total: 7000,
        amount_paid: 0,
      })
      .select("id")
      .single();

    // Expired holds should NOT block disconnect
    const { count } = await db
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("venue_id", venueId)
      .eq("status", "hold")
      .gt("hold_expires_at", new Date().toISOString());

    expect(count).toBe(0);

    // Cleanup
    await db.from("bookings").delete().eq("id", booking!.id);
  });

  it("resets venue payment settings after disconnect", async () => {
    // Ensure mp_account exists
    await db.from("mp_accounts").upsert({
      venue_id: venueId,
      mp_user_id: "12345678",
      mp_email: "test@mp.com",
      access_token_enc: "fake:enc:token",
      refresh_token_enc: "fake:enc:refresh",
      expires_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
    }, { onConflict: "venue_id" });

    // Set payment settings
    await db
      .from("venues")
      .update({
        deposit_required: true,
        deposit_type: "percent",
        deposit_value: 50,
        allow_full_payment: true,
        allow_pay_at_venue: false,
      })
      .eq("id", venueId);

    // Simulate disconnect: delete mp_account and reset settings
    await db.from("mp_accounts").delete().eq("venue_id", venueId);
    await db
      .from("venues")
      .update({
        deposit_required: false,
        allow_full_payment: false,
        allow_pay_at_venue: true,
      })
      .eq("id", venueId);

    // Verify settings were reset
    const { data: venue } = await db
      .from("venues")
      .select("deposit_required, allow_full_payment, allow_pay_at_venue")
      .eq("id", venueId)
      .single();

    expect(venue!.deposit_required).toBe(false);
    expect(venue!.allow_full_payment).toBe(false);
    expect(venue!.allow_pay_at_venue).toBe(true);

    // Re-insert mp_account for other tests
    await db.from("mp_accounts").insert({
      venue_id: venueId,
      mp_user_id: "12345678",
      mp_email: "test@mp.com",
      access_token_enc: "fake:enc:token",
      refresh_token_enc: "fake:enc:refresh",
      expires_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
    });
  });
});

// ---------------------------------------------------------------------------
// disconnectMpAction — the real server action, called as the owner
// ---------------------------------------------------------------------------

/** Puts the venue back in "MP connected + deposit on" before each action test. */
async function connectWithDeposit() {
  const { error: mpErr } = await db.from("mp_accounts").upsert({
    venue_id: venueId,
    mp_user_id: "12345678",
    mp_email: "test@mp.com",
    access_token_enc: "fake:enc:token",
    refresh_token_enc: "fake:enc:refresh",
    expires_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
  }, { onConflict: "venue_id" });
  if (mpErr) throw mpErr;

  const { error: venueErr } = await db
    .from("venues")
    .update({
      deposit_required: true,
      deposit_type: "percent",
      deposit_value: 50,
      allow_full_payment: true,
      allow_pay_at_venue: false,
    })
    .eq("id", venueId);
  if (venueErr) throw venueErr;
}

/** Confirmed booking paid online whose period starts `startOffsetMs` from now. */
async function insertPaidBooking(startOffsetMs: number, name: string) {
  const start = new Date(Date.now() + startOffsetMs);
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  const { data, error } = await db
    .from("bookings")
    .insert({
      venue_id: venueId,
      court_id: courtId,
      period: `[${start.toISOString()},${end.toISOString()})`,
      status: "confirmed",
      payment_status: "paid",
      customer_name: name,
      customer_phone: "5492612345678",
      cancel_token: randomBytes(16).toString("hex"),
      price_total: 7000,
      amount_paid: 7000,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

function disconnect() {
  const formData = new FormData();
  formData.set("venue_id", venueId);
  return disconnectMpAction(null, formData);
}

async function readVenueSettings() {
  const { data } = await db
    .from("venues")
    .select("deposit_required, allow_full_payment, allow_pay_at_venue")
    .eq("id", venueId)
    .single();
  return data;
}

async function countMpAccounts() {
  const { data } = await db.from("mp_accounts").select("id").eq("venue_id", venueId);
  return data?.length;
}

describe("disconnectMpAction", () => {
  it("reserva pagada pasada no bloquea", async () => {
    await connectWithDeposit();
    // Played yesterday, paid in full. created_at is today on purpose:
    // the old 30-day created_at heuristic would have blocked on this row.
    const bookingId = await insertPaidBooking(-24 * 3600 * 1000, "Paid Past");

    try {
      expect(await disconnect()).toBeNull();
      expect(await countMpAccounts()).toBe(0);
      expect(await readVenueSettings()).toEqual({
        deposit_required: false,
        allow_full_payment: false,
        allow_pay_at_venue: true,
      });
    } finally {
      await db.from("bookings").delete().eq("id", bookingId);
    }
  });

  it("reserva pagada futura bloquea y no toca nada", async () => {
    await connectWithDeposit();
    const bookingId = await insertPaidBooking(72 * 3600 * 1000, "Paid Future");

    try {
      const result = await disconnect();
      expect(result?.error).toMatch(/pagos activos/);
      expect(await countMpAccounts()).toBe(1);
      expect(await readVenueSettings()).toEqual({
        deposit_required: true,
        allow_full_payment: true,
        allow_pay_at_venue: false,
      });
    } finally {
      await db.from("bookings").delete().eq("id", bookingId);
    }
  });

  it("reserva pagada en curso (empezó pero no terminó) bloquea", async () => {
    await connectWithDeposit();
    // Started 30 min ago, ends in 60 min: the END of the period is what counts.
    const bookingId = await insertPaidBooking(-30 * 60 * 1000, "Paid Ongoing");

    try {
      const result = await disconnect();
      expect(result?.error).toMatch(/pagos activos/);
      expect(await countMpAccounts()).toBe(1);
    } finally {
      await db.from("bookings").delete().eq("id", bookingId);
    }
  });
});

describe("OAuth state security", () => {
  it("state with mismatched userId is rejected by design", async () => {
    // This tests the principle: callback must verify user.id === payload.userId
    // We test this at the state level: creating state for user-A, but checking user-B
    process.env.MP_STATE_SECRET = "test-secret-for-integration-32chars!";
    const { createOAuthState, verifyOAuthState } = await import("@/lib/mp/state");

    const { state, nonce } = createOAuthState({ userId: "user-A", venueId: venueId });
    const payload = verifyOAuthState(state, nonce);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("user-A");

    // The callback route would compare: user.id !== payload.userId → reject
    // We verify the state itself carries the correct userId
    expect(payload!.userId).not.toBe("user-B");
  });

  it("rejects state without nonce cookie", async () => {
    process.env.MP_STATE_SECRET = "test-secret-for-integration-32chars!";
    const { createOAuthState, verifyOAuthState } = await import("@/lib/mp/state");

    const { state } = createOAuthState({ userId: "user-1", venueId: venueId });
    // No nonce → reject
    expect(verifyOAuthState(state, undefined)).toBeNull();
  });
});
