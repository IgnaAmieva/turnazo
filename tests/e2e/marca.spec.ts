/**
 * Marca Depoturnos: logo del encabezado (pin + "depo" 500 + "turnos" 800, con
 * los colores de cada modo), solo el pin en pantallas muy angostas, títulos,
 * manifest e íconos, y que "Turnazo" no aparezca visible en ninguna pantalla.
 */
import { test, expect, type Page } from "@playwright/test";
import { VENUE_ID, VENUE_PATH, contrastOf } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const visibleText = (page: Page) => page.evaluate(() => document.body.innerText + " " + document.title);

test.describe("público", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("encabezado: pin + 'depo' (500) + 'turnos' (800); título de la pestaña con Depoturnos", async ({ page }) => {
    await page.goto("/");
    const logo = page.locator("header").getByTestId("marca");
    await expect(logo).toBeVisible();
    await expect(logo.getByTestId("marca-pin")).toBeVisible();
    await expect(logo).toHaveText("depoturnos");
    const weights = await logo.locator("span span").evaluateAll((els) => els.map((e) => [e.textContent, getComputedStyle(e).fontWeight, getComputedStyle(e).fontFamily]));
    expect(weights.map((w) => [w[0], w[1]])).toEqual([["depo", "500"], ["turnos", "800"]]);
    expect(weights[0][2]).toMatch(/Outfit/i);
    await expect(page.getByRole("link", { name: "Depoturnos, inicio" })).toBeVisible();
    await expect(page).toHaveTitle(/Depoturnos/);
  });

  for (const [scheme, depo, turnos, pinFill] of [
    ["light", "rgb(11, 61, 46)", "rgb(11, 61, 46)", "rgb(11, 61, 46)"],
    ["dark", "rgb(246, 243, 234)", "rgb(212, 243, 74)", "rgba(0, 0, 0, 0)"],
  ] as const) {
    test(`colores del logo en modo ${scheme} (AA)`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      const logo = page.locator("header").getByTestId("marca");
      const [d, t] = await logo.locator("span span").evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
      expect([d, t]).toEqual([depo, turnos]);
      const fill = await logo.locator("path").first().evaluate((e) => getComputedStyle(e).fill);
      expect(fill).toBe(pinFill);
      for (const s of await logo.locator("span span").all()) expect(await contrastOf(s)).toBeGreaterThanOrEqual(4.5);
    });
  }

  test("celular muy angosto (320 px): solo el pin; el nombre queda para lectores de pantalla", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto("/");
    const logo = page.locator("header").getByTestId("marca");
    await expect(logo.getByTestId("marca-pin")).toBeVisible();
    const box = (await logo.locator("> span").boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(1);   // sr-only
    await expect(page.getByRole("link", { name: "Depoturnos, inicio" })).toBeVisible();
    await ctx.close();
  });

  test("manifest e íconos: Depoturnos, ícono oscuro 192/512 y maskable, apple-touch-icon y favicon", async ({ page, request }) => {
    const manifest = await (await request.get("/manifest.json")).json();
    expect(manifest.name).toBe("Depoturnos");
    expect(manifest.short_name).toBe("Depoturnos");
    expect(manifest.theme_color).toBe("#0B3D2E");
    const icons = manifest.icons as { src: string; sizes: string; purpose: string }[];
    expect(icons.map((i) => `${i.sizes} ${i.purpose}`).sort()).toEqual(["192x192 any", "192x192 maskable", "512x512 any", "512x512 maskable"]);
    for (const i of icons) {
      const r = await request.get(i.src);
      expect(r.status(), i.src).toBe(200);
      expect(r.headers()["content-type"]).toContain("image/png");
    }

    await page.goto("/");
    const links = await page.evaluate(() => [...document.querySelectorAll("link[rel~=icon], link[rel=apple-touch-icon], link[rel=manifest]")]
      .map((l) => `${l.getAttribute("rel")} ${l.getAttribute("href")}`));
    expect(links.join("\n")).toMatch(/apple-touch-icon \/apple-icon\.png/);
    expect(links.join("\n")).toMatch(/icon \/icon\.svg/);
    expect(links.join("\n")).toMatch(/manifest \/manifest\.json/);
    for (const path of ["/apple-icon.png", "/favicon.ico"]) expect((await request.get(path)).status(), path).toBe(200);
    expect(await (await request.get("/icon.svg")).text()).toContain("#D4F34A");
  });

  test("ninguna pantalla pública muestra 'Turnazo'", async ({ page }) => {
    for (const path of ["/", "/?localidad=tunuyan&deporte=padel", "/tunuyan/padel", VENUE_PATH, "/login", "/registro", "/turnos/no-existe", "/no-existe-esta-pagina"]) {
      await page.goto(path);
      expect(await visibleText(page), path).not.toMatch(/turnazo/i);
    }
  });
});

test("panel: logo en el encabezado y sin 'Turnazo' visible", async ({ page }) => {
  await page.goto("/panel/agenda");
  await expect(page.getByRole("link", { name: "Depoturnos panel, agenda" })).toBeVisible();
  for (const path of [`/panel/complejos/${VENUE_ID}/agenda`, "/panel/complejos", `/panel/complejos/${VENUE_ID}`, `/panel/complejos/${VENUE_ID}/historia`]) {
    await page.goto(path);
    expect(await visibleText(page), path).not.toMatch(/turnazo/i);
  }
});
