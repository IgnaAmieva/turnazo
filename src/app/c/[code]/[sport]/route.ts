import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Link corto de las historias de turnos libres: /c/{código}/{deporte}, donde
 * el código son los primeros 8 caracteres del id del complejo. Redirige a la
 * página del complejo; si no hay uno (o hay más de uno) aprobado con ese
 * código, al inicio.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string; sport: string }> }) {
  const { code, sport } = await params;
  const home = new URL('/', req.url);
  if (!/^[0-9a-f]{8}$/.test(code) || !/^[a-z0-9-]{1,40}$/.test(sport)) return NextResponse.redirect(home);

  // El id es uuid: se busca por rango (prefijo) en vez de LIKE, que uuid no admite
  const supabase = await createClient();
  const { data } = await supabase
    .from('venues')
    .select('id, localities(slug)')
    .eq('status', 'approved')
    .gte('id', `${code}-0000-0000-0000-000000000000`)
    .lte('id', `${code}-ffff-ffff-ffff-ffffffffffff`)
    .limit(2);

  if (!data || data.length !== 1) return NextResponse.redirect(home);
  const loc = (data[0].localities as unknown as { slug: string } | null)?.slug;
  if (!loc) return NextResponse.redirect(home);
  return NextResponse.redirect(new URL(`/${loc}/${sport}/${data[0].id}`, req.url));
}
