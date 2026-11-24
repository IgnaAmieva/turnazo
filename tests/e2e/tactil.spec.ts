/**
 * Rediseño M1: en el flujo público todo lo que se toca mide 44 × 44 px o más
 * (celular, 390 px). Recorre inicio → localidad → complejos → complejo →
 * reservar → mi turno, y las pantallas de error de pago / turno.
 * Usa una reserva propia en el complejo de prueba y la borra al final.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  VENUE_PATH, VENUE_ID, SUPABASE_URL, nextWeekday, serviceHeaders,
  createTestBooking, deleteTestBookings, deleteTestOutboxRows,
} from "./helpers";

test.use({
  storageState: { cookies: [], origins: [] },
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});

const NAME = "E2E Rediseño Táctil";
const FECHA = nextWeekday(2, 10);
let token = "";

test.beforeAll(async ({ request }) => {
  await deleteTestBookings(request, [NAME]);
  const id = await createTestBooking(request, FECHA, 8, 0, NAME, "2622000555");
  expect(id).toBeTruthy();
  const res = await request.get(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${id}&venue_id=eq.${VENUE_ID}&select=cancel_token`, { headers: serviceHeaders() });
  token = (await res.json())[0].cancel_token;
});

test.afterAll(async ({ request }) => {
  await deleteTestBookings(request, [NAME]);
  await deleteTestOutboxRows(request);
});

/** Elementos tocables visibles que miden menos de 44 × 44 px. */
async function smallTargets(page: Page): Promise<string[]> {
  await page.waitForLoadState("load");
  return page.evaluate(() => {
    const sel = [
      "a[href]", "button", "select", "textarea", "[role=button]", "[role=tab]",
      "input:not([type=hidden]):not([type=radio]):not([type=checkbox])",
      "label:has(input[type=radio])", "label:has(input[type=checkbox])",
    ].join(",");
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (el.closest(".leaflet-control-attribution, .leaflet-marker-pane, .leaflet-popup-pane")) continue;
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || st.visibility === "hidden" || st.display === "none") continue;
      if (r.height < 44 || r.width < 44) {
        out.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return out;
  });
}

test("Mi turno muestra el celular con el formato de siempre (área + espacio + número)", async ({ page }) => {
  await page.goto(`/turnos/${token}`);
  await expect(page.locator("p", { hasText: "Teléfono:" })).toContainText("Teléfono: 2622 000555");
});

test("todo el flujo público tiene objetivos táctiles de 44 px o más", async ({ page }) => {
  const report: Record<string, string[]> = {};
  const check = async (label: string, url?: string) => {
    if (url) await page.goto(url);
    report[label] = await smallTargets(page);
  };

  await check("inicio", "/");
  await check("localidad", "/tunuyan");
  await page.goto("/tunuyan/padel");
  await page.locator(".leaflet-control-zoom").waitFor(); // el mapa carga después
  await check("complejos");
  await check("complejo", `${VENUE_PATH}?fecha=${FECHA}`);
  const href = await page.locator('a[href*="/reservar?"]').first().getAttribute("href");
  await check("reservar", href!);
  await check("mi turno", `/turnos/${token}`);
  await check("turno inexistente", "/turnos/no-existe");
  await check("pago inexistente", "/pago/no-existe");

  const bad = Object.entries(report).filter(([, v]) => v.length);
  expect(bad, JSON.stringify(Object.fromEntries(bad), null, 2)).toEqual([]);
});
