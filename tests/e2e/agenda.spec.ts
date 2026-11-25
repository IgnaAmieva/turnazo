/**
 * E2E tests for the panel agenda (Bloque 2).
 * Requires the owner to be logged in.
 */
import { test, expect } from "@playwright/test";
import {
  collectPageErrors,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  VENUE_ID,
  SUPABASE_URL,
  nextWeekday,
  serviceHeaders,
  createTestBooking,
  deleteTestBookings,
  deleteTestOutboxRows,
} from "./helpers";

// ---------------------------------------------------------------------------
// Login helper (no-op when storageState already has auth)
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

// Use a future weekday so bookings won't conflict with today's data
const AGENDA_DATE = nextWeekday(3, 7); // Wednesday at least 7 days ahead

// ---------------------------------------------------------------------------
// Cleanup: cancel any confirmed test blocks after each test run
// (prevents EXCLUDE constraint violations on repeated runs)
// ---------------------------------------------------------------------------
test.afterAll(async ({ request }) => {
  await deleteTestBookings(request, ["E2E block*"]);
  await deleteTestOutboxRows(request);
});

// ---------------------------------------------------------------------------
// /panel/agenda redirects to the venue's agenda
// ---------------------------------------------------------------------------
test("panel/agenda redirects to venue agenda when owner has one venue", async ({ page }) => {
  const errors = collectPageErrors(page);
  await loginAsOwner(page);
  await page.goto("/panel/agenda");
  await page.waitForLoadState("networkidle");

  expect(page.url()).toContain(`/panel/complejos/${VENUE_ID}/agenda`);
  expect(errors).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Venue agenda loads and shows the grid
// ---------------------------------------------------------------------------
test("venue agenda page loads: days, summary and court tabs", async ({ page }) => {
  const errors = collectPageErrors(page);
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}/agenda?fecha=${AGENDA_DATE}`);
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("dia").first()).toBeVisible();
  await expect(page.getByTestId("resumen")).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "Canchas" });
  await expect(tabs.getByRole("tab", { name: /^Cancha 1 · \d+$/ })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Todas" })).toBeVisible();

  expect(errors).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Date navigation changes the date in the URL
// ---------------------------------------------------------------------------
test("tapping another day updates the URL date", async ({ page }) => {
  const errors = collectPageErrors(page);
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}/agenda?fecha=${AGENDA_DATE}`);
  await page.waitForLoadState("networkidle");

  await page.getByTestId("dia").filter({ hasText: "Hoy" }).click();
  await page.waitForURL(
    (url) => url.searchParams.get("fecha") !== AGENDA_DATE,
    { timeout: 5_000 }
  );

  const url = new URL(page.url());
  const newDate = url.searchParams.get("fecha");
  expect(newDate).toBeTruthy();
  expect(newDate).not.toBe(AGENDA_DATE);

  expect(errors).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Manual block creation
// ---------------------------------------------------------------------------
test("can create a manual block on a court", async ({ page }) => {
  const errors = collectPageErrors(page);
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}/agenda?fecha=${AGENDA_DATE}`);
  await page.waitForLoadState("networkidle");

  // "+ Nuevo turno" → "Bloquear horario" (la cancha propuesta es la del primer libre: Cancha 1)
  await page.getByRole("button", { name: /nuevo turno/i }).click();
  await page.getByRole("dialog", { name: "Nuevo turno" }).getByRole("radio", { name: "Bloquear horario" }).click();

  // Use hour derived from current time to avoid EXCLUDE constraint conflicts
  // Changes every hour → 15 non-overlapping 1-hour slots (08:00-22:00)
  const startHour = 8 + (Math.floor(Date.now() / 3_600_000) % 15);
  const startVal  = `${AGENDA_DATE}T${String(startHour).padStart(2, "0")}:00`;
  const endVal    = `${AGENDA_DATE}T${String(startHour + 1).padStart(2, "0")}:00`;
  const noteLabel = `E2E block ${startHour}h`;

  await page.locator('input[name="start"]').fill(startVal);
  await page.locator('input[name="end"]').fill(endVal);
  await page.locator('input[name="note"]').fill(noteLabel);

  await page.getByRole("button", { name: /guardar bloqueo/i }).click();

  // Block should appear in the grid after page refresh
  await expect(page.getByText(new RegExp(noteLabel, "i"))).toBeVisible({ timeout: 12_000 });

  expect(errors).toHaveLength(0);
  // Note: afterAll will cancel all E2E test blocks via the Supabase REST API
});

// ---------------------------------------------------------------------------
// Cancelled bookings are not listed: their slot shows as free again
// ---------------------------------------------------------------------------
test("cancelled bookings are not listed; their slot is free again", async ({ page, request }) => {
  const errors = collectPageErrors(page);
  // Otro día que el del bloqueo de arriba (ese puede caer a cualquier hora)
  const date = nextWeekday(5, 8);
  const id = await createTestBooking(request, date, 18, 30, "E2E block cancelado", "2622000444");
  expect(id).toBeTruthy();
  await request.patch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${id}`, { headers: serviceHeaders(), data: { status: "cancelled" } });

  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}/agenda?fecha=${date}`);
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("resumen")).toBeVisible();
  await expect(page.getByText("E2E block cancelado")).toHaveCount(0);
  await expect(page.locator('[data-testid="turno-libre"][data-inicio="18:30"]')).toBeVisible();
  expect(errors).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Agenda page with unowned venue ID → 404
// ---------------------------------------------------------------------------
test("venue agenda with unowned venue ID returns 404 or redirects to login", async ({ page }) => {
  const response = await page.goto(
    `/panel/complejos/00000000-0000-0000-0000-000000000000/agenda`
  );
  const url = page.url();
  expect(url.includes("/login") || (response?.status() === 404)).toBe(true);
});
