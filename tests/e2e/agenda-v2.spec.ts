/**
 * Agenda nueva del dueño (diseno/agenda-v2.png, pantallas 1 y 2): lista del
 * día en orden de hora, resumen (turnos, $ a cobrar, libres), línea AHORA,
 * libres con "+ Cargar turno", barra fija con "+ Nuevo turno" y "Compartir
 * libres", y aviso de guardado.
 *
 * Usa un día propio (martes 25+ días) en el complejo de prueba; borra lo que
 * crea ("E2E Agenda*").
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  VENUE_ID, COURT_ID, SUPABASE_URL, nextWeekday, serviceHeaders,
  createTestBooking, deleteTestBookings, deleteTestOutboxRows,
} from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const DATE = nextWeekday(2, 25);
const AGENDA = `/panel/complejos/${VENUE_ID}/agenda?fecha=${DATE}`;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Mendoza" }).format(new Date());

async function rows(request: APIRequestContext, name: string) {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/bookings?venue_id=eq.${VENUE_ID}&customer_name=eq.${encodeURIComponent(name)}&select=id,status,source,kind,payment_status,price_total,amount_paid`,
    { headers: serviceHeaders() },
  );
  return (await res.json()) as { id: string; status: string; source: string; kind: string; payment_status: string; price_total: number; amount_paid: number }[];
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  await deleteTestBookings(request, ["E2E Agenda*"]);
  const a = await createTestBooking(request, DATE, 9, 30, "E2E Agenda Sin Pagar", "2622000661");
  const b = await createTestBooking(request, DATE, 17, 0, "E2E Agenda Seña", "2622000662");
  expect(a && b).toBeTruthy();
  await request.patch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${b}`, {
    headers: serviceHeaders(), data: { payment_status: "deposit_paid", amount_paid: 2000 },
  });
});

test.afterAll(async ({ request }) => {
  await deleteTestBookings(request, ["E2E Agenda*"]);
  await deleteTestOutboxRows(request);
});

test("lista del día en orden de hora, con resumen: turnos, $ a cobrar y libres", async ({ page, request }) => {
  await page.goto(AGENDA);
  const unpaid = (await rows(request, "E2E Agenda Sin Pagar"))[0];
  const deposit = (await rows(request, "E2E Agenda Seña"))[0];
  const due = Number(unpaid.price_total) + Number(deposit.price_total) - 2000;

  await expect(page.getByTestId("resumen-turnos")).toHaveText("2");
  await expect(page.getByTestId("resumen-cobrar")).toHaveText(`$${due.toLocaleString("es-AR")}`);
  await expect(page.getByTestId("resumen")).toContainText("turnos");

  // Pestañas con la cantidad de turnos de cada cancha, más "Todas"
  const tabs = page.getByRole("tablist", { name: "Canchas" });
  await expect(tabs.getByRole("tab")).toHaveText(["Cancha 1 · 2", "Cancha 2 · 0", "Todas"]);

  // En "Todas", los libres de las dos canchas: los mismos que dice el resumen
  await tabs.getByRole("tab", { name: "Todas" }).click();
  const free = page.getByTestId("turno-libre").filter({ visible: true });
  await expect(page.getByTestId("resumen-libres")).toHaveText(String(await free.count()));

  // En orden de hora (turnos y libres mezclados)
  await tabs.getByRole("tab", { name: /^Cancha 1/ }).click();
  const times = await page.locator('[data-testid="court-column"] [data-inicio]').evaluateAll((els) => els.map((e) => e.getAttribute("data-inicio")!));
  expect(times).toEqual([...times].sort());
  expect(times).toContain("09:30");
  expect(times).toContain("17:00");

  // Estado del pago: ámbar sin pagar (con el monto), lima la seña
  const cardUnpaid = page.getByTestId("booking-card").filter({ hasText: "E2E Agenda Sin Pagar" });
  await expect(cardUnpaid.getByTestId("badge-pago")).toHaveText(`Sin pagar $${Number(unpaid.price_total).toLocaleString("es-AR")}`);
  await expect(page.getByTestId("booking-card").filter({ hasText: "E2E Agenda Seña" }).getByTestId("badge-pago")).toHaveText("Seña $2.000");
  // Hora y fin, nombre y celular
  await expect(cardUnpaid).toContainText("2622 000661");
  await expect(page.locator("li").filter({ has: cardUnpaid })).toContainText(/09:30\s*11:00/);
});

test("WhatsApp de cada turno: link a wa.me, de 44 px", async ({ page }) => {
  await page.goto(AGENDA);
  const wa = page.getByTestId("booking-card").filter({ hasText: "E2E Agenda Sin Pagar" }).getByRole("link", { name: /whatsapp/i });
  await expect(wa).toHaveAttribute("href", /^https:\/\/wa\.me\/5492622000661/);
  const box = (await wa.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});

test("línea AHORA solo cuando el día es hoy", async ({ page }) => {
  await page.goto(AGENDA);
  await expect(page.getByTestId("resumen")).toBeVisible();
  await expect(page.getByTestId("ahora")).toHaveCount(0);
  await page.goto(`/panel/complejos/${VENUE_ID}/agenda?fecha=${today}`);
  await expect(page.getByTestId("ahora").filter({ visible: true })).toHaveCount(1);
  await expect(page.getByTestId("ahora").filter({ visible: true })).toContainText(/AHORA \d{2}:\d{2}/);
});

test("barra fija abajo con '+ Nuevo turno' y 'Compartir libres' (44 px, siempre a la vista)", async ({ page }) => {
  await page.goto(AGENDA);
  const nuevo = page.getByRole("button", { name: /nuevo turno/i });
  const compartir = page.getByRole("link", { name: /compartir libres/i });
  await expect(compartir).toHaveAttribute("href", `/panel/complejos/${VENUE_ID}/historia`);
  await page.mouse.wheel(0, 3000);
  for (const el of [nuevo, compartir]) {
    const box = (await el.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    expect(box.y).toBeGreaterThan(700);
  }
});

test("un libre → 'Bloquear horario' con ese horario → aviso 'Horario bloqueado' y queda en la lista", async ({ page, request }) => {
  await page.goto(AGENDA);
  await page.locator('[data-testid="turno-libre"][data-inicio="21:30"]').click();
  const sheet = page.getByRole("dialog", { name: "Nuevo turno" });
  await sheet.getByRole("radio", { name: "Bloquear horario" }).click();
  await expect(sheet.locator('input[name="start"]')).toHaveValue(`${DATE}T21:30`);
  await expect(sheet.locator('input[name="end"]')).toHaveValue(`${DATE}T23:00`);
  await sheet.locator('input[name="note"]').fill("E2E Agenda bloqueo");
  await sheet.getByRole("button", { name: /guardar bloqueo/i }).click();
  await expect(page.getByTestId("guardado")).toHaveText("Horario bloqueado");
  await expect(page.getByTestId("bloqueo").filter({ hasText: "E2E Agenda bloqueo" })).toBeVisible();
  expect((await rows(request, "E2E Agenda bloqueo"))[0]).toMatchObject({ kind: "block", status: "confirmed" });
});

test("'+ Nuevo turno' propone la cancha y el primer horario libre; un horario ocupado no aparece", async ({ page }) => {
  await page.goto(AGENDA);
  await page.getByRole("button", { name: /nuevo turno/i }).click();
  const sheet = page.getByRole("dialog", { name: "Nuevo turno" });
  await expect(sheet.getByRole("button", { name: "Cancha 1", pressed: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "08:00", pressed: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "09:30" })).toHaveCount(0); // ocupado
  for (const b of await sheet.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

// Último: necesita la migración 026 (panel_create_booking), sin aplicar todavía
test("'+ Cargar turno' en un libre: nombre y celular → turno confirmado sin pagar (026)", async ({ page, request }) => {
  await page.goto(AGENDA);
  await page.locator('[data-testid="turno-libre"][data-inicio="12:30"]').click();
  const sheet = page.getByRole("dialog", { name: "Nuevo turno" });
  await expect(sheet.getByRole("button", { name: "12:30", pressed: true })).toBeVisible();
  // El celular mal escrito se marca en el campo
  await sheet.getByLabel("Nombre").fill("E2E Agenda Cargado");
  await sheet.getByLabel("Celular").fill("123");
  await sheet.getByRole("button", { name: "Cargar turno" }).click();
  await expect(sheet.getByText(/Revisá el celular/)).toBeVisible();

  await sheet.getByLabel("Celular").fill("2622 000663");
  await sheet.getByRole("button", { name: "Cargar turno" }).click();
  await expect(page.getByTestId("guardado")).toHaveText("Turno cargado");
  const card = page.getByTestId("booking-card").filter({ hasText: "E2E Agenda Cargado" });
  await expect(card).toHaveAttribute("data-inicio", "12:30");
  await expect(card.getByTestId("badge-pago")).toContainText("Sin pagar");
  const row = (await rows(request, "E2E Agenda Cargado"))[0];
  expect(row).toMatchObject({ status: "confirmed", source: "manual", kind: "booking", payment_status: "unpaid" });
  expect(Number(row.price_total)).toBeGreaterThan(0);
  // El turno se cargó en Cancha 1 (la del libre)
  const court = await request.get(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${row.id}&select=court_id`, { headers: serviceHeaders() });
  expect((await court.json())[0].court_id).toBe(COURT_ID);
});
