/**
 * Rediseño V2b: lista de complejos con horarios reales, mapa chiquito esquemático,
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

test("mapa chiquito: link a Google Maps con el pin real (44 px, pestaña nueva); el resto de la tarjeta lleva al complejo", async ({ page }) => {
  await page.goto(`${LIST}?_now=${NOW}`);
  const c = card(page);
  const map = c.getByTestId("mapa-link");
  await expect(map).toHaveAttribute("aria-label", "Ver ubicación de Complejo Padelero Tunuyán en el mapa");
  // Look de mapa: pin rojo y la etiqueta que invita a tocarlo
  await expect(map.getByTestId("mapa-etiqueta")).toHaveText("Ver en el mapa ↗︎");
  expect(await map.locator('svg path[fill="var(--map-pin)"]').evaluate((p) => getComputedStyle(p).fill)).toBe("rgb(234, 67, 53)");
  await expect(map).toHaveAttribute("target", "_blank");
  await expect(map).toHaveAttribute("rel", /noopener/);
  await expect(map).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
  const box = (await map.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  // Lo que se toca es el mapa (no el link de la tarjeta que está debajo)
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("a")?.getAttribute("data-testid"),
    { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(hit).toBe("mapa-link");

  // Tocar la dirección (resto de la tarjeta) abre el complejo
  const addr = (await c.locator("p").first().boundingBox())!;
  await page.mouse.click(addr.x + 10, addr.y + addr.height / 2);
  await expect(page).toHaveURL(new RegExp(`${VENUE_PATH}$`));
});

test("'¿A qué hora querés jugar?': los horarios reales del día; con turnos de 90 min, 18:30 · 20:00 · 21:30", async ({ page }) => {
  await page.goto(`${LIST}?_now=${NOW}`);
  const hour = page.getByTestId("hora");
  await expect(hour).toHaveValue("");
  const options = await hour.locator("option").allInnerTexts();
  expect(options).toEqual(expect.arrayContaining(["Cualquier hora", "18:30", "20:00", "21:30"]));
  expect(options).not.toContain("18:00");

  await hour.selectOption("20:00");
  await expect(page).toHaveURL(/hora=20%3A00/);
  await expect(hour).toHaveValue("20:00");
  await expect(card(page).getByTestId("turno-chip")).toHaveText([/^20:00/, /^21:30/]);
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
  test(`contraste AA en la hora, tarjetas y turnos (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`${LIST}?_now=${NOW}`);
    expect(await contrastOf(page.getByTestId("hora"))).toBeGreaterThanOrEqual(4.5);
    const c = card(page);
    for (const el of [c.getByRole("link").first(), c.getByTestId("etiquetas"), c.locator("p").first()]) {
      expect(await contrastOf(el)).toBeGreaterThanOrEqual(4.5);
    }
    for (const span of await c.getByTestId("turno-chip").locator("span").all()) {
      expect(await contrastOf(span)).toBeGreaterThanOrEqual(4.5);
    }
  });
}
