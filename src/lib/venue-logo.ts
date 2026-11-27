/**
 * Logo del club (migración 024): bucket público 'venue-logos', un archivo por
 * complejo en la carpeta '{venue_id}/'. Sin logo, las iniciales del club.
 * Sin imports del servidor: lo usan la portada, el panel y la historia.
 */

export const LOGO_BUCKET = 'venue-logos';
/** Igual que file_size_limit del bucket (024): lo que se guarda, ya achicado. */
export const LOGO_MAX_BYTES = 512 * 1024;
/** Lo que puede elegir el dueño: el servidor lo achica (1024 px, < 512 KB, mismo formato). */
export const LOGO_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/**
 * Vercel corta los pedidos de más de 4,5 MB: si el archivo pesa más que esto,
 * el navegador lo baja primero a 2048 px (mismo formato) y recién ahí lo manda.
 */
export const LOGO_SEND_MAX_BYTES = 4 * 1024 * 1024;
/** Lado más largo del logo guardado. */
export const LOGO_MAX_SIDE = 1024;
/** Foto de portada (029, mismo bucket, '{venue_id}/cover-…'): 1600 px y menos de 500 KB. */
export const COVER_MAX_SIDE = 1600;
export const COVER_MAX_BYTES = 500 * 1024;

export type LogoType = { mime: 'image/png' | 'image/jpeg' | 'image/webp'; ext: 'png' | 'jpg' | 'webp' };

/**
 * Tipo REAL de la imagen por sus primeros bytes (no por la extensión ni por
 * el Content-Type que manda el navegador). null si no es PNG, JPEG ni WebP.
 *   PNG  89 50 4E 47 0D 0A 1A 0A
 *   JPEG FF D8 FF
 *   WebP 'RIFF' ···· 'WEBP'
 */
export function detectLogoType(b: Uint8Array): LogoType | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((x, k) => b[i + k] === x);
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mime: 'image/png', ext: 'png' };
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { mime: 'image/webp', ext: 'webp' };
  return null;
}

/** URL pública del logo (no necesita política de lectura), o null sin logo. */
export function venueLogoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${LOGO_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Iniciales del club para el círculo sin logo: "futmates" → "FU", "Club Norte" → "CN". */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const stop = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y']);
  const main = words.filter((w) => !stop.has(w.toLowerCase()));
  const pick = main.length >= 2 ? main[0][0] + main[1][0] : (main[0] ?? words[0] ?? '?').slice(0, 2);
  return pick.toUpperCase();
}
