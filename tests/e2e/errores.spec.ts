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

test("teléfono bloqueado: mensaje claro, sin botón para reintentar", async ({ page, request }) => {
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
});
