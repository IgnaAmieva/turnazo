/**
 * Rediseño: chequeos visuales que los tests de flujo no cubren.
 * Contraste medido en el navegador real (colores calculados), en los dos modos.
 */
import { expect, test } from "@playwright/test";
import {
  VENUE_PATH, contrastOf, nextWeekday, createTestBooking, deleteTestBookings, deleteTestOutboxRows,
} from "./helpers";

test.use({ storageState: { cookies: [], origins: [] } });

const OCUPADO = "E2E Rediseño Ocupado";
const FECHA = nextWeekday(2, 10);

test.beforeAll(async ({ request }) => {
  await deleteTestBookings(request, [OCUPADO]);
  expect(await createTestBooking(request, FECHA, 11, 0, OCUPADO, "2622000777")).toBeTruthy();
});

test.afterAll(async ({ request }) => {
  await deleteTestBookings(request, [OCUPADO]);
  await deleteTestOutboxRows(request);
});

for (const scheme of ["light", "dark"] as const) {
  test(`inicio (${scheme}): las localidades sin complejos aprobados no aparecen; la barra "¿Dónde?" se lee (AA)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/?localidad=la-consulta");
    // Una localidad sin complejos pedida por URL no se muestra: queda la primera con complejos
    const where = page.getByTestId("donde");
    await expect(where).not.toHaveValue("la-consulta");
    expect(await where.locator("option").allInnerTexts()).not.toContainEqual(expect.stringMatching(/pronto|La Consulta|San Carlos|Tupungato/));
    await expect(page.getByTestId("locality-soon")).toHaveCount(0);
    expect(await contrastOf(where)).toBeGreaterThanOrEqual(4.5);
  });

  test(`complejo (${scheme}): turnos libres en tarjeta neutra, legibles y de 44 px o más`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`${VENUE_PATH}?fecha=${FECHA}`);
    const slot = page.getByTestId("slot-free").first();
    await expect(slot).toBeVisible();

    const bg = await slot.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgb(212, 243, 74)"); // nada de lima en los turnos libres

    for (const span of await slot.locator("span").all()) {
      expect(await contrastOf(span)).toBeGreaterThanOrEqual(4.5);
    }
    const box = await slot.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test(`complejo (${scheme}): "Ocupado" sin fondo, borde punteado y texto tachado legible`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`${VENUE_PATH}?fecha=${FECHA}`);
    const taken = page.getByTestId("slot-taken").first();
    await expect(taken).toContainText("Ocupado");
    const st = await taken.evaluate((el) => {
      const c = getComputedStyle(el);
      return { bg: c.backgroundColor, border: c.borderTopStyle };
    });
    expect(st.bg).toBe("rgba(0, 0, 0, 0)"); // transparente
    expect(st.border).toBe("dashed");
    const hour = taken.locator("span").first();
    expect(await hour.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
    for (const span of await taken.locator("span").all()) {
      expect(await contrastOf(span)).toBeGreaterThanOrEqual(4.5);
    }
    // Se distingue del libre: el libre sí tiene fondo
    const freeBg = await page.getByTestId("slot-free").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(freeBg).not.toBe(st.bg);
  });
}
