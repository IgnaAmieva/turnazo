/**
 * Migración 027 en canchas: formato (solo fútbol) por la API directa y por
 * las acciones del panel. Si una cancha pasa a pádel o tenis, el panel manda
 * format = NULL (el trigger enforce_court_format rechazaría otro valor).
 *
 * Fixture propio (un dueño, un complejo); afterAll borra todo.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const opts = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts);
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, opts);
const owner = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, opts);

const current = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current.client }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("NEXT_REDIRECT " + u); } }));

import { createCourtAction, updateCourtAction } from "@/app/actions/panel";

const ids = { user: "", venue: "", courts: [] as string[] };
const sport: Record<string, string> = {};
let futbolCourt = "", padelCourt = "";

const formatOf = async (id: string) => (await admin.from("courts").select("format, sport_id").eq("id", id).single()).data;

function form(f: { name: string; sport: string; format?: string }) {
  const fd = new FormData();
  fd.set("name", f.name);
  fd.set("sport_id", sport[f.sport]);
  fd.set("slot_minutes", "60");
  fd.set("active", "on");
  fd.set("surface", "");
  if (f.format !== undefined) fd.set("format", f.format);
  return fd;
}

beforeAll(async () => {
  const { data: loc } = await admin.from("localities").select("id").eq("slug", "tunuyan").single();
  for (const s of (await admin.from("sports").select("id, slug")).data ?? []) sport[s.slug] = s.id;
  const email = `test-027-${Date.now()}@turnazo.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "TestPass123!", email_confirm: true });
  if (error) throw error;
  ids.user = data.user.id;
  await admin.from("profiles").upsert({ id: ids.user, role: "owner" });
  await owner.auth.signInWithPassword({ email, password: "TestPass123!" });
  const { data: v } = await admin.from("venues").insert({
    owner_id: ids.user, name: "Test 027", phone: "2622000000", address: "027", lat: -33.6, lng: -69.0,
    locality_id: loc!.id, status: "approved",
  }).select("id").single();
  ids.venue = v!.id;
  const { data: cs } = await admin.from("courts").insert([
    { venue_id: ids.venue, sport_id: sport.futbol, name: "F", slot_minutes: 60, active: true },
    { venue_id: ids.venue, sport_id: sport.padel, name: "P", slot_minutes: 90, active: true },
  ]).select("id, name");
  futbolCourt = cs!.find((c) => c.name === "F")!.id;
  padelCourt = cs!.find((c) => c.name === "P")!.id;
  ids.courts.push(futbolCourt, padelCourt);
}, 30_000);

afterAll(async () => {
  await owner.auth.signOut();
  const { data: all } = await admin.from("courts").select("id").eq("venue_id", ids.venue);
  const courtIds = (all ?? []).map((c) => c.id);
  await admin.from("court_hours").delete().in("court_id", courtIds);
  await admin.from("audit_log").delete().eq("venue_id", ids.venue);
  await admin.from("courts").delete().in("id", courtIds);
  await admin.from("venues").delete().eq("id", ids.venue);
  await admin.from("profiles").delete().eq("id", ids.user);
  await admin.auth.admin.deleteUser(ids.user);
}, 30_000);

describe("027 — API directa", () => {
  it("el dueño pone el formato de su cancha de fútbol; el público lo lee y no lo escribe", async () => {
    const { error } = await owner.from("courts").update({ format: "futbol_5" }).eq("id", futbolCourt);
    expect(error).toBeNull();
    expect((await anon.from("courts").select("format").eq("id", futbolCourt).single()).data).toEqual({ format: "futbol_5" });
    const { error: e2, count } = await anon.from("courts").update({ format: "futbol_7" }, { count: "exact" }).eq("id", futbolCourt);
    expect(e2 !== null || (count ?? 0) === 0).toBe(true);
    expect((await formatOf(futbolCourt))!.format).toBe("futbol_5");
  });

  it("el CHECK rechaza un formato inventado y el trigger rechaza formato en pádel", async () => {
    expect((await owner.from("courts").update({ format: "futbol_8" }).eq("id", futbolCourt)).error).not.toBeNull();
    const { error } = await owner.from("courts").update({ format: "futbol_5" }).eq("id", padelCourt);
    expect(error?.message).toContain("format_only_futbol");
    expect((await formatOf(padelCourt))!.format).toBeNull();
  });

  it("notes: 200 caracteres como máximo", async () => {
    expect((await owner.from("courts").update({ notes: "x".repeat(200) }).eq("id", futbolCourt)).error).toBeNull();
    expect((await owner.from("courts").update({ notes: "x".repeat(201) }).eq("id", futbolCourt)).error).not.toBeNull();
    await owner.from("courts").update({ notes: null }).eq("id", futbolCourt);
  });
});

describe("027 — acciones del panel", () => {
  it("crear una cancha de fútbol con formato lo guarda", async () => {
    current.client = owner;
    await expect(createCourtAction(ids.venue, null, form({ name: "Nueva F7", sport: "futbol", format: "futbol_7" })))
      .rejects.toThrow(/NEXT_REDIRECT .*paso=precios/);
    const { data } = await admin.from("courts").select("format").eq("venue_id", ids.venue).eq("name", "Nueva F7").single();
    expect(data!.format).toBe("futbol_7");
  });

  it("si la cancha pasa a pádel, se guarda format = NULL aunque el formulario lo mande", async () => {
    current.client = owner;
    expect(await updateCourtAction(ids.venue, futbolCourt, null, form({ name: "F", sport: "futbol", format: "futbol_11" }))).toBeNull();
    expect((await formatOf(futbolCourt))!.format).toBe("futbol_11");

    expect(await updateCourtAction(ids.venue, futbolCourt, null, form({ name: "F", sport: "padel", format: "futbol_11" }))).toBeNull();
    expect(await formatOf(futbolCourt)).toEqual({ format: null, sport_id: sport.padel });
  });

  it("un formato inventado vuelve como error del campo", async () => {
    current.client = owner;
    const res = await updateCourtAction(ids.venue, padelCourt, null, form({ name: "P", sport: "futbol", format: "futbol_8" }));
    expect(res?.fieldErrors?.format?.length).toBeGreaterThan(0);
  });
});
