/**
 * GET /api/mp/oauth/callback?code=...&state=...
 * MP redirects here after the owner authorizes.
 * Verifies session + state + nonce, exchanges code for tokens, encrypts, and upserts mp_accounts.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyOAuthState, OAUTH_NONCE_COOKIE } from "@/lib/mp/state";
import { encrypt } from "@/lib/mp/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Error codes — the component translates these to user-facing messages. */
type MpErrorCode = "invalid_params" | "expired" | "not_authenticated" | "not_owner" | "exchange_failed" | "save_failed";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  if (!code || !state) {
    return redirectWithError(req, "invalid_params");
  }

  // Read and consume nonce cookie (single use)
  const nonce = req.cookies.get(OAUTH_NONCE_COOKIE)?.value;

  // Verify HMAC state + TTL + nonce
  const payload = verifyOAuthState(state, nonce);
  if (!payload) {
    return redirectWithError(req, "expired");
  }

  const { userId, venueId } = payload;

  // Verify the logged-in user matches the state's userId
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return redirectWithError(req, "not_authenticated", venueId);
  }

  if (user.id !== userId) {
    return redirectWithError(req, "not_owner", venueId);
  }

  // Re-verify venue ownership
  const { data: venue } = await supabase
    .from("venues")
    .select("id")
    .eq("id", venueId)
    .eq("owner_id", user.id)
    .single();

  if (!venue) {
    return redirectWithError(req, "not_owner", venueId);
  }

  // Exchange authorization code for tokens. Any failure here (network, MP down,
  // malformed body) must end in a redirect, never in a raw 500.
  let tokens: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user_id: number;
  };
  try {
    const tokenRes = await fetch("https://api.mercadopago.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type:    "authorization_code",
        client_id:     process.env.MP_CLIENT_ID,
        client_secret: process.env.MP_CLIENT_SECRET,
        code,
        redirect_uri:  process.env.MP_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.json().catch(() => ({})) as { error?: string };
      console.error("[mp/callback] token exchange failed:", tokenRes.status, errBody.error ?? "unknown");
      return redirectWithError(req, "exchange_failed", venueId);
    }

    tokens = await tokenRes.json();
    if (!tokens?.access_token || !tokens.refresh_token || !tokens.user_id) {
      console.error("[mp/callback] token exchange returned an incomplete body");
      return redirectWithError(req, "exchange_failed", venueId);
    }
  } catch (err) {
    console.error("[mp/callback] token exchange threw:", err instanceof Error ? err.message : "unknown");
    return redirectWithError(req, "exchange_failed", venueId);
  }

  // Fetch MP user email (best effort)
  let mpEmail: string | null = null;
  try {
    const meRes = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (meRes.ok) {
      const me = await meRes.json() as { email?: string };
      mpEmail = me.email ?? null;
    }
  } catch {
    // Non-blocking
  }

  // Encrypt + save. encrypt() throws if MP_TOKEN_ENCRYPTION_KEY is missing or
  // malformed, and createAdminClient() throws without the service key: both
  // must end in mp_error=save_failed, never in a raw 500.
  try {
    const accessEnc = encrypt(tokens.access_token);
    const refreshEnc = encrypt(tokens.refresh_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Upsert into mp_accounts using service role (bypasses RLS + column ACL)
    const admin = createAdminClient();

    const { error } = await admin
      .from("mp_accounts")
      .upsert(
        {
          venue_id:          venueId,
          mp_user_id:        String(tokens.user_id),
          mp_email:          mpEmail,
          access_token_enc:  accessEnc,
          refresh_token_enc: refreshEnc,
          expires_at:        expiresAt,
          updated_at:        new Date().toISOString(),
        },
        { onConflict: "venue_id" }
      );

    if (error) {
      console.error("[mp/callback] upsert failed:", error.message);
      return redirectWithError(req, "save_failed", venueId);
    }

    // Audit log (best-effort)
    await admin.from("audit_log").insert({
      profile_id: userId,
      venue_id:   venueId,
      entity:     "mp_account",
      entity_id:  venueId,
      action:     "create",
      new_data:   { mp_user_id: String(tokens.user_id), mp_email: mpEmail },
    });
  } catch (err) {
    // Never log the tokens: only the error message.
    console.error("[mp/callback] save failed:", err instanceof Error ? err.message : "unknown");
    return redirectWithError(req, "save_failed", venueId);
  }

  // Redirect back to venue edit page with success + delete nonce cookie
  const url = new URL(`/panel/complejos/${venueId}`, req.url);
  url.searchParams.set("mp", "connected");
  const response = NextResponse.redirect(url);
  response.cookies.delete(OAUTH_NONCE_COOKIE);
  return response;
}

function redirectWithError(req: NextRequest, code: MpErrorCode, venueId?: string) {
  // Only use venueId if it was verified (passed explicitly); don't parse from unverified state
  const path = venueId ? `/panel/complejos/${venueId}` : "/panel/complejos";
  const url = new URL(path, req.url);
  url.searchParams.set("mp_error", code);
  const response = NextResponse.redirect(url);
  response.cookies.delete(OAUTH_NONCE_COOKIE);
  return response;
}
