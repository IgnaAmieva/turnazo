/**
 * Migración 023: etiquetas de la cancha (surface, covered, lit, has_locker_room).
 *
 * Un dueño solo puede editar SUS canchas, por la API directa (grants por
 * columna + RLS) y por la acción del panel (updateCourtAction). El público
 * (anon) las lee pero no las escribe, y el CHECK de surface rechaza valores
 * que no son de la lista.
 *
 * Fixture propio (dos dueños, dos complejos, una cancha cada uno); afterAll
 * borra todo. Las verificaciones de permisos usan los clientes de cada rol;
 * service_role solo para preparar y leer el resultado.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const opts = { auth: { autoRefreshToken: false, persistSession: false } };

const admin = createClient(url, serviceKey, opts);
const anon = createClient(url, anonKey, opts);
const ownerA = createClient(url, anonKey, opts);
const ownerB = createClient(url, anonKey, opts);

// La acción del panel usa el cliente del servidor: acá, el del dueño que la llama
const current = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current.client }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("NEXT_REDIRECT " + u); } }));

import { updateCourtAction } from "@/app/actions/panel";

const PASSWORD = "TestPass123!";
const ids = { users: [] as string[], venues: [] as string[], courts: [] as string[] };
let venueA = "", venueB = "", courtA = "", courtB = "", sportId = "";

async function makeOwner(client: SupabaseClient, tag: string) {
  const email = `test-023-${tag}-${Date.now()}@turnazo.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  ids.users.push(data.user.id);
  await admin.from("profiles").upsert({ id: data.user.id, role: "owner" });
  const { error: e2 } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (e2) throw e2;
  return data.user.id;
}

async function makeVenueWithCourt(ownerId: string, tag: string, localityId: string) {
  const { data: v, error } = await admin.from("venues").insert({
    owner_id: ownerId, name: `Test 023 ${tag}`, phone: "2622000000", address: `023 ${tag}`,
    lat: -33.6, lng: -69.0, locality_id: localityId, status: "approved",
  }).select("id").single();
  if (error) throw error;
  ids.venues.push(v.id);
  const { data: c, error: e2 } = await admin.from("courts").insert({
    venue_id: v.id, sport_id: sportId, name: `Cancha ${tag}`, slot_minutes: 90, active: true,
  }).select("id").single();
  if (e2) throw e2;
  ids.courts.push(c.id);
  return { venue: v.id, court: c.id };
}

const features = async (courtId: string) =>
  (await admin.from("courts").select("surface, covered, lit, has_locker_room").eq("id", courtId).single()).data;

function form(f: Record<string, string | boolean>) {
  const fd = new FormData();
  fd.set("name", String(f.name ?? "Cancha A"));
  fd.set("sport_id", sportId);
  fd.set("slot_minutes", "90");
  fd.set("active", "on");
  fd.set("surface", String(f.surface ?? ""));
  for (const k of ["covered", "lit", "has_locker_room"]) if (f[k]) fd.set(k, "on");
  return fd;
}

beforeAll(async () => {
  const { data: loc } = await admin.from("localities").select("id").eq("slug", "tunuyan").single();
  const { data: sport } = await admin.from("sports").select("id").eq("slug", "padel").single();
  sportId = sport!.id;
  const a = await makeOwner(ownerA, "a");
  const b = await makeOwner(ownerB, "b");
  ({ venue: venueA, court: courtA } = await makeVenueWithCourt(a, "A", loc!.id));
  ({ venue: venueB, court: courtB } = await makeVenueWithCourt(b, "B", loc!.id));
}, 30_000);

afterAll(async () => {
  await ownerA.auth.signOut();
  await ownerB.auth.signOut();
  await admin.from("audit_log").delete().in("venue_id", ids.venues);
  await admin.from("courts").delete().in("id", ids.courts);
  await admin.from("venues").delete().in("id", ids.venues);
  for (const u of ids.users) {
    await admin.from("profiles").delete().eq("id", u);
    await admin.auth.admin.deleteUser(u);
  }
}, 30_000);

describe("023 — API directa (grants + RLS)", () => {
  it("el dueño edita las etiquetas de SU cancha", async () => {
    const { error, count } = await ownerA.from("courts")
      .update({ surface: "sintetico", covered: true, lit: true }, { count: "exact" }).eq("id", courtA);
    expect(error).toBeNull();
    expect(count).toBe(1);
    expect(await features(courtA)).toEqual({ surface: "sintetico", covered: true, lit: true, has_locker_room: false });
  });

  it("NO puede editar la cancha de otro dueño (0 filas, sin cambios)", async () => {
    const before = await features(courtB);
    const { count } = await ownerA.from("courts")
      .update({ surface: "pasto", has_locker_room: true }, { count: "exact" }).eq("id", courtB);
    expect(count ?? 0).toBe(0);
    expect(await features(courtB)).toEqual(before);
  });

  it("el público las lee pero no las escribe", async () => {
    const { data } = await anon.from("courts").select("surface, covered, lit, has_locker_room").eq("id", courtA).single();
    expect(data).toMatchObject({ surface: "sintetico", covered: true });
    const before = await features(courtA);
    const { error, count } = await anon.from("courts").update({ lit: false }, { count: "exact" }).eq("id", courtA);
    expect(error !== null || (count ?? 0) === 0).toBe(true);
    expect(await features(courtA)).toEqual(before);
  });

  it("el CHECK de surface rechaza un valor que no es de la lista", async () => {
    const { error } = await ownerA.from("courts").update({ surface: "arena" }).eq("id", courtA);
    expect(error).not.toBeNull();
  });
});

describe("023 — acción del panel (updateCourtAction)", () => {
  it("el dueño guarda superficie e interruptores; 'Sin indicar' deja surface en null", async () => {
    current.client = ownerA;
    expect(await updateCourtAction(venueA, courtA, null, form({ surface: "blindex", has_locker_room: true }))).toBeNull();
    expect(await features(courtA)).toEqual({ surface: "blindex", covered: false, lit: false, has_locker_room: true });

    expect(await updateCourtAction(venueA, courtA, null, form({ surface: "" }))).toBeNull();
    expect(await features(courtA)).toEqual({ surface: null, covered: false, lit: false, has_locker_room: false });
  });

  it("otro dueño no puede cambiar la cancha ajena, ni aunque arme el pedido a mano", async () => {
    const before = await features(courtA);
    current.client = ownerB;
    const res = await updateCourtAction(venueA, courtA, null, form({ name: "Hackeada", surface: "pasto", covered: true, lit: true }));
    // La auditoría del complejo ajeno falla (RLS) y la acción lo informa; la cancha queda igual
    expect(res?.error).toBeTruthy();
    expect(await features(courtA)).toEqual(before);
    const { data } = await admin.from("courts").select("name").eq("id", courtA).single();
    expect(data!.name).toBe("Cancha A");
  });

  it("una superficie inventada vuelve como error del campo", async () => {
    current.client = ownerA;
    const res = await updateCourtAction(venueA, courtA, null, form({ surface: "arena" }));
    expect(res?.fieldErrors?.surface?.length).toBeGreaterThan(0);
  });
});
