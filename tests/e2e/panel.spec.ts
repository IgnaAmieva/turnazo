/**
 * E2E tests for the owner panel.
 * Login as dueno@turnazo.test before each test.
 */
import { test, expect } from "@playwright/test";
import {
  collectPageErrors,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  VENUE_ID,
  SUPABASE_URL,
  serviceHeaders, waitIdle } from "./helpers";

// ---------------------------------------------------------------------------
// Login helper (no-op when storageState already has auth)
// ---------------------------------------------------------------------------
async function loginAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/panel/complejos");
  await waitIdle(page);
  if (page.url().includes("/login")) {
    await page.fill('[name="email"]', OWNER_EMAIL);
    await page.fill('[name="password"]', OWNER_PASSWORD);
    await page.getByRole("button", { name: /entrar/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 25_000 });
  }
}

// ---------------------------------------------------------------------------
// Unauthenticated access → redirect to login
// Uses a fresh context with explicitly cleared storageState (no cookies, no
// localStorage) to simulate an unauthenticated user hitting /panel.
// ---------------------------------------------------------------------------
test("panel redirects unauthenticated users to /login", async ({ browser }) => {
  // Explicitly empty storageState ensures no Supabase session cookies are sent
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  // Navigate directly to the panel; middleware must redirect to /login
  await page.goto("http://localhost:3001/panel/complejos");
  await page.waitForURL(/\/login/, { timeout: 15_000 });
  expect(page.url()).toContain("/login");
  await context.close();
});

// ---------------------------------------------------------------------------
// Panel home
// ---------------------------------------------------------------------------
test("panel/complejos lists venues after login", async ({ page }) => {
  const errors = collectPageErrors(page);
  await loginAsOwner(page);
  await page.goto("/panel/complejos");
  await waitIdle(page);

  await expect(page.getByText("Complejo Padelero Tunuyán")).toBeVisible();
  await expect(page.getByText(/aprobado/i)).toBeVisible();
  expect(errors).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Edit venue page
// ---------------------------------------------------------------------------
test("panel/complejos/[id] loads the edit form", async ({ page }) => {
  const errors = collectPageErrors(page);
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}`);
  await waitIdle(page);

  await expect(page.locator('input[name="name"]')).toHaveValue("Complejo Padelero Tunuyán");
  expect(errors).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Courts list
// ---------------------------------------------------------------------------
test("panel/complejos/[id]/canchas lists courts", async ({ page }) => {
  const errors = collectPageErrors(page);
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}/canchas`);
  await waitIdle(page);

  await expect(page.getByText("Cancha 1")).toBeVisible();
  await expect(page.getByText("Cancha 2")).toBeVisible();
  expect(errors).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// New venue page
// ---------------------------------------------------------------------------
test("panel/complejos/nuevo loads the new venue form", async ({ page }) => {
  const errors = collectPageErrors(page);
  await loginAsOwner(page);
  await page.goto("/panel/complejos/nuevo");
  await waitIdle(page);

  await expect(page.getByRole("button", { name: /crear complejo/i })).toBeVisible();
  expect(errors).toHaveLength(0);

  // La localidad sale del pin (en el servidor): no hay selector, y el mapa arranca SIN pin
  await expect(page.locator('select[name="locality_id"]')).toHaveCount(0);
  await expect(page.getByTestId("pin-estado")).toContainText("Tocá el mapa justo donde está el complejo");
  await expect(page.locator('input[name="lat"]')).toHaveValue("");

  // Sin pin no se crea (no se guarda nada): avisa que falta marcar el mapa
  await page.locator('input[name="name"]').fill("E2E Sin Pin");
  await page.locator('input[name="phone"]').fill("2622000999");
  await page.locator('input[name="address"]').fill("Calle de prueba 123");
  await page.getByRole("button", { name: /crear complejo/i }).click();
  await expect(page.getByText("Marcá en el mapa dónde está el complejo.")).toBeVisible();
  await expect(page).toHaveURL(/\/panel\/complejos\/nuevo$/);
});

test("al editar el complejo se ve la localidad que salió del pin", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}`);
  await expect(page.getByTestId("localidad-actual")).toContainText("Tunuyán");
  await expect(page.locator('select[name="locality_id"]')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// New court page
// ---------------------------------------------------------------------------
test("panel/complejos/[id]/canchas/nuevo loads the new court form", async ({ page }) => {
  const errors = collectPageErrors(page);
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}/canchas/nuevo`);
  await waitIdle(page);

  await expect(page.getByRole("button", { name: /siguiente: precios/i })).toBeVisible();
  expect(errors).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Edit court page (hours + prices editors)
// ---------------------------------------------------------------------------
test("panel/complejos/[id]/canchas/[cid] loads hours and prices editors", async ({ page }) => {
  const errors = collectPageErrors(page);
  await loginAsOwner(page);
  const COURT_ID = "c3d4e5f6-0000-0000-0000-000000000001";
  await page.goto(`/panel/complejos/${VENUE_ID}/canchas/${COURT_ID}`);
  await waitIdle(page);

  await expect(page.getByText("Horarios de apertura")).toBeVisible();
  await expect(page.getByText("Precios por franja")).toBeVisible();
  await expect(page.getByRole("button", { name: /guardar horarios/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /guardar precios/i })).toBeVisible();
  expect(errors).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// audit_log: saving court hours writes a row
// ---------------------------------------------------------------------------
test("saving court hours writes an audit_log row", async ({ page, request }) => {
  const errors = collectPageErrors(page);
  await loginAsOwner(page);
  const COURT_ID = "c3d4e5f6-0000-0000-0000-000000000001";
  await page.goto(`/panel/complejos/${VENUE_ID}/canchas/${COURT_ID}`);
  await waitIdle(page);

  // Record the current audit_log count before the action (service_role: el
  // dueño no lee audit_log desde la migración 021)
  const countBefore = await request.get(
    `${SUPABASE_URL}/rest/v1/audit_log?venue_id=eq.${VENUE_ID}&entity=eq.court_hours&select=count`,
    {
      headers: {
        ...serviceHeaders(),
        Accept:        "application/vnd.pgrst.object+json",
        Prefer:        "count=exact",
      },
    }
  );
  const contentRangeBefore = countBefore.headers()["content-range"] ?? "*/0";
  const rowsBefore = parseInt(contentRangeBefore.split("/")[1] ?? "0", 10) || 0;

  // Click "Guardar horarios" to trigger an audit_log insert
  await page.getByRole("button", { name: /guardar horarios/i }).click();
  // Wait for the success indicator (button re-enables or success state)
  await page.waitForTimeout(2_000);

  // Verify a new audit_log row was written
  const countAfter = await request.get(
    `${SUPABASE_URL}/rest/v1/audit_log?venue_id=eq.${VENUE_ID}&entity=eq.court_hours&select=count`,
    {
      headers: {
        ...serviceHeaders(),
        Accept:        "application/vnd.pgrst.object+json",
        Prefer:        "count=exact",
      },
    }
  );
  const contentRangeAfter = countAfter.headers()["content-range"] ?? "*/0";
  const rowsAfter = parseInt(contentRangeAfter.split("/")[1] ?? "0", 10) || 0;

  expect(rowsAfter).toBeGreaterThan(rowsBefore);
  expect(errors).toHaveLength(0);
});
