/**
 * Rediseño D2: panel en el celular (390 px). Menú desplegable, entrada directa
 * a la agenda, días (Hoy + 6), pestañas por cancha y "Todas", color según el pago
 * y hoja de acciones (44 px, con confirmación para cancelar y bloquear).
 * Usa reservas propias en el complejo de prueba y las borra al final.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  OWNER_EMAIL, OWNER_PASSWORD, VENUE_ID, SUPABASE_URL, nextWeekday, serviceHeaders, contrastOf,
  createTestBooking, deleteTestBookings, deleteTestOutboxRows,
} from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const NAME  = "E2E Rediseño Panel";
const NAME_PAGO = "E2E Rediseño Pago";
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

let bookingId = "";

test.beforeAll(async ({ request }) => {
  await deleteTestBookings(request, [NAME, NAME_PAGO]);
  bookingId = (await createTestBooking(request, FECHA, 18, 30, NAME, "2622000222"))!;
  expect(bookingId).toBeTruthy();
  expect(await createTestBooking(request, FECHA, 9, 30, NAME_PAGO, "2622000223")).toBeTruthy();
});

test.afterAll(async ({ request }) => {
  await deleteTestBookings(request, [NAME, NAME_PAGO]);
  await deleteTestOutboxRows(request);
});

async function statusOf(request: import("@playwright/test").APIRequestContext, id: string) {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${id}&select=status`, { headers: serviceHeaders() });
  return (await res.json())[0]?.status;
}

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
  const grid = await page.getByTestId("resumen").boundingBox();
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

test("agenda: días (Hoy + 6) y selector de fecha; todo de 44 px", async ({ page }) => {
  await gotoPanel(page, AGENDA);
  const days = page.getByTestId("dia");
  // El día elegido (9+ días adelante) va primero, después Hoy y los 6 siguientes
  await expect(days).toHaveCount(8);
  await expect(days.first()).toHaveAttribute("aria-current", "date");
  for (const d of await days.all()) expect((await d.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await days.filter({ hasText: "Hoy" }).click();
  await page.waitForURL((u) => u.searchParams.get("fecha") !== FECHA);
  await expect(days.filter({ hasText: "Hoy" })).toHaveAttribute("aria-current", "date");
  await expect(days).toHaveCount(7);

  const picker = page.getByLabel("Elegir fecha");
  expect((await picker.locator("xpath=..").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await picker.fill(FECHA);
  await page.waitForURL((u) => u.searchParams.get("fecha") === FECHA);
});

test("tocar un turno abre la hoja: 'Cobrado' y 'WhatsApp' grandes arriba, el resto abajo, todo de 44 px; Escape la cierra", async ({ page }) => {
  await gotoPanel(page, AGENDA);
  await page.getByText(NAME).first().click();

  const sheet = page.getByRole("dialog", { name: `Turno de ${NAME}` });
  await expect(sheet).toBeVisible();
  const cobrado = sheet.getByRole("button", { name: /^cobrado \$/i });
  const wa = sheet.getByRole("link", { name: /whatsapp/i });
  const noVino = sheet.getByRole("button", { name: /marcar que no vino/i });
  // Cobrado y WhatsApp lado a lado, arriba de las demás acciones
  const [c, w, n] = [await cobrado.boundingBox(), await wa.boundingBox(), await noVino.boundingBox()];
  expect(Math.abs(c!.y - w!.y)).toBeLessThan(2);
  expect(c!.y).toBeLessThan(n!.y);
  expect(c!.height).toBeGreaterThanOrEqual(52);
  for (const name of [/whatsapp/i, /^cobrado/i, /marcar que no vino/i, /cancelar turno/i, /bloquear este número/i, /^cerrar$/i]) {
    const el = sheet.getByRole(name.source.includes("whatsapp") ? "link" : "button", { name });
    await expect(el).toBeVisible();
    const box = (await el.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(390); // entra en la pantalla
  }

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("celular: pestañas por cancha, una columna a la vez, la elegida queda recordada", async ({ page }) => {
  await gotoPanel(page, AGENDA);
  const tabs = page.getByRole("tablist", { name: "Canchas" });
  await expect(tabs).toBeVisible();
  const columns = page.getByTestId("court-column");
  await expect(columns.filter({ visible: true })).toHaveCount(1);
  await expect(page.getByText(NAME).first()).toBeVisible(); // Cancha 1 por defecto

  const tab2 = tabs.getByRole("tab", { name: "Cancha 2" });
  expect((await tab2.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await tab2.click();
  await expect(tab2).toHaveAttribute("aria-selected", "true");
  await expect(columns.filter({ visible: true })).toHaveCount(1);
  await expect(page.getByText(NAME).first()).toBeHidden();

  // La columna visible entra entera en la pantalla (no queda cortada)
  const col = (await columns.filter({ visible: true }).boundingBox())!;
  expect(col.x + col.width).toBeLessThanOrEqual(390);

  await page.reload();
  await expect(page.getByRole("tab", { name: "Cancha 2" })).toHaveAttribute("aria-selected", "true");
});

test.describe("escritorio", () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
  test("'Todas': una columna por cancha lado a lado, con las mismas tarjetas", async ({ page }) => {
    await gotoPanel(page, AGENDA);
    await page.getByRole("tablist", { name: "Canchas" }).getByRole("tab", { name: "Todas" }).click();
    const cols = page.getByTestId("court-column").filter({ visible: true });
    await expect(cols).toHaveCount(2);
    const [a, b] = [await cols.nth(0).boundingBox(), await cols.nth(1).boundingBox()];
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);   // lado a lado
    expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1);
    await expect(cols.nth(0).getByTestId("booking-card").filter({ hasText: NAME })).toBeVisible();
    await page.evaluate((k) => localStorage.removeItem(k), `turnazo-agenda-cancha:${VENUE_ID}`);
  });
});

test("celular, 'Todas': una sola lista en orden de hora, con el nombre de la cancha", async ({ page }) => {
  await gotoPanel(page, AGENDA);
  await page.getByRole("tablist", { name: "Canchas" }).getByRole("tab", { name: "Todas" }).click();
  await expect(page.getByTestId("court-column").filter({ visible: false })).toHaveCount(2); // las columnas de escritorio, ocultas
  await expect(page.getByTestId("booking-card").filter({ visible: true }).filter({ hasText: NAME })).toContainText("Cancha 1");
  await expect(page.getByTestId("turno-libre").filter({ visible: true }).filter({ hasText: "Cancha 2" }).first()).toBeVisible();
  await page.evaluate((k) => localStorage.removeItem(k), `turnazo-agenda-cancha:${VENUE_ID}`);
});

for (const scheme of ["light", "dark"] as const) {
  test(`color según el pago (${scheme}): sin pagar = tarjeta neutra con "Sin pagar" legible`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await gotoPanel(page, AGENDA);
    const card = page.getByTestId("booking-card").filter({ hasText: NAME });
    await expect(card).toHaveAttribute("data-pago", "unpaid");
    const bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgb(212, 243, 74)"); // no es lima
    const badge = card.getByTestId("badge-pago");
    await expect(badge).toContainText("Sin pagar");
    expect(await contrastOf(badge)).toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(card.getByText(NAME))).toBeGreaterThanOrEqual(4.5);
  });
}

test("'Cobrado' pasa el turno a lima (borde y etiqueta 'Pagado') y avisa 'Cobrado'", async ({ page }) => {
  await gotoPanel(page, AGENDA);
  const card = page.getByTestId("booking-card").filter({ hasText: NAME_PAGO });
  await expect(card).toHaveAttribute("data-pago", "unpaid");
  expect(await card.evaluate((el) => getComputedStyle(el).borderLeftColor)).not.toBe("rgb(212, 243, 74)");
  await page.getByText(NAME_PAGO).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /^cobrado/i }).click();
  await expect(page.getByTestId("guardado")).toHaveText("Cobrado");
  await expect(card).toHaveAttribute("data-pago", "paid", { timeout: 15_000 });
  expect(await card.evaluate((el) => getComputedStyle(el).borderLeftColor)).toBe("rgb(212, 243, 74)");
  const badge = card.getByTestId("badge-pago");
  await expect(badge).toHaveText("Pagado");
  expect(await badge.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(212, 243, 74)");
  expect(await contrastOf(badge)).toBeGreaterThanOrEqual(4.5);
});

test("cancelar turno y bloquear teléfono piden confirmación; 'Volver' no ejecuta nada", async ({ page, request }) => {
  await gotoPanel(page, AGENDA);
  await page.getByText(NAME).first().click();
  const sheet = page.getByRole("dialog", { name: `Turno de ${NAME}` });

  await sheet.getByRole("button", { name: /cancelar turno/i }).click();
  await expect(sheet.getByText(/El horario queda libre/)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Confirmar cancelación" })).toBeVisible();
  await sheet.getByRole("button", { name: "Volver" }).click();

  await sheet.getByRole("button", { name: /bloquear este número/i }).click();
  await expect(sheet.getByText(/No va a poder reservar más en este complejo/)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Confirmar bloqueo" })).toBeVisible();
  await sheet.getByRole("button", { name: "Volver" }).click();

  await expect(sheet.getByRole("button", { name: /cancelar turno/i })).toBeVisible();
  expect(await statusOf(request, bookingId)).toBe("confirmed");
  const blocked = await request.get(`${SUPABASE_URL}/rest/v1/blocked_phones?venue_id=eq.${VENUE_ID}&phone=like.*2622000222&select=phone`, { headers: serviceHeaders() });
  expect(await blocked.json()).toHaveLength(0);
});

test("la hoja usa íconos de línea, no emojis", async ({ page }) => {
  await gotoPanel(page, AGENDA);
  await page.getByText(NAME).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  expect(await sheet.innerText()).not.toMatch(/\p{Extended_Pictographic}/u);
  expect(await sheet.locator("svg").count()).toBeGreaterThanOrEqual(5);
});
