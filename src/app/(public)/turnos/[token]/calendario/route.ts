import { getBookingByToken, originFrom } from '@/lib/mi-turno';
import { buildIcs } from '@/lib/ics';

export const dynamic = 'force-dynamic';

/** GET /turnos/{token}/calendario → turno.ics para "Agregar al calendario". */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await getBookingByToken(token);
  if (!b || b.status !== 'confirmed') {
    return new Response('Turno no encontrado', { status: 404 });
  }

  const url = `${originFrom(req.headers)}/turnos/${token}`;
  const ics = buildIcs({
    uid: `${b.id}@turnazo`,
    start: new Date(b.period_start),
    end: new Date(b.period_end),
    summary: `Turno en ${b.venue_name} · ${b.court_name}`,
    location: b.venue_address ? `${b.venue_name}, ${b.venue_address}` : b.venue_name,
    description: `Ver o cancelar tu turno: ${url}`,
    url,
  });

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="turno.ics"',
      // El link es privado (permite cancelar): que no quede en cachés compartidas
      'Cache-Control': 'private, no-store',
    },
  });
}
