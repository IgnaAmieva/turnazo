/**
 * Aclaraciones de la cancha (027): campo opcional de 200 caracteres en la
 * carga de cancha; se muestran en la portada del complejo, en la hoja de
 * reserva y en /reservar, ESCAPADAS como texto (sin HTML).
 *
 * Usa la cancha de prueba y al final le deja notes = NULL, como estaba.
 * No reserva nada: solo abre la hoja.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { VENUE_ID, COURT_ID, VENUE_PATH, SUPABASE_URL, serviceHeaders, nextWeekday, slotParams, contrastOf } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
test.describe.configure({ mode: "serial" });

const NOTES = "<b>Piso</b> de baldosa & red nueva <img src=x onerror=alert(1)>";
const FECHA = nextWeekday(2, 9);   // martes, 9+ días

const resetNotes = (request: APIRequestContext) =>
  request.patch(`${SUPABASE_URL}/rest/v1/courts?id=eq.${COURT_ID}`, { headers: serviceHeaders(), data: { notes: null } });

test.beforeAll(async ({ request }) => { await resetNotes(request); });
test.afterAll(async ({ request }) => {
  await resetNotes(request);
  await request.delete(`${SUPABASE_URL}/rest/v1/audit_log?entity_id=eq.${COURT_ID}&new_data->>notes=not.is.null`, { headers: serviceHeaders() });
});

test("panel: 'Aclaraciones (opcional)' con contador y tope de 200; se guarda", async ({ page }) => {
  await page.goto(`/panel/complejos/${VENUE_ID}/canchas/${COURT_ID}`);
  const field = page.getByLabel("Aclaraciones (opcional)");
  await expect(field).toHaveAttribute("maxlength", "200");
  await field.fill("x".repeat(250));                  // el navegador corta en 200
  await expect(field).toHaveValue("x".repeat(200));
  await expect(page.getByTestId("notas-contador")).toHaveText("200/200");

  await field.fill(NOTES);
  await expect(page.getByTestId("notas-contador")).toHaveText(`${NOTES.length}/200`);
  await page.getByRole("button", { name: "Guardar info" }).click();
  await expect(page.getByTestId("guardado")).toHaveText("Guardado");
  await page.reload();
  await expect(page.getByLabel("Aclaraciones (opcional)")).toHaveValue(NOTES);
});

test.describe("público", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("portada del complejo y hoja de reserva: el texto tal cual, sin HTML", async ({ page }) => {
    let dialogs = 0;
    page.on("dialog", (d) => { dialogs++; void d.dismiss(); });
    await page.goto(`${VENUE_PATH}?fecha=${FECHA}&c=${COURT_ID}`);

    const cover = page.getByTestId("aclaraciones");
    await expect(cover).toHaveText(`Aclaraciones: ${NOTES}`);
    await expect(cover.locator("b, img")).toHaveCount(0);   // escapado: no se arma ningún elemento

    await page.getByTestId("slot-free").first().click();
    await page.getByTestId("barra-reservar").getByRole("button", { name: "Reservar" }).click();
    const sheet = page.getByTestId("hoja-reserva");
    await expect(sheet.getByTestId("aclaraciones")).toHaveText(`Aclaraciones: ${NOTES}`);
    await expect(sheet.locator("[data-testid=aclaraciones] b, [data-testid=aclaraciones] img")).toHaveCount(0);
    expect(dialogs).toBe(0);
  });

  test("/reservar también las muestra, escapadas", async ({ page }) => {
    const p = slotParams(FECHA, 11, 90);
    await page.goto(`${VENUE_PATH}/reservar?cancha=${COURT_ID}&inicio=${p.inicio}&fin=${p.fin}&fecha=${p.fecha}`);
    const notes = page.getByTestId("aclaraciones");
    await expect(notes).toHaveText(`Aclaraciones: ${NOTES}`);
    await expect(notes.locator("b, img")).toHaveCount(0);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`contraste AA de las aclaraciones (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`${VENUE_PATH}?fecha=${FECHA}&c=${COURT_ID}`);
      expect(await contrastOf(page.getByTestId("aclaraciones"))).toBeGreaterThanOrEqual(4.5);
    });
  }
});

test("sin aclaraciones no se muestra nada", async ({ page, request }) => {
  await resetNotes(request);
  await page.goto(`${VENUE_PATH}?fecha=${FECHA}&c=${COURT_ID}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("aclaraciones")).toHaveCount(0);
});
