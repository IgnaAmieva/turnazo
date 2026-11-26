/**
 * Rediseño M1: el dispositivo recuerda nombre, celular, localidad y deporte
 * (y nada más). En el inicio (V2a) se abre la búsqueda recordada, datos precargados al reservar y
 * "No soy yo" que borra todo. Reserva solo en el complejo de prueba y la borra.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  VENUE_PATH, COURT_ID, nextWeekday, slotParams, contrastOf,
  deleteTestBookings, deleteTestOutboxRows, waitIdle } from "./helpers";

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const NAME  = "E2E Recordar Juan";
const PHONE = "2622000666";
const FECHA = nextWeekday(6, 16); // sábado, 16+ días
const KEY   = "turnazo-jugador";

const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), KEY);

function reservarUrl(hour: number) {
  const p = slotParams(FECHA, hour, 90);
  return `${VENUE_PATH}/reservar?cancha=${COURT_ID}&inicio=${p.inicio}&fin=${p.fin}&fecha=${p.fecha}`;
}

test.afterAll(async ({ request }) => {
  await deleteTestBookings(request, [NAME]);
  await deleteTestOutboxRows(request);
});

test("sin nada guardado no hay saludo; al mirar complejos, el inicio abre esa localidad y deporte", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("hola")).toHaveCount(0);

  await page.goto("/tunuyan/padel");
  await expect.poll(() => stored(page)).toContain("tunuyan");

  await page.goto("/");
  await expect(page).toHaveURL(/\?localidad=tunuyan&deporte=padel/);
  const padel = page.getByTestId("deporte").filter({ hasText: "Pádel" });
  await expect(padel).toHaveAttribute("aria-current", "true");
  expect((await padel.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(JSON.parse((await stored(page))!)).toEqual({
    localidad: { slug: "tunuyan", nombre: "Tunuyán" },
    deporte:   { slug: "padel",   nombre: "Pádel" },
  });
});

test("reservar guarda solo nombre y celular; la próxima vez vienen precargados; 'No soy yo' borra todo", async ({ page }) => {
  await page.goto("/tunuyan/padel");
  await page.goto(reservarUrl(17));
  await page.getByLabel("Tu nombre").fill(NAME);
  await page.getByLabel("Tu teléfono").fill(PHONE);

  // Si el complejo ofrece pago online, escribir un email que NO se tiene que guardar
  const online = page.getByRole("radio", { name: /pagar (la seña|el total) online/i }).first();
  if (await online.count()) {
    await online.check();
    await page.getByLabel("Tu email").fill("no-guardar@turnazo.test");
  }
  await page.getByRole("radio", { name: /pagar en el lugar/i }).check();
  const nav = page.waitForURL(/\/turnos\//, { timeout: 25_000 });
  await page.getByRole("button", { name: /confirmar reserva/i }).click();
  await nav;

  const mem = JSON.parse((await stored(page))!);
  expect(Object.keys(mem).sort()).toEqual(["celular", "deporte", "localidad", "nombre"]);
  expect(mem).toMatchObject({ nombre: NAME, celular: "2622 000666" }); // se guarda como se muestra: área + espacio + número
  expect(JSON.stringify(mem)).not.toContain("@");
  // Nada más del sitio en localStorage salvo esto (y el tema, si se eligió)
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.filter((k) => k !== KEY && k !== "turnazo-theme")).toEqual([]);

  // Otra reserva: una sola línea con los datos, "Cambiar" despliega los campos, "No soy yo" visible
  await page.goto(reservarUrl(20));
  await expect(page.getByTestId("datos-recordados")).toContainText(`${NAME} · 2622 000666`);
  await expect(page.getByLabel("Tu nombre")).toBeHidden();
  const cambiar = page.getByRole("button", { name: "Cambiar", exact: true });
  expect((await cambiar.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await cambiar.click();
  await expect(page.getByLabel("Tu nombre")).toHaveValue(NAME);
  await expect(page.getByLabel("Tu teléfono")).toHaveValue("2622 000666");
  const notMe = page.getByRole("button", { name: "No soy yo" });
  await expect(notMe).toBeVisible();
  expect((await notMe.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await contrastOf(notMe)).toBeGreaterThanOrEqual(4.5);

  await notMe.click();
  await expect(page.getByLabel("Tu nombre")).toHaveValue("");
  await expect(page.getByLabel("Tu teléfono")).toHaveValue("");
  await expect(notMe).toBeHidden();
  expect(await stored(page)).toBeNull();

  await page.goto("/");
  await expect(page.getByTestId("hola")).toHaveCount(0);
});

test("inicio: título '¿Jugamos hoy?' y saludo solo con el primer nombre", async ({ page }) => {
  await page.addInitScript((k) => localStorage.setItem(k, JSON.stringify({
    nombre: "Juan Carlos Pérez", celular: "2622123456",
    localidad: { slug: "tunuyan", nombre: "Tunuyán" }, deporte: { slug: "padel", nombre: "Pádel" },
  })), KEY);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("¿Jugamos hoy?");
  await expect(page.getByTestId("hola")).toContainText("Hola, Juan");
  await expect(page.getByTestId("hola")).not.toContainText("Carlos");
});

test("'No soy yo' también está en el inicio y borra la búsqueda recordada", async ({ page }) => {
  await page.goto("/tunuyan/padel");
  await page.goto("/");
  await expect(page.getByTestId("hola")).toBeVisible();
  const notMe = page.getByRole("button", { name: "No soy yo" });
  expect((await notMe.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await notMe.click();
  await expect(page.getByTestId("hola")).toHaveCount(0);
  expect(await stored(page)).toBeNull();
});

test("un valor manipulado en localStorage se ignora (solo campos permitidos)", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({
    nombre: "Ana", email: "x@y.com", pago: "tarjeta",
    localidad: { slug: "<script>", nombre: "X" }, deporte: { slug: "padel", nombre: "Pádel" },
  })), KEY);
  await page.goto(reservarUrl(20));
  await expect(page.getByLabel("Tu nombre")).toHaveValue("Ana");
  await page.goto("/");
  // localidad inválida → no se abre ninguna búsqueda recordada
  await waitIdle(page);
  expect(new URL(page.url()).search).toBe("");
});
