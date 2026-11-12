/**
 * E2E tests for public routes.
 * Verifies pages load without server errors, console errors, or
 * "Event handlers cannot be passed to Client Component props" crashes.
 */
import { test, expect } from "@playwright/test";
import {
  collectPageErrors,
  nextWeekday,
  slotParams,
  VENUE_ID,
  COURT_ID,
  LOCALITY,
  SPORT,
  VENUE_PATH,
  deleteTestBookings,
} from "./helpers";

test.afterAll(async ({ request }) => {
  await deleteTestBookings(request, ["Test E2E"]);
});

// ---------------------------------------------------------------------------
// Helper: assert no server-rendered error overlay or uncaught JS exception
// ---------------------------------------------------------------------------
async function assertNoError(page: ReturnType<typeof test["info"]> extends never ? never : import("@playwright/test").Page) {
  // Next.js dev overlay has this text when there's a server component error
  const errorOverlay = page.locator("body").getByText(
    "Event handlers cannot be passed to Client Component props",
    { exact: false }
  );
  await expect(errorOverlay).not.toBeVisible();

  // Also look for generic Next.js error UI
  const nextErrorHeading = page.locator("[data-nextjs-container-errors]");
  await expect(nextErrorHeading).not.toBeAttached();
}

// ---------------------------------------------------------------------------
// Home page
// ---------------------------------------------------------------------------
test("home page shows localities with venue counts", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await assertNoError(page);
  expect(errors).toHaveLength(0);

  // Tunuyán should appear as a link (has 1 venue)
  await expect(page.getByRole("link", { name: /tunuy/i })).toBeVisible();
  // Should show venue count
  await expect(page.getByText("1 complejo")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Locality page
// ---------------------------------------------------------------------------
test("/tunuyan shows sports with correct counts", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto(`/${LOCALITY}`);
  await page.waitForLoadState("networkidle");
  await assertNoError(page);
  expect(errors).toHaveLength(0);

  // Pádel (1 venue) should be a link
  await expect(page.getByRole("link", { name: /pádel/i })).toBeVisible();
  await expect(page.getByText("1 complejo")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Venue list — the page that was broken (onClick on <a> in Server Component)
// ---------------------------------------------------------------------------
test("/tunuyan/padel loads without errors", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto(`/${LOCALITY}/${SPORT}`);
  await page.waitForLoadState("networkidle");
  await assertNoError(page);
  expect(errors).toHaveLength(0);

  // The venue should appear
  await expect(page.getByText("Complejo Padelero Tunuyán")).toBeVisible();
  // "Cómo llegar" link must exist without crashing
  await expect(page.getByRole("link", { name: /cómo llegar/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Venue detail (calendar)
// ---------------------------------------------------------------------------
test("venue detail page loads courts", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto(VENUE_PATH);
  await page.waitForLoadState("networkidle");
  await assertNoError(page);
  expect(errors).toHaveLength(0);

  await expect(page.getByRole("heading", { name: "Complejo Padelero Tunuyán" })).toBeVisible();
  // At least one court section should render
  await expect(page.getByText(/cancha/i).first()).toBeVisible();
});

// ---------------------------------------------------------------------------
// Booking page — invalid params → notFound (no crash)
// ---------------------------------------------------------------------------
test("booking page with missing params returns 404 gracefully", async ({ page }) => {
  // Missing required params → Next.js notFound()
  const response = await page.goto(`${VENUE_PATH}/reservar`);
  expect(response?.status()).toBe(404);
});

// ---------------------------------------------------------------------------
// Full booking flow: pick slot → fill form → confirm → cancel
// ---------------------------------------------------------------------------
test("full booking flow: select slot, book, cancel", async ({ page }) => {
  const errors = collectPageErrors(page);
  const allRequests: string[] = [];
  let postHeaders: Record<string, string> = {};
  let postResponseBody = "";
  page.on("request", (r) => {
    allRequests.push(`→ ${r.method()} ${r.url()}`);
    if (r.method() === "POST") postHeaders = r.headers();
  });
  page.on("response", async (r) => {
    allRequests.push(`← ${r.status()} ${r.url()}`);
    if (r.request().method() === "POST" && r.url().includes("/reservar")) {
      try { postResponseBody = (await r.text()).slice(0, 500); } catch {}
    }
  });

  // Pick next Monday (weekday 1) which has hours 08-23
  const fecha = nextWeekday(1, 2); // at least 2 days ahead
  const { inicio, fin } = slotParams(fecha, 11, 90); // 11:00–12:30 Mendoza (aligned with 90-min slots from 08:00)

  const url =
    `${VENUE_PATH}/reservar` +
    `?cancha=${COURT_ID}&fecha=${fecha}&inicio=${encodeURIComponent(inicio)}&fin=${encodeURIComponent(fin)}`;

  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await assertNoError(page);

  // The booking summary should be visible
  await expect(page.getByRole("heading", { name: "Confirmar reserva" })).toBeVisible();
  await expect(page.getByText("Cancha 1")).toBeVisible();

  // Wait for React to fully hydrate the form (formAction becomes a bound function).
  // We detect this by waiting for the submit button to have a React fiber attached.
  await page.waitForFunction(() => {
    const btn = document.querySelector('button[type="submit"]');
    if (!btn) return false;
    // React 18/19 attaches __reactFiber or __reactProps to DOM nodes after hydration
    return Object.keys(btn).some((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps"));
  }, { timeout: 15_000 });

  // Check for JS errors that might have occurred during hydration
  if (errors.length > 0) {
    throw new Error(`JS errors during hydration: ${errors.join("; ")}`);
  }

  // Verify the form is set up with a server action (not defaulting to GET)
  const formMethod = await page.locator('form').getAttribute('method');
  const formActionAttr = await page.locator('form').getAttribute('action');
  // In Next.js 16, the form action is either null (React handles it) or a server-action path
  // The important thing is that it's NOT the page URL (which would cause a GET reload)
  expect(formActionAttr).not.toContain('/reservar');

  // Fill and submit the form
  await page.locator('[name="customer_name"]').fill("Test E2E");
  await page.locator('[name="customer_phone"]').fill("2622 999999");

  // Assert fill worked before clicking
  await expect(page.locator('[name="customer_name"]')).toHaveValue("Test E2E");
  await expect(page.locator('[name="customer_phone"]')).toHaveValue("2622 999999");

  // Scroll the submit button into view in case the Next.js Dev Tools toolbar is blocking it
  const submitBtn = page.getByRole("button", { name: /confirmar reserva/i });
  await submitBtn.scrollIntoViewIfNeeded();

  // Start waiting for navigation BEFORE clicking (RSC redirect arrives as a soft nav)
  const navPromise = page.waitForURL((url) => !url.pathname.includes('/reservar'), { timeout: 25_000 });
  await submitBtn.click({ force: true });
  try {
    await navPromise;
  } catch (e) {
    const reqs = allRequests.slice(-30).join("\n") || "(none)";
    const hasNextAction = !!postHeaders['next-action'];
    throw new Error(`No navigation after submit.\nAction response body: ${postResponseBody}\nForm action attr: "${formActionAttr}"\nNext-Action header: ${hasNextAction}\nErrors: ${errors.join('; ')}\n\nOriginal: ${e}`);
  }
  await assertNoError(page);
  expect(errors).toHaveLength(0);

  // The turno page should show "Confirmado"
  await expect(page.getByText(/confirmado/i)).toBeVisible();
  await expect(page.getByText("Test E2E")).toBeVisible();

  // Cancel the booking — after cancel the page re-renders via RSC showing the cancelled state
  await page.getByRole("button", { name: /cancelar turno/i }).click();
  await expect(page.getByText(/este turno fue cancelado/i)).toBeVisible({ timeout: 10_000 });
  expect(errors).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Turnos page with invalid token → shows "no encontrado" gracefully
// ---------------------------------------------------------------------------
test("/turnos/invalid-token shows not-found message", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/turnos/token-invalido-123");
  await page.waitForLoadState("networkidle");
  await assertNoError(page);
  expect(errors).toHaveLength(0);
  await expect(page.getByText(/turno no encontrado/i)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Locality with no venues shows empty state
// ---------------------------------------------------------------------------
test("/la-consulta shows empty state (no venues)", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/la-consulta");
  await page.waitForLoadState("networkidle");
  await assertNoError(page);
  expect(errors).toHaveLength(0);
  await expect(page.getByText(/sin complejos|no hay complejos/i)).toBeVisible();
});
