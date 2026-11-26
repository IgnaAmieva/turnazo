/**
 * Verificación del captcha Cloudflare Turnstile (Fase 7 S2), SIEMPRE del lado
 * del servidor (la reserva, el pago, el login y el registro). Nunca loguea el
 * token ni la clave.
 *
 * - 'ok': Cloudflare dijo que sí.
 * - 'invalid': sin token, token raro o Cloudflare dijo que no → no se sigue.
 * - 'unavailable': Cloudflare no respondió (o falta la clave). Antes de darlo
 *   por caído se reintenta una vez, corto; si sigue sin responder, no se
 *   reserva, pero el jugador ve un mensaje claro y puede volver a tocar
 *   (ningún estado queda trabado: cada intento empieza de cero).
 */
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Por intento: con Cloudflare sano responde en menos de medio segundo. */
export const SITEVERIFY_TIMEOUT_MS = 4000;
/** Pausa antes del único reintento. */
export const SITEVERIFY_RETRY_DELAY_MS = 300;

export type TurnstileResult = 'ok' | 'invalid' | 'unavailable';

/** Una llamada a siteverify; null = no respondió (se puede reintentar). */
async function siteverify(body: URLSearchParams): Promise<TurnstileResult | null> {
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (res.status >= 500 || res.status === 429) {
      console.error('[turnstile] siteverify HTTP', res.status);
      return null;
    }
    if (!res.ok) {
      console.error('[turnstile] siteverify HTTP', res.status);
      return 'invalid';
    }
    const json = (await res.json()) as { success?: unknown; 'error-codes'?: unknown };
    if (json.success === true) return 'ok';
    const codes = Array.isArray(json['error-codes']) ? json['error-codes'].map(String) : [];
    // internal-error: problema de Cloudflare, no del jugador → reintentable
    if (codes.includes('internal-error')) return null;
    console.warn('[turnstile] rechazado', codes.join(','));
    return 'invalid';
  } catch (err) {
    console.error('[turnstile] siteverify no respondió', err instanceof Error ? err.name : 'error');
    return null;
  }
}

export async function verifyTurnstile(token: string | null, remoteIp: string | null): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error('[turnstile] falta TURNSTILE_SECRET_KEY');
    return 'unavailable';
  }
  if (!token || token.length > 2048) return 'invalid';

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);
  // idempotency_key: el reintento con el mismo token no cuenta como "token ya usado"
  body.set('idempotency_key', crypto.randomUUID());

  const first = await siteverify(body);
  if (first) return first;
  await new Promise((r) => setTimeout(r, SITEVERIFY_RETRY_DELAY_MS));
  return (await siteverify(body)) ?? 'unavailable';
}
