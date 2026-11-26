/**
 * Mercado Pago — API de Orders (Checkout Pro con redirección).
 *
 * Verificado contra la documentación oficial (2026-11-15):
 *   POST /v1/orders
 *   - Headers: Authorization: Bearer <token del vendedor (OAuth)>,
 *              X-Idempotency-Key (obligatorio, 1–128 chars).
 *   - Body: type "online" y processing_mode "manual" (únicos valores para
 *     Checkout Pro), total_amount (string, 2 decimales, = suma de items),
 *     external_reference (≤ 64 chars), expiration_time (duración ISO 8601
 *     contada desde la creación), payer.email ("Required for all Checkout
 *     Pro orders", referencia 2026-11-16; sin él la orden se crea pero el
 *     checkout rechaza el pago), items[] (title, unit_price, quantity;
 *     description y category_id opcionales, los usa el antifraude),
 *     config.online.{success_url, failure_url, pending_url, auto_return},
 *     config.payment_method.
 *   - Respuesta 201: { id, status: "created", checkout_url, ... }.
 *     El comprador se redirige a checkout_url.
 *   GET /v1/orders/{id}
 *   - Orden pagada y acreditada al vendedor: status "processed" +
 *     status_detail "accredited". transactions.payments[] trae id, amount,
 *     paid_amount, status, status_detail.
 *   POST /v1/orders/{id}/refund   (X-Idempotency-Key obligatorio)
 *   - Body vacío = reembolso total. 201 con status "refunded".
 *     409 order_already_refunded si ya se devolvió.
 *   POST /v1/orders/{id}/cancel   (X-Idempotency-Key obligatorio)
 *   - Solo órdenes en created / action_required. 409 cannot_cancel_order
 *     si ya se pagó, 409 order_already_canceled si ya estaba cancelada.
 *
 * No se manda marketplace_fee: el modelo es cuota mensual, 0 % por reserva.
 * No existe notification_url por orden en Orders: el webhook se configura
 * en el panel de la app de MP (Webhooks → tema "Order (Mercado Pago)").
 */

export const MP_API_BASE = "https://api.mercadopago.com";

export type MpError = { ok: false; status: number; code: string; message: string };

// ---------------------------------------------------------------------------
// Helper HTTP (nunca loguea el token ni el body)
// ---------------------------------------------------------------------------

async function mpRequest(
  method: "GET" | "POST",
  path: string,
  accessToken: string,
  opts: { body?: unknown; idempotencyKey?: string } = {},
): Promise<{ ok: true; status: number; data: Record<string, unknown> } | MpError> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept:         "application/json",
    Authorization:  `Bearer ${accessToken}`,
  };
  if (opts.idempotencyKey) headers["X-Idempotency-Key"] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${MP_API_BASE}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      code: "network_error",
      message: err instanceof Error ? err.message : "fetch failed",
    };
  }

  const data = await res.json().catch(() => ({})) as Record<string, unknown>;

  if (!res.ok) {
    const errors = data.errors as { code?: string; message?: string }[] | undefined;
    return {
      ok: false,
      status: res.status,
      code: String(errors?.[0]?.code ?? data.error ?? data.code ?? "mp_error"),
      message: String(errors?.[0]?.message ?? data.message ?? "unknown"),
    };
  }

  return { ok: true, status: res.status, data };
}

// ---------------------------------------------------------------------------
// Crear orden
// ---------------------------------------------------------------------------

export type CreateMpOrderInput = {
  /** access_token del dueño (OAuth), ya descifrado */
  accessToken: string;
  /** booking_id: evita órdenes duplicadas si se reintenta */
  idempotencyKey: string;
  /** booking_id: para que el webhook encuentre la reserva */
  externalReference: string;
  /** Monto en ARS, calculado por la base (nunca por el navegador) */
  amount: number;
  /** Descripción que ve el jugador en el checkout */
  title: string;
  /** Email del jugador: obligatorio en Checkout Pro (ahí llega el comprobante) */
  payerEmail: string;
  /** Nombre del jugador tal como lo escribió (opcional, ayuda al antifraude) */
  payerName?: string;
  /** URL de vuelta (éxito, fallo y pendiente van a la misma: no se confía en ella) */
  backUrl: string;
  /** Duración ISO 8601, ej. "PT10M" (vence junto con el hold) */
  expiresIn: string;
};

export type CreateMpOrderResult =
  | { ok: true; orderId: string; checkoutUrl: string }
  | MpError;

export async function createMpOrder(input: CreateMpOrderInput): Promise<CreateMpOrderResult> {
  const amount = input.amount.toFixed(2);

  // "Juan García" → first_name "Juan", last_name "García" (MP los usa para el antifraude).
  const nameParts = (input.payerName ?? "").trim().split(/\s+/).filter(Boolean);
  const payer: Record<string, string> = { email: input.payerEmail.trim() };
  if (nameParts.length > 0) payer.first_name = nameParts[0];
  if (nameParts.length > 1) payer.last_name = nameParts.slice(1).join(" ");

  const body = {
    type:               "online",
    processing_mode:    "manual",
    total_amount:       amount,
    external_reference: input.externalReference,
    expiration_time:    input.expiresIn,
    payer,
    items: [
      {
        title:       input.title,
        description: "Reserva de cancha en Depoturnos",
        category_id: "services",
        unit_price:  amount,
        quantity:    1,
      },
    ],
    config: {
      online: {
        success_url: input.backUrl,
        failure_url: input.backUrl,
        pending_url: input.backUrl,
        auto_return: "all",
      },
      // El hold dura 10 minutos: los medios offline (Rapipago, Pago Fácil)
      // nunca acreditan a tiempo.
      payment_method: {
        not_allowed_types: ["ticket"],
      },
    },
  };

  const res = await mpRequest("POST", "/v1/orders", input.accessToken, {
    body,
    idempotencyKey: input.idempotencyKey,
  });
  if (!res.ok) return res;

  const orderId = res.data.id;
  const checkoutUrl = res.data.checkout_url;

  if (typeof orderId !== "string" || !orderId || typeof checkoutUrl !== "string" || !checkoutUrl) {
    return {
      ok: false,
      status: res.status,
      code: "invalid_response",
      message: "La respuesta de Mercado Pago no trae id o checkout_url",
    };
  }

  return { ok: true, orderId, checkoutUrl };
}

// ---------------------------------------------------------------------------
// Consultar orden
// ---------------------------------------------------------------------------

export type MpOrderPayment = {
  id?: string | number;
  amount?: string | number;
  paid_amount?: string | number;
  status?: string;
  status_detail?: string;
};

export type MpOrder = {
  id: string;
  status: string;
  status_detail?: string;
  external_reference?: string;
  total_amount?: string | number;
  total_paid_amount?: string | number;
  currency?: string;
  transactions?: { payments?: MpOrderPayment[] };
  [key: string]: unknown;
};

export async function getMpOrder(
  accessToken: string,
  orderId: string,
): Promise<{ ok: true; order: MpOrder } | MpError> {
  const res = await mpRequest("GET", `/v1/orders/${encodeURIComponent(orderId)}`, accessToken);
  if (!res.ok) return res;
  const order = res.data as unknown as MpOrder;
  if (typeof order.id !== "string" || typeof order.status !== "string") {
    return { ok: false, status: res.status, code: "invalid_response", message: "La orden no trae id o status" };
  }
  return { ok: true, order };
}

/** Orden pagada y acreditada al vendedor. */
export function isMpOrderPaid(order: MpOrder): boolean {
  return order.status === "processed" && order.status_detail === "accredited";
}

/** Primer pago procesado de la orden (id como string). */
export function mpOrderPaymentId(order: MpOrder): string | null {
  const payments = order.transactions?.payments ?? [];
  const paid = payments.find((p) => p.status === "processed") ?? payments[0];
  if (!paid || paid.id === undefined || paid.id === null) return null;
  return String(paid.id);
}

// ---------------------------------------------------------------------------
// Reembolso total
// ---------------------------------------------------------------------------

export async function refundMpOrder(
  accessToken: string,
  orderId: string,
  idempotencyKey: string,
): Promise<{ ok: true; alreadyRefunded: boolean } | MpError> {
  const res = await mpRequest("POST", `/v1/orders/${encodeURIComponent(orderId)}/refund`, accessToken, {
    body: {},
    idempotencyKey,
  });
  if (res.ok) return { ok: true, alreadyRefunded: false };
  // Reintento de un reembolso que ya se hizo: lo damos por bueno.
  if (res.status === 409 && (res.code === "order_already_refunded" || res.code === "idempotency_key_already_used")) {
    return { ok: true, alreadyRefunded: true };
  }
  return res;
}

// ---------------------------------------------------------------------------
// Cancelar orden (solo created / action_required)
// ---------------------------------------------------------------------------

export async function cancelMpOrder(
  accessToken: string,
  orderId: string,
  idempotencyKey: string,
): Promise<{ ok: true; alreadyCancelled: boolean } | MpError> {
  const res = await mpRequest("POST", `/v1/orders/${encodeURIComponent(orderId)}/cancel`, accessToken, {
    body: {},
    idempotencyKey,
  });
  if (res.ok) return { ok: true, alreadyCancelled: false };
  if (res.status === 409 && res.code === "order_already_canceled") {
    return { ok: true, alreadyCancelled: true };
  }
  return res;
}
