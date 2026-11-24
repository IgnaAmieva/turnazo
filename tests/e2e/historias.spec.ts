/**
 * Historias de turnos libres (panel): el dueño del complejo de prueba elige
 * día, deporte y estilo, ve las 3 vistas previas y descarga un PNG 1080×1920.
 * Nadie más puede generarla: sin sesión va al login; otro dueño recibe 404.
 * También el link corto /c/{código}/{deporte} que va en la imagen.
 */
import { test, expect } from "@playwright/test";
import { VENUE_ID, VENUE_PATH, SPORT, SUPABASE_URL, serviceHeaders } from "./helpers";

const IMG = `/panel/complejos/${VENUE_ID}/historia/imagen`;

function pngSize(buf: Buffer) {
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test.describe("celular", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("desde la agenda: 'Compartir turnos libres' con día, estilo y vista previa de los 3", async ({ page }) => {
    await page.goto(`/panel/complejos/${VENUE_ID}/agenda`);
    const btn = page.getByTestId("compartir-turnos");
    expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await btn.click();
    await expect(page.getByRole("heading", { name: "Compartir turnos libres" })).toBeVisible();

    const day = page.getByLabel("Día");
    await expect(day.locator("option").first()).toHaveText(/^Hoy · /);
    expect(await day.locator("option").count()).toBe(7);

    const previews = page.getByRole("img", { name: /Vista previa/ });
    await expect(previews).toHaveCount(3);
    for (const img of await previews.all()) {
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth), { timeout: 30_000 }).toBe(1080);
    }
    await expect(page.getByTestId("estilo")).toHaveText(["Pizarra", "Invitación", "Urgencia"].map((s) => new RegExp(s)));

    // Elegir Urgencia y descargar: el archivo es un PNG 1080×1920
    await page.getByTestId("estilo").filter({ hasText: "Urgencia" }).click();
    const download = page.waitForEvent("download");
    await page.getByTestId("descargar-historia").click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^turnos-padel-\d{4}-\d{2}-\d{2}-urgencia\.png$/);
    const buf = await (await import("node:fs/promises")).readFile((await file.path())!);
    expect(pngSize(buf)).toEqual({ w: 1080, h: 1920 });
    await expect(page.getByRole("button", { name: "Compartir" })).toBeVisible();
  });
});

test("la imagen de cada estilo es un PNG 1080×1920 que no queda en cachés compartidas", async ({ request }) => {
  for (const estilo of ["pizarra", "invitacion", "urgencia"]) {
    const res = await request.get(`${IMG}?estilo=${estilo}&deporte=${SPORT}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(pngSize(await res.body())).toEqual({ w: 1080, h: 1920 });
  }
  const dl = await request.get(`${IMG}?estilo=pizarra&descargar=1`);
  expect(dl.headers()["content-disposition"]).toMatch(/^attachment; filename="turnos-padel-.*-pizarra\.png"$/);
});

test.describe("sin sesión", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("no se puede generar: la imagen y la página piden iniciar sesión", async ({ page, request }) => {
    const res = await request.get(IMG, { maxRedirects: 0 });
    expect(res.status()).not.toBe(200);
    await page.goto(`/panel/complejos/${VENUE_ID}/historia`);
    await expect(page).toHaveURL(/\/login/);
  });
});

test("un complejo que no es del dueño da 404 (no se puede generar su imagen)", async ({ request }) => {
  // Otro complejo aprobado, de otro dueño (solo se lee su id; no se toca nada)
  const r = await request.get(`${SUPABASE_URL}/rest/v1/venues?status=eq.approved&id=neq.${VENUE_ID}&select=id&limit=1`, { headers: serviceHeaders() });
  const other = (await r.json())[0]?.id as string | undefined;
  for (const id of [other, "00000000-0000-0000-0000-000000000000"].filter(Boolean)) {
    expect((await request.get(`/panel/complejos/${id}/historia/imagen`)).status()).toBe(404);
    expect((await request.get(`/panel/complejos/${id}/historia`)).status()).toBe(404);
  }
});

test("el link corto de la historia lleva a la página del complejo", async ({ page }) => {
  await page.goto(`/c/${VENUE_ID.slice(0, 8)}/${SPORT}`);
  await expect(page).toHaveURL(new RegExp(`${VENUE_PATH}$`));
  await page.goto(`/c/zzzzzzzz/${SPORT}`);
  await expect(page).toHaveURL(/\/(\?.*)?$/);
});
