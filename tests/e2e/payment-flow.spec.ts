/**
 * E2E — Fase 6, Bloque 3: pago del jugador desde la pantalla pública.
 *
 * Mercado Pago NUNCA se llama de verdad: el complejo de prueba tiene una
 * cuenta MP falsa (tokens inválidos), así que el intento de pago online
 * termina en un error claro y el hold se libera. Eso es exactamente lo que
 * se verifica. La confirmación (webhook) se simula escribiendo en la base
 * con service_role.
 *
 * Cleanup: afterAll borra la cuenta MP falsa, restaura la configuración de
 * cobro original y borra todas las reservas "E2E Pago*".
 */
import path from "path";
import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  VENUE_ID,
  COURT_ID,
  VENUE_PATH,
  SUPABASE_URL,
  getOwnerToken,
  SUPABASE_ANON_KEY,
  nextWeekday,
  deleteTestBookings,
  deleteTestOutboxRows,
} from "./helpers";

process.loadEnvFile(path.join(__dirname, "../../.env.local"));
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const FAKE_MP_USER_ID = "e2e-fake-mp";
const SETTINGS_COLUMNS =
  "deposit_required,deposit_type,deposit_value,allow_full_payment,allow_pay_at_venue";

type Settings = {
  deposit_required: boolean;
  deposit_type: "fixed" | "percent" | null;
  deposit_value: number | null;
  allow_full_payment: boolean;
  allow_pay_at_venue: boolean;
};

const DEPOSIT_AND_FULL: Settings = {
  deposit_required:   true,
  deposit_type:       "percent",
  deposit_value:      50,
  allow_full_payment: true,
  allow_pay_at_venue: false,
};

const FULL_AND_VENUE: Settings = {
  deposit_required:   false,
  deposit_type:       null,
  deposit_value:      null,
  allow_full_payment: true,
  allow_pay_at_venue: true,
};

// ---------------------------------------------------------------------------
// Helpers (service_role: solo para preparar y limpiar)
// ---------------------------------------------------------------------------

const serviceHeaders = {
  apikey:         SERVICE_KEY,
  Authorization:  `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  "User-Agent":   "turnazo-e2e",
};

async function readSettings(request: APIRequestContext): Promise<Settings> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/venues?id=eq.${VENUE_ID}&select=${SETTINGS_COLUMNS}`,
    { headers: { ...serviceHeaders, Accept: "application/vnd.pgrst.object+json" } }
  );
  expect(res.ok()).toBe(true);
  return await res.json() as Settings;
}

async function writeSettings(request: APIRequestContext, settings: Settings) {
  const res = await request.patch(`${SUPABASE_URL}/rest/v1/venues?id=eq.${VENUE_ID}`, {
    headers: { ...serviceHeaders, Prefer: "return=minimal" },
    data: settings,
  });
  expect(res.ok()).toBe(true);
}

async function readMpUserId(request: APIRequestContext): Promise<string | null> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/mp_accounts?venue_id=eq.${VENUE_ID}&select=mp_user_id`,
    { headers: serviceHeaders }
  );
  expect(res.ok()).toBe(true);
  const rows = await res.json() as { mp_user_id: string }[];
  return rows[0]?.mp_user_id ?? null;
}

async function connectFakeMp(request: APIRequestContext) {
  if (await readMpUserId(request)) return;
  const res = await request.post(`${SUPABASE_URL}/rest/v1/mp_accounts`, {
    headers: { ...serviceHeaders, Prefer: "return=minimal" },
    data: {
      venue_id:          VENUE_ID,
      mp_user_id:        FAKE_MP_USER_ID,
      mp_email:          "e2e-fake@mp.test",
      access_token_enc:  "fake:enc:token",
      refresh_token_enc: "fake:enc:refresh",
      expires_at:        new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
    },
  });
  expect(res.ok()).toBe(true);
}

async function disconnectFakeMp(request: APIRequestContext) {
  const res = await request.delete(
    `${SUPABASE_URL}/rest/v1/mp_accounts?venue_id=eq.${VENUE_ID}&mp_user_id=eq.${FAKE_MP_USER_ID}`,
    { headers: { ...serviceHeaders, Prefer: "return=minimal" } }
  );
  expect(res.ok()).toBe(true);
}

type BookingRow = { id: string; status: string; mp_order_id: string | null; cancel_token: string };

async function bookingsNamed(request: APIRequestContext, name: string): Promise<BookingRow[]> {
  const res = await request.get(
    `${SUPABASE_URL}/rest/v1/bookings?venue_id=eq.${VENUE_ID}&customer_name=eq.${encodeURIComponent(name)}&select=id,status,mp_order_id,cancel_token`,
    { headers: serviceHeaders }
  );
  expect(res.ok()).toBe(true);
  return await res.json() as BookingRow[];
}

/** Slot de 90 min a la hora:minuto Mendoza (UTC-3) de la fecha dada. */
function slotIso(fecha: string, hour: number, minute: number) {
  const [y, m, d] = fecha.split("-").map(Number);
  const startUtcMs = Date.UTC(y, m - 1, d, hour + 3, minute, 0);
  return {
    inicio: new Date(startUtcMs).toISOString(),
    fin:    new Date(startUtcMs + 90 * 60 * 1000).toISOString(),
  };
}

function randomToken() {
  let t = "";
  while (t.length < 64) t += Math.random().toString(16).slice(2);
  return t.slice(0, 64);
}

/** Hold como el que deja create_booking_hold, escrito directo con service_role. */
async function insertHold(
  request: APIRequestContext,
  name: string,
  fecha: string,
  hour: number,
  minute: number,
  expiresInMs: number,
): Promise<string> {
  const { inicio, fin } = slotIso(fecha, hour, minute);
  const token = randomToken();
  const res = await request.post(`${SUPABASE_URL}/rest/v1/bookings`, {
    headers: { ...serviceHeaders, Prefer: "return=minimal" },
    data: {
      venue_id:        VENUE_ID,
      court_id:        COURT_ID,
      period:          `[${inicio},${fin})`,
      kind:            "booking",
      source:          "app",
      status:          "hold",
      payment_status:  "unpaid",
      customer_name:   name,
      customer_phone:  "2622777001",
      price_total:     5000,
      deposit_amount:  2500,
      amount_paid:     0,
      hold_expires_at: new Date(Date.now() + expiresInMs).toISOString(),
      mp_order_id:     "ORD-E2E",
      cancel_token:    token,
    },
  });
  expect(res.ok()).toBe(true);
  return token;
}

async function updateBooking(request: APIRequestContext, token: string, patch: Record<string, unknown>) {
  const res = await request.patch(
    `${SUPABASE_URL}/rest/v1/bookings?cancel_token=eq.${token}`,
    { headers: { ...serviceHeaders, Prefer: "return=minimal" }, data: patch }
  );
  expect(res.ok()).toBe(true);
}

function reservarUrl(fecha: string, hour: number, minute: number) {
  const { inicio, fin } = slotIso(fecha, hour, minute);
  return `${VENUE_PATH}/reservar?cancha=${COURT_ID}&fecha=${fecha}` +
    `&inicio=${encodeURIComponent(inicio)}&fin=${encodeURIComponent(fin)}`;
}

// Lunes, al menos 2 días adelante (Cancha 1 abre 08:00; grilla de 90 min:
// 14:00 y 15:30 están alineados). public.spec usa el mismo día a las 11:00.
const FECHA = nextWeekday(1, 2);

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let originalSettings: Settings | null = null;

test.beforeAll(async ({ request }) => {
  if (!SERVICE_KEY) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en .env.local");

  const existing = await readMpUserId(request);
  if (existing && existing !== FAKE_MP_USER_ID) {
    throw new Error("El complejo de prueba tiene una cuenta MP real conectada; no se corre este spec.");
  }

  originalSettings = await readSettings(request);
  await deleteTestBookings(request, ["E2E Pago*"]);
});

test.afterAll(async ({ request }) => {
  await deleteTestBookings(request, ["E2E Pago*"]);
  await deleteTestOutboxRows(request);
  if (originalSettings) await writeSettings(request, originalSettings);
  await disconnectFakeMp(request);
});

// ---------------------------------------------------------------------------
// Pantalla de reserva: opciones según la configuración del complejo
// ---------------------------------------------------------------------------

test.describe("opciones de pago en la pantalla de reserva", () => {
  test("seña + pago total: solo opciones online y botón para ir a pagar", async ({ page, request }) => {
    await connectFakeMp(request);
    await writeSettings(request, DEPOSIT_AND_FULL);

    await page.goto(reservarUrl(FECHA, 14, 0));
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "Confirmar reserva" })).toBeVisible();
    const deposit = page.getByRole("radio", { name: /pagar la seña online/i });
    const full    = page.getByRole("radio", { name: /pagar el total online/i });
    await expect(deposit).toBeVisible();
    await expect(deposit).toBeChecked();
    await expect(full).toBeVisible();
    await expect(page.getByRole("radio", { name: /pagar en el lugar/i })).toHaveCount(0);

    // Montos orientativos: seña = 50 % del precio del turno
    await expect(page.getByText("El resto lo pagás en el lugar.")).toBeVisible();
    await expect(page.getByRole("button", { name: /ir a pagar con mercado pago/i })).toBeVisible();
    await expect(page.getByText(/Tenés 10 minutos para completar el pago/)).toBeVisible();

    // Pago online ⇒ se pide el email (Mercado Pago lo exige para el checkout)
    const email = page.locator('[name="customer_email"]');
    await expect(email).toBeVisible();
    await expect(email).toHaveAttribute("required", "");
    await expect(page.getByText(/te manda ahí el comprobante/)).toBeVisible();
  });

  test("pago total + en el lugar: elegir 'en el lugar' reserva sin pagar", async ({ page, request }) => {
    await connectFakeMp(request);
    await writeSettings(request, FULL_AND_VENUE);

    await page.goto(reservarUrl(FECHA, 14, 0));
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("radio", { name: /pagar la seña online/i })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: /pagar el total online/i })).toBeChecked();

    await page.getByRole("radio", { name: /pagar en el lugar/i }).check();
    const submit = page.getByRole("button", { name: /confirmar reserva/i });
    await expect(submit).toBeVisible();
    // Sin pago online no se pide email
    await expect(page.locator('[name="customer_email"]')).toHaveCount(0);

    await page.locator('[name="customer_name"]').fill("E2E Pago Lugar");
    await page.locator('[name="customer_phone"]').fill("2622 777002");

    const nav = page.waitForURL(/\/turnos\//, { timeout: 25_000 });
    await submit.click({ force: true });
    await nav;

    await expect(page.getByText(/confirmado/i)).toBeVisible();
    await expect(page.getByText("E2E Pago Lugar")).toBeVisible();

    const rows = await bookingsNamed(request, "E2E Pago Lugar");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("confirmed");
    expect(rows[0].mp_order_id).toBeNull();
  });

  test("pago online con cuenta MP inválida: error claro y el horario queda libre", async ({ page, request }) => {
    await connectFakeMp(request);
    await writeSettings(request, DEPOSIT_AND_FULL);

    await page.goto(reservarUrl(FECHA, 15, 30));
    await page.waitForLoadState("networkidle");

    await page.locator('[name="customer_name"]').fill("E2E Pago Online");
    await page.locator('[name="customer_phone"]').fill("2622 777003");
    await page.locator('[name="customer_email"]').fill("e2e.pago@turnazo.test");
    await page.getByRole("radio", { name: /pagar el total online/i }).check();

    await page.getByRole("button", { name: /ir a pagar con mercado pago/i }).click({ force: true });

    // Los tokens de la cuenta falsa no se pueden descifrar → sin token → error
    await expect(
      page.getByText(/No pudimos acceder a la cuenta de Mercado Pago del complejo/)
    ).toBeVisible({ timeout: 20_000 });
    expect(page.url()).toContain("/reservar");

    // El hold se creó y se liberó: no queda nada en 'hold'
    const rows = await bookingsNamed(request, "E2E Pago Online");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("expired");
    expect(rows[0].mp_order_id).toBeNull();

    // El mismo horario se puede reservar de nuevo (otro teléfono, otra persona)
    await page.locator('[name="customer_name"]').fill("E2E Pago Online 2");
    await page.locator('[name="customer_phone"]').fill("2622 777004");
    await page.locator('[name="customer_email"]').fill("e2e.pago2@turnazo.test");
    await page.getByRole("button", { name: /reintentar el pago/i }).click({ force: true });
    // El mensaje del primer intento sigue en pantalla: esperar la fila nueva en la base
    await expect
      .poll(async () => (await bookingsNamed(request, "E2E Pago Online 2")).map((r) => r.status), { timeout: 20_000 })
      .toEqual(["expired"]);
    await expect(
      page.getByText(/No pudimos acceder a la cuenta de Mercado Pago del complejo/)
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Pantalla de vuelta: estado real de la base, no la URL
// ---------------------------------------------------------------------------

test.describe("pantalla de vuelta /pago/[token]", () => {
  test("pendiente con cuenta regresiva, y pasa a confirmada cuando la base cambia", async ({ page, request }) => {
    // Un lunes a las 17:00 Mendoza
    const token = await insertHold(request, "E2E Pago Hold", FECHA, 17, 0, 10 * 60 * 1000);

    // La cuenta regresiva se calcula solo en el navegador: sin error de hidratación.
    const hydration: string[] = [];
    page.on("pageerror", (err) => { if (/hydrat/i.test(err.message)) hydration.push(err.message); });
    page.on("console", (msg) => { if (msg.type() === "error" && /hydrat/i.test(msg.text())) hydration.push(msg.text()); });

    // Parámetros de MP en la URL: se ignoran por completo
    await page.goto(`/pago/${token}?status=approved&collection_status=approved`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Estamos confirmando tu pago")).toBeVisible();
    await expect(page.getByTestId("countdown")).toHaveText(/^(09|10):\d\d$/);
    await expect(page.getByText("Monto: $2.500")).toBeVisible();

    // La cuenta regresiva avanza
    const first = await page.getByTestId("countdown").textContent();
    await expect(page.getByTestId("countdown")).not.toHaveText(first!, { timeout: 5_000 });
    expect(hydration).toEqual([]);

    // "Webhook": confirma la reserva en la base. La pantalla reconcilia cada 15 s.
    await updateBooking(request, token, { status: "confirmed", payment_status: "deposit_paid", amount_paid: 2500 });

    await expect(page.getByText("¡Pago confirmado!")).toBeVisible({ timeout: 25_000 });
    const link = page.getByRole("link", { name: "Ver mi turno" });
    await expect(link).toHaveAttribute("href", `/turnos/${token}`);
  });

  test("'Cancelar y elegir otro horario' libera el hold y vuelve a la pantalla de reserva", async ({ page, request }) => {
    const token = await insertHold(request, "E2E Pago Cancelar", FECHA, 12, 30, 10 * 60 * 1000);

    await page.goto(`/pago/${token}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Estamos confirmando tu pago")).toBeVisible();

    await page.getByRole("button", { name: "Cancelar y elegir otro horario" }).click();

    // Vuelve a la reserva del mismo complejo, cancha y horario
    const { inicio, fin } = slotIso(FECHA, 12, 30);
    await expect(page).toHaveURL(
      `${VENUE_PATH}/reservar?cancha=${COURT_ID}&inicio=${encodeURIComponent(inicio)}&fin=${encodeURIComponent(fin)}&fecha=${FECHA}`,
      { timeout: 15_000 }
    );
    await expect(page.getByRole("heading", { name: "Confirmar reserva" })).toBeVisible();
    await expect(page.getByText("12:30 – 14:00")).toBeVisible();

    // El hold quedó liberado al instante
    await expect
      .poll(async () => (await bookingsNamed(request, "E2E Pago Cancelar")).map((r) => r.status), { timeout: 10_000 })
      .toEqual(["expired"]);

    // Volver a /pago con ese token ya muestra vencida (no hay botón)
    await page.goto(`/pago/${token}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Se venció el tiempo para pagar")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancelar y elegir otro horario" })).toHaveCount(0);
  });

  test("vencida cuando el hold expiró, cancelada, y token inexistente", async ({ page, request }) => {
    const expired = await insertHold(request, "E2E Pago Vencido", FECHA, 18, 30, -60 * 1000);
    await page.goto(`/pago/${expired}?status=approved`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Se venció el tiempo para pagar")).toBeVisible();
    await expect(page.getByText("Estamos confirmando tu pago")).toHaveCount(0);

    await updateBooking(request, expired, { status: "cancelled" });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Este turno fue cancelado")).toBeVisible();

    await page.goto("/pago/token-que-no-existe");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Pago no encontrado.")).toBeVisible();
  });

  test("el dueño sigue viendo el turno confirmado desde /turnos/[token]", async ({ page, request }) => {
    const token = await insertHold(request, "E2E Pago Turno", FECHA, 20, 0, 10 * 60 * 1000);
    await updateBooking(request, token, { status: "confirmed", payment_status: "deposit_paid", amount_paid: 2500 });

    await page.goto(`/turnos/${token}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/confirmado/i)).toBeVisible();
    await expect(page.getByText("E2E Pago Turno")).toBeVisible();
  });
});

// Sanity: el token del dueño sigue sirviendo para la limpieza compartida
test("helpers: el dueño de prueba puede autenticarse", async ({ request }) => {
  expect(await getOwnerToken(request)).toBeTruthy();
  expect(SUPABASE_ANON_KEY).toBeTruthy();
});
