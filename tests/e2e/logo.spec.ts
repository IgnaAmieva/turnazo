/**
 * Logo del club (024/025): el dueño lo sube desde el panel y se ve en la
 * portada del complejo y en las historias. Sin logo, las iniciales.
 * Archivos que no son imagen se rechazan por su contenido, no por el nombre.
 *
 * Toca solo el complejo de prueba. Al final borra los archivos de su carpeta
 * en el bucket y deja logo_path en null (como estaba).
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { VENUE_ID, VENUE_PATH, SPORT, SUPABASE_URL, serviceHeaders, nextWeekday } from "./helpers";

const BUCKET = "venue-logos";
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082",
  "hex",
);
/** WebP 4×4 (sin pérdida): next/og también tiene que poder dibujarlo */
const WEBP = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvA8AAAAfQni7Upf+BiOh/AAA=", "base64");
const PANEL = `/panel/complejos/${VENUE_ID}`;
const IMG = `${PANEL}/historia/imagen?estilo=pizarra&deporte=${SPORT}&fecha=${nextWeekday(3, 2)}`;

async function setLogoPath(request: APIRequestContext, path: string | null) {
  const res = await request.patch(`${SUPABASE_URL}/rest/v1/venues?id=eq.${VENUE_ID}`, {
    headers: serviceHeaders(), data: { logo_path: path },
  });
  expect(res.ok()).toBe(true);
}

/** Borra todo lo que haya en la carpeta del complejo de prueba y deja logo_path en null. */
async function cleanup(request: APIRequestContext) {
  await setLogoPath(request, null);
  const list = await request.post(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    headers: serviceHeaders(), data: { prefix: VENUE_ID, limit: 100 },
  });
  const names = ((await list.json()) as { name: string }[]).map((f) => `${VENUE_ID}/${f.name}`);
  if (names.length) {
    await request.delete(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, { headers: serviceHeaders(), data: { prefixes: names } });
  }
}

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ request }) => cleanup(request));
test.afterAll(async ({ request }) => cleanup(request));

test("sin logo: iniciales en la portada; con logo: la imagen, en la portada y en la historia", async ({ page, request }) => {
  await page.goto(VENUE_PATH);
  const logo = page.getByTestId("portada-complejo").getByTestId("logo-club");
  await expect(logo).toHaveText(/^[A-Z0-9]{2}$/);
  const withoutLogo = await (await request.get(IMG)).body();

  // Logo cargado por el servicio (no depende de la subida del panel)
  const path = `${VENUE_ID}/logo-e2e.png`;
  const up = await request.post(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    headers: { ...serviceHeaders(), "Content-Type": "image/png" }, data: PNG,
  });
  expect(up.ok()).toBe(true);
  await setLogoPath(request, path);

  await page.reload();
  const img = page.getByTestId("portada-complejo").getByRole("img", { name: /^Logo de / });
  await expect(img).toHaveAttribute("src", new RegExp(`/storage/v1/object/public/${BUCKET}/${path}$`));
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(1);

  // La historia dibuja el logo en lugar de las iniciales: la imagen cambia
  const res = await request.get(IMG);
  expect(res.status()).toBe(200);
  const withLogo = await res.body();
  expect(withLogo.equals(withoutLogo)).toBe(false);

  // También con un logo WebP
  const webp = `${VENUE_ID}/logo-e2e.webp`;
  expect((await request.post(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${webp}`, {
    headers: { ...serviceHeaders(), "Content-Type": "image/webp" }, data: WEBP,
  })).ok()).toBe(true);
  await setLogoPath(request, webp);
  const resWebp = await request.get(IMG);
  expect(resWebp.status()).toBe(200);
  const withWebp = await resWebp.body();
  expect(withWebp.equals(withoutLogo)).toBe(false);
  expect(withWebp.equals(withLogo)).toBe(false);

  await cleanup(request);
  await page.reload();
  await expect(logo).toHaveText(/^[A-Z0-9]{2}$/);
});

test.describe("celular", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("un archivo que no es imagen se rechaza aunque se llame .png", async ({ page }) => {
    await page.goto(PANEL);
    const section = page.getByTestId("seccion-logo");
    await expect(section.getByTestId("logo-iniciales")).toBeVisible();
    await section.getByLabel("Archivo del logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: Buffer.from("no soy una imagen") });
    await section.getByRole("button", { name: "Subir logo" }).click();
    await expect(section.getByTestId("logo-error")).toHaveText(/PNG, JPG o WebP/);
    await expect(section.getByTestId("logo-iniciales")).toBeVisible();
  });

  test("más de 512 KB se avisa antes de mandar", async ({ page }) => {
    await page.goto(PANEL);
    const section = page.getByTestId("seccion-logo");
    await section.getByLabel("Archivo del logo").setInputFiles({ name: "grande.png", mimeType: "image/png", buffer: Buffer.concat([PNG, Buffer.alloc(600 * 1024)]) });
    await expect(section.getByTestId("logo-error")).toHaveText(/512 KB/);
    await expect(section.getByRole("button", { name: "Subir logo" })).toBeDisabled();
  });

  test("el dueño sube el logo, se ve en el panel y en la portada, y lo quita", async ({ page }) => {
    await page.goto(PANEL);
    const section = page.getByTestId("seccion-logo");
    const upload = section.getByRole("button", { name: "Subir logo" });
    expect((await upload.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await section.getByLabel("Archivo del logo").setInputFiles({ name: "escudo.png", mimeType: "image/png", buffer: PNG });
    await upload.click();
    await expect(section.getByTestId("logo-actual")).toBeVisible();
    await expect(section.getByTestId("logo-error")).toHaveCount(0);

    await page.goto(VENUE_PATH);
    await expect(page.getByTestId("portada-complejo").getByRole("img", { name: /^Logo de / })).toBeVisible();

    await page.goto(PANEL);
    const remove = section.getByRole("button", { name: "Quitar logo" });
    expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await remove.click();
    await expect(section.getByTestId("logo-iniciales")).toBeVisible();
  });
});
