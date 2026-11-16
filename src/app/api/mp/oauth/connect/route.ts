/**
 * GET /api/mp/oauth/connect?venueId=...
 * Generates HMAC state + nonce cookie and redirects the owner to MP authorization page.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createOAuthState, OAUTH_NONCE_COOKIE } from "@/lib/mp/state";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const venueId = req.nextUrl.searchParams.get("venueId");
  if (!venueId) {
    return NextResponse.json({ error: "Missing venueId" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Verify ownership
  const { data: venue } = await supabase
    .from("venues")
    .select("id")
    .eq("id", venueId)
    .eq("owner_id", user.id)
    .single();

  if (!venue) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const clientId = process.env.MP_CLIENT_ID;
  const redirectUri = process.env.MP_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "MP not configured" }, { status: 500 });
  }

  const { state, nonce } = createOAuthState({ userId: user.id, venueId });

  const mpUrl = new URL("https://auth.mercadopago.com.ar/authorization");
  mpUrl.searchParams.set("client_id", clientId);
  mpUrl.searchParams.set("response_type", "code");
  mpUrl.searchParams.set("platform_id", "mp");
  mpUrl.searchParams.set("redirect_uri", redirectUri);
  mpUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(mpUrl.toString());

  // Store nonce in httpOnly cookie (single-use: callback will consume it)
  response.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/api/mp/oauth/callback",
    maxAge:   5 * 60, // 5 minutes, same as state TTL
  });

  return response;
}
