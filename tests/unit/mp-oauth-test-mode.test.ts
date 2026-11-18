/**
 * MP_OAUTH_TEST_MODE: con "true", el intercambio OAuth del callback y el
 * refresh de token.ts mandan test_token: true; sin la variable (o con otro
 * valor) no lo mandan. El callback loguea solo live_mode, nunca los tokens.
 * fetch, Supabase y el cifrado están simulados: no se llama a nada real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const VENUE_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const ACCESS = "APP_USR-access-secreto";
const REFRESH = "TG-refresh-secreto";

vi.mock("@/lib/mp/state", () => ({
  OAUTH_NONCE_COOKIE: "mp_oauth_nonce",
  verifyOAuthState: () => ({ userId: USER_ID, venueId: VENUE_ID }),
}));

vi.mock("@/lib/mp/crypto", () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ""),
}));

/** Query builder encadenable: cualquier método devuelve el builder; await o single() resuelven `result`. */
function builder(result: unknown) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "update", "upsert", "insert"]) b[m] = () => b;
  b.single = async () => result;
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: () => builder({ data: { id: VENUE_ID }, error: null }),
  }),
}));

// La cuenta vence en 1 minuto: getMpToken tiene que renovar.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      table === "mp_accounts"
        ? builder({
            data: {
              id: "acc-1",
              mp_user_id: "3852550904",
              access_token_enc: `enc:${ACCESS}`,
              refresh_token_enc: `enc:${REFRESH}`,
              expires_at: new Date(Date.now() + 60_000).toISOString(),
            },
            error: null,
            count: 1,
          })
        : builder({ data: null, error: null }),
  }),
}));

const fetchMock = vi.fn();

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function tokenBody(liveMode: boolean) {
  return { access_token: ACCESS, refresh_token: REFRESH, expires_in: 15552000, user_id: 3852550904, live_mode: liveMode };
}

/** Body JSON del POST a /oauth/token. */
function oauthBody() {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/oauth/token"));
  expect(call).toBeDefined();
  return JSON.parse(String((call![1] as RequestInit).body));
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    String(url).endsWith("/oauth/token") ? json(200, tokenBody(false)) : json(200, { email: "vendedor@testuser.com" })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function runCallback() {
  const { GET } = await import("@/app/api/mp/oauth/callback/route");
  const req = new NextRequest("http://localhost:3001/api/mp/oauth/callback?code=TG-code&state=firmado");
  return GET(req);
}

describe("callback OAuth y MP_OAUTH_TEST_MODE", () => {
  it('con "true" manda test_token: true y conecta', async () => {
    vi.stubEnv("MP_OAUTH_TEST_MODE", "true");
    const res = await runCallback();
    expect(oauthBody()).toMatchObject({ grant_type: "authorization_code", code: "TG-code", test_token: true });
    expect(res.headers.get("location")).toContain(`/panel/complejos/${VENUE_ID}?mp=connected`);
  });

  it.each([undefined, "false", "1", "TRUE"])("con %s no manda test_token", async (value) => {
    if (value !== undefined) vi.stubEnv("MP_OAUTH_TEST_MODE", value);
    else vi.stubEnv("MP_OAUTH_TEST_MODE", undefined as unknown as string);
    await runCallback();
    expect(oauthBody()).not.toHaveProperty("test_token");
  });

  it("loguea solo live_mode, sin tokens", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await runCallback();
    expect(info).toHaveBeenCalledWith("[mp/callback] live_mode:", false);
    const logged = JSON.stringify([...info.mock.calls, ...error.mock.calls]);
    expect(logged).not.toContain(ACCESS);
    expect(logged).not.toContain(REFRESH);
  });
});

describe("refresh de token y MP_OAUTH_TEST_MODE", () => {
  it('con "true" manda test_token: true al renovar', async () => {
    vi.stubEnv("MP_OAUTH_TEST_MODE", "true");
    const { getMpToken } = await import("@/lib/mp/token");
    const token = await getMpToken(VENUE_ID);
    expect(token?.accessToken).toBe(ACCESS);
    expect(oauthBody()).toMatchObject({ grant_type: "refresh_token", refresh_token: REFRESH, test_token: true });
  });

  it("sin la variable no manda test_token", async () => {
    vi.stubEnv("MP_OAUTH_TEST_MODE", undefined as unknown as string);
    const { getMpToken } = await import("@/lib/mp/token");
    await getMpToken(VENUE_ID);
    expect(oauthBody()).not.toHaveProperty("test_token");
  });
});
