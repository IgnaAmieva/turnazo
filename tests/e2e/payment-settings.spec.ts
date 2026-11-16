/**
 * E2E tests for the payment settings section of the venue edit page
 * (Fase 6, Bloque 2): seña fija o porcentaje, pago total, pago en el lugar.
 *
 * Two states of the same fixture venue:
 *   - Mercado Pago NOT connected: seña / pago total are off-limits, and the
 *     server refuses them even if the form is forced.
 *   - Mercado Pago connected: uses a FAKE mp_accounts row (no real tokens).
 *     Writing mp_accounts is service_role-only since migration 017, so this
 *     file reads SUPABASE_SERVICE_ROLE_KEY from .env.local.
 *
 * Cleanup: afterAll removes the fake MP row and restores the venue's original
 * payment settings. No bookings are created.
 */
import path from "path";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  VENUE_ID,
  COURT_ID,
  VENUE_PATH,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  getOwnerToken,
  nextWeekday,
  slotParams,
} from "./helpers";

process.loadEnvFile(path.join(__dirname, "../../.env.local"));
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const FAKE_MP_USER_ID = "e2e-fake-mp";
const SETTINGS_COLUMNS =
  "deposit_required,deposit_type,deposit_value,allow_full_payment,allow_pay_at_venue";

type Settings = {
  deposit_required: boolean;
  deposit_type: "fixed" | "percent" | null;
  deposit_value: number | null;
  allow_full_payment: boolean;
  allow_pay_at_venue: boolean;
};

const PAY_AT_VENUE_ONLY: Settings = {
  deposit_required:   false,
  deposit_type:       null,
  deposit_value:      null,
  allow_full_payment: false,
  allow_pay_at_venue: true,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ownerHeaders(request: APIRequestContext) {
  const token = await getOwnerToken(request);
  if (!token) throw new Error("No se pudo obtener el token del dueño");
  return {
    apikey:         SUPABASE_ANON_KEY,
    Authorization:  `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

const serviceHeaders = {
  apikey:         SERVICE_KEY,
  Authorization:  `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  // Supabase rejects secret keys sent with a browser User-Agent, and this
  // project's request context inherits Desktop Chrome's.
  "User-Agent":   "turnazo-e2e",
};

async function readSettings(request: APIRequestContext): Promise<Settings> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/venues?id=eq.${VENUE_ID}&select=${SETTINGS_COLUMNS}`,
    { headers: { ...(await ownerHeaders(request)), Accept: "application/vnd.pgrst.object+json" } }
  );
  expect(res.ok()).toBe(true);
  return await res.json() as Settings;
}

async function writeSettings(request: APIRequestContext, settings: Settings) {
  const res = await request.patch(`${SUPABASE_URL}/rest/v1/venues?id=eq.${VENUE_ID}`, {
    headers: { ...(await ownerHeaders(request)), Prefer: "return=minimal" },
    data: settings,
  });
  expect(res.ok()).toBe(true);
}

async function readMpUserId(request: APIRequestContext): Promise<string | null> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/mp_accounts?venue_id=eq.${VENUE_ID}&select=mp_user_id`,
    { headers: serviceHeaders }
  );
  expect(res.ok()).toBe(true);
  const rows = await res.json() as { mp_user_id: string }[];
  return rows[0]?.mp_user_id ?? null;
}

async function connectFakeMp(request: APIRequestContext) {
  if (await readMpUserId(request)) return;
  const res = await request.post(`${SUPABASE_URL}/rest/v1/mp_accounts`, {
    headers: { ...serviceHeaders, Prefer: "return=minimal" },
    data: {
      venue_id:          VENUE_ID,
      mp_user_id:        FAKE_MP_USER_ID,
      mp_email:          "e2e-fake@mp.test",
      access_token_enc:  "fake:enc:token",
      refresh_token_enc: "fake:enc:refresh",
      expires_at:        new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
    },
  });
  expect(res.ok()).toBe(true);
}

/** Only ever deletes the row this file created. */
async function disconnectFakeMp(request: APIRequestContext) {
  const res = await request.delete(
    `${SUPABASE_URL}/rest/v1/mp_accounts?venue_id=eq.${VENUE_ID}&mp_user_id=eq.${FAKE_MP_USER_ID}`,
    { headers: { ...serviceHeaders, Prefer: "return=minimal" } }
  );
  expect(res.ok()).toBe(true);
}

async function openVenuePage(page: Page) {
  await page.goto(`/panel/complejos/${VENUE_ID}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Cobro de reservas" })).toBeVisible();
}

const deposit    = (page: Page) => page.locator('input[name="deposit_required"]');
const fullPay    = (page: Page) => page.locator('input[name="allow_full_payment"]');
const payAtVenue = (page: Page) => page.locator('input[name="allow_pay_at_venue"]');
const value      = (page: Page) => page.locator('input[name="deposit_value"]');
const saveButton = (page: Page) => page.getByRole("button", { name: "Guardar cobro" });
const savedMsg   = (page: Page) => page.getByText("Configuración de cobro guardada.");

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let originalSettings: Settings | null = null;

test.beforeAll(async ({ request }) => {
  if (!SERVICE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en .env.local");

  // Never touch a real Mercado Pago connection on the fixture venue.
  const existing = await readMpUserId(request);
  if (existing && existing !== FAKE_MP_USER_ID) {
    throw new Error("El complejo de prueba tiene una cuenta MP real conectada; no se corre este spec.");
  }

  originalSettings = await readSettings(request);
});

test.afterAll(async ({ request }) => {
  await disconnectFakeMp(request);
  if (originalSettings) await writeSettings(request, originalSettings);
});

// ---------------------------------------------------------------------------
// Sin Mercado Pago conectado
// ---------------------------------------------------------------------------

test.describe("cobro sin Mercado Pago", () => {
  test.beforeEach(async ({ request }) => {
    await disconnectFakeMp(request);
    await writeSettings(request, PAY_AT_VENUE_ONLY);
  });

  test("seña y pago total están deshabilitados y se avisa por qué", async ({ page }) => {
    await openVenuePage(page);

    await expect(page.getByText(/primero conectá Mercado Pago/)).toBeVisible();
    await expect(deposit(page)).toBeDisabled();
    await expect(deposit(page)).not.toBeChecked();
    await expect(fullPay(page)).toBeDisabled();
    await expect(fullPay(page)).not.toBeChecked();
    await expect(payAtVenue(page)).toBeEnabled();
    await expect(payAtVenue(page)).toBeChecked();
  });

  test("el servidor rechaza la seña aunque se fuerce el formulario", async ({ page, request }) => {
    await openVenuePage(page);

    // Bypass the screen: send the fields the UI refuses to send.
    await saveButton(page).evaluate((button) => {
      const form = (button as HTMLButtonElement).form!;
      for (const [name, val] of [
        ["deposit_required", "on"],
        ["deposit_type", "percent"],
        ["deposit_value", "50"],
      ]) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = val;
        form.appendChild(input);
      }
    });
    await saveButton(page).click();

    await expect(page.getByText("Conectá Mercado Pago para activar la seña o el pago total.")).toBeVisible();
    await expect(savedMsg(page)).not.toBeVisible();
    expect(await readSettings(request)).toEqual(PAY_AT_VENUE_ONLY);
  });

  test("el servidor rechaza el pago total aunque se fuerce el formulario", async ({ page, request }) => {
    await openVenuePage(page);

    await saveButton(page).evaluate((button) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "allow_full_payment";
      input.value = "on";
      (button as HTMLButtonElement).form!.appendChild(input);
    });
    await saveButton(page).click();

    await expect(page.getByText("Conectá Mercado Pago para activar la seña o el pago total.")).toBeVisible();
    expect(await readSettings(request)).toEqual(PAY_AT_VENUE_ONLY);
  });

  test("no deja quedarse sin ninguna forma de pago", async ({ page, request }) => {
    await openVenuePage(page);

    await payAtVenue(page).uncheck();
    await saveButton(page).click();

    await expect(page.getByText("Dejá al menos una forma de pago activa.")).toBeVisible();
    expect(await readSettings(request)).toEqual(PAY_AT_VENUE_ONLY);
  });
});

// ---------------------------------------------------------------------------
// Con Mercado Pago conectado (cuenta falsa)
// ---------------------------------------------------------------------------

test.describe("cobro con Mercado Pago conectado", () => {
  test.beforeEach(async ({ request }) => {
    await connectFakeMp(request);
    await writeSettings(request, PAY_AT_VENUE_ONLY);
  });

  test("seña por porcentaje: se guarda, apaga el pago en el lugar y persiste al recargar", async ({ page, request }) => {
    await openVenuePage(page);

    await expect(page.getByText(/primero conectá Mercado Pago/)).not.toBeVisible();
    await expect(deposit(page)).toBeEnabled();
    await expect(value(page)).not.toBeVisible();

    await deposit(page).check();
    await expect(page.getByLabel("Porcentaje del turno")).toBeChecked();
    await value(page).fill("30");

    // Seña obligatoria ⇒ no hay pago en el lugar
    await expect(payAtVenue(page)).toBeDisabled();
    await expect(payAtVenue(page)).not.toBeChecked();

    await saveButton(page).click();
    await expect(savedMsg(page)).toBeVisible();

    // Lo guardado sigue en pantalla sin recargar (React 19 resetea el form
    // al terminar la acción: el componente tiene que volver a mostrarlo).
    await expect(deposit(page)).toBeChecked();
    await expect(page.getByLabel("Porcentaje del turno")).toBeChecked();
    await expect(value(page)).toHaveValue("30");
    await expect(payAtVenue(page)).not.toBeChecked();

    expect(await readSettings(request)).toEqual({
      deposit_required:   true,
      deposit_type:       "percent",
      deposit_value:      30,
      allow_full_payment: false,
      allow_pay_at_venue: false,
    });

    await openVenuePage(page);
    await expect(deposit(page)).toBeChecked();
    await expect(page.getByLabel("Porcentaje del turno")).toBeChecked();
    await expect(value(page)).toHaveValue("30");
    await expect(payAtVenue(page)).not.toBeChecked();
  });

  test("seña fija junto con pago total", async ({ page, request }) => {
    await openVenuePage(page);

    await deposit(page).check();
    await page.getByLabel("Monto fijo").check();
    await value(page).fill("2500");
    await fullPay(page).check();

    await saveButton(page).click();
    await expect(savedMsg(page)).toBeVisible();
    await expect(page.getByLabel("Monto fijo")).toBeChecked();
    await expect(value(page)).toHaveValue("2500");
    await expect(fullPay(page)).toBeChecked();

    expect(await readSettings(request)).toEqual({
      deposit_required:   true,
      deposit_type:       "fixed",
      deposit_value:      2500,
      allow_full_payment: true,
      allow_pay_at_venue: false,
    });
  });

  test("el servidor rechaza porcentaje fuera de 1–100 y seña fija en 0", async ({ page, request }) => {
    await openVenuePage(page);

    // Skip the browser's own min/max check: this test is about the server.
    await saveButton(page).evaluate((button) => {
      (button as HTMLButtonElement).form!.noValidate = true;
    });

    await deposit(page).check();
    await value(page).fill("150");
    await saveButton(page).click();
    await expect(page.getByText("El porcentaje de seña debe estar entre 1 y 100")).toBeVisible();
    await expect(savedMsg(page)).not.toBeVisible();
    // The rejected value stays on screen so the owner can fix it
    await expect(value(page)).toHaveValue("150");

    await page.getByLabel("Monto fijo").check();
    await value(page).fill("0");
    await saveButton(page).click();
    await expect(page.getByText("El monto de la seña debe ser mayor a 0")).toBeVisible();

    expect(await readSettings(request)).toEqual(PAY_AT_VENUE_ONLY);
  });

  test("sin seña: pago total y pago en el lugar a la vez", async ({ page, request }) => {
    await openVenuePage(page);

    await fullPay(page).check();
    await expect(payAtVenue(page)).toBeChecked();

    await saveButton(page).click();
    await expect(savedMsg(page)).toBeVisible();

    expect(await readSettings(request)).toEqual({
      deposit_required:   false,
      deposit_type:       null,
      deposit_value:      null,
      allow_full_payment: true,
      allow_pay_at_venue: true,
    });
  });

  test("solo pago online: la pantalla pública de reserva ofrece solo el pago total", async ({ page, request }) => {
    await writeSettings(request, {
      deposit_required:   false,
      deposit_type:       null,
      deposit_value:      null,
      allow_full_payment: true,
      allow_pay_at_venue: false,
    });

    // Same slot shape as the public booking flow: Monday, 11:00–12:30 Mendoza
    const fecha = nextWeekday(1, 2);
    const { inicio, fin } = slotParams(fecha, 11, 90);
    await page.goto(
      `${VENUE_PATH}/reservar?cancha=${COURT_ID}&fecha=${fecha}` +
      `&inicio=${encodeURIComponent(inicio)}&fin=${encodeURIComponent(fin)}`
    );
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Confirmar reserva" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /pagar el total online/i })).toBeChecked();
    await expect(page.getByRole("radio", { name: /pagar en el lugar/i })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: /pagar la seña online/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /ir a pagar con mercado pago/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /confirmar reserva/i })).toHaveCount(0);

    // Back to pay-at-venue: only that option, and the classic confirm button
    await writeSettings(request, PAY_AT_VENUE_ONLY);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("radio", { name: /pagar en el lugar/i })).toBeChecked();
    await expect(page.getByRole("radio", { name: /pagar el total online/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /confirmar reserva/i })).toBeVisible();
  });

  test("desconectar Mercado Pago apaga la seña y el pago total", async ({ page, request }) => {
    await writeSettings(request, {
      deposit_required:   true,
      deposit_type:       "percent",
      deposit_value:      50,
      allow_full_payment: true,
      allow_pay_at_venue: false,
    });
    await openVenuePage(page);
    await expect(deposit(page)).toBeChecked();

    await page.getByRole("button", { name: "Desconectar Mercado Pago" }).click();
    await page.getByRole("button", { name: "Sí, desconectar" }).click();

    await expect(page.getByText(/primero conectá Mercado Pago/)).toBeVisible({ timeout: 15_000 });
    await expect(deposit(page)).toBeDisabled();
    await expect(deposit(page)).not.toBeChecked();
    await expect(fullPay(page)).not.toBeChecked();
    await expect(payAtVenue(page)).toBeChecked();

    expect(await readMpUserId(request)).toBeNull();
    const after = await readSettings(request);
    expect(after.deposit_required).toBe(false);
    expect(after.allow_full_payment).toBe(false);
    expect(after.allow_pay_at_venue).toBe(true);
  });
});
