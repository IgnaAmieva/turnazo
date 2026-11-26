import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "@/lib/turnstile";

// Fase 7 S2: el captcha se verifica en el servidor. Falla cerrado, pero si
// Cloudflare no responde reintenta una vez y lo distingue ('unavailable').
describe("verifyTurnstile", () => {
  const fetchMock = vi.fn();
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    process.env.TURNSTILE_SECRET_KEY = "secreto-de-prueba";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.TURNSTILE_SECRET_KEY = originalSecret;
  });

  const reply = (json: unknown, status = 200) =>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(json), { status }));

  it("token válido → ok, y manda secreto, token, IP e idempotency_key a siteverify", async () => {
    reply({ success: true });
    expect(await verifyTurnstile("tok", "1.2.3.4")).toBe("ok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = init.body as URLSearchParams;
    expect(body.get("secret")).toBe("secreto-de-prueba");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("1.2.3.4");
    expect(body.get("idempotency_key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("Cloudflare dice que no → invalid, sin reintentar", async () => {
    reply({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await verifyTurnstile("tok", null)).toBe("invalid");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sin token, o token gigante → invalid sin llamar a Cloudflare", async () => {
    expect(await verifyTurnstile(null, null)).toBe("invalid");
    expect(await verifyTurnstile("", null)).toBe("invalid");
    expect(await verifyTurnstile("x".repeat(3000), null)).toBe("invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sin TURNSTILE_SECRET_KEY → unavailable (no se reserva) sin llamar a Cloudflare", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(await verifyTurnstile("tok", null)).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Cloudflare no responde una vez: reintenta (mismo idempotency_key) y pasa", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
    reply({ success: true });
    expect(await verifyTurnstile("tok", null)).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const keys = fetchMock.mock.calls.map(([, init]) => (init.body as URLSearchParams).get("idempotency_key"));
    expect(keys[0]).toBe(keys[1]);
  });

  it("Cloudflare caído las dos veces (HTTP 500, 429, red, internal-error) → unavailable", async () => {
    reply({}, 500); reply({}, 503);
    expect(await verifyTurnstile("tok", null)).toBe("unavailable");
    reply({}, 429); fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await verifyTurnstile("tok", null)).toBe("unavailable");
    reply({ success: false, "error-codes": ["internal-error"] }); reply({ success: false, "error-codes": ["internal-error"] });
    expect(await verifyTurnstile("tok", null)).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("respuesta rara (success no es true) → invalid", async () => {
    reply({ success: "true" });
    expect(await verifyTurnstile("tok", null)).toBe("invalid");
  });
});
