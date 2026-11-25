/**
 * Complejos con lugar (inicio y lista de complejos): "¿A qué hora querés
 * jugar?" (Ahora · 18–20 · 20–22 · 22+ · una hora exacta) y debajo SOLO los
 * complejos con turnos libres a esa hora, primero el que tiene más libres
 * (para repartir los turnos entre todos), con sus próximos horarios y precio.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { slotHref, type FreeSlot, type VenueForList } from '@/lib/free-slots';
import { FRANJAS, whenLabel, whenParams, type When } from '@/lib/franjas';
import { rankVenues } from '@/lib/rank-venues';
import { formatTimeMendoza } from '@/lib/slots';
import { venueTagsLine } from '@/lib/court-tags';
import { MiniMapLink } from '@/components/mini-map';
import { VenueDistance } from '@/components/venue-distance';
import { HourSelect } from '@/components/hour-select';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Props = {
  venues: VenueForList[];
  slots: FreeSlot[];
  when: When;
  today: string;
  localitySlug: string;
  sportSlug: string;
  /** Adónde apuntan las franjas: el inicio ("/" + localidad y deporte) o la lista */
  basePath: string;
  baseParams: Record<string, string>;
  /** Filtros extra entre la hora y la lista (formato de fútbol) */
  filters?: ReactNode;
  /** Texto si no hay ningún complejo (por ejemplo, ninguno con canchas de ese formato) */
  noVenuesText?: string;
};

export function VenueResults({ venues, slots, when, today, localitySlug, sportSlug, basePath, baseParams, filters, noVenuesText }: Props) {
  const rows = rankVenues(venues, slots, when, today);
  const without = venues.length - rows.length;
  const href = (params: Record<string, string>) => {
    const qs = new URLSearchParams({ ...baseParams, ...params }).toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <section aria-labelledby="a-que-hora">
      <h2 id="a-que-hora" className="mt-7 mb-3 text-lg text-ink">¿A qué hora querés jugar?</h2>
      <nav aria-label="Franja horaria" className="flex flex-wrap gap-2">
        {FRANJAS.map((f) => {
          const selected = when.kind === 'franja' && when.id === f.id;
          return (
            <Link
              key={f.id}
              href={href(whenParams({ kind: 'franja', id: f.id }))}
              scroll={false}
              aria-current={selected ? 'true' : undefined}
              data-testid="franja"
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-4 text-sm font-extrabold
                ${selected ? 'border-primary bg-primary text-on-primary' : 'border-line bg-surface text-ink hover:border-primary'}`}
            >
              {f.label}
            </Link>
          );
        })}
        <HourSelect basePath={basePath} baseParams={baseParams} value={when.kind === 'hora' ? when.h : null} />
      </nav>

      {filters}

      <p className="mt-4 mb-3 text-sm text-ink-muted" data-testid="con-lugar">
        {venues.length === 0
          ? (noVenuesText ?? 'No hay complejos disponibles en esta localidad todavía.')
          : rows.length === 0
            ? `Ningún complejo tiene lugar ${whenLabel(when)}. Probá otra hora.`
            : `${plural(rows.length, 'complejo', 'complejos')} con lugar ${whenLabel(when)}` +
              (without > 0 ? ` · ${without} sin lugar` : '')}
      </p>

      <ul className="grid gap-3">
        {rows.map(({ v, free, next }) => (
          <li key={v.id} data-testid="complejo" data-libres={free} className="relative rounded-3xl border border-line bg-surface p-4 shadow-sm">
            <div className="flex gap-3">
              {/* El mapa chiquito abre Google Maps; el resto de la tarjeta, el complejo */}
              <MiniMapLink id={v.id} name={v.name} lat={v.lat} lng={v.lng} />
              <div className="min-w-0 flex-1">
                <Link href={`/${localitySlug}/${sportSlug}/${v.id}`} data-testid="complejo-link"
                  className="inline-flex min-h-11 items-center text-lg font-extrabold text-ink hover:underline
                    after:absolute after:inset-0 after:rounded-3xl after:content-['']">
                  {v.name}
                </Link>
                <p className="text-sm text-ink-muted">
                  {v.address}<VenueDistance lat={v.lat} lng={v.lng} />
                </p>
                {/* Etiquetas (023): lo cargado, o "2 canchas · turnos de 90 min" */}
                <p className="mt-1 text-xs text-ink-muted" data-testid="etiquetas">{venueTagsLine(v.courts)}</p>
              </div>
            </div>

            <p className="mt-3 text-xs font-extrabold text-ink" data-testid="libres">
              {plural(free, 'turno libre', 'turnos libres')} {whenLabel(when)}
            </p>
            <ul className="relative z-10 mt-2 flex flex-wrap gap-2" aria-label={`Próximos turnos en ${v.name}`}>
              {next.map((s) => (
                <li key={`${s.courtId}-${s.start.toISOString()}`}>
                  <Link
                    href={slotHref(localitySlug, sportSlug, s)}
                    data-testid="turno-chip"
                    className="flex min-h-11 min-w-[4.5rem] flex-col items-center justify-center rounded-xl bg-accent px-3 py-1.5 text-on-accent hover:opacity-90"
                  >
                    <span className="text-base font-extrabold leading-tight">{formatTimeMendoza(s.start)}</span>
                    <span className="text-xs leading-tight">${s.price.toLocaleString('es-AR')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
