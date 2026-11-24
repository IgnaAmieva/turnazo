/**
 * Rediseño M2: reserva en la misma página del complejo (hoja), contando toques.
 * Solo el complejo de prueba; las reservas "E2E Hoja*" se borran al final.
 * El test de pago online usa la cuenta de Mercado Pago falsa (como
 * payment-flow.spec): termina en el error de MP y el hold se libera; se
 * restaura la configuración de cobro original.
 */
import path from "path";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  VENUE_ID, VENUE_PATH, SUPABASE_URL, nextWeekday, serviceHeaders,
  createTestBooking, deleteTestBookings, deleteTestOutboxRows,
} from "./helpers";

process.loadEnvFile(path.join(__dirname, "../../.env.local"));

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});
test.describe.configure({ mode: "serial" });

const FECHA = nextWeekday(0, 17); // domingo, 17+ días
const NAME = "E2E Hoja Juan";
const MEM = { nombre: NAME, celular: "2622000999" };
const MP_FAKE = "e2e-fake-mp-hoja";
const SETTINGS = "deposit_required,deposit_type,deposit_value,allow_full_payment,allow_pay_at_venue";

async function remember(page: Page) {
  await page.addInitScript((m) => localStorage.setItem("turnazo-jugador", JSON.stringify(m)), MEM);
}
const venueUrl = `${VENUE_PATH}?fecha=${FECHA}`;
const slotAt = (page: Page, hhmm: string) =>
  page.locator("section").first().getByTestId("slot-free").filter({ hasText: hhmm }).first(); // Cancha 1

test.afterAll(async ({ request }) => {
  await deleteTestBookings(request, ["E2E Hoja*"]);
  await deleteTestOutboxRows(request);
});

test("con datos recordados: turno → Confirmar = 2 toques y queda reservado", async ({ page }) => {
  await remember(page);
  await page.goto(venueUrl);
  let taps = 0;

  await slotAt(page, "17:00").click(); taps++;
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${VENUE_PATH}\\?`)); // no navegó a /reservar
  await expect(sheet.getByTestId("datos-recordados")).toContainText(`${NAME} · ${MEM.celular}`);
  await expect(sheet.getByLabel("Tu nombre")).toBeHidden(); // sin campos: una sola línea
  await expect(sheet.getByRole("radio", { name: /pagar en el lugar/i })).toBeChecked();

  const confirm = sheet.getByRole("button", { name: "Confirmar reserva" });
  const box = (await confirm.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(844);   // fijo abajo, a la vista sin scrollear
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(sheet.locator("[data-captcha-slot]")).toHaveCount(1); // lugar para Turnstile

  const nav = page.waitForURL(/\/turnos\//, { timeout: 25_000 });
  await confirm.click(); taps++;
  await nav;
  expect(taps).toBe(2);
  await expect(page.getByText(/confirmado/i)).toBeVisible();
  await expect(page.getByText(NAME)).toBeVisible();
});

test("turno tomado con la hoja abierta: error pegado y 'Ver otros horarios' reemplaza a Confirmar", async ({ page, request }) => {
  await remember(page);
  await page.goto(venueUrl);
  await slotAt(page, "18:30").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();

  // Otra persona lo reserva antes
  expect(await createTestBooking(request, FECHA, 18, 30, "E2E Hoja Otro", "2622000998")).toBeTruthy();

  await sheet.getByRole("button", { name: "Confirmar reserva" }).click();
  const err = sheet.getByTestId("reserva-error");
  await expect(err).toContainText("ya fue reservado");
  await expect(err).toHaveAttribute("data-error-code", "slot_taken");
  await expect(sheet.getByRole("button", { name: "Confirmar reserva" })).toHaveCount(0);
  const otros = sheet.getByRole("button", { name: "Ver otros horarios" });
  const e = (await err.boundingBox())!;
  const b = (await otros.boundingBox())!;
  expect(b.y - (e.y + e.height)).toBeGreaterThanOrEqual(0);
  expect(b.y - (e.y + e.height)).toBeLessThanOrEqual(24);   // pegado
  expect(b.y + b.height).toBeLessThanOrEqual(844);          // a la vista

  // Cierra la hoja y recarga la disponibilidad del mismo día: 18:30 ya figura ocupado
  await otros.click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`fecha=${FECHA}`));
  await expect(page.locator("section").first().getByTestId("slot-taken").filter({ hasText: "18:30" })).toBeVisible({ timeout: 10_000 });
});

test("Cerrar y Escape cierran la hoja sin reservar", async ({ page }) => {
  await page.goto(venueUrl);
  await slotAt(page, "20:00").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cerrar" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await slotAt(page, "20:00").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test.describe("sin JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("el turno sigue siendo un link a /reservar", async ({ page }) => {
    await page.goto(venueUrl);
    await slotAt(page, "20:00").click();
    await page.waitForURL(/\/reservar\?/);
    await expect(page.getByRole("heading", { name: "Confirmar reserva" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Pago online desde la hoja: mismo flujo que /reservar (cuenta MP falsa)
// ---------------------------------------------------------------------------
async function getSettings(request: APIRequestContext) {
  const r = await request.get(`${SUPABASE_URL}/rest/v1/venues?id=eq.${VENUE_ID}&select=${SETTINGS}`,
    { headers: { ...serviceHeaders(), Accept: "application/vnd.pgrst.object+json" } });
  expect(r.ok()).toBe(true);
  return r.json();
}
async function setSettings(request: APIRequestContext, data: object) {
  const r = await request.patch(`${SUPABASE_URL}/rest/v1/venues?id=eq.${VENUE_ID}`,
    { headers: { ...serviceHeaders(), Prefer: "return=minimal" }, data });
  expect(r.ok()).toBe(true);
}
async function mpRows(request: APIRequestContext) {
  const r = await request.get(`${SUPABASE_URL}/rest/v1/mp_accounts?venue_id=eq.${VENUE_ID}&select=mp_user_id`, { headers: serviceHeaders() });
  return (await r.json()) as { mp_user_id: string }[];
}

test("pago online desde la hoja: error de MP pegado y 'Pagar en el lugar' reserva sin volver a cargar nada", async ({ page, request }) => {
  const original = await getSettings(request);
  const hadMp = (await mpRows(request)).length > 0;
  try {
    if (!hadMp) {
      const r = await request.post(`${SUPABASE_URL}/rest/v1/mp_accounts`, {
        headers: { ...serviceHeaders(), Prefer: "return=minimal" },
        data: {
          venue_id: VENUE_ID, mp_user_id: MP_FAKE, mp_email: "e2e-fake@mp.test",
          access_token_enc: "fake:enc:token", refresh_token_enc: "fake:enc:refresh",
          expires_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        },
      });
      expect(r.ok()).toBe(true);
    }
    await setSettings(request, { deposit_required: false, deposit_type: null, deposit_value: null, allow_full_payment: true, allow_pay_at_venue: true });

    await remember(page);
    await page.goto(venueUrl);
    await slotAt(page, "14:00").click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("radio", { name: /pagar el total online/i }).check();
    await sheet.getByLabel("Tu email").fill("e2e-hoja@turnazo.test");
    await sheet.getByRole("button", { name: "Ir a pagar con Mercado Pago" }).click();
    const err = sheet.getByTestId("reserva-error");
    await expect(err).toContainText(/No pudimos acceder a la cuenta de Mercado Pago del complejo/, { timeout: 20_000 });
    const venueBtn = sheet.getByRole("button", { name: "Pagar en el lugar" });
    await expect(sheet.getByRole("button", { name: "Reintentar el pago" })).toBeVisible();
    const e = (await err.boundingBox())!;
    const b = (await venueBtn.boundingBox())!;
    expect(b.y - (e.y + e.height)).toBeLessThanOrEqual(24);

    // Un toque: cambia a "pagar en el lugar" y reserva (el hold de MP ya se liberó)
    const nav = page.waitForURL(/\/turnos\//, { timeout: 25_000 });
    await venueBtn.click();
    await nav;
    await expect(page.getByText(/confirmado/i)).toBeVisible();
  } finally {
    await setSettings(request, original);
    if (!hadMp) {
      await request.delete(`${SUPABASE_URL}/rest/v1/mp_accounts?venue_id=eq.${VENUE_ID}&mp_user_id=eq.${MP_FAKE}`,
        { headers: { ...serviceHeaders(), Prefer: "return=minimal" } });
    }
  }
  expect(await getSettings(request)).toEqual(original);
});

// ---------------------------------------------------------------------------
// Navegación en el celular: "← Volver" en lugar de las migas
// ---------------------------------------------------------------------------
test("celular: '← Volver' de 44 px al paso anterior lógico; sin migas", async ({ page }) => {
  const cases: [string, string][] = [
    ["/tunuyan", "/"],
    ["/tunuyan/padel", "/tunuyan"],
    [venueUrl, "/tunuyan/padel"],
  ];
  for (const [url, back] of cases) {
    await page.goto(url);
    const volver = page.getByTestId("volver");
    await expect(volver).toBeVisible();
    await expect(volver).toHaveAttribute("href", back);
    expect((await volver.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("navigation", { name: "Ruta" })).toBeHidden();
  }
  const href = await page.getByTestId("slot-free").first().getAttribute("href");
  await page.goto(href!);
  await expect(page.getByTestId("volver")).toHaveAttribute("href", `${VENUE_PATH}?fecha=${FECHA}`);
});

test.describe("escritorio", () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
  test("migas completas y sin '← Volver'", async ({ page }) => {
    await page.goto(venueUrl);
    await expect(page.getByRole("navigation", { name: "Ruta" })).toBeVisible();
    await expect(page.getByTestId("volver")).toBeHidden();
  });
});
