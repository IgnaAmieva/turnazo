/**
 * Rediseño V2b: lista de complejos con franjas, mapa chiquito esquemático,
 * distancia (solo con permiso) y próximos turnos con precio.
 * Solo se mira el complejo de prueba; tocar un turno abre su hoja, sin reservar.
 * ?_now= fija "hoy" en un día futuro a las 09:00 para que no dependa de la hora.
 */
import { test, expect } from "@playwright/test";
import { VENUE_PATH, LOCALITY, SPORT, nextWeekday, contrastOf, collectPageErrors } from "./helpers";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});

const FECHA = nextWeekday(1, 12);                // lunes, 12+ días
const NOW = `${FECHA}T12:00:00.000Z`;           // 09:00 en Mendoza
const LIST = `/${LOCALITY}/${SPORT}`;
const card = (page: import("@playwright/test").Page) =>
  page.getByTestId("complejo").filter({ hasText: "Complejo Padelero Tunuyán" });

test("tarjeta: mapa chiquito sin pedidos externos, etiquetas que existen y 4 turnos con precio que abren la hoja", async ({ page }) => {
  const errors = collectPageErrors(page);
  const external: string[] = [];
  page.on("request", (r) => { if (/tile\.openstreetmap|openstreetmap\.org/.test(r.url())) external.push(r.url()); });

  await page.goto(`${LIST}?_now=${NOW}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pádel en Tunuyán");
  await expect(page.getByTestId("con-lugar")).toContainText(/complejos? con lugar/);

  const c = card(page);
  await expect(c.getByTestId("mapa-mini")).toBeVisible();
  expect((await c.getByTestId("mapa-mini").boundingBox())!.width).toBe(76);
  await expect(c.getByTestId("etiquetas")).toHaveText(/^\d+ canchas? · turnos de 90 min$/);
  await expect(c.getByTestId("distancia")).toHaveCount(0); // sin permiso de ubicación, sin distancia

  const chips = c.getByTestId("turno-chip");
  await expect(chips).toHaveCount(4);
  for (const chip of await chips.all()) {
    await expect(chip).toContainText(/\d{2}:\d{2}\s*\$[\d.]+/);
    expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  const time = (await chips.first().innerText()).match(/\d{2}:\d{2}/)![0];
  expect(time).toBe("09:30"); // el primero que no empezó a las 09:00 (grilla de 90 min desde 08:00)

  await chips.first().click();
  await expect(page).toHaveURL(new RegExp(VENUE_PATH));
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(time);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("franjas Ahora · 18–20 · 20–22 · 22+: filtran los turnos del día", async ({ page }) => {
  await page.goto(`${LIST}?_now=${NOW}`);
  const franjas = page.getByTestId("franja");
  await expect(franjas).toHaveText(["Ahora", "18–20", "20–22", "22+"]);
  await expect(franjas.first()).toHaveAttribute("aria-current", "true");

  await franjas.filter({ hasText: "18–20" }).click();
  await expect(page).toHaveURL(/franja=18-20/);
  await expect(franjas.filter({ hasText: "18–20" })).toHaveAttribute("aria-current", "true");
  // 90 min desde 08:00 → en 18–20 solo puede estar 18:30
  for (const chip of await card(page).getByTestId("turno-chip").all()) {
    await expect(chip).toContainText(/^(18|19):\d{2}/);
  }
});

test("distancia solo si el jugador ya dio permiso de ubicación", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    permissions: ["geolocation"], geolocation: { latitude: -33.58, longitude: -69.02 },
  });
  const page = await ctx.newPage();
  await page.goto(`${LIST}?_now=${NOW}`);
  await expect(card(page).getByTestId("distancia")).toContainText(/ · \d+(,\d)? km/);
  await ctx.close();
});

test("'Ver todos en el mapa': el mapa grande no está arriba y aparece al tocarlo", async ({ page }) => {
  await page.goto(`${LIST}?_now=${NOW}`);
  await expect(page.locator(".leaflet-container")).toHaveCount(0);
  const btn = page.getByRole("button", { name: "Ver todos en el mapa" });
  expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await btn.click();
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.getByRole("link", { name: "OpenStreetMap" })).toBeVisible(); // atribución del mapa real
});

for (const scheme of ["light", "dark"] as const) {
  test(`contraste AA en franjas, tarjetas y turnos (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`${LIST}?_now=${NOW}`);
    for (const f of await page.getByTestId("franja").all()) {
      expect(await contrastOf(f)).toBeGreaterThanOrEqual(4.5);
    }
    const c = card(page);
    for (const el of [c.getByRole("link").first(), c.getByTestId("etiquetas"), c.locator("p").first()]) {
      expect(await contrastOf(el)).toBeGreaterThanOrEqual(4.5);
    }
    for (const span of await c.getByTestId("turno-chip").locator("span").all()) {
      expect(await contrastOf(span)).toBeGreaterThanOrEqual(4.5);
    }
  });
}
