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
  test(`inicio (${scheme}): localidades sin complejos dicen "Próximamente", se leen (AA) y no se pueden tocar`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    const soon = page.getByTestId("locality-soon");
    await expect(soon.first()).toBeVisible();
    const n = await soon.count();
    for (let i = 0; i < n; i++) {
      const card = soon.nth(i);
      await expect(card).toContainText("Próximamente");
      await expect(card).toHaveAttribute("aria-disabled", "true");
      expect(await card.locator("a").count()).toBe(0);
      for (const span of await card.locator("span").all()) {
        expect(await contrastOf(span)).toBeGreaterThanOrEqual(4.5);
      }
    }
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
