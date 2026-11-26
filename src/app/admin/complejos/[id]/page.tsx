import Link from 'next/link';
import { notFound } from 'next/navigation';
import VenueMap from '@/components/venue-map-wrapper';
import { ClubLogo } from '@/components/club-logo';
import { getAdminVenueDetail, requireSuperadmin } from '@/lib/supabase/admin-queries';
import { venueStatus } from '@/lib/venue-status';
import { buildWhatsAppUrl, formatArgentinePhone } from '@/lib/phone';
import { mapsUrl } from '@/lib/geo';
import { formatLabel, isFormat } from '@/lib/court-format';
import { APP_TIMEZONE } from '@/lib/constants';
import { VenueStatusActions } from './status-actions';

type Props = { params: Promise<{ id: string }> };

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const hhmm = (t: string) => t.slice(0, 5);
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('es-AR', { timeZone: APP_TIMEZONE, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

/** Detalle de un complejo para el superadmin: mapa con el pin, canchas, horarios, precios, logo y acciones. */
export default async function AdminVenuePage({ params }: Props) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase } = await requireSuperadmin();
  const v = await getAdminVenueDetail(supabase, id);
  if (!v) notFound();
  const st = venueStatus(v.status);

  return (
    <div className="mx-auto max-w-3xl pb-10">
      <Link href="/admin" className="inline-flex min-h-11 items-center gap-1 text-sm font-extrabold text-ink hover:underline">
        <span aria-hidden="true">←</span> Todos los complejos
      </Link>

      <header className="mt-2 flex items-center gap-3">
        <ClubLogo name={v.name} logoPath={v.logo_path} size={64} />
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold leading-tight text-ink">{v.name}</h1>
          <span className={`mt-1 inline-flex items-center rounded-full px-3 py-1 text-xs font-extrabold ring-1 ring-inset ${st.className}`}
            data-testid="estado">
            {st.label}
          </span>
        </div>
      </header>
      {v.status_reason && (
        <p className="mt-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink" data-testid="motivo">
          Motivo: {v.status_reason}
        </p>
      )}

      {/* Acciones (con confirmación) */}
      <VenueStatusActions venueId={v.id} venueName={v.name} status={v.status} />

      {/* Datos */}
      <section className="mt-6 rounded-2xl border border-line bg-surface p-4 shadow-sm" aria-labelledby="datos">
        <h2 id="datos" className="text-lg font-extrabold text-ink">Datos</h2>
        <dl className="mt-2 grid gap-2 text-sm text-ink sm:grid-cols-2">
          <div><dt className="text-ink-muted">Dueño</dt><dd data-testid="dueno">{v.owner_email ?? '—'}</dd></div>
          <div>
            <dt className="text-ink-muted">Teléfono</dt>
            <dd className="flex flex-wrap items-center gap-2">
              {formatArgentinePhone(v.phone)}
              <a href={buildWhatsAppUrl(v.phone)} target="_blank" rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center rounded-full border border-line px-3 text-sm font-extrabold text-ink hover:border-primary">
                WhatsApp
              </a>
            </dd>
          </div>
          <div><dt className="text-ink-muted">Dirección</dt><dd>{v.address} · {v.locality_name}</dd></div>
          <div><dt className="text-ink-muted">Alta</dt><dd>{fmtDate(v.created_at)}</dd></div>
          <div><dt className="text-ink-muted">Mercado Pago</dt><dd data-testid="mp">{v.mp_connected ? 'Conectado' : 'Sin conectar'}</dd></div>
        </dl>
      </section>

      {/* Mapa con el pin */}
      <section className="mt-6" aria-labelledby="ubicacion">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="ubicacion" className="text-lg font-extrabold text-ink">Ubicación</h2>
          <a href={mapsUrl(v)} target="_blank" rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center text-sm font-extrabold text-ink underline underline-offset-4">
            Abrir en Google Maps
          </a>
        </div>
        <p className="text-xs text-ink-muted">Pin: {v.lat.toFixed(5)}, {v.lng.toFixed(5)}</p>
        <div className="mt-2" data-testid="mapa-pin">
          <VenueMap venues={[{ id: v.id, name: v.name, address: v.address, lat: v.lat, lng: v.lng }]}
            className="h-64 w-full overflow-hidden rounded-2xl border border-line shadow-sm" />
        </div>
      </section>

      {/* Canchas, horarios y precios */}
      <section className="mt-6" aria-labelledby="canchas">
        <h2 id="canchas" className="text-lg font-extrabold text-ink">Canchas ({v.courts.length})</h2>
        {v.courts.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Todavía no cargó canchas.</p>
        ) : (
          <ul className="mt-2 grid gap-3">
            {v.courts.map((c) => (
              <li key={c.id} data-testid="admin-cancha" className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
                <p className="font-extrabold text-ink">
                  {c.name} <span className="font-medium text-ink-muted">· {isFormat(c.format) ? formatLabel(c.format) : c.sport_name} · turnos de {c.slot_minutes} min{c.active ? '' : ' · inactiva'}</span>
                </p>
                {c.notes && <p className="mt-1 text-sm text-ink">{c.notes}</p>}
                <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="font-extrabold text-ink">Horarios</p>
                    {c.hours.length === 0 ? <p className="text-ink-muted">Sin horarios</p> : (
                      <ul className="text-ink">
                        {c.hours.map((h, i) => <li key={i}>{DAYS[h.weekday]} {hhmm(h.open_time)}–{hhmm(h.close_time)}</li>)}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="font-extrabold text-ink">Precios</p>
                    {c.prices.length === 0 ? <p className="text-ink-muted">Sin precios</p> : (
                      <ul className="text-ink">
                        {c.prices.map((p, i) => (
                          <li key={i}>{DAYS[p.weekday]} {hhmm(p.from_time)}–{hhmm(p.to_time)} · ${p.price.toLocaleString('es-AR')}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
