/**
 * Rediseño D0: modo claro/oscuro. Sigue al celular, el botón lo cambia y la
 * elección queda guardada al recargar. Sin login (contexto nuevo).
 */
import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

const html = (page: import("@playwright/test").Page) => page.locator("html");

test("sigue al modo del celular", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await expect(page.getByTestId("theme-toggle")).toContainText("Automático");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(html(page)).toHaveAttribute("data-theme", "light");
});

test("el botón cicla Automático → Claro → Oscuro y queda guardado al recargar", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const toggle = page.getByTestId("theme-toggle");
  await expect(toggle).toContainText("Automático");

  await toggle.click();
  await expect(toggle).toContainText("Claro");
  await expect(html(page)).toHaveAttribute("data-theme", "light");

  await toggle.click();
  await expect(toggle).toContainText("Oscuro");
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", "#14523F");

  await page.reload();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await expect(page.getByTestId("theme-toggle")).toContainText("Oscuro");

  // Con "Oscuro" fijo no importa el modo del celular
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html(page)).toHaveAttribute("data-theme", "dark");

  await toggle.click();
  await expect(toggle).toContainText("Automático");
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("turnazo-theme"))).toBeNull();
});

test("D1: en oscuro el contenido público también cambia (no solo el encabezado)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const colors = await page.evaluate(() => {
    const h1 = document.querySelector("main h1")!;
    const main = document.querySelector("main")!.parentElement!;
    return { h1: getComputedStyle(h1).color, bg: getComputedStyle(main).backgroundColor };
  });
  expect(colors.h1).toBe("rgb(246, 243, 234)"); // #F6F3EA
  expect(colors.bg).toBe("rgb(11, 61, 46)");    // #0B3D2E
});

test("el botón mide al menos 44 px", async ({ page }) => {
  await page.goto("/");
  const box = await page.getByTestId("theme-toggle").boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
});
