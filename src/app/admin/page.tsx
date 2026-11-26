import Link from 'next/link';
import { getAdminSummary, getAdminVenues, requireSuperadmin } from '@/lib/supabase/admin-queries';
import { VENUE_STATUS, VENUE_STATUSES, isVenueStatus, venueStatus } from '@/lib/venue-status';
import { formatArgentinePhone } from '@/lib/phone';
import { APP_TIMEZONE } from '@/lib/constants';

type Props = { searchParams: Promise<{ estado?: string }> };

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('es-AR', { timeZone: APP_TIMEZONE, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

/**
 * Superadmin: resumen arriba (complejos por estado, reservas y dueños nuevos de
 * los últimos 7 días) y la lista de complejos con filtro por estado.
 */
export default async function AdminPage({ searchParams }: Props) {
  const { supabase } = await requireSuperadmin();
  const { estado } = await searchParams;
  const status = isVenueStatus(estado) ? estado : null;
  const [summary, venues] = await Promise.all([getAdminSummary(supabase), getAdminVenues(supabase, status)]);
  const total = VENUE_STATUSES.reduce((n, s) => n + (summary.venues_by_status[s] ?? 0), 0);

  const chips: { key: string; label: string; href: string; count: number; selected: boolean }[] = [
    { key: 'todos', label: 'Todos', href: '/admin', count: total, selected: status === null },
    ...VENUE_STATUSES.map((s) => ({
      key: s, label: VENUE_STATUS[s].plural, href: `/admin?estado=${s}`,
      count: summary.venues_by_status[s] ?? 0, selected: status === s,
    })),
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-extrabold text-ink">Superadmin</h1>

      {/* Resumen */}
      <section aria-label="Resumen" className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="resumen">
        {[
          { k: 'pendientes', label: 'Pendientes', value: summary.venues_by_status.pending ?? 0, strong: (summary.venues_by_status.pending ?? 0) > 0 },
          { k: 'aprobados', label: 'Aprobados', value: summary.venues_by_status.approved ?? 0 },
          { k: 'suspendidos', label: 'Suspendidos', value: summary.venues_by_status.suspended ?? 0 },
          { k: 'rechazados', label: 'Rechazados', value: summary.venues_by_status.rejected ?? 0 },
          { k: 'reservas', label: 'Reservas · 7 días', value: summary.bookings_7d },
          { k: 'duenos', label: 'Dueños nuevos · 7 días', value: summary.new_owners_7d },
        ].map((c) => (
          <div key={c.k} data-testid={`resumen-${c.k}`}
            className={`rounded-2xl border p-4 shadow-sm ${c.strong ? 'border-primary bg-primary text-on-primary' : 'border-line bg-surface text-ink'}`}>
            <p className="text-3xl font-extrabold leading-none">{c.value}</p>
            <p className="mt-1 text-sm">{c.label}</p>
          </div>
        ))}
      </section>

      {/* Filtro por estado */}
      <nav aria-label="Estado" className="mt-6 flex flex-wrap gap-2">
        {chips.map((c) => (
          <Link key={c.key} href={c.href} scroll={false} data-testid="filtro-estado"
            aria-current={c.selected ? 'true' : undefined}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-extrabold
              ${c.selected ? 'border-primary bg-primary text-on-primary' : 'border-line bg-surface text-ink hover:border-primary'}`}>
            {c.label} <span className="font-medium">{c.count}</span>
          </Link>
        ))}
      </nav>

      {/* Complejos */}
      {venues.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-ink-muted" data-testid="sin-complejos">
          No hay complejos {status ? VENUE_STATUS[status].plural.toLowerCase() : ''}.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {venues.map((v) => {
            const st = venueStatus(v.status);
            return (
              <li key={v.id} data-testid="admin-complejo" data-estado={v.status}
                className="relative rounded-2xl border border-line bg-surface p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link href={`/admin/complejos/${v.id}`} data-testid="admin-complejo-link"
                    className="inline-flex min-h-11 items-center text-lg font-extrabold text-ink hover:underline
                      after:absolute after:inset-0 after:rounded-2xl after:content-['']">
                    {v.name}
                  </Link>
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold ring-1 ring-inset ${st.className}`}
                    data-testid="estado">
                    {st.label}
                  </span>
                </div>
                <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-sm text-ink sm:grid-cols-2">
                  <div><dt className="sr-only">Dueño</dt><dd className="truncate">{v.owner_email ?? '—'}</dd></div>
                  <div><dt className="sr-only">Localidad</dt><dd>{v.locality_name ?? '—'}</dd></div>
                  <div><dt className="sr-only">Teléfono</dt><dd>{formatArgentinePhone(v.phone)}</dd></div>
                  <div><dt className="sr-only">Alta</dt><dd>Alta: {fmtDate(v.created_at)}</dd></div>
                  <div>
                    <dt className="sr-only">Mercado Pago</dt>
                    <dd data-testid="mp">{v.mp_connected ? 'Mercado Pago conectado' : 'Sin Mercado Pago'}</dd>
                  </div>
                  <div><dt className="sr-only">Canchas</dt><dd>{v.courts_count} cancha{v.courts_count === 1 ? '' : 's'}</dd></div>
                </dl>
                {v.status_reason && (
                  <p className="mt-2 text-sm text-ink" data-testid="motivo">Motivo: {v.status_reason}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
