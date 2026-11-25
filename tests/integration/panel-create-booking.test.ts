/**
 * Migración 026: panel_create_booking — el dueño carga un turno desde la agenda.
 *
 * - Solo el dueño del complejo (otro dueño → not_owner; anon no puede llamarla).
 * - Misma validación que la reserva pública: horario, grilla, precio, celular.
 * - Queda confirmado, sin pagar, source = 'manual', con el precio de la cancha.
 * - Horario ocupado → slot_taken.
 * - La acción del panel traduce los errores para el dueño y escribe audit_log.
 *
 * Fixture propio (dos dueños, dos complejos, una cancha cada uno); afterAll
 * borra todo. service_role solo para preparar y leer.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const opts = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts);
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, opts);
const ownerA = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, opts);
const ownerB = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, opts);

const current = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current.client }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("NEXT_REDIRECT " + u); } }));

import { createBookingPanelAction } from "@/app/actions/panel";

const ids = { users: [] as string[], venues: [] as string[] };
let venueA = "", courtA = "", venueB = "", courtB = "";

/** Un día que viene (3 días adelante) a las HH:MM de Mendoza, en ISO. */
function at(hh: number, mm: number, plusMin = 0): string {
  const d = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Mendoza" }).format(d);
  const [y, m, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day, hh + 3, mm + plusMin)).toISOString();
}

async function makeOwnerWithCourt(client: SupabaseClient, tag: string) {
  const email = `test-026-${tag}-${Date.now()}@turnazo.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "TestPass123!", email_confirm: true });
  if (error) throw error;
  ids.users.push(data.user.id);
  await admin.from("profiles").upsert({ id: data.user.id, role: "owner" });
  const { error: e2 } = await client.auth.signInWithPassword({ email, password: "TestPass123!" });
  if (e2) throw e2;

  const { data: loc } = await admin.from("localities").select("id").eq("slug", "tunuyan").single();
  const { data: sport } = await admin.from("sports").select("id").eq("slug", "padel").single();
  const { data: venue, error: ve } = await admin.from("venues").insert({
    owner_id: data.user.id, name: `Test 026 ${tag}`, phone: "2622000000", address: `026 ${tag}`,
    locality_id: loc!.id, lat: -33.6, lng: -69.0, status: "approved",
  }).select("id").single();
  if (ve) throw ve;
  ids.venues.push(venue.id);
  const { data: court, error: ce } = await admin.from("courts")
    .insert({ venue_id: venue.id, sport_id: sport!.id, name: "Cancha 026", slot_minutes: 90, active: true })
    .select("id").single();
  if (ce) throw ce;
  await admin.from("court_hours").insert(Array.from({ length: 7 }, (_, i) => ({ court_id: court.id, weekday: i, open_time: "08:00:00", close_time: "22:00:00" })));
  await admin.from("court_prices").insert(Array.from({ length: 7 }, (_, i) => ({ court_id: court.id, weekday: i, from_time: "08:00:00", to_time: "22:00:00", price: 7000 })));
  return { venue: venue.id as string, court: court.id as string };
}

const rpcArgs = (venue: string, court: string, startIso: string, endIso: string, name = "Jugador 026", phone = "2622 000770") => ({
  p_venue_id: venue, p_court_id: court, p_start: startIso, p_end: endIso, p_customer_name: name, p_customer_phone: phone,
});

beforeAll(async () => {
  ({ venue: venueA, court: courtA } = await makeOwnerWithCourt(ownerA, "a"));
  ({ venue: venueB, court: courtB } = await makeOwnerWithCourt(ownerB, "b"));
}, 30_000);

afterAll(async () => {
  await ownerA.auth.signOut();
  await ownerB.auth.signOut();
  await admin.from("bookings").delete().in("venue_id", ids.venues);
  await admin.from("audit_log").delete().in("venue_id", ids.venues);
  await admin.from("venues").delete().in("id", ids.venues);
  for (const u of ids.users) {
    await admin.from("profiles").delete().eq("id", u);
    await admin.auth.admin.deleteUser(u);
  }
}, 30_000);

describe("026 — panel_create_booking", () => {
  it("anon no puede llamarla", async () => {
    const { data, error } = await anon.rpc("panel_create_booking" as never, rpcArgs(venueA, courtA, at(9, 30), at(9, 30, 90)) as never);
    expect(error ?? (data as { error?: string })?.error).toBeTruthy();
    const { count } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("venue_id", venueA);
    expect(count).toBe(0);
  });

  it("B no puede cargar un turno en el complejo de A (ni con la cancha de A en su complejo)", async () => {
    const r1 = await ownerB.rpc("panel_create_booking" as never, rpcArgs(venueA, courtA, at(9, 30), at(9, 30, 90)) as never);
    expect((r1.data as { error?: string }).error).toBe("not_owner");
    const r2 = await ownerB.rpc("panel_create_booking" as never, rpcArgs(venueB, courtA, at(9, 30), at(9, 30, 90)) as never);
    expect((r2.data as { error?: string }).error).toBe("court_not_found");
    const { count } = await admin.from("bookings").select("id", { count: "exact", head: true }).in("venue_id", [venueA, venueB]);
    expect(count).toBe(0);
  });

  it("valida como la reserva pública: fuera de la grilla, celular, en el pasado", async () => {
    const err = async (args: Record<string, string>) =>
      ((await ownerA.rpc("panel_create_booking" as never, args as never)).data as { error?: string }).error;
    expect(await err(rpcArgs(venueA, courtA, at(9, 0), at(9, 0, 90)))).toBe("invalid_slot");
    expect(await err(rpcArgs(venueA, courtA, at(9, 30), at(9, 30, 90), "Jugador", "123"))).toBe("invalid_phone");
    const past = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    expect(await err(rpcArgs(venueA, courtA, past.toISOString(), new Date(past.getTime() + 90 * 60000).toISOString()))).toBe("past_slot");
  });

  it("A carga un turno: confirmado, sin pagar, manual, con el precio de la cancha; el mismo horario otra vez → slot_taken", async () => {
    const { data } = await ownerA.rpc("panel_create_booking" as never, rpcArgs(venueA, courtA, at(11, 0), at(11, 0, 90)) as never);
    const res = data as { ok?: boolean; booking_id?: string; price_total?: number };
    expect(res.ok).toBe(true);
    const { data: row } = await admin.from("bookings").select("status, source, kind, payment_status, price_total, amount_paid, customer_phone")
      .eq("id", res.booking_id!).single();
    expect(row).toMatchObject({ status: "confirmed", source: "manual", kind: "booking", payment_status: "unpaid", amount_paid: 0, customer_phone: "2622000770" });
    expect(Number(row!.price_total)).toBe(7000);

    const again = await ownerA.rpc("panel_create_booking" as never, rpcArgs(venueA, courtA, at(11, 0), at(11, 0, 90), "Otro", "2622000771") as never);
    expect((again.data as { error?: string }).error).toBe("slot_taken");
  });
});

describe("026 — acción del panel", () => {
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  it("marca el nombre y el celular en su campo; otro complejo → No autorizado", async () => {
    current.client = ownerA;
    const base = { venue_id: venueA, court_id: courtA, start: at(14, 0), end: at(14, 0, 90) };
    expect((await createBookingPanelAction(null, form({ ...base, customer_name: "J", customer_phone: "2622000772" })))?.fieldErrors?.customer_name?.[0]).toMatch(/nombre/);
    expect((await createBookingPanelAction(null, form({ ...base, customer_name: "Juan", customer_phone: "12" })))?.fieldErrors?.customer_phone?.[0]).toMatch(/celular/);
    current.client = ownerB;
    expect((await createBookingPanelAction(null, form({ ...base, customer_name: "Juan", customer_phone: "2622000772" })))?.error).toBe("No autorizado");
  });

  it("carga el turno y escribe audit_log (create, source manual)", async () => {
    current.client = ownerA;
    const res = await createBookingPanelAction(null, form({
      venue_id: venueA, court_id: courtA, start: at(15, 30), end: at(15, 30, 90),
      customer_name: "Juan Acción", customer_phone: "2622000773",
    }));
    expect(res).toBeNull();
    const { data: b } = await admin.from("bookings").select("id").eq("venue_id", venueA).eq("customer_name", "Juan Acción").single();
    const { data: audit } = await admin.from("audit_log").select("action, entity, new_data").eq("entity_id", b!.id);
    expect(audit).toEqual([expect.objectContaining({ action: "create", entity: "booking", new_data: expect.objectContaining({ source: "manual", price_total: 7000 }) })]);
  });
});
