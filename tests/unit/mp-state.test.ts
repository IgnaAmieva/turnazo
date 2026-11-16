import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.MP_STATE_SECRET = "test-secret-for-unit-tests-32chars!";
});

describe("mp/state", () => {
  it("creates and verifies a valid state with matching nonce", async () => {
    const { createOAuthState, verifyOAuthState } = await import("@/lib/mp/state");
    const { state, nonce } = createOAuthState({ userId: "user-1", venueId: "venue-1" });

    expect(state).toContain(".");
    const payload = verifyOAuthState(state, nonce);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("user-1");
    expect(payload!.venueId).toBe("venue-1");
    expect(payload!.nonce).toBe(nonce);
  });

  it("rejects when nonce does not match", async () => {
    const { createOAuthState, verifyOAuthState } = await import("@/lib/mp/state");
    const { state } = createOAuthState({ userId: "user-1", venueId: "venue-1" });

    expect(verifyOAuthState(state, "wrong-nonce")).toBeNull();
  });

  it("rejects when nonce is undefined", async () => {
    const { createOAuthState, verifyOAuthState } = await import("@/lib/mp/state");
    const { state } = createOAuthState({ userId: "user-1", venueId: "venue-1" });

    expect(verifyOAuthState(state, undefined)).toBeNull();
  });

  it("rejects expired state", async () => {
    const { verifyOAuthState } = await import("@/lib/mp/state");
    const { createHmac } = await import("crypto");

    // Build an expired state manually
    const body = { userId: "u", venueId: "v", nonce: "n", exp: Date.now() - 1000 };
    const b64 = Buffer.from(JSON.stringify(body)).toString("base64url");
    const hmac = createHmac("sha256", process.env.MP_STATE_SECRET!)
      .update(b64)
      .digest("base64url");

    expect(verifyOAuthState(`${b64}.${hmac}`, "n")).toBeNull();
  });

  it("rejects tampered signature", async () => {
    const { createOAuthState, verifyOAuthState } = await import("@/lib/mp/state");
    const { state, nonce } = createOAuthState({ userId: "user-1", venueId: "venue-1" });

    const [b64] = state.split(".");
    const tampered = `${b64}.tampered-signature`;
    expect(verifyOAuthState(tampered, nonce)).toBeNull();
  });

  it("does not throw on signature with different length", async () => {
    const { createOAuthState, verifyOAuthState } = await import("@/lib/mp/state");
    const { state, nonce } = createOAuthState({ userId: "user-1", venueId: "venue-1" });

    const [b64] = state.split(".");
    // Much shorter signature — would crash timingSafeEqual without length check
    expect(verifyOAuthState(`${b64}.ab`, nonce)).toBeNull();
    // Much longer signature
    expect(verifyOAuthState(`${b64}.${"a".repeat(200)}`, nonce)).toBeNull();
  });

  it("rejects state without dot separator", async () => {
    const { verifyOAuthState } = await import("@/lib/mp/state");
    expect(verifyOAuthState("nodothere", "nonce")).toBeNull();
  });

  it("rejects garbage base64 payload", async () => {
    const { verifyOAuthState } = await import("@/lib/mp/state");
    // This has a dot but the payload is garbage
    expect(verifyOAuthState("not-base64.not-hmac", "nonce")).toBeNull();
  });
});
