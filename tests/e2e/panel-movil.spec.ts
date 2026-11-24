/**
 * Rediseño D2: panel en el celular (390 px). Menú desplegable, entrada directa
 * a la agenda, botón "Hoy" y hoja de acciones con botones de 44 px o más.
 * Usa una reserva propia en el complejo de prueba y la borra al final.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  OWNER_EMAIL, OWNER_PASSWORD, VENUE_ID, nextWeekday,
  createTestBooking, deleteTestBookings, deleteTestOutboxRows,
} from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const NAME  = "E2E Rediseño Panel";
const FECHA = nextWeekday(6, 9); // sábado, 9+ días: no choca con otros archivos
const AGENDA = `/panel/complejos/${VENUE_ID}/agenda?fecha=${FECHA}`;

async function gotoPanel(page: Page, url: string) {
  await page.goto(url);
  if (page.url().includes("/login")) {
    await page.fill('[name="email"]', OWNER_EMAIL);
    await page.fill('[name="password"]', OWNER_PASSWORD);
    await page.getByRole("button", { name: /entrar/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 25_000 });
    await page.goto(url);
  }
  await page.waitForLoadState("load");
}

test.beforeAll(async ({ request }) => {
  await deleteTestBookings(request, [NAME]);
  expect(await createTestBooking(request, FECHA, 18, 30, NAME, "2622000222")).toBeTruthy();
});

test.afterAll(async ({ request }) => {
  await deleteTestBookings(request, [NAME]);
  await deleteTestOutboxRows(request);
});

test("/panel entra directo a la agenda", async ({ page }) => {
  await gotoPanel(page, "/panel");
  await expect(page).toHaveURL(/\/panel\/(agenda|complejos\/[^/]+\/agenda)/);
});

test("en el celular el menú está cerrado, se abre con un toque y deja la agenda a todo el ancho", async ({ page }) => {
  await gotoPanel(page, AGENDA);
  const menuBtn = page.getByRole("button", { name: "Menú" });
  await expect(menuBtn).toBeVisible();
  await expect(page.locator("#panel-menu").getByRole("link", { name: "Complejos", exact: true })).toBeHidden();

  // La agenda usa todo el ancho (antes la barra lateral se comía 224 px)
  const grid = await page.getByRole("button", { name: /anterior/i }).boundingBox();
  expect(grid!.x).toBeLessThan(40);

  await menuBtn.click();
  await expect(page.getByRole("button", { name: "Cerrar menú" })).toHaveAttribute("aria-expanded", "true");
  for (const name of ["Agenda", "Complejos"]) {
    const link = page.locator("#panel-menu").getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByRole("button", { name: /cerrar sesión/i })).toBeVisible();

  // Dentro de la agenda de un complejo, el ítem activo es "Agenda"
  await expect(page.locator("#panel-menu").getByRole("link", { name: "Agenda", exact: true })).toHaveAttribute("aria-current", "page");
  await page.locator("#panel-menu").getByRole("link", { name: "Complejos", exact: true }).click();
  await page.waitForURL(/\/panel\/complejos$/);
  await expect(page.locator("#panel-menu").getByRole("link", { name: "Complejos", exact: true })).toBeHidden(); // se cierra al navegar
});

test("agenda: 'Hoy' y selector de fecha; botones de 44 px", async ({ page }) => {
  await gotoPanel(page, AGENDA);
  for (const name of [/anterior/i, /siguiente/i, /^hoy$/i]) {
    const btn = page.getByRole("button", { name });
    await expect(btn).toBeVisible();
    expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("button", { name: /^hoy$/i }).click();
  await page.waitForURL((u) => u.searchParams.get("fecha") !== FECHA);
  await expect(page.getByRole("button", { name: /^hoy$/i })).toBeHidden();

  await page.getByLabel("Elegir fecha").fill(FECHA);
  await page.waitForURL((u) => u.searchParams.get("fecha") === FECHA);
});

test("tocar un turno abre la hoja de acciones con botones de 44 px; Escape la cierra", async ({ page }) => {
  await gotoPanel(page, AGENDA);
  await page.getByText(NAME).first().click();

  const sheet = page.getByRole("dialog", { name: `Turno de ${NAME}` });
  await expect(sheet).toBeVisible();
  for (const name of [/whatsapp/i, /marcar pagado/i, /marcar ausente/i, /cancelar turno/i, /bloquear teléfono/i, /^cerrar$/i]) {
    const el = sheet.getByRole(name.source.includes("whatsapp") ? "link" : "button", { name });
    await expect(el).toBeVisible();
    const box = (await el.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(390); // entra en la pantalla
  }

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});
