/**
 * De noche: si hoy ya no hay lugar (ningún turno libre que empiece en 30 min
 * o más), el inicio, "Lo antes posible" y la lista pasan solos a mañana, con
 * el título "Hoy ya no hay lugar · Mañana, martes N". Con la fila de días se
 * vuelve a hoy. ?_now= fija la hora en un lunes futuro (solo fuera de producción).
 * Pádel en Tunuyán: el complejo de prueba cierra a las 23:00 (último turno 21:30)
 * y futmates (real) a las 00:30 (último turno 23:00). No se reserva nada.
 */
import { test, expect } from "@playwright/test";
import { LOCALITY, SPORT, VENUE_PATH, nextWeekday, contrastOf, collectPageErrors } from "./helpers";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});

const LUNES = nextWeekday(1, 12);
const [y, m, d] = LUNES.split("-").map(Number);
const MARTES = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
/** Hora de Mendoza (UTC-3) del lunes, como ISO para ?_now= */
const lunesA = (h: number, min: number) => new Date(Date.UTC(y, m - 1, d, h + 3, min)).toISOString();
const HOME = `/?localidad=${LOCALITY}&deporte=${SPORT}`;
const LIST = `/${LOCALITY}/${SPORT}`;
const TITLE = new RegExp(`^Hoy ya no hay lugar · Mañana, martes ${Number(MARTES.slice(8))}$`);

test("23:10: el inicio, 'Lo antes posible' y la lista pasan solos a mañana", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto(`${HOME}&_now=${lunesA(23, 10)}`);
  await expect(page.getByTestId("portada").getByRole("heading", { level: 1 })).toHaveText("¿Jugamos mañana?");
  await expect(page.getByTestId("lo-antes-posible")).toContainText(/Mañana \d{2}:\d{2}/);

  const list = page.getByTestId("complejos-inicio");
  await expect(list.getByTestId("dia-titulo")).toHaveText(TITLE);
  const days = list.getByTestId("dia");
  await expect(days).toHaveCount(7);
  await expect(days.first()).toContainText("Hoy");
  await expect(days.nth(1)).toHaveAttribute("aria-current", "date");
  for (const day of await days.all()) {
    const box = (await day.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  await expect(list.getByTestId("franja").first()).toHaveText("Todo el día");
  await expect(list.getByTestId("con-lugar")).toContainText(/complejos? con lugar mañana/);

  // Los turnos y la tarjeta abren el complejo en el martes
  const card = list.getByTestId("complejo").filter({ hasText: "Complejo Padelero Tunuyán" });
  await expect(card.getByTestId("libres")).toContainText(/turnos? libres? mañana/);
  await expect(card.getByTestId("complejo-link")).toHaveAttribute("href", `${VENUE_PATH}?fecha=${MARTES}`);
  await expect(card.getByTestId("turno-chip").first()).toHaveAttribute("href", new RegExp(`fecha=${MARTES}`));
  expect(errors).toEqual([]);
});

test("con la fila de días se vuelve a hoy, aunque esté vacío", async ({ page }) => {
  await page.goto(`${LIST}?_now=${lunesA(23, 10)}&franja=20-22`);
  await expect(page.getByTestId("dia-titulo")).toHaveText(TITLE);

  await page.getByTestId("dia").first().click();
  await expect(page).toHaveURL(new RegExp(`fecha=${LUNES}`));
  await expect(page).toHaveURL(/franja=20-22/);            // la franja elegida se mantiene
  await expect(page.getByTestId("dia-titulo")).toHaveText(new RegExp(`^Hoy, lunes ${Number(LUNES.slice(8))}$`));
  await expect(page.getByTestId("dia").first()).toHaveAttribute("aria-current", "date");
  await expect(page.getByTestId("con-lugar")).toHaveText("Ningún complejo tiene lugar de 20–22. Probá otra hora u otro día.");

  // Cambiar la franja con hoy elegido no vuelve a pasar a mañana
  await page.getByTestId("franja").first().click();
  await expect(page).toHaveURL(new RegExp(`fecha=${LUNES}`));
  await expect(page.getByTestId("dia-titulo")).toHaveText(/^Hoy, /);
});

test("22:40: falta poco para cerrar (el único que queda empieza en 20 min) → mañana", async ({ page }) => {
  await page.goto(`${LIST}?_now=${lunesA(22, 40)}`);
  await expect(page.getByTestId("dia-titulo")).toHaveText(TITLE);
  // Hoy sigue a mano, con lo que queda
  await page.getByTestId("dia").first().click();
  await expect(page.getByTestId("dia-titulo")).toHaveText(/^Hoy, /);
});

test("21:00: todavía hay turnos que llegás a jugar → hoy, sin aviso", async ({ page }) => {
  await page.goto(`${HOME}&_now=${lunesA(21, 0)}`);
  await expect(page.getByTestId("portada").getByRole("heading", { level: 1 })).toHaveText("¿Jugamos hoy?");
  await expect(page.getByTestId("dia-titulo")).toHaveText(/^Hoy, lunes /);
  await expect(page.getByTestId("franja").first()).toHaveText("Ahora");
  await expect(page.getByTestId("lo-antes-posible")).not.toContainText("Mañana");
});

for (const scheme of ["light", "dark"] as const) {
  test(`contraste AA del título y la fila de días (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`${LIST}?_now=${lunesA(23, 10)}`);
    expect(await contrastOf(page.getByTestId("dia-titulo"))).toBeGreaterThanOrEqual(4.5);
    for (const span of await page.getByTestId("dia").locator("span").all()) {
      expect(await contrastOf(span)).toBeGreaterThanOrEqual(4.5);
    }
  });
}
