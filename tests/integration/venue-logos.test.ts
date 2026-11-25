/**
 * Migraciones 024/025: logo del club en el bucket 'venue-logos'.
 *
 * - Un dueño sube, cambia y quita el logo de SU complejo (acción del panel,
 *   con su sesión).
 * - NO puede subir, pisar, borrar ni listar en la carpeta de otro complejo,
 *   ni por la API de storage ni por la acción; tampoco apuntar logo_path a un
 *   archivo de otra carpeta (venues_logo_path_check).
 * - La acción valida el tipo real por los primeros bytes y el tamaño.
 *
 * Fixture propio (dos dueños, dos complejos); afterAll borra los archivos de
 * las dos carpetas, los complejos y los usuarios. service_role solo para
 * preparar y para leer el resultado.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { randomBytes } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const opts = { auth: { autoRefreshToken: false, persistSession: false } };

const admin = createClient(url, serviceKey, opts);
const anon = createClient(url, anonKey, opts);
const ownerA = createClient(url, anonKey, opts);
const ownerB = createClient(url, anonKey, opts);

const current = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current.client }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("NEXT_REDIRECT " + u); } }));

import { uploadVenueLogoAction, removeVenueLogoAction } from "@/app/actions/panel";

const BUCKET = "venue-logos";
const PASSWORD = "TestPass123!";
const ids = { users: [] as string[], venues: [] as string[] };
let venueA = "", venueB = "";

/** PNG 1×1 válido */
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082",
  "hex",
);

async function makeOwner(client: SupabaseClient, tag: string) {
  const email = `test-024-${tag}-${Date.now()}@turnazo.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  ids.users.push(data.user.id);
  await admin.from("profiles").upsert({ id: data.user.id, role: "owner" });
  const { error: e2 } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (e2) throw e2;
  return data.user.id;
}

async function makeVenue(ownerId: string, tag: string, localityId: string) {
  const { data, error } = await admin.from("venues").insert({
    owner_id: ownerId, name: `Test 024 ${tag}`, phone: "2622000000", address: `024 ${tag}`,
    lat: -33.6, lng: -69.0, locality_id: localityId, status: "approved",
  }).select("id").single();
  if (error) throw error;
  ids.venues.push(data.id);
  return data.id as string;
}

/** Archivos de la carpeta de un complejo (leídos con service_role). */
async function files(venueId: string) {
  const { data } = await admin.storage.from(BUCKET).list(venueId);
  return (data ?? []).map((f) => f.name).sort();
}
const logoPath = async (venueId: string) =>
  (await admin.from("venues").select("logo_path").eq("id", venueId).single()).data!.logo_path as string | null;

function logoForm(bytes: Buffer, name = "logo.png", type = "image/png") {
  const fd = new FormData();
  fd.set("logo", new File([new Uint8Array(bytes)], name, { type }));
  return fd;
}

beforeAll(async () => {
  const { data: loc } = await admin.from("localities").select("id").eq("slug", "tunuyan").single();
  const a = await makeOwner(ownerA, "a");
  const b = await makeOwner(ownerB, "b");
  venueA = await makeVenue(a, "A", loc!.id);
  venueB = await makeVenue(b, "B", loc!.id);
  // B ya tiene un logo (subido con service_role, para probar que A no lo toca)
  const { error } = await admin.storage.from(BUCKET).upload(`${venueB}/logo-b.png`, PNG, { contentType: "image/png" });
  if (error) throw error;
  await admin.from("venues").update({ logo_path: `${venueB}/logo-b.png` }).eq("id", venueB);
}, 30_000);

afterAll(async () => {
  await ownerA.auth.signOut();
  await ownerB.auth.signOut();
  for (const v of ids.venues) {
    const names = await files(v);
    if (names.length) await admin.storage.from(BUCKET).remove(names.map((n) => `${v}/${n}`));
  }
  await admin.from("audit_log").delete().in("venue_id", ids.venues);
  await admin.from("venues").delete().in("id", ids.venues);
  for (const u of ids.users) {
    await admin.from("profiles").delete().eq("id", u);
    await admin.auth.admin.deleteUser(u);
  }
}, 30_000);

describe("024 — storage: nadie toca la carpeta de otro complejo", () => {
  it("A no puede subir en la carpeta de B", async () => {
    const { error } = await ownerA.storage.from(BUCKET).upload(`${venueB}/intruso.png`, PNG, { contentType: "image/png" });
    expect(error).not.toBeNull();
    expect(await files(venueB)).toEqual(["logo-b.png"]);
  });

  it("A no puede pisar el logo de B (upsert)", async () => {
    const before = (await admin.storage.from(BUCKET).download(`${venueB}/logo-b.png`)).data!.size;
    const { error } = await ownerA.storage.from(BUCKET)
      .upload(`${venueB}/logo-b.png`, Buffer.concat([PNG, Buffer.alloc(100)]), { contentType: "image/png", upsert: true });
    expect(error).not.toBeNull();
    expect((await admin.storage.from(BUCKET).download(`${venueB}/logo-b.png`)).data!.size).toBe(before);
  });

  it("A no puede borrar el logo de B", async () => {
    await ownerA.storage.from(BUCKET).remove([`${venueB}/logo-b.png`]);
    expect(await files(venueB)).toEqual(["logo-b.png"]);
  });

  it("ni A ni el público pueden listar la carpeta de B (pero la URL pública del logo sí se lee)", async () => {
    expect((await ownerA.storage.from(BUCKET).list(venueB)).data ?? []).toEqual([]);
    expect((await anon.storage.from(BUCKET).list(venueB)).data ?? []).toEqual([]);
    const res = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${venueB}/logo-b.png`);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  it("A no puede apuntar logo_path de su complejo a un archivo de otra carpeta ni con '..'", async () => {
    for (const p of [`${venueB}/logo-b.png`, `${venueA}/../${venueB}/logo-b.png`]) {
      const { error } = await ownerA.from("venues").update({ logo_path: p }).eq("id", venueA);
      expect(error).not.toBeNull();
    }
    expect(await logoPath(venueA)).toBeNull();
  });

  it("A no puede cambiar el logo_path del complejo de B", async () => {
    const { count } = await ownerA.from("venues").update({ logo_path: null }, { count: "exact" }).eq("id", venueB);
    expect(count ?? 0).toBe(0);
    expect(await logoPath(venueB)).toBe(`${venueB}/logo-b.png`);
  });
});

describe("024 — acción del panel", () => {
  it("rechaza un archivo que no es imagen aunque diga .png e image/png (tipo real por los bytes)", async () => {
    current.client = ownerA;
    const res = await uploadVenueLogoAction(venueA, null, logoForm(Buffer.from("<svg onload=alert(1)>"), "logo.png", "image/png"));
    expect(res?.fieldErrors?.logo?.[0]).toMatch(/PNG, JPG o WebP/);
    expect(await files(venueA)).toEqual([]);
  });

  it("rechaza más de 10 MB, el envío sin archivo y una imagen rota (bytes de PNG y el resto basura)", async () => {
    current.client = ownerA;
    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
    expect((await uploadVenueLogoAction(venueA, null, logoForm(big)))?.fieldErrors?.logo?.[0]).toMatch(/10 MB/);
    expect((await uploadVenueLogoAction(venueA, null, new FormData()))?.fieldErrors?.logo?.[0]).toMatch(/Elegí/);
    const broken = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(3000, 7)]);
    expect((await uploadVenueLogoAction(venueA, null, logoForm(broken)))?.fieldErrors?.logo?.[0]).toMatch(/No pudimos achicar/);
    expect(await files(venueA)).toEqual([]);
  });

  it("B no puede subir ni quitar el logo del complejo de A, ni con un id que no es uuid", async () => {
    current.client = ownerB;
    expect((await uploadVenueLogoAction(venueA, null, logoForm(PNG)))?.error).toBe("No autorizado");
    expect((await uploadVenueLogoAction("../x", null, logoForm(PNG)))?.error).toBe("No autorizado");
    expect(await files(venueA)).toEqual([]);
    current.client = ownerA;
    expect((await removeVenueLogoAction(venueB, null, new FormData()))?.error).toBe("No autorizado");
    expect(await files(venueB)).toEqual(["logo-b.png"]);
  });

  it("A sube su logo (PNG de 3 MB con transparencia: se guarda achicado y sigue PNG), lo cambia (el viejo se borra) y lo quita", async () => {
    current.client = ownerA;
    const bigPng = await sharp(randomBytes(1400 * 1400 * 4), { raw: { width: 1400, height: 1400, channels: 4 } }).png().toBuffer();
    expect(bigPng.length).toBeGreaterThan(2 * 1024 * 1024);
    expect(await uploadVenueLogoAction(venueA, null, logoForm(bigPng))).toEqual({});
    const first = await logoPath(venueA);
    expect(first).toMatch(new RegExp(`^${venueA}/logo-\\d+\\.png$`));
    expect(await files(venueA)).toEqual([first!.split("/")[1]]);
    const stored = Buffer.from(await (await admin.storage.from(BUCKET).download(first!)).data!.arrayBuffer());
    expect(stored.length).toBeLessThanOrEqual(512 * 1024);
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe("png");
    expect(meta.hasAlpha).toBe(true);
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1024);

    // JPEG con nombre .png: se guarda como .jpg (manda el tipo real)
    const jpeg = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#0b4f3c" } }).jpeg().toBuffer();
    await new Promise((r) => setTimeout(r, 5));
    expect(await uploadVenueLogoAction(venueA, null, logoForm(jpeg, "foto.png", "image/png"))).toEqual({});
    const second = await logoPath(venueA);
    expect(second).toMatch(/\.jpg$/);
    expect(await files(venueA)).toEqual([second!.split("/")[1]]);

    expect(await removeVenueLogoAction(venueA, null, new FormData())).toEqual({});
    expect(await logoPath(venueA)).toBeNull();
    expect(await files(venueA)).toEqual([]);
  }, 60_000); // el PNG de ruido es el peor caso para comprimir
});
