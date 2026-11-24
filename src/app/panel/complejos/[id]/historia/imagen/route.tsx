import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { getStoryData, parseStyle } from '@/lib/stories';
import { StoryArt } from '../story-art';

export const dynamic = 'force-dynamic';

/** Outfit 500 y 800 (OFL, de @fontsource/outfit), los mismos pesos que la app. */
let fonts: Promise<{ name: string; data: Buffer; weight: 500 | 800; style: 'normal' }[]> | null = null;
function loadFonts() {
  fonts ??= Promise.all(([500, 800] as const).map(async (weight) => ({
    name: 'Outfit',
    data: await readFile(join(process.cwd(), 'src/assets/fonts', `outfit-latin-${weight}-normal.woff`)),
    weight,
    style: 'normal' as const,
  })));
  return fonts;
}

/** Origen del pedido, para el link que va en la imagen. */
function hostOf(req: Request) {
  const h = req.headers;
  return h.get('x-forwarded-host') ?? h.get('host') ?? 'turnazo';
}

/**
 * GET /panel/complejos/{id}/historia/imagen?fecha=&deporte=&estilo=[&descargar=1]
 * PNG 1080×1920 con los turnos libres. Solo el dueño del complejo (si no, 404).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const data = await getStoryData(id, { sport: q.get('deporte'), date: q.get('fecha') });
  if (!data) return new Response('No encontrado', { status: 404 });

  const style = parseStyle(q.get('estilo'));
  // Link corto y legible desde la imagen: /c/{primeros 8 del id}/{deporte} redirige al complejo
  const link = `${hostOf(req)}/c/${data.venueId.slice(0, 8)}/${data.sport.slug}`;

  const image = new ImageResponse(<StoryArt data={data} style={style} link={link} />, {
    width: 1080,
    height: 1920,
    fonts: await loadFonts(),
  });

  const headers = new Headers(image.headers);
  headers.set('Cache-Control', 'private, no-store');
  if (q.get('descargar') === '1') {
    headers.set('Content-Disposition', `attachment; filename="turnos-${data.sport.slug}-${data.date}-${style}.png"`);
  }
  return new Response(image.body, { status: 200, headers });
}
