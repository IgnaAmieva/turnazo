/**
 * E2E tests for venue settings screens added in Fase 4 debt:
 *   1. WhatsApp template editor (edit form + live preview)
 *   2. Blocked phones list + unblock
 *
 * Uses the same owner fixture as the other panel tests.
 * Cleanup restores the original whatsapp_template and unblocks the test phone.
 */
import { test, expect } from "@playwright/test";
import {
  OWNER_EMAIL,
  OWNER_PASSWORD,
  VENUE_ID,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  getOwnerToken,
  unblockTestPhones,
} from "./helpers";

// Phone used exclusively by this test file
const SETTINGS_PHONE = "2615009001";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loginAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/panel/complejos");
  await page.waitForLoadState("networkidle");
  if (page.url().includes("/login")) {
    await page.fill('[name="email"]', OWNER_EMAIL);
    await page.fill('[name="password"]', OWNER_PASSWORD);
    await page.getByRole("button", { name: /entrar/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 25_000 });
  }
}

/** Read the current whatsapp_template value via REST (owner-scoped). */
async function getTemplate(request: import("@playwright/test").APIRequestContext): Promise<string | null> {
  const token = await getOwnerToken(request);
  if (!token) return null;
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/venues?id=eq.${VENUE_ID}&select=whatsapp_template`,
    {
      headers: {
        apikey:        SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        Accept:        "application/vnd.pgrst.object+json",
      },
    }
  );
  if (!res.ok()) return null;
  const body = await res.json() as { whatsapp_template?: string | null };
  return body.whatsapp_template ?? null;
}

/** Block a phone directly via REST for setup. */
async function blockPhone(
  request: import("@playwright/test").APIRequestContext,
  phone: string,
): Promise<void> {
  const token = await getOwnerToken(request);
  if (!token) return;
  await request.post(`${SUPABASE_URL}/rest/v1/blocked_phones`, {
    headers: {
      apikey:          SUPABASE_ANON_KEY,
      Authorization:   `Bearer ${token}`,
      "Content-Type":  "application/json",
      Prefer:          "resolution=merge-duplicates",
    },
    data: { venue_id: VENUE_ID, phone },
  });
}

/** Restore whatsapp_template to its original value via REST. */
async function restoreTemplate(
  request: import("@playwright/test").APIRequestContext,
  original: string | null,
): Promise<void> {
  const token = await getOwnerToken(request);
  if (!token) return;
  await request.patch(
    `${SUPABASE_URL}/rest/v1/venues?id=eq.${VENUE_ID}`,
    {
      headers: {
        apikey:          SUPABASE_ANON_KEY,
        Authorization:   `Bearer ${token}`,
        "Content-Type":  "application/json",
        Prefer:          "return=minimal",
      },
      data: { whatsapp_template: original },
    }
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

// Known default template from the seed — used as a fallback if the DB
// was left with NULL by a previous failed test run.
const DEFAULT_TEMPLATE =
  "Hola {nombre}! Tu turno en {cancha} está confirmado para el {dia} a las {hora}. Para cancelar: {link}";

let originalTemplate: string | null = null;

test.beforeAll(async ({ request }) => {
  const dbTemplate = await getTemplate(request);
  // If the DB has null (from a previous run that didn't restore), use the known default
  originalTemplate = dbTemplate ?? DEFAULT_TEMPLATE;
  await unblockTestPhones(request, [SETTINGS_PHONE]);
  await blockPhone(request, SETTINGS_PHONE);
});

test.afterAll(async ({ request }) => {
  await restoreTemplate(request, originalTemplate);
  await unblockTestPhones(request, [SETTINGS_PHONE]);
});

// ---------------------------------------------------------------------------
// 1. WhatsApp template editor loads
// ---------------------------------------------------------------------------

test("venue edit page shows whatsapp_template textarea", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}`);
  await page.waitForLoadState("networkidle");

  await expect(page.locator('textarea[name="whatsapp_template"]')).toBeVisible();
  // Variable hint badges (the <code> elements, not the textarea placeholder)
  await expect(page.locator("code").filter({ hasText: "{nombre}" })).toBeVisible();
  await expect(page.locator("code").filter({ hasText: "{cancha}" })).toBeVisible();
});

// ---------------------------------------------------------------------------
// 2. Live preview renders when template is typed
// ---------------------------------------------------------------------------

test("whatsapp template live preview shows substituted text", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}`);
  await page.waitForLoadState("networkidle");

  const textarea = page.locator('textarea[name="whatsapp_template"]');
  await textarea.fill("Hola {nombre}, tu turno es el {dia} a las {hora}.");

  // Preview section should appear with substituted values
  await expect(page.getByText("Vista previa:")).toBeVisible();
  await expect(page.getByText(/Hola Juan Pérez/)).toBeVisible();
});

// ---------------------------------------------------------------------------
// 3. Saving template persists to DB
// ---------------------------------------------------------------------------

test("saving whatsapp template persists the value", async ({ page, request }) => {
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}`);
  await page.waitForLoadState("networkidle");

  const newTemplate = "Test template {nombre} — settings spec";
  const textarea = page.locator('textarea[name="whatsapp_template"]');
  await textarea.fill(newTemplate);

  await page.getByRole("button", { name: /guardar cambios/i }).click();
  // After save, the action redirects to /panel/complejos
  await page.waitForURL(/\/panel\/complejos$/, { timeout: 10_000 });

  // Verify the value was persisted
  const saved = await getTemplate(request);
  expect(saved).toBe(newTemplate);
});

// ---------------------------------------------------------------------------
// 4. Blocked phones page loads and shows the test phone
// ---------------------------------------------------------------------------

test("blocked phones page lists blocked numbers", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}/bloqueados`);
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("Teléfonos bloqueados")).toBeVisible();
  await expect(page.getByText(SETTINGS_PHONE)).toBeVisible();
});

// ---------------------------------------------------------------------------
// 5. Unblocking a phone removes it from the list
// ---------------------------------------------------------------------------

test("unblocking a phone removes it from the blocked list", async ({ page, request }) => {
  // Ensure the phone is blocked before the test (re-block in case a previous run unblocked it)
  await blockPhone(request, SETTINGS_PHONE);

  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}/bloqueados`);
  await page.waitForLoadState("networkidle");

  await expect(page.getByText(SETTINGS_PHONE)).toBeVisible();

  // Find the row and click Desbloquear
  const row = page.locator("li").filter({ hasText: SETTINGS_PHONE });
  await row.getByRole("button", { name: /desbloquear/i }).click();

  // The row should disappear after unblock
  await expect(page.getByText(SETTINGS_PHONE)).not.toBeVisible({ timeout: 8_000 });
});
