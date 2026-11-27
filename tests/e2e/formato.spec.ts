/**
 * Fútbol (027): formato de la cancha. "Tipo de cancha" (desplegable) en el inicio para
 * filtrar, formato en la tarjeta y en la portada del complejo, y en el panel
 * el formato se elige con botones (solo fútbol; si pasa a pádel, NULL).
 *
 * Crea "E2E Formato F5" (fútbol 5, con horarios y precio) en el complejo de
 * prueba y la borra al final, con todo lo que cuelga de ella.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { VENUE_ID, SUPABASE_URL, serviceHeaders, nextWeekday, contrastOf } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
test.describe.configure({ mode: "serial" });

const NAME = "E2E Formato F5";
const NOW = `${nextWeekday(1, 12)}T12:00:00.000Z`;   // lunes futuro, 09:00 en Mendoza
const FUTBOL = `/?localidad=tunuyan&deporte=futbol&_now=${NOW}`;
let courtId = "";

async function cleanup(request: APIRequestContext) {
  const res = await request.get(`${SUPABASE_URL}/rest/v1/courts?venue_id=eq.${VENUE_ID}&name=like.E2E%20Formato*&select=id`, { headers: serviceHeaders() });
  for (const { id } of (await res.json()) as { id: string }[]) {
    for (const t of ["court_prices", "court_hours"]) {
      await request.delete(`${SUPABASE_URL}/rest/v1/${t}?court_id=eq.${id}`, { headers: serviceHeaders() });
    }
    await request.delete(`${SUPABASE_URL}/rest/v1/audit_log?entity_id=eq.${id}`, { headers: serviceHeaders() });
    await request.delete(`${SUPABASE_URL}/rest/v1/courts?id=eq.${id}`, { headers: serviceHeaders() });
  }
}

test.beforeAll(async ({ request }) => {
  await cleanup(request);
  const sports = (await (await request.get(`${SUPABASE_URL}/rest/v1/sports?select=id,slug`, { headers: serviceHeaders() })).json()) as { id: string; slug: string }[];
  const futbol = sports.find((s) => s.slug === "futbol")!.id;
  const res = await request.post(`${SUPABASE_URL}/rest/v1/courts`, {
    headers: { ...serviceHeaders(), Prefer: "return=representation" },
    data: { venue_id: VENUE_ID, sport_id: futbol, name: NAME, slot_minutes: 60, active: true, format: "futbol_5" },
  });
  expect(res.ok()).toBe(true);
  courtId = ((await res.json()) as { id: string }[])[0].id;
  const days = Array.from({ length: 7 }, (_, weekday) => weekday);
  await request.post(`${SUPABASE_URL}/rest/v1/court_hours`, { headers: serviceHeaders(),
    data: days.map((weekday) => ({ court_id: courtId, weekday, open_time: "08:00:00", close_time: "23:00:00" })) });
  await request.post(`${SUPABASE_URL}/rest/v1/court_prices`, { headers: serviceHeaders(),
    data: days.map((weekday) => ({ court_id: courtId, weekday, from_time: "08:00:00", to_time: "23:00:00", price: 7000 })) });
});

test.afterAll(async ({ request }) => cleanup(request));

test.describe("público", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("fútbol: desplegable 'Tipo de cancha' (Todos por defecto, 44 px) que filtra; el formato aparece en la tarjeta", async ({ page }) => {
    await page.goto(FUTBOL);
    const tipo = page.getByLabel("Tipo de cancha");
    await expect(tipo).toHaveValue("");
    await expect(tipo.locator("option")).toHaveText(["Todos", "Fútbol 5", "Fútbol 6", "Fútbol 7", "Fútbol 9", "Fútbol 11", "Futsal"]);
    expect((await tipo.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("navigation", { name: "Formato" })).toHaveCount(0); // ya no hay chips

    const card = page.getByTestId("complejo").filter({ hasText: "Complejo Padelero Tunuyán" });
    await expect(card.getByTestId("etiquetas")).toContainText("Fútbol 5");

    await tipo.selectOption("futbol_5");
    await expect(page).toHaveURL(/formato=futbol_5/);
    await expect(card).toBeVisible();
    await expect(tipo).toHaveValue("futbol_5");
    // Cambiar la hora conserva el tipo de cancha (cancha de 60 min desde las 08:00 → 20:00 existe)
    await page.getByTestId("hora").selectOption("20:00");
    await expect(page).toHaveURL(/formato=futbol_5/);
    await expect(page).toHaveURL(/hora=20%3A00/);

    await page.getByLabel("Tipo de cancha").selectOption("futbol_7");
    await expect(page).toHaveURL(/formato=futbol_7/);
    await expect(page).toHaveURL(/hora=20%3A00/);
    await expect(card).toHaveCount(0);
  });

  test("pádel no tiene 'Tipo de cancha'", async ({ page }) => {
    await page.goto(`/?localidad=tunuyan&deporte=padel&_now=${NOW}`);
    await expect(page.getByTestId("complejo").first()).toBeVisible();
    await expect(page.getByTestId("formato")).toHaveCount(0);
  });
  test("portada del complejo: 'Fútbol 5' en el subtítulo y en la pestaña de la cancha", async ({ page }) => {
    await page.goto(`/tunuyan/futbol/${VENUE_ID}?_now=${NOW}`);
    await expect(page.getByTestId("portada-complejo").getByTestId("etiquetas")).toHaveText(/^Fútbol 5 · /);
    await expect(page.getByTestId("cancha-tab").filter({ hasText: NAME })).toContainText("Fútbol 5");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`contraste AA en "Tipo de cancha" (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`${FUTBOL}&formato=futbol_5`);
      for (const c of await page.getByTestId("formato").all()) expect(await contrastOf(c)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

test("panel: el formato se elige con botones solo en fútbol; si la cancha pasa a pádel queda NULL", async ({ page, request }) => {
  await page.goto(`/panel/complejos/${VENUE_ID}/canchas/${courtId}`);
  const sport = page.getByRole("group", { name: "Deporte" });
  const format = page.getByRole("group", { name: "Formato" });
  await expect(format.getByRole("radio")).toHaveCount(6);
  await expect(format.getByRole("radio", { name: "Fútbol 5" })).toBeChecked();
  for (const l of await format.locator("label").all()) expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await format.getByText("Fútbol 7").click();
  await page.getByRole("button", { name: "Guardar info" }).click();
  await expect(page.getByTestId("guardado")).toHaveText("Guardado");
  const read = async () => ((await (await request.get(`${SUPABASE_URL}/rest/v1/courts?id=eq.${courtId}&select=format`, { headers: serviceHeaders() })).json()) as { format: string | null }[])[0].format;
  expect(await read()).toBe("futbol_7");

  // Pádel: los botones de formato desaparecen y se guarda NULL
  await sport.getByText("Pádel", { exact: true }).click();
  await expect(format).toHaveCount(0);
  await page.getByRole("button", { name: "Guardar info" }).click();
  await expect(page.getByTestId("guardado")).toHaveText("Guardado");
  await expect.poll(read).toBeNull();
});
