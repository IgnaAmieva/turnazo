import { createHmac } from 'node:crypto';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeArgentinePhone } from '@/lib/phone';
import { verifyTurnstile } from '@/lib/turnstile';
import { bookingError } from '@/lib/booking-errors';

/**
 * Anti-abuso (Fase 7 S2): captcha + límites por IP, por teléfono y por token
 * (migración 022, rate_limit_hit).
 *
 * - El captcha falla cerrado: sin un token que Cloudflare confirme no se
 *   reserva ni se entra al panel. Si Cloudflare no responde, el mensaje lo
 *   dice y se puede volver a intentar (lib/turnstile.ts reintenta una vez).
 * - Los límites fallan abiertos: si la base no responde (o falta
 *   RATE_LIMIT_SECRET) se loguea y se deja pasar, para no tirar las reservas
 *   reales por un problema del contador.
 * - A la base solo llega un HMAC-SHA256 (clave RATE_LIMIT_SECRET) de la IP /
 *   teléfono / token / email, nunca el valor.
 * - Los mensajes salen del catálogo (lib/booking-errors.ts).
 */

export type Limit = { bucket: string; max: number; windowSeconds: number };

export const BOOKING_LIMITS = {
  /** Intentos de reserva (con o sin pago) por IP. Holgado por el CGNAT de las telefónicas. */
  ip:    { bucket: 'booking_ip',    max: 20, windowSeconds: 3600 },
  /** Intentos de reserva por teléfono, en cualquier complejo. */
  phone: { bucket: 'booking_phone', max: 8,  windowSeconds: 86400 },
} as const satisfies Record<string, Limit>;

/** Login y registro de dueños, por IP (además de los límites propios de Supabase Auth). */
export const AUTH_LIMITS = {
  login:  { bucket: 'login_ip',  max: 20, windowSeconds: 900 },
  signup: { bucket: 'signup_ip', max: 10, windowSeconds: 3600 },
} as const satisfies Record<string, Limit>;

/** Consultas a Mercado Pago desde /pago: una cada 10 s por reserva (la pantalla consulta cada 15 s). */
export const RECONCILE_LIMIT = { bucket: 'reconcile_token', max: 1, windowSeconds: 10 } as const satisfies Limit;

let warnedNoSecret = false;

/** HMAC de bucket:valor, o null si falta RATE_LIMIT_SECRET (entonces no se cuenta). */
export function keyHash(bucket: string, value: string): string | null {
  const secret = process.env.RATE_LIMIT_SECRET;
  if (!secret) {
    if (!warnedNoSecret) console.error('[abuso] falta RATE_LIMIT_SECRET: los límites no cuentan');
    warnedNoSecret = true;
    return null;
  }
  return createHmac('sha256', secret).update(`${bucket}:${value}`).digest('hex');
}

/** true si el pedido entra en el límite. */
export async function hit(limit: Limit, value: string): Promise<boolean> {
  const hash = keyHash(limit.bucket, value);
  if (!hash) return true;
  const { data, error } = await createAdminClient().rpc('rate_limit_hit', {
    p_bucket:         limit.bucket,
    p_key_hash:       hash,
    p_max:            limit.max,
    p_window_seconds: limit.windowSeconds,
  });
  if (error) {
    console.error('[abuso] rate_limit_hit', limit.bucket, error.code, error.message);
    return true;
  }
  return data !== false;
}

/** IP del cliente. En Vercel x-real-ip / x-forwarded-for los pone el proxy (no los controla el cliente). */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const real = h.get('x-real-ip')?.trim();
  if (real) return real;
  const fwd = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || null;
}

/** Captcha del formulario → null si pasó, o el mensaje del catálogo. */
async function checkCaptcha(formData: FormData, ip: string | null): Promise<string | null> {
  const token = formData.get('cf-turnstile-response');
  const result = await verifyTurnstile(typeof token === 'string' ? token : null, ip);
  if (result === 'ok') return null;
  return bookingError(result === 'unavailable' ? 'captcha_unavailable' : 'captcha_failed').message;
}

/**
 * Antes de create_booking / create_booking_hold. Devuelve el mensaje de error
 * para el jugador, o null si puede seguir.
 */
export async function checkBookingAbuse(formData: FormData, rawPhone: string): Promise<string | null> {
  const ip = await clientIp();
  const captcha = await checkCaptcha(formData, ip);
  if (captcha) return captcha;

  if (ip && !(await hit(BOOKING_LIMITS.ip, ip))) {
    console.warn('[abuso] límite por IP en reservas');
    return bookingError('too_many_attempts').message;
  }
  if (!(await hit(BOOKING_LIMITS.phone, normalizeArgentinePhone(rawPhone)))) {
    console.warn('[abuso] límite por teléfono en reservas');
    return bookingError('too_many_attempts').message;
  }
  return null;
}

/** Antes de signInWithPassword / signUp: captcha y límite por IP. */
export async function checkAuthAbuse(formData: FormData, kind: keyof typeof AUTH_LIMITS): Promise<string | null> {
  const ip = await clientIp();
  const captcha = await checkCaptcha(formData, ip);
  if (captcha) return captcha;
  if (ip && !(await hit(AUTH_LIMITS[kind], ip))) {
    console.warn('[abuso] límite por IP en', kind);
    return bookingError('too_many_attempts').message;
  }
  return null;
}

/** Antes de consultar una orden en Mercado Pago desde /pago (A3). */
export async function allowReconcile(cancelToken: string): Promise<boolean> {
  return hit(RECONCILE_LIMIT, cancelToken);
}
