/**
 * Rediseño: chequeos visuales que los tests de flujo no cubren.
 * Contraste medido en el navegador real (colores calculados), en los dos modos.
 */
import { expect, test, type Locator } from "@playwright/test";
import { VENUE_PATH, nextWeekday } from "./helpers";

test.use({ storageState: { cookies: [], origins: [] } });

/** Contraste entre el color del texto del elemento y el fondo opaco más cercano. */
async function contrastOf(el: Locator): Promise<number> {
  return el.evaluate((node) => {
    const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    let bgEl: Element | null = node;
    let bg = "";
    while (bgEl) {
      const c = getComputedStyle(bgEl).backgroundColor;
      const parts = rgb(c);
      if (parts.length === 3 || (parts.length === 4 && parts[3] === 1)) { bg = c; break; }
      bgEl = bgEl.parentElement;
    }
    let opacity = 1;
    for (let e: Element | null = node; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
    if (opacity < 1) return 0; // un texto semitransparente no cuenta como legible
    const [a, b] = [lum(rgb(getComputedStyle(node).color)), lum(rgb(bg))].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
}

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
    await page.goto(`${VENUE_PATH}?fecha=${nextWeekday(2, 10)}`);
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
}
