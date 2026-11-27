/**
 * Foto de portada del complejo (029): el dueño la sube desde el panel (hasta
 * 10 MB; el servidor la deja en 1600 px y < 500 KB, mismo formato, validando
 * los primeros bytes) y la página del complejo la muestra con un degradado
 * oscuro abajo. Sin foto, la portada verde con líneas. Toca solo el complejo
 * de prueba y al final borra sus archivos de portada y deja cover_path en null.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { VENUE_ID, VENUE_PATH, SUPABASE_URL, serviceHeaders, nextWeekday, contrastOf } from "./helpers";

const BUCKET = "venue-logos";
const PANEL = `/panel/complejos/${VENUE_ID}`;
const NOW = `${nextWeekday(1, 12)}T12:00:00.000Z`;

async function cleanup(request: APIRequestContext) {
  await request.patch(`${SUPABASE_URL}/rest/v1/venues?id=eq.${VENUE_ID}`, { headers: serviceHeaders(), data: { cover_path: null } });
  const list = await request.post(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, { headers: serviceHeaders(), data: { prefix: VENUE_ID, limit: 100 } });
  const names = ((await list.json()) as { name: string }[]).filter((f) => f.name.startsWith("cover-")).map((f) => `${VENUE_ID}/${f.name}`);
  if (names.length) await request.delete(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, { headers: serviceHeaders(), data: { prefixes: names } });
}

async function storedCover(request: APIRequestContext) {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/venues?id=eq.${VENUE_ID}&select=cover_path`, { headers: serviceHeaders() });
  const path = ((await res.json()) as { cover_path: string | null }[])[0].cover_path;
  if (!path) return null;
  const file = await (await request.get(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`)).body();
  return { path, bytes: file.length, meta: await sharp(file).metadata() };
}

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ request }) => cleanup(request));
test.afterAll(async ({ request }) => cleanup(request));

test("panel: un archivo que no es imagen se rechaza por su contenido", async ({ page }) => {
  await page.goto(PANEL);
  const section = page.getByTestId("seccion-portada");
  await expect(section.getByTestId("portada-vacia")).toBeVisible();
  await section.getByLabel("Archivo de la foto de portada").setInputFiles({ name: "foto.jpg", mimeType: "image/jpeg", buffer: Buffer.from("no soy una foto") });
  await section.getByRole("button", { name: "Subir foto" }).click();
  await expect(section.getByTestId("portada-error")).toHaveText(/PNG, JPG o WebP/);
  await expect(section.getByTestId("portada-vacia")).toBeVisible();
});

test("panel: sube una foto JPG grande; se guarda en 1600 px, < 500 KB y sigue JPG; la página la muestra con degradado y el nombre se lee", async ({ page, request, browser }) => {
  // Foto "difícil" de comprimir (ruido) de 2400 × 1600, ~2-3 MB
  const raw = randomBytes(2400 * 1600 * 3);
  const jpg = await sharp(raw, { raw: { width: 2400, height: 1600, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  expect(jpg.length).toBeGreaterThan(500 * 1024);
  expect(jpg.length).toBeLessThan(4 * 1024 * 1024);

  await page.goto(PANEL);
  const section = page.getByTestId("seccion-portada");
  await section.getByLabel("Archivo de la foto de portada").setInputFiles({ name: "canchas.jpg", mimeType: "image/jpeg", buffer: jpg });
  await section.getByRole("button", { name: "Subir foto" }).click();
  await expect(section.getByTestId("portada-actual")).toBeVisible({ timeout: 30_000 });

  const stored = (await storedCover(request))!;
  expect(stored.path).toMatch(new RegExp(`^${VENUE_ID}/cover-\\d+\\.jpg$`));
  expect(stored.bytes).toBeLessThanOrEqual(500 * 1024);
  expect(Math.max(stored.meta.width!, stored.meta.height!)).toBeLessThanOrEqual(1600);
  expect(stored.meta.format).toBe("jpeg");

  // Página pública, en claro y en oscuro
  for (const scheme of ["light", "dark"] as const) {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, colorScheme: scheme, viewport: { width: 390, height: 844 }, isMobile: true });
    const pub = await ctx.newPage();
    await pub.goto(`${VENUE_PATH}?_now=${NOW}`);
    const cover = pub.getByTestId("portada-complejo");
    await expect(cover).toHaveAttribute("data-foto", "si");
    await expect(cover.getByTestId("portada-foto")).toHaveAttribute("src", new RegExp(`${stored.path}$`));
    await expect(cover.locator("svg.court-lines")).toHaveCount(0);
    // Texto blanco sobre el degradado negro (el fondo opaco del header es negro)
    const h1 = cover.getByRole("heading", { level: 1 });
    expect(await h1.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(255, 255, 255)");
    expect(await contrastOf(h1)).toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(cover.getByTestId("etiquetas"))).toBeGreaterThanOrEqual(4.5);
    // El degradado es oscuro abajo (donde va el nombre)
    const grad = await cover.locator("div[aria-hidden=true]").first().evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(grad).toMatch(/linear-gradient/);
    await ctx.close();
  }
});

test("panel: quitar la foto vuelve a la portada verde con líneas", async ({ page, request }) => {
  await page.goto(PANEL);
  const section = page.getByTestId("seccion-portada");
  await section.getByRole("button", { name: "Quitar foto" }).click();
  await expect(section.getByTestId("portada-vacia")).toBeVisible();
  expect(await storedCover(request)).toBeNull();
  await page.goto(`${VENUE_PATH}?_now=${NOW}`);
  const cover = page.getByTestId("portada-complejo");
  await expect(cover).toHaveAttribute("data-foto", "no");
  await expect(cover.locator("svg.court-lines")).toHaveCount(1);
});
