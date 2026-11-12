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
  SUPABASE_ANON_KEY,
  getOwnerToken,
} from "./helpers";

// ---------------------------------------------------------------------------
// Login helper
// ---------------------------------------------------------------------------
async function loginAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.fill('[name="email"]', OWNER_EMAIL);
  await page.fill('[name="password"]', OWNER_PASSWORD);
  await page.getByRole("button", { name: /entrar/i }).click();
  // Wait for redirect away from /login
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Unauthenticated access → redirect to login
// ---------------------------------------------------------------------------
test("panel redirects unauthenticated users to /login", async ({ page }) => {
  await page.goto("/panel");
  // Next.js App Router redirect may be a client-side navigation; wait for it
  await page.waitForURL(/\/login/, { timeout: 10_000 });
  expect(page.url()).toContain("/login");
});

// ---------------------------------------------------------------------------
// Panel home
// ---------------------------------------------------------------------------
test("panel/complejos lists venues after login", async ({ page }) => {
  const errors = collectPageErrors(page);
  await loginAsOwner(page);
  await page.goto("/panel/complejos");
  await page.waitForLoadState("networkidle");

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
  await page.waitForLoadState("networkidle");

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
  await page.waitForLoadState("networkidle");

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
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("button", { name: /crear complejo/i })).toBeVisible();
  expect(errors).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// New court page
// ---------------------------------------------------------------------------
test("panel/complejos/[id]/canchas/nuevo loads the new court form", async ({ page }) => {
  const errors = collectPageErrors(page);
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}/canchas/nuevo`);
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("button", { name: /crear cancha/i })).toBeVisible();
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
  await page.waitForLoadState("networkidle");

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
  await page.waitForLoadState("networkidle");

  // Record the current audit_log count before the action
  const tokenBefore = await getOwnerToken(request);
  expect(tokenBefore).not.toBeNull();

  const countBefore = await request.get(
    `${SUPABASE_URL}/rest/v1/audit_log?venue_id=eq.${VENUE_ID}&entity=eq.court_hours&select=count`,
    {
      headers: {
        apikey:        SUPABASE_ANON_KEY,
        Authorization: `Bearer ${tokenBefore!}`,
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
  const tokenAfter = await getOwnerToken(request);
  const countAfter = await request.get(
    `${SUPABASE_URL}/rest/v1/audit_log?venue_id=eq.${VENUE_ID}&entity=eq.court_hours&select=count`,
    {
      headers: {
        apikey:        SUPABASE_ANON_KEY,
        Authorization: `Bearer ${tokenAfter!}`,
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
