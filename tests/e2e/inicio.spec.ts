/**
 * Rediseño V2a: inicio con deporte y lugar en una sola pantalla y "Lo antes
 * posible". Solo se mira el complejo de prueba (Pádel en Tunuyán): "Lo antes
 * posible" abre su hoja, pero no se reserva nada.
 */
import { test, expect } from "@playwright/test";
import { VENUE_PATH, nextWeekday, contrastOf, collectPageErrors } from "./helpers";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});

const HOME = "/?localidad=tunuyan&deporte=padel";
// "Hoy" fijo en un lunes futuro a las 09:00 (solo fuera de producción), para no depender de la hora
const NOW = `${nextWeekday(1, 12)}T12:00:00.000Z`;

test("'Lo antes posible' lleva al complejo con la hoja de ese turno abierta", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto(`${HOME}&_now=${NOW}`);
  const cover = page.getByTestId("portada");
  await expect(cover.getByRole("heading", { level: 1 })).toHaveText("¿Jugamos hoy?");
  await expect(cover).toContainText("Tunuyán · Pádel");

  const soon = cover.getByTestId("lo-antes-posible");
  await expect(soon).toContainText("Lo antes posible");
  await expect(soon).toContainText("Complejo Padelero Tunuyán");
  const time = (await soon.innerText()).match(/(\d{2}:\d{2})/)![1];
  expect((await soon.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await soon.click();
  await expect(page).toHaveURL(new RegExp(VENUE_PATH));
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("paragraph").first()).toContainText(time);
  // El turno elegido no queda en la URL (al recargar no se reabre la hoja)
  expect(new URL(page.url()).searchParams.get("inicio")).toBeNull();
  expect(errors).toEqual([]);
});

test("un turno inválido en el link no abre la hoja", async ({ page }) => {
  await page.goto(`${VENUE_PATH}?cancha=no-existe&inicio=cualquiera`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("deportes con íconos de línea (sin emojis); el elegido en primary; sin complejos dice 'Pronto' y no se toca", async ({ page }) => {
  await page.goto(HOME);
  const cards = page.getByTestId("deporte");
  const padel = cards.filter({ hasText: "Pádel" });
  await expect(padel).toHaveAttribute("aria-current", "true");
  // Sin número exacto: futmates (real) cargó una cancha de pádel el 2026-11-25
  await expect(padel).toContainText(/\d+ complejos?/);
  expect(await padel.locator("svg").count()).toBe(1);

  const all = await page.locator("main").innerText();
  expect(all).not.toMatch(/\p{Extended_Pictographic}/u);

  for (const soon of await page.getByTestId("deporte-pronto").all()) {
    await expect(soon).toContainText("Pronto");
    await expect(soon).toHaveAttribute("aria-disabled", "true");
    expect(await soon.evaluate((el) => el.closest("a"))).toBeNull();
  }

  // Elegir otro deporte cambia la URL y la portada, sin salir del inicio
  const other = cards.filter({ hasNotText: "Pádel" }).first();
  if (await other.count()) {
    await other.click();
    await expect(page).toHaveURL(/deporte=(?!padel)/);
    await expect(page.getByTestId("portada")).not.toContainText("Tunuyán · Pádel");
  }
});

test("'¿Dónde?': una sola barra desplegable, solo localidades con complejos; los complejos aparecen abajo, en la misma pantalla", async ({ page }) => {
  await page.goto(`${HOME}&_now=${NOW}`);
  const where = page.getByTestId("donde");
  await expect(where).toHaveValue("tunuyan");
  expect((await where.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByTestId("localidad")).toHaveCount(0); // ya no hay chips
  const options = await where.locator("option").allInnerTexts();
  expect(options.length).toBeGreaterThan(0);
  for (const o of options) expect(o).toMatch(/ · \d+ complejos?/); // sin "pronto": las vacías no aparecen
  expect(options.join()).not.toMatch(/San Carlos|Tupungato|La Consulta/);

  // Complejos de Pádel abajo, sin ir a otra página
  const list = page.getByTestId("complejos-inicio");
  await expect(list.getByTestId("con-lugar")).toContainText(/complejos? con lugar hoy/);
  const card = list.getByTestId("complejo").filter({ hasText: "Complejo Padelero Tunuyán" });
  await expect(card.getByTestId("turno-chip").first()).toBeVisible();
  await expect(page).toHaveURL(/\/\?localidad=tunuyan&deporte=padel/);
});

test("complejos ordenados por más turnos libres; solo los que tienen lugar", async ({ page }) => {
  await page.goto(`${HOME}&_now=${NOW}`);
  const cards = page.getByTestId("complejos-inicio").getByTestId("complejo");
  const free = (await cards.evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-libres")))));
  expect(free.length).toBeGreaterThan(0);
  expect(free.every((n) => n > 0)).toBe(true);
  expect(free).toEqual([...free].sort((a, b) => b - a));
  for (const c of await cards.all()) await expect(c.getByTestId("libres")).toContainText(/\d+ turnos? libres? hoy/);
});

test("'¿A qué hora querés jugar?': desplegable con los horarios reales libres; al elegir uno quedan los que empiezan a esa hora", async ({ page }) => {
  await page.goto(`${HOME}&_now=${NOW}`);
  const section = page.getByTestId("complejos-inicio");
  const hour = section.getByLabel("¿A qué hora querés jugar?");
  await expect(hour).toHaveValue("");
  expect((await hour.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const options = await hour.locator("option").allInnerTexts();
  expect(options[0]).toBe("Cualquier hora");
  // Turnos de 90 min desde las 08:00: 18:30, 20:00, 21:30 (no hay 18:00 ni 20:30); ya pasó el de 08:00 (son las 09:00)
  expect(options).toEqual(expect.arrayContaining(["09:30", "18:30", "20:00", "21:30"]));
  expect(options).not.toContain("18:00");
  expect(options).not.toContain("08:00");
  expect(options.slice(1)).toEqual([...options.slice(1)].sort((a, b) => (a < "06:00" ? "3" + a : a).localeCompare(b < "06:00" ? "3" + b : b)));

  await hour.selectOption("18:30");
  await expect(page).toHaveURL(/hora=18%3A30/);
  await expect(page).toHaveURL(/localidad=tunuyan&deporte=padel/);
  const cards = section.getByTestId("complejo");
  expect(await cards.count()).toBeGreaterThan(0);
  for (const c of await cards.all()) {
    await expect(c.getByTestId("turno-chip").first()).toContainText(/^18:30/);
    await expect(c.getByTestId("libres")).toContainText("a las 18:30");
  }
  const card = cards.filter({ hasText: "Complejo Padelero Tunuyán" });
  await expect(card.getByTestId("turno-chip")).toHaveText([/^18:30/, /^20:00/, /^21:30/]);
  await expect(section.getByTestId("con-lugar")).toContainText("con lugar a las 18:30");

  // Volver a "Cualquier hora"
  await hour.selectOption("");
  await expect(page).not.toHaveURL(/hora=/);
});
test("con permiso de ubicación: sin elegir nada, la localidad más cercana y la distancia en la barra", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    permissions: ["geolocation"], geolocation: { latitude: -33.58, longitude: -69.02 },
  });
  const page = await ctx.newPage();
  await page.goto("/");
  // Hoy solo Tunuyán tiene complejos: la más cercana coincide con la que muestra el servidor
  await expect(page.getByTestId("donde")).toHaveValue("tunuyan");
  await expect(page.getByTestId("donde").locator("option:checked")).toContainText(/Tunuyán · \d+ complejos? · a \d+,\d km/);
  await expect(page.getByTestId("usar-ubicacion")).toHaveCount(0);
  // La posición no se guarda: localStorage solo tiene localidad (y deporte)
  const saved = await page.evaluate(() => localStorage.getItem("turnazo-jugador"));
  expect(saved ?? "").not.toMatch(/lat|lng|-33/);
  await ctx.close();
});

test("sin permiso: 'Usar mi ubicación' (44 px) y no se pide la ubicación sola", async ({ page }) => {
  let asked = false;
  await page.exposeFunction("__asked", () => { asked = true; });
  await page.addInitScript(() => {
    const orig = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (...a: Parameters<typeof orig>) => {
      (window as unknown as { __asked: () => void }).__asked();
      return orig(...a);
    };
  });
  await page.goto(HOME);
  const btn = page.getByTestId("usar-ubicacion");
  await expect(btn).toBeVisible();
  expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.waitForTimeout(500);
  expect(asked).toBe(false);
});

test("las URLs de antes siguen funcionando", async ({ page }) => {
  await page.goto("/tunuyan");
  await expect(page).toHaveURL(/\/\?localidad=tunuyan/);
  // Sin ?_now= (la redirección no lo lleva): de noche el inicio pasa solo a mañana
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^¿Jugamos (hoy|mañana)\?$/);
  await page.goto(`/tunuyan/padel?_now=${NOW}`);
  await expect(page.getByText("Complejo Padelero Tunuyán").first()).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test(`contraste AA en la portada, "Lo antes posible" y las tarjetas (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(HOME);
    const cover = page.getByTestId("portada");
    expect(await contrastOf(cover.getByRole("heading", { level: 1 }))).toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(cover.getByRole("link", { name: "cambiar" }))).toBeGreaterThanOrEqual(4.5);
    const soon = cover.getByTestId("lo-antes-posible");
    for (const span of await soon.locator("span span").all()) {
      expect(await contrastOf(span)).toBeGreaterThanOrEqual(4.5);
    }
    for (const card of await page.getByTestId("deporte").all()) {
      for (const span of await card.locator("span").all()) {
        expect(await contrastOf(span)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(await contrastOf(page.getByTestId("donde"))).toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(page.getByTestId("hora"))).toBeGreaterThanOrEqual(4.5);
    for (const t of await page.getByTestId("libres").all()) {
      expect(await contrastOf(t)).toBeGreaterThanOrEqual(4.5);
    }
  });
}
