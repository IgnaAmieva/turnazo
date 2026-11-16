/**
 * createMpOrder — cliente de la API de Orders con Mercado Pago simulado
 * (fetch mockeado). Nunca llama a la API real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMpOrder, getMpOrder, refundMpOrder, cancelMpOrder,
  isMpOrderPaid, mpOrderPaymentId, MP_API_BASE,
} from "@/lib/mp/orders";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const input = {
  accessToken:       "APP_USR-seller-token",
  idempotencyKey:    "11111111-2222-3333-4444-555555555555",
  externalReference: "11111111-2222-3333-4444-555555555555",
  amount:            2500,
  title:             "Seña de turno",
  backUrl:           "https://turnazo.test/pago/abc123",
  expiresIn:         "PT10M",
};

describe("createMpOrder", () => {
  it("manda la orden con el token del vendedor, sin marketplace_fee y con idempotencia", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, {
      id: "ORD01TEST",
      status: "created",
      checkout_url: "https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORD01TEST",
    }));

    const result = await createMpOrder(input);

    expect(result).toEqual({
      ok: true,
      orderId: "ORD01TEST",
      checkoutUrl: "https://www.mercadopago.com.ar/checkout/v1/redirect?order_id=ORD01TEST",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MP_API_BASE}/v1/orders`);
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer APP_USR-seller-token");
    expect(headers["X-Idempotency-Key"]).toBe(input.idempotencyKey);

    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      type:               "online",
      processing_mode:    "manual",
      total_amount:       "2500.00",
      external_reference: input.externalReference,
      expiration_time:    "PT10M",
      items: [{ title: "Seña de turno", unit_price: "2500.00", quantity: 1 }],
      config: {
        online: {
          success_url: input.backUrl,
          failure_url: input.backUrl,
          pending_url: input.backUrl,
          auto_return: "all",
        },
        payment_method: { not_allowed_types: ["ticket"] },
      },
    });
    expect(body).not.toHaveProperty("marketplace_fee");
    expect(body).not.toHaveProperty("notification_url");
  });

  it("formatea montos con dos decimales y total = suma de items", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: "X", checkout_url: "https://mp/x" }));
    await createMpOrder({ ...input, amount: 1234.5 });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.total_amount).toBe("1234.50");
    expect(body.items[0].unit_price).toBe("1234.50");
  });

  it("devuelve el error de MP cuando responde 4xx", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, {
      errors: [{ code: "invalid_expiration_time", message: "expiration_time inválido" }],
    }));

    const result = await createMpOrder(input);
    expect(result).toEqual({
      ok: false,
      status: 400,
      code: "invalid_expiration_time",
      message: "expiration_time inválido",
    });
  });

  it("devuelve error si la respuesta no trae checkout_url", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: "ORD-sin-url", status: "created" }));
    const result = await createMpOrder(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_response");
  });

  it("devuelve network_error si fetch falla", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    const result = await createMpOrder(input);
    expect(result).toEqual({ ok: false, status: 0, code: "network_error", message: "ECONNRESET" });
  });
});

describe("getMpOrder / isMpOrderPaid / mpOrderPaymentId", () => {
  it("consulta GET /v1/orders/{id} con el token del vendedor", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {
      id: "ORD01", status: "processed", status_detail: "accredited",
      external_reference: "booking-1", total_amount: "2500.00", total_paid_amount: "2500.00", currency: "ARS",
      transactions: { payments: [{ id: "PAY-1", amount: "2500.00", paid_amount: "2500.00", status: "processed", status_detail: "accredited" }] },
    }));

    const res = await getMpOrder("APP_USR-seller-token", "ORD01");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.order.id).toBe("ORD01");
    expect(isMpOrderPaid(res.order)).toBe(true);
    expect(mpOrderPaymentId(res.order)).toBe("PAY-1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MP_API_BASE}/v1/orders/ORD01`);
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer APP_USR-seller-token");
    expect(init.body).toBeUndefined();
  });

  it("una orden created / processing / canceled / refunded no cuenta como pagada", () => {
    for (const [status, status_detail] of [
      ["created", undefined], ["processing", "in_process"], ["action_required", "waiting_transfer"],
      ["failed", "cc_rejected_insufficient_amount"], ["canceled", undefined], ["refunded", "refunded"],
      ["processed", "partially_refunded"],
    ] as const) {
      expect(isMpOrderPaid({ id: "x", status, status_detail })).toBe(false);
    }
  });

  it("mpOrderPaymentId devuelve null sin pagos y convierte ids numéricos a string", () => {
    expect(mpOrderPaymentId({ id: "x", status: "created" })).toBeNull();
    expect(mpOrderPaymentId({ id: "x", status: "processed", transactions: { payments: [{ id: 123456, status: "processed" }] } })).toBe("123456");
  });

  it("devuelve el error de MP si la orden no existe", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { errors: [{ code: "order_not_found", message: "not found" }] }));
    const res = await getMpOrder("tok", "NOPE");
    expect(res).toEqual({ ok: false, status: 404, code: "order_not_found", message: "not found" });
  });
});

describe("refundMpOrder", () => {
  it("POST /v1/orders/{id}/refund con X-Idempotency-Key y body vacío (reembolso total)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: "ORD01", status: "refunded" }));
    const res = await refundMpOrder("tok", "ORD01", "refund-PAY-1");
    expect(res).toEqual({ ok: true, alreadyRefunded: false });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MP_API_BASE}/v1/orders/ORD01/refund`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Idempotency-Key"]).toBe("refund-PAY-1");
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it("409 order_already_refunded se trata como éxito (reintento)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { errors: [{ code: "order_already_refunded", message: "x" }] }));
    expect(await refundMpOrder("tok", "ORD01", "k")).toEqual({ ok: true, alreadyRefunded: true });
  });

  it("otros errores se devuelven tal cual", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { errors: [{ code: "cannot_refund_order", message: "no" }] }));
    expect(await refundMpOrder("tok", "ORD01", "k")).toEqual({ ok: false, status: 409, code: "cannot_refund_order", message: "no" });
  });
});

describe("cancelMpOrder", () => {
  it("POST /v1/orders/{id}/cancel; order_already_canceled cuenta como éxito", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "ORD01", status: "canceled" }));
    expect(await cancelMpOrder("tok", "ORD01", "cancel-1")).toEqual({ ok: true, alreadyCancelled: false });
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(`${MP_API_BASE}/v1/orders/ORD01/cancel`);

    fetchMock.mockResolvedValueOnce(jsonResponse(409, { errors: [{ code: "order_already_canceled", message: "x" }] }));
    expect(await cancelMpOrder("tok", "ORD01", "cancel-1")).toEqual({ ok: true, alreadyCancelled: true });

    fetchMock.mockResolvedValueOnce(jsonResponse(409, { errors: [{ code: "cannot_cancel_order", message: "paid" }] }));
    expect((await cancelMpOrder("tok", "ORD01", "cancel-1")).ok).toBe(false);
  });
});
