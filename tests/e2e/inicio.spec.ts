/**
 * Rediseño V2a: inicio con deporte y lugar en una sola pantalla y "Lo antes
 * posible". Solo se mira el complejo de prueba (Pádel en Tunuyán): "Lo antes
 * posible" abre su hoja, pero no se reserva nada.
 */
import { test, expect } from "@playwright/test";
import { VENUE_PATH, contrastOf, collectPageErrors } from "./helpers";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});

const HOME = "/?localidad=tunuyan&deporte=padel";

test("'Lo antes posible' lleva al complejo con la hoja de ese turno abierta", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto(HOME);
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
  await expect(padel).toContainText(/1 complejo/);
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

test("'¿Dónde?': chips con la cantidad de complejos; 'Ver complejos' lleva a la lista", async ({ page }) => {
  await page.goto(HOME);
  const tunuyan = page.getByTestId("localidad").filter({ hasText: "Tunuyán" });
  await expect(tunuyan).toHaveAttribute("aria-current", "true");
  await expect(tunuyan).toContainText(/Tunuyán · \d+/);
  await page.getByTestId("ver-complejos").click();
  await expect(page).toHaveURL(/\/tunuyan\/padel$/);
});

test("las URLs de antes siguen funcionando", async ({ page }) => {
  await page.goto("/tunuyan");
  await expect(page).toHaveURL(/\/\?localidad=tunuyan/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("¿Jugamos hoy?");
  await page.goto("/tunuyan/padel");
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
    for (const chip of await page.getByTestId("localidad").all()) {
      expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
    }
  });
}
