/**
 * HMAC-SHA256 state for OAuth — prevents CSRF.
 * Signed with MP_STATE_SECRET. TTL: 5 minutes.
 * Includes a nonce that must be stored in a httpOnly cookie for single-use validation.
 */
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

function getSecret(): string {
  const s = process.env.MP_STATE_SECRET;
  if (!s) throw new Error("MP_STATE_SECRET not set");
  return s;
}

export interface StatePayload {
  userId: string;
  venueId: string;
  nonce: string;
}

/** Name of the httpOnly cookie that stores the nonce. */
export const OAUTH_NONCE_COOKIE = "mp_oauth_nonce";

/**
 * Build state = base64(json) + "." + hmac.
 * Returns { state, nonce } — caller must set nonce in a httpOnly cookie.
 */
export function createOAuthState(payload: Omit<StatePayload, "nonce">): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("hex");
  const body = { ...payload, nonce, exp: Date.now() + 5 * 60 * 1000 };
  const b64 = Buffer.from(JSON.stringify(body)).toString("base64url");
  const hmac = createHmac("sha256", getSecret()).update(b64).digest("base64url");
  return { state: `${b64}.${hmac}`, nonce };
}

/**
 * Verify state: HMAC + TTL + nonce match. Returns payload or null.
 * Never throws — returns null on any invalid input.
 */
export function verifyOAuthState(state: string, expectedNonce: string | undefined): StatePayload | null {
  if (!expectedNonce) return null;

  const dot = state.indexOf(".");
  if (dot === -1) return null;

  const b64 = state.slice(0, dot);
  const sig = state.slice(dot + 1);

  const expected = createHmac("sha256", getSecret()).update(b64).digest("base64url");

  // Length check before timingSafeEqual to avoid exception on mismatched lengths
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;

  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const body = JSON.parse(Buffer.from(b64, "base64url").toString());
    if (typeof body.exp !== "number" || body.exp < Date.now()) return null;
    if (body.nonce !== expectedNonce) return null;
    return { userId: body.userId, venueId: body.venueId, nonce: body.nonce };
  } catch {
    return null;
  }
}
