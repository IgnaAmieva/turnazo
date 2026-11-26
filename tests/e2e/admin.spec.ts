/**
 * Panel de superadmin (028): /admin y /admin/complejos/[id].
 * - Acceso: el rol se verifica en el servidor y en la base (anon → login,
 *   dueño → 404 y sin acceso a las funciones superadmin_*).
 * - Acciones con confirmación sobre un complejo de prueba que crea el dueño de
 *   prueba (queda pendiente, sin canchas: nunca aparece en la web). Se
 *   rechaza, aprueba, suspende y reactiva; queda en audit_log, el push al
 *   dueño en notification_outbox y el link de WhatsApp. afterAll borra el
 *   complejo y todo lo que generó.
 */
import { test, expect, type Browser } from "@playwright/test";
import {
  SUPABASE_URL, SUPABASE_ANON_KEY, VENUE_ID, serviceHeaders, getOwnerToken, superadminCookies,
  contrastOf, waitIdle,
} from "./helpers";

const NAME = "E2E Superadmin Complejo";
const PHONE = "2622 000444";
const REASON = "El pin del mapa no coincide con la dirección";
let venueId = "";
let superadminToken = "";

async function adminPage(browser: Browser, opts: { colorScheme?: "light" | "dark"; mobile?: boolean } = {}) {
  const { cookies, accessToken } = await superadminCookies();
  superadminToken = accessToken;
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    colorScheme: opts.colorScheme ?? "light",
    ...(opts.mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}),
  });
  await ctx.addCookies(cookies);
  return { ctx, page: await ctx.newPage() };
}

const svc = async (path: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...serviceHeaders(), ...(init.headers ?? {}) } });

test.beforeAll(async ({ request }) => {
  // El dueño de prueba da de alta un complejo: el trigger lo deja pendiente
  const token = await getOwnerToken(request);
  expect(token).toBeTruthy();
  const me = await (await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } })).json() as { id: string };
  const loc = await (await svc("localities?slug=eq.tunuyan&select=id")).json() as { id: string }[];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/venues?select=id,status`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ owner_id: me.id, name: NAME, phone: PHONE, address: "Calle de Prueba 123", locality_id: loc[0].id, lat: -33.577, lng: -69.015 }),
  });
  const rows = await res.json() as { id: string; status: string }[];
  expect(rows[0]?.status).toBe("pending");
  venueId = rows[0].id;
});

test.afterAll(async () => {
  if (!venueId) return;
  await svc(`audit_log?venue_id=eq.${venueId}`, { method: "DELETE" });
  await svc(`notification_outbox?venue_id=eq.${venueId}`, { method: "DELETE" });
  await svc(`venues?id=eq.${venueId}`, { method: "DELETE" });
});

test("acceso: sin sesión → login; el dueño ve 404 y la base le niega las funciones de superadmin", async ({ page, browser, request }) => {
  // Dueño (sesión del setup)
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Superadmin", { exact: true })).toHaveCount(0);
  await page.goto("/panel/complejos");
  await expect(page.getByRole("link", { name: "Superadmin" })).toHaveCount(0);

  const owner = await getOwnerToken(request);
  for (const fn of ["superadmin_venues", "superadmin_summary", "superadmin_set_venue_status"]) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${owner}`, "Content-Type": "application/json" },
      body: JSON.stringify(fn === "superadmin_set_venue_status" ? { p_venue_id: venueId, p_action: "approve" } : {}),
    });
    expect(r.status, fn).toBe(403);
  }
  // anon: ni siquiera puede llamarlas
  const anon = await fetch(`${SUPABASE_URL}/rest/v1/rpc/superadmin_summary`, {
    method: "POST", headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: "{}",
  });
  expect([401, 403, 404]).toContain(anon.status);
  // El complejo sigue pendiente
  const v = await (await svc(`venues?id=eq.${venueId}&select=status`)).json() as { status: string }[];
  expect(v[0].status).toBe("pending");

  // Sin sesión → login
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const anonPage = await ctx.newPage();
  await anonPage.goto("/admin");
  await expect(anonPage).toHaveURL(/\/login/);
  await ctx.close();
});

test("lista: resumen arriba, filtro por estado y datos de cada complejo", async ({ browser }) => {
  const { ctx, page } = await adminPage(browser);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Superadmin" })).toBeVisible();
  const resumen = page.getByTestId("resumen");
  await expect(resumen.getByTestId("resumen-pendientes")).toContainText(/\d+\s*Pendientes/);
  await expect(resumen.getByTestId("resumen-reservas")).toContainText(/\d+\s*Reservas · 7 días/);
  await expect(resumen.getByTestId("resumen-duenos")).toContainText(/\d+\s*Dueños nuevos · 7 días/);
  await expect(page.getByTestId("filtro-estado")).toHaveText([/^Todos \d+/, /^Pendientes \d+/, /^Aprobados \d+/, /^Suspendidos \d+/, /^Rechazados \d+/]);

  // Pendientes: está el de prueba, con su dueño, localidad, teléfono, alta y Mercado Pago
  await page.getByTestId("filtro-estado").filter({ hasText: "Pendientes" }).click();
  await expect(page).toHaveURL(/estado=pending/);
  const cards = page.getByTestId("admin-complejo");
  for (const c of await cards.all()) await expect(c).toHaveAttribute("data-estado", "pending");
  const card = cards.filter({ hasText: NAME });
  await expect(card).toContainText("dueno@turnazo.test");
  await expect(card).toContainText("Tunuyán");
  await expect(card).toContainText("2622 000444");
  await expect(card).toContainText(/Alta: \d+/);
  await expect(card.getByTestId("mp")).toHaveText("Sin Mercado Pago");
  await expect(card.getByTestId("estado")).toHaveText("Pendiente");

  // Aprobados: el complejo de prueba (con Mercado Pago de prueba según los tests) y futmates
  await page.getByTestId("filtro-estado").filter({ hasText: "Aprobados" }).click();
  await expect(cards.filter({ hasText: "Complejo Padelero Tunuyán" })).toHaveCount(1);
  await expect(cards.filter({ hasText: NAME })).toHaveCount(0);
  await ctx.close();
});

test("detalle: mapa con el pin, canchas con horarios y precios, logo y datos del dueño", async ({ browser }) => {
  const { ctx, page } = await adminPage(browser);
  await page.goto(`/admin/complejos/${VENUE_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "Complejo Padelero Tunuyán" })).toBeVisible();
  await expect(page.getByTestId("dueno")).toHaveText("dueno@turnazo.test");
  await expect(page.getByTestId("mapa-pin").locator(".leaflet-container")).toBeVisible();
  await expect(page.getByTestId("mapa-pin").locator(".leaflet-marker-icon")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Abrir en Google Maps" })).toHaveAttribute("href", /google\.com\/maps\/dir\/\?api=1&destination=-?\d/);
  const court = page.getByTestId("admin-cancha").first();
  await expect(court).toContainText(/turnos de \d+ min/);
  await expect(court).toContainText(/Lun \d{2}:\d{2}–\d{2}:\d{2}/);
  await expect(court).toContainText(/\$[\d.]+/);
  // Aprobado: solo "Suspender"
  await expect(page.getByTestId("accion-suspend")).toBeVisible();
  await expect(page.getByTestId("accion-approve")).toHaveCount(0);
  await ctx.close();
});

test("acciones con confirmación: rechazar (motivo), aprobar, suspender y reactivar; audit_log, push y WhatsApp", async ({ browser }) => {
  const { ctx, page } = await adminPage(browser, { mobile: true });
  await page.goto(`/admin/complejos/${venueId}`);
  await expect(page.getByTestId("estado")).toHaveText("Pendiente");

  // Cancelar no cambia nada
  await page.getByTestId("accion-approve").click();
  const dialog = page.getByTestId("confirmar");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("estado")).toHaveText("Pendiente");

  // Rechazar: sin motivo no se puede; con motivo queda rechazado
  await page.getByTestId("accion-reject").click();
  await expect(dialog.getByRole("heading")).toHaveText(`Rechazar ${NAME}`);
  await dialog.getByTestId("confirmar-si").click();
  await expect(page.getByTestId("estado")).toHaveText("Pendiente"); // el navegador pide el motivo
  await dialog.getByLabel("Motivo").fill(REASON);
  await dialog.getByTestId("confirmar-si").click();
  await expect(page.getByTestId("accion-hecha")).toContainText("quedó rechazado");
  await expect(page.getByTestId("estado")).toHaveText("Rechazado");
  await expect(page.getByTestId("motivo")).toHaveText(`Motivo: ${REASON}`);
  const wa = page.getByTestId("whatsapp-dueno");
  const href = decodeURIComponent((await wa.getAttribute("href"))!);
  expect(href).toMatch(/^https:\/\/wa\.me\/5492622000444\?text=/);
  expect(href).toContain(REASON);
  expect((await wa.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  // El dueño ve "Rechazado" con el motivo en su panel
  const ownerPage = await (await browser.newContext({ storageState: "tests/e2e/setup/.auth.json" })).newPage();
  await ownerPage.goto("/panel/complejos");
  const mine = ownerPage.getByTestId("mi-complejo").filter({ hasText: NAME });
  await expect(mine.getByTestId("estado")).toHaveText("Rechazado");
  await expect(mine.getByTestId("motivo")).toHaveText(`Motivo: ${REASON}`);
  await ownerPage.context().close();

  // Aprobar (desde rechazado)
  await page.getByTestId("accion-approve").click();
  await dialog.getByTestId("confirmar-si").click();
  await expect(page.getByTestId("estado")).toHaveText("Aprobado");
  await expect(page.getByTestId("motivo")).toHaveCount(0);
  expect(decodeURIComponent((await page.getByTestId("whatsapp-dueno").getAttribute("href"))!)).toContain("ya está aprobado");

  // Suspender (motivo opcional) y reactivar
  await page.getByTestId("accion-suspend").click();
  await dialog.getByTestId("confirmar-si").click();
  await expect(page.getByTestId("estado")).toHaveText("Suspendido");
  await expect(page.getByTestId("whatsapp-dueno")).toHaveCount(0); // solo al aprobar o rechazar
  await page.getByTestId("accion-reactivate").click();
  await dialog.getByTestId("confirmar-si").click();
  await expect(page.getByTestId("estado")).toHaveText("Aprobado");

  // audit_log: las 4, con quién y estado viejo/nuevo
  const audit = await (await svc(`audit_log?venue_id=eq.${venueId}&select=action,profile_id,old_data,new_data&order=created_at`)).json() as
    { action: string; profile_id: string; old_data: { status: string }; new_data: { status: string; reason: string | null } }[];
  expect(audit.map((a) => `${a.action}:${a.old_data.status}→${a.new_data.status}`)).toEqual([
    "venue_reject:pending→rejected", "venue_approve:rejected→approved",
    "venue_suspend:approved→suspended", "venue_reactivate:suspended→approved",
  ]);
  expect(audit[0].new_data.reason).toBe(REASON);
  expect(new Set(audit.map((a) => a.profile_id)).size).toBe(1);

  // Push al dueño: rechazado y aprobado (no al suspender ni reactivar)
  const outbox = await (await svc(`notification_outbox?venue_id=eq.${venueId}&select=type,payload&order=created_at`)).json() as
    { type: string; payload: { venue_name: string; reason: string | null } }[];
  expect(outbox.map((o) => o.type)).toEqual(["venue_rejected", "venue_approved"]);
  expect(outbox[0].payload).toMatchObject({ venue_name: NAME, reason: REASON });
  await ctx.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`44 px y contraste AA en la lista y el detalle (${scheme})`, async ({ browser }) => {
    const { ctx, page } = await adminPage(browser, { colorScheme: scheme, mobile: true });
    await page.goto("/admin");
    await waitIdle(page);
    for (const chip of await page.getByTestId("filtro-estado").all()) {
      expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await contrastOf(chip)).toBeGreaterThanOrEqual(4.5);
    }
    for (const el of await page.getByTestId("estado").all()) expect(await contrastOf(el)).toBeGreaterThanOrEqual(4.5);
    for (const el of await page.getByTestId("resumen").locator("p").all()) expect(await contrastOf(el)).toBeGreaterThanOrEqual(4.5);
    for (const el of (await page.getByTestId("admin-complejo").locator("dd").all()).slice(0, 12)) {
      expect(await contrastOf(el)).toBeGreaterThanOrEqual(4.5);
    }

    await page.goto(`/admin/complejos/${venueId}`);
    for (const b of await page.getByRole("button").filter({ hasText: /Aprobar|Rechazar|Suspender|Reactivar/ }).all()) {
      expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await contrastOf(b)).toBeGreaterThanOrEqual(4.5);
    }
    // La hoja de confirmación (botón rojo incluido)
    const action = page.getByRole("button").filter({ hasText: /Rechazar|Suspender/ }).first();
    if (await action.count()) {
      await action.click();
      const yes = page.getByTestId("confirmar-si");
      expect(await contrastOf(yes)).toBeGreaterThanOrEqual(4.5);
      expect((await yes.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.getByTestId("confirmar").getByRole("button", { name: "Cancelar" }).click();
    }
    await ctx.close();
  });
}

test("login con contraseña del superadmin → /admin (si está E2E_SUPERADMIN_PASSWORD)", async ({ browser }) => {
  const password = process.env.E2E_SUPERADMIN_PASSWORD;
  test.skip(!password, "Falta E2E_SUPERADMIN_PASSWORD en .env.local");
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await waitIdle(page);
  await page.getByLabel("Email").fill("superadmin@turnazo.test");
  await page.getByLabel("Contraseña").fill(password!);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: "Superadmin" })).toBeVisible();
  await ctx.close();
});

test("la base rechaza transiciones inválidas aunque el superadmin llame directo", async () => {
  const call = async (action: string, reason?: string) => (await (await fetch(`${SUPABASE_URL}/rest/v1/rpc/superadmin_set_venue_status`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${superadminToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_venue_id: venueId, p_action: action, p_reason: reason ?? null }),
  })).json()) as { error?: string };
  // A esta altura el complejo de prueba está aprobado
  expect((await call("reject", REASON)).error).toBe("invalid_transition");
  expect((await call("reactivate")).error).toBe("invalid_transition");
  expect((await call("approve")).error).toBe("invalid_transition");
});
