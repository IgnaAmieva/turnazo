/**
 * Logo del club (024/025): el dueño lo sube desde el panel y se ve en la
 * portada del complejo y en las historias. Sin logo, las iniciales.
 * Archivos que no son imagen se rechazan por su contenido, no por el nombre.
 *
 * Toca solo el complejo de prueba. Al final borra los archivos de su carpeta
 * en el bucket y deja logo_path en null (como estaba).
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import sharp, { type Metadata } from "sharp";
import { randomBytes } from "node:crypto";
import { VENUE_ID, VENUE_PATH, SPORT, SUPABASE_URL, serviceHeaders, nextWeekday } from "./helpers";

const BUCKET = "venue-logos";
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082",
  "hex",
);
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

/** El logo guardado del complejo de prueba (leído con service_role). */
async function storedLogo(request: APIRequestContext) {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/venues?id=eq.${VENUE_ID}&select=logo_path`, { headers: serviceHeaders() });
  const path = ((await res.json()) as { logo_path: string | null }[])[0].logo_path;
  if (!path) return { path: null, bytes: 0, meta: {} as Metadata };
  const file = await (await request.get(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`)).body();
  return { path, bytes: file.length, meta: await sharp(file).metadata() };
}

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ request }) => cleanup(request));
test.afterAll(async ({ request }) => cleanup(request));

test("sin logo: iniciales en la portada; con logo: la imagen, en la portada y en la historia", async ({ page, request }) => {
  await page.goto(VENUE_PATH);
  const logo = page.getByTestId("portada-complejo").getByTestId("logo-club");
  await expect(logo).toHaveText(/^[A-Z0-9]{2}$/);
  const withoutLogo = await (await request.get(IMG)).body();

  // Logo cargado por el servicio (no depende de la subida del panel): círculo rojo
  // sobre fondo transparente, y después uno azul en WebP
  const dot = (fill: string) => sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="${fill}"/></svg>`) }]);
  // Nombre nuevo en cada corrida: la URL pública queda en la caché del CDN
  const path = `${VENUE_ID}/logo-e2e-${Date.now()}.png`;
  const up = await request.post(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    headers: { ...serviceHeaders(), "Content-Type": "image/png" }, data: await dot("#c0392b").png().toBuffer(),
  });
  expect(up.ok()).toBe(true);
  await setLogoPath(request, path);

  await page.reload();
  const img = page.getByTestId("portada-complejo").getByRole("img", { name: /^Logo de / });
  await expect(img).toHaveAttribute("src", new RegExp(`/storage/v1/object/public/${BUCKET}/${path}$`));
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(64);

  // La historia dibuja el logo en lugar de las iniciales: la imagen cambia
  const res = await request.get(IMG);
  expect(res.status()).toBe(200);
  const withLogo = await res.body();
  expect(withLogo.equals(withoutLogo)).toBe(false);

  // También con un logo WebP
  const webp = `${VENUE_ID}/logo-e2e-${Date.now()}.webp`;
  expect((await request.post(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${webp}`, {
    headers: { ...serviceHeaders(), "Content-Type": "image/webp" }, data: await dot("#2155c4").webp().toBuffer(),
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

  test("más de 10 MB se avisa antes de mandar", async ({ page }) => {
    await page.goto(PANEL);
    const section = page.getByTestId("seccion-logo");
    await section.getByLabel("Archivo del logo").setInputFiles({ name: "grande.png", mimeType: "image/png", buffer: Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]) });
    await expect(section.getByTestId("logo-error")).toHaveText(/10 MB/);
    await expect(section.getByRole("button", { name: "Subir logo" })).toBeDisabled();
  });

  test("el dueño sube un PNG transparente y después una foto JPG de más de 4 MB: se guardan achicados, en su formato; se ven enteros y lo quita", async ({ page, request }) => {
    test.setTimeout(90_000);
    await page.goto(PANEL);
    const section = page.getByTestId("seccion-logo");
    const upload = section.getByRole("button", { name: "Subir logo" });
    expect((await upload.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Escudo 1600×1600 con fondo transparente
    const escudo = await sharp({ create: { width: 1600, height: 1600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600"><circle cx="800" cy="800" r="600" fill="#0b4f3c"/></svg>`) }])
      .png().toBuffer();
    await section.getByLabel("Archivo del logo").setInputFiles({ name: "escudo.png", mimeType: "image/png", buffer: escudo });
    await upload.click();
    await expect(section.getByTestId("logo-actual")).toBeVisible();
    await expect(section.getByTestId("logo-error")).toHaveCount(0);
    const png = await storedLogo(request);
    expect(png.meta.format).toBe("png");
    expect(png.meta.hasAlpha).toBe(true);
    expect([png.meta.width, png.meta.height]).toEqual([1024, 1024]);

    await page.goto(VENUE_PATH);
    const cover = page.getByTestId("portada-complejo").getByRole("img", { name: /^Logo de / });
    await expect(cover).toBeVisible();
    // Entero: sin círculo que lo recorte ni fondo blanco detrás
    const box = await cover.evaluate((el) => {
      const wrap = el.parentElement!;
      const s = getComputedStyle(wrap);
      return { radius: s.borderRadius, overflow: s.overflow, bg: s.backgroundColor, fit: getComputedStyle(el).objectFit };
    });
    expect(box).toEqual({ radius: "0px", overflow: "visible", bg: "rgba(0, 0, 0, 0)", fit: "contain" });

    // Foto de más de 4 MB: el navegador la baja antes de mandarla (Vercel corta en 4,5 MB) y el servidor la deja < 512 KB
    const foto = await sharp(randomBytes(2400 * 2400 * 3), { raw: { width: 2400, height: 2400, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    expect(foto.length).toBeGreaterThan(4 * 1024 * 1024);
    await page.goto(PANEL);
    await section.getByLabel("Archivo del logo").setInputFiles({ name: "foto.jpg", mimeType: "image/jpeg", buffer: foto });
    await section.getByRole("button", { name: "Cambiar logo" }).click();
    await expect.poll(async () => (await storedLogo(request)).path, { timeout: 60_000 }).toMatch(/\.jpg$/);
    const jpg = await storedLogo(request);
    expect(jpg.meta.format).toBe("jpeg");
    expect(jpg.bytes).toBeLessThanOrEqual(512 * 1024);
    expect(Math.max(jpg.meta.width!, jpg.meta.height!)).toBeLessThanOrEqual(1024);
    await expect(section.getByTestId("logo-error")).toHaveCount(0);

    await page.goto(PANEL);
    const remove = section.getByRole("button", { name: "Quitar logo" });
    expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await remove.click();
    await expect(section.getByTestId("logo-iniciales")).toBeVisible();
  });
});
