/**
 * Imágenes del complejo, solo servidor: las achica con sharp antes de subirlas
 * al bucket. Logo: 1024 px y < 512 KB. Foto de portada (029): 1600 px y < 500 KB.
 *
 * - Como mucho `maxSide` de lado, sin agrandar ni recortar.
 * - Menos de `maxBytes`.
 * - Mismo formato: PNG sigue PNG (con su transparencia), JPEG sigue JPEG y
 *   WebP sigue WebP.
 * - Se aplica la orientación de la foto (EXIF) y se descartan los metadatos
 *   (ubicación, cámara).
 *
 * En cada lado prueba primero la mejor calidad y va bajando: en PNG, sin
 * pérdida y después con paleta; en JPEG y WebP, calidad 90 → 60. Si no entra,
 * baja el lado en proporción a lo que sobra (dos o tres vueltas como mucho).
 * null si no es una imagen que sharp pueda leer o si no se llega al peso.
 */
import { COVER_MAX_BYTES, COVER_MAX_SIDE, LOGO_MAX_BYTES, LOGO_MAX_SIDE, type LogoType } from '@/lib/venue-logo';

const QUALITIES = [90, 80, 70, 60];
const MIN_SIDE = 64;

export async function shrinkImage(input: Uint8Array, type: LogoType, maxSide: number, maxBytes: number): Promise<Buffer | null> {
  const sharp = (await import('sharp')).default;
  try {
    const meta = await sharp(input, { failOn: 'error' }).metadata();
    if (!meta.width || !meta.height) return null;
    let side = Math.min(maxSide, Math.max(meta.width, meta.height));

    while (side >= MIN_SIDE) {
      const base = () => sharp(input, { failOn: 'error' })
        .rotate()
        .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true });

      const attempts: (() => Promise<Buffer>)[] =
        type.ext === 'png'
          ? [
              () => base().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer(),
              () => base().png({ compressionLevel: 9, palette: true, quality: 100, colours: 256 }).toBuffer(),
            ]
          : type.ext === 'jpg'
            ? QUALITIES.map((q) => () => base().jpeg({ quality: q, mozjpeg: true }).toBuffer())
            : QUALITIES.map((q) => () => base().webp({ quality: q, alphaQuality: 100 }).toBuffer());

      let smallest = Infinity;
      for (const attempt of attempts) {
        const out = await attempt();
        if (out.length <= maxBytes) return out;
        smallest = Math.min(smallest, out.length);
      }
      // El peso crece con el área: se baja el lado en proporción (con 10 % de margen)
      side = Math.min(Math.floor(side * 0.9), Math.floor(side * Math.sqrt(maxBytes / smallest) * 0.9));
    }
    return null;
  } catch {
    return null;
  }
}

export const shrinkLogo = (input: Uint8Array, type: LogoType) => shrinkImage(input, type, LOGO_MAX_SIDE, LOGO_MAX_BYTES);
export const shrinkCover = (input: Uint8Array, type: LogoType) => shrinkImage(input, type, COVER_MAX_SIDE, COVER_MAX_BYTES);
