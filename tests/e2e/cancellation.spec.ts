/**
 * E2E — Fase 6, Bloque 5: política de cancelación en el panel y cancelación
 * del jugador con devolución desde /turnos/[token].
 *
 * - El panel se prueba siempre.
 * - Los tests del jugador con pago online necesitan la migración 020
 *   (cancel_booking_by_token v3 / get_booking_by_token v2). Si no está
 *   aplicada se saltean (test.skip) para que la suite siga verde.
 * - Nunca se llama a Mercado Pago: el complejo de prueba no tiene token
 *   válido, así que la devolución queda "en proceso" (refund_failed) y la
 *   reintenta el cron.
 *
 * Limpieza: payments → bookings "E2E Cancel*" → outbox → audit_log de esos
 * pagos; restaura cancel_limit_hours / refund_policy originales.
 */
import path from "path";
import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  VENUE_ID, COURT_ID, SUPABASE_URL, SUPABASE_ANON_KEY, OWNER_EMAIL, OWNER_PASSWORD,
  deleteTestBookings, deleteTestOutboxRows, nextWeekday,
} from "./helpers";

process.loadEnvFile(path.join(__dirname, "../../.env.local"));
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const serviceHeaders = {
  apikey:         SERVICE_KEY,
  Authorization:  `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  "User-Agent":   "turnazo-e2e",
};

type Policy = { cancel_limit_hours: number; refund_policy: "full" | "none" };

async function readPolicy(request: APIRequestContext): Promise<Policy> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/venues?id=eq.${VENUE_ID}&select=cancel_limit_hours,refund_policy`,
    { headers: { ...serviceHeaders, Accept: "application/vnd.pgrst.object+json" } }
  );
  expect(res.ok()).toBe(true);
  return await res.json() as Policy;
}

async function writePolicy(request: APIRequestContext, policy: Policy) {
  const res = await request.patch(`${SUPABASE_URL}/rest/v1/venues?id=eq.${VENUE_ID}`, {
    headers: { ...serviceHeaders, Prefer: "return=minimal" }, data: policy,
  });
  expect(res.ok()).toBe(true);
}

function slotIso(fecha: string, hour: number, minute: number) {
  const [y, m, d] = fecha.split("-").map(Number);
  const startUtcMs = Date.UTC(y, m - 1, d, hour + 3, minute, 0);
  return { inicio: new Date(startUtcMs).toISOString(), fin: new Date(startUtcMs + 90 * 60 * 1000).toISOString() };
}

function randomToken() {
  let t = "";
  while (t.length < 64) t += Math.random().toString(16).slice(2);
  return t.slice(0, 64);
}

const createdBookingIds: string[] = [];

/** Reserva confirmada y, si se pide, pagada online (fila en payments 'approved'). */
async function insertConfirmed(
  request: APIRequestContext, name: string, fecha: string, hour: number, minute: number, paidOnline: number,
): Promise<{ id: string; token: string }> {
  const { inicio, fin } = slotIso(fecha, hour, minute);
  const token = randomToken();
  const orderId = paidOnline > 0 ? `ORD-E2E-${token.slice(0, 8)}` : null;
  const res = await request.post(`${SUPABASE_URL}/rest/v1/bookings`, {
    headers: { ...serviceHeaders, Prefer: "return=representation" },
    data: {
      venue_id: VENUE_ID, court_id: COURT_ID, period: `[${inicio},${fin})`,
      kind: "booking", source: "app", status: "confirmed",
      payment_status: paidOnline === 0 ? "unpaid" : paidOnline >= 5000 ? "paid" : "deposit_paid",
      customer_name: name, customer_phone: "2622777002",
      price_total: 5000, deposit_amount: paidOnline, amount_paid: paidOnline,
      mp_order_id: orderId, cancel_token: token,
    },
  });
  expect(res.ok()).toBe(true);
  const [row] = await res.json() as { id: string }[];
  createdBookingIds.push(row.id);

  if (paidOnline > 0) {
    const pay = await request.post(`${SUPABASE_URL}/rest/v1/payments`, {
      headers: { ...serviceHeaders, Prefer: "return=minimal" },
      data: {
        booking_id: row.id, mp_order_id: orderId, mp_payment_id: `PAY-E2E-${token.slice(0, 8)}`,
        amount: paidOnline, type: paidOnline >= 5000 ? "full" : "deposit", status: "approved",
        platform_fee: 0, currency: "ARS", raw: {},
      },
    });
    expect(pay.ok()).toBe(true);
  }
  return { id: row.id, token };
}

async function bookingRow(request: APIRequestContext, id: string) {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/bookings?id=eq.${id}&select=status,payment_status`,
    { headers: { ...serviceHeaders, Accept: "application/vnd.pgrst.object+json" } }
  );
  return await res.json() as { status: string; payment_status: string };
}

async function paymentStatus(request: APIRequestContext, bookingId: string) {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/payments?booking_id=eq.${bookingId}&select=status`,
    { headers: serviceHeaders }
  );
  return (await res.json() as { status: string }[]).map((r) => r.status);
}

/** ¿Está aplicada la 020? get_booking_by_token v2 devuelve refund_policy. */
async function migration020Applied(request: APIRequestContext, token: string): Promise<boolean> {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/get_booking_by_token`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
    data: { p_cancel_token: token },
  });
  if (!res.ok()) return false;
  const body = await res.json() as Record<string, unknown>;
  return "refund_policy" in body;
}

// Lunes +2 días; 15:30 y 17:00 están alineados a la grilla de 90 min desde 08:00
// y no los usa ningún otro spec (payment-flow usa 12:30, 14:00, 17:00 con otros nombres
// pero los borra en su propio afterAll; acá usamos 15:30 y 18:30).
const FECHA = nextWeekday(1, 2);

let originalPolicy: Policy | null = null;
let applied020 = false;

test.beforeAll(async ({ request }) => {
  if (!SERVICE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en .env.local");
  originalPolicy = await readPolicy(request);
  await cleanup(request);
  const probe = await insertConfirmed(request, "E2E Cancel Probe", FECHA, 15, 30, 0);
  applied020 = await migration020Applied(request, probe.token);
  await cleanup(request);
});

/**
 * Borra todo lo que crea este spec. No depende de ids en memoria: si un test
 * falla, Playwright reinicia el worker y vuelve a correr beforeAll con el
 * módulo limpio, así que se buscan por nombre las reservas "E2E Cancel*".
 * Primero payments y audit_log (FK / rastro), después las reservas.
 */
async function cleanup(request: APIRequestContext) {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/bookings?venue_id=eq.${VENUE_ID}&customer_name=like.${encodeURIComponent("E2E Cancel*")}&select=id`,
    { headers: serviceHeaders }
  );
  const ids = ((await res.json()) as { id: string }[]).map((r) => r.id);
  if (ids.length) {
    const list = ids.join(",");
    await request.delete(`${SUPABASE_URL}/rest/v1/payments?booking_id=in.(${list})`, { headers: { ...serviceHeaders, Prefer: "return=minimal" } });
    await request.delete(`${SUPABASE_URL}/rest/v1/audit_log?entity_id=in.(${list})`, { headers: { ...serviceHeaders, Prefer: "return=minimal" } });
  }
  createdBookingIds.length = 0;
  await deleteTestBookings(request, ["E2E Cancel*"]);
  await deleteTestOutboxRows(request);
}

test.afterAll(async ({ request }) => {
  await cleanup(request);
  if (originalPolicy) await writePolicy(request, originalPolicy);
});

// ---------------------------------------------------------------------------
// Panel: política de cancelación
// ---------------------------------------------------------------------------

test.describe("panel: política de cancelación", () => {
  test("guarda plazo y devolución, y persiste al recargar", async ({ page, request }) => {
    await writePolicy(request, { cancel_limit_hours: 2, refund_policy: "none" });

    await page.goto(`/panel/complejos/${VENUE_ID}`);
    await page.waitForLoadState("networkidle");

    const section = page.locator("div", { has: page.getByRole("heading", { name: "Cancelaciones" }) }).last();
    await expect(section.getByLabel("Plazo para cancelar (horas antes del turno)")).toHaveValue("2");
    await expect(section.getByRole("radio", { name: /Sin devolución/ })).toBeChecked();

    await section.getByLabel("Plazo para cancelar (horas antes del turno)").fill("5");
    await section.getByRole("radio", { name: /Devolución total/ }).check();
    await section.getByRole("button", { name: "Guardar cancelaciones" }).click();
    await expect(page.getByText("Política de cancelación guardada.")).toBeVisible();

    expect(await readPolicy(request)).toEqual({ cancel_limit_hours: 5, refund_policy: "full" });

    await page.reload();
    await page.waitForLoadState("networkidle");
    const again = page.locator("div", { has: page.getByRole("heading", { name: "Cancelaciones" }) }).last();
    await expect(again.getByLabel("Plazo para cancelar (horas antes del turno)")).toHaveValue("5");
    await expect(again.getByRole("radio", { name: /Devolución total/ })).toBeChecked();
  });

  test("rechaza un plazo fuera de rango", async ({ page }) => {
    await page.goto(`/panel/complejos/${VENUE_ID}`);
    await page.waitForLoadState("networkidle");
    const section = page.locator("div", { has: page.getByRole("heading", { name: "Cancelaciones" }) }).last();
    const input = section.getByLabel("Plazo para cancelar (horas antes del turno)");
    // El input tiene max=168: forzamos el valor para que lo rechace el servidor
    await input.evaluate((el: HTMLInputElement) => { el.removeAttribute("max"); });
    await input.fill("500");
    await section.getByRole("button", { name: "Guardar cancelaciones" }).click();
    await expect(section.getByText("Máximo 168 horas (7 días)")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Panel: el dueño cancela una reserva pagada online → se devuelve todo
// ---------------------------------------------------------------------------

test.describe("panel: cancelar reserva con pago online", () => {
  test("avisa la devolución antes de confirmar, cancela y deja la devolución en proceso", async ({ page, request }) => {
    // Política restrictiva a propósito: cuando cancela el complejo se devuelve igual
    await writePolicy(request, { cancel_limit_hours: 48, refund_policy: "none" });
    const b = await insertConfirmed(request, "E2E Cancel Dueño", FECHA, 9, 30, 2500);

    await page.goto(`/panel/complejos/${VENUE_ID}/agenda?fecha=${FECHA}`);
    await page.waitForLoadState("networkidle");
    if (page.url().includes("/login")) {
      await page.fill('[name="email"]', OWNER_EMAIL);
      await page.fill('[name="password"]', OWNER_PASSWORD);
      await page.getByRole("button", { name: /entrar/i }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 25_000 });
      await page.goto(`/panel/complejos/${VENUE_ID}/agenda?fecha=${FECHA}`);
      await page.waitForLoadState("networkidle");
    }

    await page.getByText("E2E Cancel Dueño").first().click();
    await page.getByRole("button", { name: /cancelar turno/i }).click();

    // Aviso antes de confirmar; todavía no se canceló nada
    await expect(page.getByText(/Se le devolverán/)).toBeVisible();
    await expect(page.getByRole("dialog").getByText("$2.500", { exact: true })).toBeVisible();
    expect(await bookingRow(request, b.id)).toMatchObject({ status: "confirmed" });

    await page.getByRole("button", { name: "Volver" }).click();
    await expect(page.getByText(/Se le devolverán/)).toBeHidden();
    await page.getByRole("button", { name: /cancelar turno/i }).click();
    await page.getByRole("button", { name: "Confirmar cancelación" }).click();

    await expect.poll(async () => (await bookingRow(request, b.id)).status, { timeout: 15_000 }).toBe("cancelled");
    // Sin token de MP en local: la devolución queda para el cron (se marca después de cancelar)
    await expect.poll(async () => await paymentStatus(request, b.id), { timeout: 15_000 }).toEqual(["refund_failed"]);

    await expect.poll(async () => {
      const audit = await request.get(
        `${SUPABASE_URL}/rest/v1/audit_log?entity=eq.booking&entity_id=eq.${b.id}&action=eq.cancel&select=new_data`,
        { headers: serviceHeaders }
      );
      return (await audit.json() as { new_data: Record<string, unknown> }[]).map((r) => r.new_data);
    }, { timeout: 15_000 }).toEqual([expect.objectContaining({ refund: "pending", refund_amount: 2500 })]);
  });
});

// ---------------------------------------------------------------------------
// Jugador: cancelar con / sin devolución (requiere migración 020)
// ---------------------------------------------------------------------------

test.describe("jugador: cancelación con devolución", () => {
  test("pago online, devolución total y dentro del plazo: avisa el monto, cancela y la devolución queda en proceso", async ({ page, request }) => {
    test.skip(!applied020, "requiere migración 020 aplicada");
    await writePolicy(request, { cancel_limit_hours: 2, refund_policy: "full" });
    const b = await insertConfirmed(request, "E2E Cancel Full", FECHA, 15, 30, 2500);

    await page.goto(`/turnos/${b.token}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/Seña pagada: \$2\.500/)).toBeVisible();
    await expect(page.getByText(/te devolvemos/)).toBeVisible();
    await expect(page.getByText("$2.500", { exact: false }).first()).toBeVisible();

    await page.getByRole("button", { name: "Cancelar turno y pedir devolución" }).click();
    await expect(page.getByText(/este turno fue cancelado/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/La devolución de \$2\.500 está en proceso/)).toBeVisible();

    expect(await bookingRow(request, b.id)).toMatchObject({ status: "cancelled" });
    expect(await paymentStatus(request, b.id)).toEqual(["refund_failed"]); // sin token de MP: la reintenta el cron
  });

  test("sin devolución (política none): avisa antes, exige confirmar y cancela sin devolver", async ({ page, request }) => {
    test.skip(!applied020, "requiere migración 020 aplicada");
    await writePolicy(request, { cancel_limit_hours: 2, refund_policy: "none" });
    const b = await insertConfirmed(request, "E2E Cancel None", FECHA, 18, 30, 5000);

    await page.goto(`/turnos/${b.token}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/NO se te devuelve lo que pagaste \(\$5\.000\)/)).toBeVisible();
    await expect(page.getByText("Este complejo no hace devoluciones por cancelación.")).toBeVisible();

    const button = page.getByRole("button", { name: "Cancelar turno sin devolución" });
    await expect(button).toBeDisabled();
    await page.getByRole("checkbox", { name: /Entiendo que no hay devolución/ }).check();
    await expect(button).toBeEnabled();
    await button.click();

    await expect(page.getByText(/este turno fue cancelado/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/no se devolvió automáticamente/)).toBeVisible();

    expect(await bookingRow(request, b.id)).toMatchObject({ status: "cancelled", payment_status: "paid" });
    expect(await paymentStatus(request, b.id)).toEqual(["approved"]);
  });
});
