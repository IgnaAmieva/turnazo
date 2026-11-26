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
  serviceHeaders,
  unblockTestPhones,
  contrastOf, waitIdle } from "./helpers";

// Phone used exclusively by this test file
const SETTINGS_PHONE = "2615009001";

// ---------------------------------------------------------------------------
// Helpers
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

/** Block a phone directly via REST for setup (service_role). */
async function blockPhone(
  request: import("@playwright/test").APIRequestContext,
  phone: string,
): Promise<void> {
  await request.post(`${SUPABASE_URL}/rest/v1/blocked_phones`, {
    headers: { ...serviceHeaders(), Prefer: "resolution=merge-duplicates" },
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
  // Si la base quedó con null o con un valor de prueba de este archivo (corridas
  // viejas lo dejaban como "original" y lo volvían a poner), se restaura el del seed
  const leftover = !dbTemplate || /settings spec|^Hola \{nombre\}, te esperamos a las \{hora\}\.$/.test(dbTemplate);
  originalTemplate = leftover ? DEFAULT_TEMPLATE : dbTemplate;
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

const DEFAULT_MSG = "¡Hola {nombre}! Tu turno en {cancha} el {dia} a las {hora} está confirmado. Total: {total}. ¡Te esperamos!";
const value = (page: import("@playwright/test").Page) => page.locator('input[name="whatsapp_template"]').inputValue();

test("plantilla: variables como pastillas, botones de 44 px y mensaje por defecto en un complejo nuevo", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}`);
  const editor = page.getByTestId("wa-editor");
  await expect(editor).toBeVisible();
  await expect(page.locator("textarea[name=whatsapp_template]")).toHaveCount(0);
  // Las {variables} se ven como pastillas con su nombre, sin llaves
  await expect(editor.locator("[data-var=nombre]")).toHaveText("Nombre");
  expect(await editor.innerText()).not.toContain("{nombre}");

  const chips = page.getByTestId("wa-variable");
  await expect(chips).toHaveText(["+ Nombre", "+ Cancha", "+ Día", "+ Hora", "+ Total"]);
  for (const c of [...await chips.all(), page.getByTestId("wa-original")]) {
    expect((await c.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }

  // Complejo nuevo: viene cargado el mensaje armado
  await page.goto("/panel/complejos/nuevo");
  expect(await value(page)).toBe(DEFAULT_MSG);
  await expect(page.getByTestId("wa-vista-previa")).toContainText("¡Hola Juan Pérez! Tu turno en Cancha 1");
});

test("plantilla: el botón inserta en el cursor (o al final), una tecla borra la pastilla entera, 'Volver al mensaje original'", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}`);
  const editor = page.getByTestId("wa-editor");

  await page.getByTestId("wa-original").click();
  expect(await value(page)).toBe(DEFAULT_MSG);

  // Sin cursor en el editor: al final
  await page.getByTestId("wa-variable").filter({ hasText: "Cancha" }).click();
  expect(await value(page)).toBe(`${DEFAULT_MSG}{cancha}`);

  // Una sola tecla borra la pastilla entera (el cursor quedó justo después)
  await page.keyboard.press("Backspace");
  expect(await value(page)).toBe(DEFAULT_MSG);

  // Con el cursor al principio: ahí
  await editor.click();
  await page.keyboard.press("Control+Home");
  await page.getByTestId("wa-variable").filter({ hasText: "Hora" }).click();
  expect(await value(page)).toBe(`{hora}${DEFAULT_MSG}`);
  await page.keyboard.type(" — ");
  expect(await value(page)).toBe(`{hora} — ${DEFAULT_MSG}`);

  // Escribir {total} a mano también vale (al salir se ve como pastilla)
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" {total}");
  await page.getByRole("heading", { level: 1 }).click();
  await expect(editor.locator("[data-var=total]")).toHaveCount(2);
  expect(await value(page)).toBe(`{hora} — ${DEFAULT_MSG} {total}`);

  await page.getByTestId("wa-original").click();
  expect(await value(page)).toBe(DEFAULT_MSG);
  await expect(editor.locator("[data-var]")).toHaveCount(5);
});

for (const scheme of ["light", "dark"] as const) {
  test(`plantilla: contraste AA de pastillas, botones y vista previa (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await loginAsOwner(page);
    await page.goto(`/panel/complejos/${VENUE_ID}`);
    for (const el of [
      page.getByTestId("wa-editor").locator("[data-var]").first(),
      ...await page.getByTestId("wa-variable").all(),
      page.getByTestId("wa-original"),
      page.getByTestId("wa-vista-previa").locator("p").last(),
    ]) {
      expect(await contrastOf(el)).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test("plantilla: vista previa con datos de ejemplo y se guarda como texto con {variables}", async ({ page, request }) => {
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}`);
  const editor = page.getByTestId("wa-editor");

  // Reemplazar todo y armar "Hola <Nombre>, te esperamos a las <Hora>."
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.type("Hola ");
  await page.getByTestId("wa-variable").filter({ hasText: "Nombre" }).click();
  await page.keyboard.type(", te esperamos a las ");
  await page.getByTestId("wa-variable").filter({ hasText: "Hora" }).click();
  await page.keyboard.type(".");

  const expected = "Hola {nombre}, te esperamos a las {hora}.";
  expect(await value(page)).toBe(expected);
  await expect(page.getByTestId("wa-vista-previa")).toContainText("Hola Juan Pérez, te esperamos a las 10:00–11:30.");

  await page.getByRole("button", { name: /guardar cambios/i }).click();
  await page.waitForURL(/\/panel\/complejos$/, { timeout: 10_000 });
  expect(await getTemplate(request)).toBe(expected);
});

// ---------------------------------------------------------------------------
// 4. Blocked phones page loads and shows the test phone
// ---------------------------------------------------------------------------

test("blocked phones page lists blocked numbers", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto(`/panel/complejos/${VENUE_ID}/bloqueados`);
  await waitIdle(page);

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
  await waitIdle(page);

  await expect(page.getByText(SETTINGS_PHONE)).toBeVisible();

  // Find the row and click Desbloquear
  const row = page.locator("li").filter({ hasText: SETTINGS_PHONE });
  await row.getByRole("button", { name: /desbloquear/i }).click();

  // The row should disappear after unblock
  await expect(page.getByText(SETTINGS_PHONE)).not.toBeVisible({ timeout: 8_000 });
});
