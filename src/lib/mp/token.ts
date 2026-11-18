/**
 * getMpToken(venueId) — reads encrypted tokens from mp_accounts,
 * decrypts, auto-refreshes if expiring within 1 hour, returns access_token.
 *
 * Uses service_role client (bypasses RLS + column ACL).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "./crypto";

interface MpTokenResult {
  accessToken: string;
  mpUserId: string;
}

export async function getMpToken(venueId: string): Promise<MpTokenResult | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("mp_accounts")
    .select("id, mp_user_id, access_token_enc, refresh_token_enc, expires_at")
    .eq("venue_id", venueId)
    .single();

  if (error || !data) return null;

  const expiresAt = new Date(data.expires_at).getTime();
  const oneHourFromNow = Date.now() + 60 * 60 * 1000;

  // If token expires within 1 hour, refresh it
  if (expiresAt < oneHourFromNow) {
    let refreshToken: string;
    try {
      refreshToken = decrypt(data.refresh_token_enc);
    } catch (err) {
      console.error("[mp] failed to decrypt refresh token for venue", venueId);
      return null;
    }

    const refreshed = await refreshMpToken(refreshToken);
    if (!refreshed) return null;

    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

    // Optimistic locking: only update if expires_at hasn't changed
    // (another process might have already refreshed)
    const { error: updateError, count } = await supabase
      .from("mp_accounts")
      .update({
        access_token_enc:  encrypt(refreshed.access_token),
        refresh_token_enc: encrypt(refreshed.refresh_token),
        expires_at:        newExpiresAt,
        updated_at:        new Date().toISOString(),
      }, { count: "exact" })
      .eq("id", data.id)
      .eq("expires_at", data.expires_at);

    if (updateError) {
      // The refreshed token was NOT persisted — do not hand it out.
      console.error("[mp] failed to save refreshed token for venue", venueId, updateError.message);
      return null;
    }

    if (count === 0) {
      // Another process already refreshed — re-read and use their token
      const { data: fresh } = await supabase
        .from("mp_accounts")
        .select("access_token_enc, mp_user_id")
        .eq("venue_id", venueId)
        .single();

      if (!fresh) return null;

      try {
        return { accessToken: decrypt(fresh.access_token_enc), mpUserId: fresh.mp_user_id };
      } catch {
        console.error("[mp] failed to decrypt re-read token for venue", venueId);
        return null;
      }
    }

    return { accessToken: refreshed.access_token, mpUserId: data.mp_user_id };
  }

  try {
    return { accessToken: decrypt(data.access_token_enc), mpUserId: data.mp_user_id };
  } catch {
    console.error("[mp] failed to decrypt access token for venue", venueId);
    return null;
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
}

async function refreshMpToken(refreshToken: string): Promise<TokenResponse | null> {
  const res = await fetch("https://api.mercadopago.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type:    "refresh_token",
      client_id:     process.env.MP_CLIENT_ID,
      client_secret: process.env.MP_CLIENT_SECRET,
      refresh_token: refreshToken,
      // Igual que en el callback: credenciales de prueba solo con MP_OAUTH_TEST_MODE=true.
      ...(process.env.MP_OAUTH_TEST_MODE === "true" ? { test_token: true } : {}),
    }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as { error?: string };
    console.error("[mp] refresh failed:", res.status, errBody.error ?? "unknown");
    return null;
  }

  return res.json() as Promise<TokenResponse>;
}
