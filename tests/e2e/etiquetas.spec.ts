/**
 * Migración 023 en la app: el dueño carga superficie y los tres interruptores
 * en el formulario de la cancha (complejo de prueba), y la lista y la portada
 * del complejo muestran "Sintético · Techada · Iluminada". Sin nada cargado,
 * "2 canchas · turnos de 90 min". Al final se deja la cancha como estaba.
 */
import { test, expect } from "@playwright/test";
import { VENUE_ID, COURT_ID, VENUE_PATH, LOCALITY, SPORT, SUPABASE_URL, serviceHeaders, contrastOf, MORNING_NOW } from "./helpers";

const FEATURES = "surface,covered,lit,has_locker_room";
let original: Record<string, unknown> = {};

async function courtFeatures(request: import("@playwright/test").APIRequestContext) {
  const r = await request.get(`${SUPABASE_URL}/rest/v1/courts?id=eq.${COURT_ID}&select=${FEATURES}`, { headers: serviceHeaders() });
  return (await r.json())[0] as Record<string, unknown>;
}

test.beforeAll(async ({ request }) => {
  original = await courtFeatures(request);
});

test.afterAll(async ({ request }) => {
  await request.patch(`${SUPABASE_URL}/rest/v1/courts?id=eq.${COURT_ID}`, { headers: serviceHeaders(), data: original });
  await request.delete(`${SUPABASE_URL}/rest/v1/audit_log?venue_id=eq.${VENUE_ID}&entity=eq.court&entity_id=eq.${COURT_ID}&action=eq.update`, { headers: serviceHeaders() });
});

test("sin etiquetas cargadas, la tarjeta y la portada dicen cuántas canchas y la duración", async ({ page, request }) => {
  await request.patch(`${SUPABASE_URL}/rest/v1/courts?venue_id=eq.${VENUE_ID}`, {
    headers: serviceHeaders(), data: { surface: null, covered: false, lit: false, has_locker_room: false },
  });
  await page.goto(`/${LOCALITY}/${SPORT}?_now=${MORNING_NOW}`);
  const card = page.getByTestId("complejo").filter({ hasText: "Complejo Padelero Tunuyán" });
  await expect(card.getByTestId("etiquetas")).toHaveText(/^\d+ canchas? · turnos de 90 min$/);
  await page.goto(VENUE_PATH);
  await expect(page.getByTestId("portada-complejo").getByTestId("etiquetas")).toHaveText(/^Pádel · \d+ canchas? · turnos de 90 min$/);
});

test("el dueño carga superficie e interruptores; la lista y la portada muestran las etiquetas", async ({ page, request }) => {
  await page.goto(`/panel/complejos/${VENUE_ID}/canchas/${COURT_ID}`);
  await page.getByLabel("Superficie").selectOption({ label: "Sintético" });
  for (const name of ["Techada", "Iluminada"]) {
    const sw = page.getByRole("switch", { name });
    const label = page.locator("label", { has: sw });
    expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await label.click();
    await expect(sw).toBeChecked();
  }
  await expect(page.getByRole("switch", { name: "Vestuario" })).not.toBeChecked();
  await page.getByRole("button", { name: "Guardar info" }).click();
  await expect.poll(() => courtFeatures(request)).toEqual({ surface: "sintetico", covered: true, lit: true, has_locker_room: false });

  // Al volver a entrar, el formulario muestra lo guardado
  await page.reload();
  await expect(page.getByLabel("Superficie")).toHaveValue("sintetico");
  await expect(page.getByRole("switch", { name: "Techada" })).toBeChecked();

  await page.goto(`/${LOCALITY}/${SPORT}?_now=${MORNING_NOW}`);
  const card = page.getByTestId("complejo").filter({ hasText: "Complejo Padelero Tunuyán" });
  await expect(card.getByTestId("etiquetas")).toHaveText("Sintético · Techada · Iluminada");
  expect(await contrastOf(card.getByTestId("etiquetas"))).toBeGreaterThanOrEqual(4.5);

  await page.goto(VENUE_PATH);
  await expect(page.getByTestId("portada-complejo").getByTestId("etiquetas")).toHaveText("Pádel · Sintético · Techada · Iluminada");
});
