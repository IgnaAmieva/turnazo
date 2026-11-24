/**
 * Rediseño M4: Mi turno con "Guardá este link" bien visible, compartir por
 * WhatsApp, agregar al calendario (.ics) y "Cómo llegar". Celular con formato.
 * Usa una reserva propia en el complejo de prueba y la borra al final.
 */
import { test, expect } from "@playwright/test";
import {
  VENUE_ID, SUPABASE_URL, nextWeekday, serviceHeaders,
  createTestBooking, deleteTestBookings, deleteTestOutboxRows, contrastOf,
} from "./helpers";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  permissions: ["clipboard-read", "clipboard-write"],
});

const NAME = "E2E Mi Turno";
// Viernes 14+ días: como mucho 20 días adelante, siempre dentro de los 30 que acepta la base
// (antes "26+ días" podía caer a más de 30 y create_booking devolvía too_far_ahead).
const FECHA = nextWeekday(5, 14);
let token = "";

test.beforeAll(async ({ request }) => {
  await deleteTestBookings(request, [NAME]);
  const id = await createTestBooking(request, FECHA, 15, 30, NAME, "2622000777");
  expect(id).toBeTruthy();
  const res = await request.get(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${id}&venue_id=eq.${VENUE_ID}&select=cancel_token`, { headers: serviceHeaders() });
  token = (await res.json())[0].cancel_token;
});

test.afterAll(async ({ request }) => {
  await deleteTestBookings(request, [NAME]);
  await deleteTestOutboxRows(request);
});

test("'Guardá este link' arriba de todo, con el link y 'Copiar link'", async ({ page }) => {
  await page.goto(`/turnos/${token}`);
  const save = page.getByTestId("guarda-link");
  await expect(save.getByRole("heading", { name: "Guardá este link" })).toBeVisible();
  // Visible sin hacer scroll, antes de los datos del turno
  const box = (await save.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  const card = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
  expect(box.y).toBeLessThan(card.y);

  const url = new URL(`/turnos/${token}`, page.url()).toString();
  await expect(save.getByLabel("Link de tu turno")).toHaveValue(url);
  const copy = save.getByRole("button", { name: "Copiar link" });
  expect((await copy.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await contrastOf(copy)).toBeGreaterThanOrEqual(4.5);
  await copy.click();
  await expect(save.getByRole("button", { name: "Link copiado" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

  // Celular con formato: área + espacio + número
  await expect(page.locator("p", { hasText: "Teléfono:" })).toContainText("Teléfono: 2622 000777");
});

test("compartir por WhatsApp, agregar al calendario y cómo llegar", async ({ page, request }) => {
  await page.goto(`/turnos/${token}`);
  const actions = page.getByTestId("turno-acciones");

  // WhatsApp: datos del turno y cómo llegar, SIN el link privado (con él se puede cancelar)
  const wa = actions.getByRole("link", { name: "Compartir por WhatsApp" });
  const waHref = (await wa.getAttribute("href"))!;
  expect(waHref).toMatch(/^https:\/\/wa\.me\/\?text=/);
  const text = decodeURIComponent(waHref.split("text=")[1]);
  expect(text).toContain("15:30 a 17:00");
  expect(text).toContain("Cómo llegar: https://www.google.com/maps/dir/");
  expect(text).not.toContain(token);

  // Calendario: .ics con el horario en UTC (15:30 Mendoza = 18:30 UTC)
  const cal = actions.getByRole("link", { name: "Agregar al calendario" });
  const res = await request.get((await cal.getAttribute("href"))!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/calendar");
  const ics = await res.text();
  expect(ics).toContain(`DTSTART:${FECHA.replace(/-/g, "")}T183000Z`);
  expect(ics).toContain(`DTEND:${FECHA.replace(/-/g, "")}T200000Z`);
  expect(ics.replace(/\r\n /g, "")).toContain(`/turnos/${token}`);

  // Cómo llegar: Google Maps con el pin del complejo
  const maps = actions.getByRole("link", { name: "Cómo llegar" });
  expect(await maps.getAttribute("href")).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=-?\d+(\.\d+)?%2C-?\d+(\.\d+)?$/);
  expect(await maps.getAttribute("target")).toBe("_blank");

  for (const link of [wa, cal, maps]) {
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test("el .ics de un token inexistente da 404", async ({ request }) => {
  const res = await request.get("/turnos/no-existe/calendario");
  expect(res.status()).toBe(404);
});
