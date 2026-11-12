/**
 * E2E tests: each booking management action in the owner panel
 * must write a row to audit_log.
 *
 * Uses Thursday 3+ weeks ahead to avoid slot conflicts with other test suites.
 * Each test has its own slot (90-min grid from 08:00) and phone number.
 */
import { test, expect } from "@playwright/test";
import {
  OWNER_EMAIL,
  OWNER_PASSWORD,
  VENUE_ID,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  nextWeekday,
  getOwnerToken,
  createTestBooking,
  deleteTestBookings,
  unblockTestPhones,
} from "./helpers";

// Thursday, at least 3 weeks out — isolated from agenda.spec.ts (Wednesday)
const AUDIT_DATE = nextWeekday(4, 21);

// 90-min slots aligned with 08:00 open_time, one phone per test
const SLOTS = {
  cancel:     { hour: 8,  min: 0,  phone: "2615001001", name: "Audit Test Cancel"     },
  markPaid:   { hour: 9,  min: 30, phone: "2615001002", name: "Audit Test MarkPaid"   },
  noShow:     { hour: 11, min: 0,  phone: "2615001003", name: "Audit Test NoShow"     },
  blockPhone: { hour: 12, min: 30, phone: "2615001004", name: "Audit Test BlockPhone" },
};

const TEST_PHONES = Object.values(SLOTS).map((s) => s.phone);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loginAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.fill('[name="email"]', OWNER_EMAIL);
  await page.fill('[name="password"]', OWNER_PASSWORD);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

async function countAuditRows(
  request: import("@playwright/test").APIRequestContext,
  token:   string,
  action:  string,
  entity:  string,
): Promise<number> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/audit_log?venue_id=eq.${VENUE_ID}&entity=eq.${entity}&action=eq.${action}&select=id`,
    {
      headers: {
        apikey:        SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        Prefer:        "count=exact",
      },
    }
  );
  const cr = res.headers()["content-range"] ?? "*/0";
  return parseInt(cr.split("/")[1] ?? "0", 10) || 0;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

test.beforeAll(async ({ request }) => {
  // Remove any leftovers from previous runs before creating fresh bookings
  await deleteTestBookings(request, ["Audit Test*"]);
  await unblockTestPhones(request, TEST_PHONES);

  for (const slot of Object.values(SLOTS)) {
    const id = await createTestBooking(request, AUDIT_DATE, slot.hour, slot.min, slot.name, slot.phone);
    if (!id) throw new Error(`Failed to create test booking for slot ${slot.hour}:${slot.min} (${slot.name})`);
  }
});

test.afterAll(async ({ request }) => {
  await deleteTestBookings(request, ["Audit Test*"]);
  await unblockTestPhones(request, TEST_PHONES);
});

// ---------------------------------------------------------------------------
// 1. Cancel booking
// ---------------------------------------------------------------------------

test("cancel booking writes audit_log row (entity=booking, action=cancel)", async ({ page, request }) => {
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}/agenda?fecha=${AUDIT_DATE}`);
  await page.waitForLoadState("networkidle");

  const token  = await getOwnerToken(request);
  const before = await countAuditRows(request, token!, "cancel", "booking");

  // Click the booking card to expand, then cancel
  await page.getByText(SLOTS.cancel.name).first().click();
  await expect(page.getByRole("button", { name: /cancelar turno/i })).toBeVisible({ timeout: 3_000 });
  await page.getByRole("button", { name: /cancelar turno/i }).click();
  await page.waitForTimeout(2_000);

  const tokenAfter = await getOwnerToken(request);
  const after      = await countAuditRows(request, tokenAfter!, "cancel", "booking");
  expect(after).toBeGreaterThan(before);
});

// ---------------------------------------------------------------------------
// 2. Mark paid
// ---------------------------------------------------------------------------

test("mark paid writes audit_log row (entity=booking, action=mark_paid)", async ({ page, request }) => {
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}/agenda?fecha=${AUDIT_DATE}`);
  await page.waitForLoadState("networkidle");

  const token  = await getOwnerToken(request);
  const before = await countAuditRows(request, token!, "mark_paid", "booking");

  await page.getByText(SLOTS.markPaid.name).first().click();
  await expect(page.getByRole("button", { name: /marcar pagado/i })).toBeVisible({ timeout: 3_000 });
  await page.getByRole("button", { name: /marcar pagado/i }).click();
  await page.waitForTimeout(2_000);

  const tokenAfter = await getOwnerToken(request);
  const after      = await countAuditRows(request, tokenAfter!, "mark_paid", "booking");
  expect(after).toBeGreaterThan(before);
});

// ---------------------------------------------------------------------------
// 3. Mark no-show
// ---------------------------------------------------------------------------

test("mark no-show writes audit_log row (entity=booking, action=mark_no_show)", async ({ page, request }) => {
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}/agenda?fecha=${AUDIT_DATE}`);
  await page.waitForLoadState("networkidle");

  const token  = await getOwnerToken(request);
  const before = await countAuditRows(request, token!, "mark_no_show", "booking");

  await page.getByText(SLOTS.noShow.name).first().click();
  await expect(page.getByRole("button", { name: /marcar ausente/i })).toBeVisible({ timeout: 3_000 });
  await page.getByRole("button", { name: /marcar ausente/i }).click();
  await page.waitForTimeout(2_000);

  const tokenAfter = await getOwnerToken(request);
  const after      = await countAuditRows(request, tokenAfter!, "mark_no_show", "booking");
  expect(after).toBeGreaterThan(before);
});

// ---------------------------------------------------------------------------
// 4. Block phone
// ---------------------------------------------------------------------------

test("block phone writes audit_log row (entity=blocked_phone, action=create)", async ({ page, request }) => {
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}/agenda?fecha=${AUDIT_DATE}`);
  await page.waitForLoadState("networkidle");

  const token  = await getOwnerToken(request);
  const before = await countAuditRows(request, token!, "create", "blocked_phone");

  await page.getByText(SLOTS.blockPhone.name).first().click();
  await expect(page.getByRole("button", { name: /bloquear teléfono/i })).toBeVisible({ timeout: 3_000 });
  await page.getByRole("button", { name: /bloquear teléfono/i }).click();
  await page.waitForTimeout(2_000);

  const tokenAfter = await getOwnerToken(request);
  const after      = await countAuditRows(request, tokenAfter!, "create", "blocked_phone");
  expect(after).toBeGreaterThan(before);
});

// ---------------------------------------------------------------------------
// 5. Create manual block
// ---------------------------------------------------------------------------

test("create manual block writes audit_log row (entity=booking, action=create_block)", async ({ page, request }) => {
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}/agenda?fecha=${AUDIT_DATE}`);
  await page.waitForLoadState("networkidle");

  const token  = await getOwnerToken(request);
  const before = await countAuditRows(request, token!, "create_block", "booking");

  // Use a slot not occupied by any other test booking (14:00 Mendoza, 90 min)
  const startVal = `${AUDIT_DATE}T14:00`;
  const endVal   = `${AUDIT_DATE}T15:30`;

  await page.locator("button[title='Agregar bloqueo']").first().click();
  await expect(page.getByText("Nuevo bloqueo")).toBeVisible();
  await page.locator('input[name="start"]').fill(startVal);
  await page.locator('input[name="end"]').fill(endVal);
  await page.locator('input[name="note"]').fill("Audit Test Block");
  await page.getByRole("button", { name: /guardar bloqueo/i }).click();
  await page.waitForTimeout(2_000);

  const tokenAfter = await getOwnerToken(request);
  const after      = await countAuditRows(request, tokenAfter!, "create_block", "booking");
  expect(after).toBeGreaterThan(before);
});
