/**
 * Rediseño V2c: página del complejo con portada, tarjeta de ubicación con "Ir",
 * días deslizables, pestañas por cancha, grilla de 4 columnas y barra fija
 * "Reservar". Solo el complejo de prueba; no se reserva nada.
 */
import { test, expect } from "@playwright/test";
import { VENUE_PATH, COURT_ID, nextWeekday, contrastOf, collectPageErrors } from "./helpers";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});

const FECHA = nextWeekday(1, 12); // lunes, 12+ días
const URL_ = `${VENUE_PATH}?fecha=${FECHA}`;

test("portada, ubicación con 'Ir' y mapa chiquito sin pedidos externos", async ({ page }) => {
  const errors = collectPageErrors(page);
  const external: string[] = [];
  page.on("request", (r) => { if (/openstreetmap/.test(r.url())) external.push(r.url()); });
  await page.goto(URL_);

  const cover = page.getByTestId("portada-complejo");
  await expect(cover.getByRole("heading", { level: 1 })).toHaveText("Complejo Padelero Tunuyán");
  await expect(cover).toContainText(/Pádel · \d+ canchas?/);
  const back = cover.getByTestId("volver");
  await expect(back).toHaveAttribute("href", "/tunuyan/padel");
  expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  const loc = page.getByTestId("ubicacion");
  await expect(loc).toContainText("Av. San Martín 1234");
  await expect(loc.getByTestId("mapa-mini")).toBeVisible();
  const ir = loc.getByTestId("ir");
  await expect(ir).toHaveText("Ir");
  await expect(ir).toHaveAttribute("href", /google\.com\/maps\/dir\/\?api=1&destination=-?\d/);
  expect((await ir.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("días deslizables (Hoy primero) y pestañas por cancha", async ({ page }) => {
  await page.goto(URL_);
  const days = page.getByTestId("dia");
  await expect(days.first()).toContainText("Hoy");
  expect(await days.count()).toBe(30);
  const selected = page.locator('[data-testid="dia"][aria-current="date"]');
  await expect(selected).toBeInViewport();
  expect((await selected.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  const tabs = page.getByTestId("cancha-tab");
  await expect(tabs.first()).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/Turnos de 90 min/)).toBeVisible();
  if ((await tabs.count()) > 1) {
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL(/[?&]c=/);
    await expect(page).toHaveURL(new RegExp(`fecha=${FECHA}`));
  }
});

test("la fila de días arranca en 'Hoy' y nunca muestra días pasados (una fecha vieja abre hoy)", async ({ page }) => {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
  const y = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Mendoza" }).format(yesterday);
  await page.goto(`${VENUE_PATH}?fecha=${y}`);
  const days = page.getByTestId("dia");
  await expect(days.first()).toHaveText(/^Hoy\s*\d+$/);
  await expect(days.first()).toHaveAttribute("aria-current", "date");
  await expect(days.first()).toBeInViewport();
  const box = (await days.first().boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); // la fila arranca en Hoy, sin días antes
});

test("grilla de 4 columnas: tocar un turno lo elige (lima, borde primary) y 'Reservar' abre la hoja", async ({ page }) => {
  await page.goto(`${URL_}&c=${COURT_ID}`);
  const slots = page.getByTestId("slot-free");
  const [a, b, c, d] = await Promise.all([0, 1, 2, 3].map(async (i) => (await slots.nth(i).boundingBox())!));
  expect(new Set([a.y, b.y, c.y, d.y]).size).toBe(1); // 4 por fila
  for (const span of await slots.first().locator("span").all()) {
    await expect(span).toBeVisible();
  }
  await expect(page.getByTestId("barra-reservar")).toHaveCount(0);

  const slot = slots.filter({ hasText: "14:00" }).first();
  await slot.click();
  await expect(slot).toHaveAttribute("data-selected", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0); // todavía no abre la hoja
  await expect.poll(() => slot.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(212, 243, 74)");

  const bar = page.getByTestId("barra-reservar");
  await expect(bar).toContainText(/14:00 · Cancha 1/);
  await expect(bar).toContainText(/\$[\d.]+/);
  const reservar = bar.getByRole("button", { name: "Reservar" });
  const box = (await reservar.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.y + box.height).toBeLessThanOrEqual(844);

  await reservar.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("14:00");
});

for (const scheme of ["light", "dark"] as const) {
  test(`contraste AA: portada, días, pestañas, turno elegido y barra (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(URL_);
    const cover = page.getByTestId("portada-complejo");
    expect(await contrastOf(cover.getByRole("heading", { level: 1 }))).toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(cover.locator("p"))).toBeGreaterThanOrEqual(4.5);
    for (const el of [page.getByTestId("ubicacion").locator("p").first(), page.getByTestId("ubicacion").locator("p").nth(1), page.getByTestId("ir")]) {
      expect(await contrastOf(el)).toBeGreaterThanOrEqual(4.5);
    }
    for (const span of await page.locator('[data-testid="dia"][aria-current="date"] span:not([hidden])').all()) {
      expect(await contrastOf(span)).toBeGreaterThanOrEqual(4.5);
    }
    expect(await contrastOf(page.getByTestId("cancha-tab").first())).toBeGreaterThanOrEqual(4.5);

    const slot = page.getByTestId("slot-free").first();
    await slot.click();
    await expect.poll(() => slot.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(212, 243, 74)");
    for (const span of await slot.locator("span").all()) {
      expect(await contrastOf(span)).toBeGreaterThanOrEqual(4.5);
    }
    const bar = page.getByTestId("barra-reservar");
    for (const p of await bar.locator("p").all()) {
      expect(await contrastOf(p)).toBeGreaterThanOrEqual(4.5);
    }
    expect(await contrastOf(bar.getByRole("button", { name: "Reservar" }))).toBeGreaterThanOrEqual(4.5);
  });
}
