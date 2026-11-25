/**
 * Cargar una cancha por pasos (diseno/agenda-v2.png, pantalla 3):
 * datos → precios → listo, con botones para el deporte y la duración, aviso
 * "Cancha cargada", aviso de turnos sin precio ahí mismo y "Guardado" al
 * guardar en el panel.
 *
 * Crea "E2E Cancha Nueva" en el complejo de prueba y la borra al final
 * (precios, horarios, auditoría y la cancha).
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { VENUE_ID, SUPABASE_URL, serviceHeaders } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const NAME = "E2E Cancha Nueva";

async function cleanup(request: APIRequestContext) {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/courts?venue_id=eq.${VENUE_ID}&name=like.E2E%20Cancha*&select=id`, { headers: serviceHeaders() });
  for (const { id } of (await res.json()) as { id: string }[]) {
    for (const t of ["court_prices", "court_hours"]) {
      await request.delete(`${SUPABASE_URL}/rest/v1/${t}?court_id=eq.${id}`, { headers: serviceHeaders() });
    }
    await request.delete(`${SUPABASE_URL}/rest/v1/audit_log?entity_id=eq.${id}`, { headers: serviceHeaders() });
    await request.delete(`${SUPABASE_URL}/rest/v1/courts?id=eq.${id}`, { headers: serviceHeaders() });
  }
}

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ request }) => cleanup(request));
test.afterAll(async ({ request }) => cleanup(request));

test("paso 1: botones para el deporte y la duración (sin selects); la duración sigue al deporte", async ({ page }) => {
  await page.goto(`/panel/complejos/${VENUE_ID}/canchas/nuevo`);
  await expect(page.getByTestId("pasos")).toContainText("Paso 1 de 3");
  await expect(page.locator('select[name="sport_id"], select[name="slot_minutes"], input[type="number"][name="slot_minutes"]')).toHaveCount(0);

  const sport = page.getByRole("group", { name: "Deporte" });
  const duration = page.getByRole("group", { name: "Duración del turno" });
  await expect(sport.getByRole("radio")).toHaveCount(3);
  for (const l of [...await sport.locator("label").all(), ...await duration.locator("label").all()]) {
    expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }

  // Fútbol → 60 min; Pádel → 90 min (mientras no se toca la duración)
  await sport.getByText("Fútbol", { exact: true }).click();
  await expect(duration.getByRole("radio", { name: "60 min" })).toBeChecked();
  await sport.getByText("Pádel", { exact: true }).click();
  await expect(duration.getByRole("radio", { name: "90 min" })).toBeChecked();
  // Elegida a mano, ya no cambia con el deporte
  await duration.getByText("120 min").click();
  await sport.getByText("Tenis", { exact: true }).click();
  await expect(duration.getByRole("radio", { name: "120 min" })).toBeChecked();
});

test("datos → 'Cancha cargada' con lo que falta → precios (aviso de sin precio ahí mismo) → listo", async ({ page }) => {
  await page.goto(`/panel/complejos/${VENUE_ID}/canchas/nuevo`);
  await page.getByLabel("Nombre").fill(NAME);
  await page.getByRole("group", { name: "Deporte" }).getByText("Pádel", { exact: true }).click();
  await page.locator("label", { has: page.getByRole("switch", { name: "Iluminada" }) }).click();
  await page.getByRole("button", { name: /siguiente: precios/i }).click();

  // Paso 2: aviso claro y qué falta
  await page.waitForURL(/\/canchas\/[0-9a-f-]{36}\?paso=precios$/);
  await expect(page.getByTestId("pasos")).toContainText("Paso 2 de 3");
  const banner = page.getByTestId("cancha-cargada");
  await expect(banner).toContainText(`${NAME} cargada`);
  await expect(banner).toContainText("Te faltan los precios.");
  await expect(page.getByTestId("sin-precio")).toContainText("08:00 a 00:30 · todos los días");

  // Precio para todo el horario, los 7 días → "Precios guardados" y el aviso se va
  const prices = page.locator("section", { hasText: "Precios por franja" });
  await prices.getByRole("button", { name: "+ Agregar precio" }).click();
  await prices.locator('input[type="number"]').first().fill("6000");
  await prices.getByRole("button", { name: "Copiar a todos los días" }).click();
  await prices.getByRole("button", { name: "Guardar precios" }).click();
  await expect(page.getByTestId("guardado")).toHaveText("Precios guardados");
  await expect(page.getByTestId("sin-precio")).toHaveCount(0);
  // Después de guardar, cada fila sigue mostrando su día (antes el form.reset() las dejaba todas en "Dom")
  const days = prices.locator("select").filter({ has: page.locator('option[value="6"]') });
  expect(await days.evaluateAll((els) => (els as HTMLSelectElement[]).map((s) => s.value))).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
  await expect(banner).toContainText("Ya aparece en la app.");
  await expect(banner).not.toContainText("Te faltan");

  // Paso 3
  await page.getByRole("link", { name: /siguiente: listo/i }).click();
  await expect(page.getByTestId("pasos")).toContainText("Paso 3 de 3");
  await expect(page.getByTestId("cancha-cargada")).toContainText(`${NAME} lista`);
  for (const name of ["Ver la agenda", "Cargar otra cancha", "Volver a las canchas"]) {
    const l = page.getByRole("link", { name });
    expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test("al editar, cada guardado avisa 'Guardado'; con un horario sin precio, el aviso aparece en la cancha", async ({ page, request }) => {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/courts?venue_id=eq.${VENUE_ID}&name=eq.${encodeURIComponent(NAME)}&select=id`, { headers: serviceHeaders() });
  const id = ((await res.json()) as { id: string }[])[0].id;
  await page.goto(`/panel/complejos/${VENUE_ID}/canchas/${id}`);

  await page.getByLabel("Nombre").fill(`${NAME} 2`);
  await page.getByRole("button", { name: "Guardar info" }).click();
  await expect(page.getByTestId("guardado")).toHaveText("Guardado");

  // Abre más tarde (hasta las 02:00): ese tramo queda sin precio y se avisa
  const hours = page.locator("section", { hasText: "Horarios de apertura" });
  await hours.locator('input[type="time"]').nth(1).fill("02:00");
  await hours.getByRole("button", { name: "Copiar a todos los días" }).click();
  await hours.getByRole("button", { name: "Guardar horarios" }).click();
  await expect(page.getByTestId("guardado")).toHaveText("Horarios guardados");
  await expect(page.getByTestId("sin-precio")).toContainText("00:30 a 02:00 · todos los días");
});
