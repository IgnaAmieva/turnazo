/**
 * Rediseño M3: errores de la reserva con acción, en la hoja del complejo.
 * (Turno tomado y error de Mercado Pago están en hoja.spec.ts.)
 * Solo el complejo de prueba: el teléfono bloqueado se desbloquea al final.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  VENUE_ID, VENUE_PATH, SUPABASE_URL, nextWeekday, serviceHeaders,
  unblockTestPhones, deleteTestBookings, deleteTestOutboxRows,
} from "./helpers";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});

const FECHA = nextWeekday(0, 24); // domingo, 24+ días
const BLOCKED = "2622 000 321";
const BLOCKED_DIGITS = "2622000321"; // la base guarda (y bloquea) solo los dígitos

const openSheet = async (page: Page, hhmm: string) => {
  await page.goto(`${VENUE_PATH}?fecha=${FECHA}`);
  await page.locator("section").first().getByTestId("slot-free").filter({ hasText: hhmm }).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  return sheet;
};

test.afterAll(async ({ request }) => {
  await unblockTestPhones(request, [BLOCKED_DIGITS]);
  await deleteTestBookings(request, ["E2E Errores*"]);
  await deleteTestOutboxRows(request);
});

test("celular inválido: marca el campo, dice qué falta y Confirmar sigue", async ({ page }) => {
  const sheet = await openSheet(page, "11:00");
  await sheet.getByLabel("Tu nombre").fill("E2E Errores Ana");
  await sheet.getByLabel("Tu teléfono").fill("12");
  await sheet.getByRole("button", { name: "Confirmar reserva" }).click();

  const phone = sheet.getByLabel("Tu teléfono");
  await expect(phone).toHaveAttribute("aria-invalid", "true");
  await expect(sheet.getByTestId("error-customer_phone")).toContainText("código de área");
  await expect(phone).toBeFocused();
  // Lo escrito no se borra
  await expect(phone).toHaveValue("12");
  await expect(sheet.getByLabel("Tu nombre")).toHaveValue("E2E Errores Ana");
  await expect(sheet.getByTestId("reserva-error")).toHaveCount(0);       // no es un error general
  await expect(sheet.getByRole("button", { name: "Confirmar reserva" })).toBeVisible();
  // Un celular mal escrito no queda recordado
  expect((await page.evaluate(() => localStorage.getItem("turnazo-jugador"))) ?? "").not.toContain("celular");
});

test("teléfono bloqueado: mensaje claro, sin reintento, datos en una línea y 'Cerrar' donde iba Confirmar", async ({ page, request }) => {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/blocked_phones`, {
    headers: { ...serviceHeaders(), Prefer: "resolution=merge-duplicates" },
    data: { venue_id: VENUE_ID, phone: BLOCKED_DIGITS },
  });
  expect(res.ok()).toBe(true);

  const sheet = await openSheet(page, "12:30");
  await sheet.getByLabel("Tu nombre").fill("E2E Errores Bloqueado");
  await sheet.getByLabel("Tu teléfono").fill(BLOCKED);
  await sheet.getByRole("button", { name: "Confirmar reserva" }).click();

  const err = sheet.getByTestId("reserva-error");
  await expect(err).toHaveAttribute("data-error-code", "phone_blocked");
  await expect(err).toContainText("Consultá con el complejo");
  await expect(sheet.getByRole("button", { name: /confirmar|reintentar|ver otros/i })).toHaveCount(0);

  // Los datos quedan en la línea recordada (con "Cambiar" y "No soy yo"), no sueltos
  const line = sheet.getByTestId("datos-recordados");
  await expect(line).toContainText("E2E Errores Bloqueado · 2622 000321");
  await expect(line.getByTestId("no-soy-yo")).toBeVisible();
  await expect(sheet.getByTestId("no-soy-yo")).toHaveCount(1);

  // Salida: "Cerrar" de 44 px en el pie, cierra la hoja
  const close = sheet.getByTestId("reserva-cerrar");
  await expect(close).toHaveText("Cerrar");
  expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(sheet.getByTestId("reserva-pie").getByTestId("reserva-cerrar")).toBeVisible();
  await close.click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("con los campos abiertos ('Cambiar'), 'No soy yo' va dentro de la misma tarjeta", async ({ page }) => {
  await page.goto(VENUE_PATH);
  await page.evaluate(() => localStorage.setItem("turnazo-jugador", JSON.stringify({ nombre: "E2E Errores Juan", celular: "02622 15 123456" })));
  const sheet = await openSheet(page, "14:00");
  await expect(sheet.getByTestId("datos-recordados")).toContainText("E2E Errores Juan · 2622 123456");
  await sheet.getByRole("button", { name: "Cambiar", exact: true }).click();
  const card = sheet.getByTestId("datos-editando");
  await expect(card.getByLabel("Tu teléfono")).toHaveValue("2622 123456");
  await expect(card.getByTestId("no-soy-yo")).toBeVisible();
  // Lo que se escribe se muestra con el mismo formato al salir del campo
  await card.getByLabel("Tu teléfono").fill("0261-15-4123456");
  await card.getByLabel("Tu nombre").focus();
  await expect(card.getByLabel("Tu teléfono")).toHaveValue("261 4123456");
});
