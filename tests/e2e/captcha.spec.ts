/**
 * S2: captcha Turnstile en la reserva y en el login, con las claves de prueba
 * oficiales de Cloudflare que siempre pasan (.env.local; nunca las reales).
 * El servidor siempre verifica: sin token no se reserva ni se entra.
 * Si el widget no carga (Cloudflare caído para el jugador), aviso con
 * "Reintentar" y nada queda trabado. Lo que se reserva se borra al final.
 */
import { test, expect } from "@playwright/test";
import {
  VENUE_PATH, COURT_ID, nextWeekday, slotParams, deleteTestBookings, deleteTestOutboxRows,
  contrastOf, waitIdle,
} from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: { cookies: [], origins: [] } });

const NAME = "E2E Captcha";
const PHONE = "2622 000888";
const FECHA = nextWeekday(2, 9); // martes 9+ días

function reservarUrl(hour: number) {
  const { fecha, inicio, fin } = slotParams(FECHA, hour, 90);
  return `${VENUE_PATH}/reservar?cancha=${COURT_ID}&fecha=${fecha}&inicio=${encodeURIComponent(inicio)}&fin=${encodeURIComponent(fin)}`;
}

async function fill(page: import("@playwright/test").Page) {
  await page.getByLabel("Tu nombre").fill(NAME);
  await page.getByLabel("Tu teléfono").fill(PHONE);
}

test.afterAll(async ({ request }) => {
  await deleteTestBookings(request, [NAME]);
  await deleteTestOutboxRows(request);
});

test("reserva: el widget va en el lugar reservado y, si Cloudflare no duda, no se ve nada ni hay que tocar nada", async ({ page }) => {
  await page.goto(reservarUrl(8));
  await waitIdle(page);
  const slot = page.locator("[data-captcha-slot]");
  await expect(slot).toHaveCount(1);
  // El token llega solo (modo Managed): sin casilla que tocar
  await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 15_000 });
  await expect(slot).toHaveAttribute("data-captcha-status", "ready");
  await expect(page.getByTestId("captcha-error")).toHaveCount(0);
});

test("sin token el servidor no reserva; el mensaje sale del catálogo y el reintento sí reserva", async ({ page }) => {
  await page.goto(reservarUrl(11));
  await waitIdle(page);
  await fill(page);
  const token = page.locator('input[name="cf-turnstile-response"]');
  await expect(token).toHaveValue(/.+/, { timeout: 15_000 });
  // Alguien saca el token del formulario (o lo falsifica): el servidor lo rechaza igual
  await token.evaluate((el) => el.remove());
  await page.getByRole("button", { name: "Confirmar reserva" }).click();
  const err = page.getByTestId("reserva-error");
  await expect(err).toHaveText("No pudimos verificar que no seas un robot. Probá de nuevo.");
  await expect(err).toHaveAttribute("data-error-code", "captcha_failed");
  await expect(page).toHaveURL(/\/reservar/);

  // Confirmar sigue: con un token nuevo (el widget se renueva solo) la reserva pasa
  const confirm = page.getByRole("button", { name: "Confirmar reserva" });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await page.waitForURL(/\/turnos\//, { timeout: 25_000 });
});

test("si el widget no carga: aviso con 'Reintentar' (44 px, AA), Confirmar no se traba y al volver Cloudflare reserva", async ({ page }) => {
  await page.route("https://challenges.cloudflare.com/**", (r) => r.abort());
  await page.goto(reservarUrl(14));
  await waitIdle(page);
  await fill(page);

  const err = page.getByTestId("captcha-error");
  await expect(err).toBeVisible({ timeout: 15_000 });
  await expect(err).toContainText("No pudimos cargar la verificación anti-robots");
  const retry = page.getByTestId("captcha-reintentar");
  expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await contrastOf(err.locator("span"))).toBeGreaterThanOrEqual(4.5);
  expect(await contrastOf(retry)).toBeGreaterThanOrEqual(4.5);

  // Tocar Confirmar sin captcha: no queda "Verificando…" para siempre, vuelve el aviso
  await page.getByRole("button", { name: "Confirmar reserva" }).click();
  await expect(err).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar reserva" })).toBeEnabled({ timeout: 20_000 });

  // Volvió Cloudflare: Reintentar y reservar
  await page.unroute("https://challenges.cloudflare.com/**");
  await retry.click();
  await expect(err).toHaveCount(0);
  await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Confirmar reserva" }).click();
  await page.waitForURL(/\/turnos\//, { timeout: 25_000 });
});

test("login y registro tienen captcha; sin token no se entra", async ({ page }) => {
  await page.goto("/registro");
  await expect(page.locator("form [data-captcha-slot]")).toHaveCount(1);

  await page.goto("/login");
  await waitIdle(page);
  await expect(page.locator("form [data-captcha-slot]")).toHaveCount(1);
  const token = page.locator('input[name="cf-turnstile-response"]');
  await expect(token).toHaveValue(/.+/, { timeout: 15_000 });
  await token.evaluate((el) => el.remove());
  await page.getByLabel("Email").fill("dueno@turnazo.test");
  await page.getByLabel("Contraseña").fill("no-es-la-clave");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByTestId("login-error")).toHaveText("No pudimos verificar que no seas un robot. Probá de nuevo.");
  await expect(page).toHaveURL(/\/login/);
  for (const el of [page.getByLabel("Email"), page.getByRole("button", { name: "Entrar" })]) {
    expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});
