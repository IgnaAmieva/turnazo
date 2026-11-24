export const dynamic = 'force-dynamic';

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocalityBySlug, getSportBySlug } from "@/lib/supabase/queries";
import { getVenuesForList, freeSlots, slotHref } from "@/lib/free-slots";
import { FRANJAS, inFranja, parseFranja } from "@/lib/franjas";
import { formatDateMendoza, formatTimeMendoza, todayInMendoza, mendozaToUtc } from "@/lib/slots";
import Breadcrumbs from "@/components/breadcrumbs";
import { RememberSearch } from "@/components/player-memory-ui";
import { MiniMap } from "@/components/mini-map";
import { VenueDistance } from "@/components/venue-distance";
import { VenuesMapToggle } from "@/components/venues-map-toggle";

type Props = {
  params: Promise<{ locality: string; sport: string }>;
  searchParams: Promise<{ franja?: string; _now?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locality: lSlug, sport: sSlug } = await params;
  const [locality, sport] = await Promise.all([getLocalityBySlug(lSlug), getSportBySlug(sSlug)]);
  if (!locality || !sport) return { title: "No encontrado" };
  return { title: `${sport.name} en ${locality.name}` };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Lista de complejos (V2b): franjas de hoy (Ahora · 18–20 · 20–22 · 22+) y,
 * por complejo, mapa chiquito esquemático, distancia (solo con permiso de
 * ubicación ya dado) y los próximos 4 turnos libres de la franja con precio.
 * Tocar un turno abre el complejo con la hoja de ese turno.
 */
export default async function VenuesPage({ params, searchParams }: Props) {
  const { locality: lSlug, sport: sSlug } = await params;
  const { franja: franjaParam, _now } = await searchParams;
  const franja = parseFranja(franjaParam);

  const [locality, sport] = await Promise.all([getLocalityBySlug(lSlug), getSportBySlug(sSlug)]);
  if (!locality || !sport) notFound();

  // Solo en desarrollo/tests: ?_now= fija la hora actual (igual que la página del complejo)
  const nowUtc = process.env.NODE_ENV !== "production" && _now && !Number.isNaN(Date.parse(_now)) ? new Date(_now) : new Date();
  const today = todayInMendoza(nowUtc);

  const venues = await getVenuesForList(locality.id, sport.id);
  const slots = await freeSlots(venues, today, nowUtc);

  const rows = venues
    .map((v) => ({
      v,
      // Próximos 4 horarios distintos (con dos canchas libres a la misma hora, un solo chip: la primera cancha)
      next: slots
        .filter((s) => s.venueId === v.id && inFranja(s.start, franja, today))
        .filter((s, i, all) => all.findIndex((o) => o.venueId === s.venueId && o.start.getTime() === s.start.getTime()) === i)
        .slice(0, 4),
    }))
    // Primero los que tienen lugar en la franja (el orden por nombre se mantiene)
    .sort((a, b) => Number(b.next.length > 0) - Number(a.next.length > 0));
  const withRoom = rows.filter((r) => r.next.length > 0).length;

  const todayLabel = formatDateMendoza(mendozaToUtc(today, "12:00:00"));
  const listUrl = (f: string) => `/${lSlug}/${sSlug}${f === "ahora" ? "" : `?franja=${f}`}`;
  const homeUrl = `/?localidad=${locality.slug}&deporte=${sport.slug}`;

  return (
    <div className="max-w-lg mx-auto">
      <RememberSearch
        localidad={{ slug: locality.slug, nombre: locality.name }}
        deporte={{ slug: sport.slug, nombre: sport.name }}
      />
      <Breadcrumbs back={homeUrl} items={[{ href: homeUrl, label: "Inicio" }]} current={`${sport.name} en ${locality.name}`} />

      <h1 className="text-2xl font-extrabold text-ink leading-tight">{sport.name} en {locality.name}</h1>
      <p className="text-sm text-ink-muted">Hoy · {todayLabel}</p>

      {/* Franjas de hoy */}
      <nav aria-label="Franja horaria" className="mt-4 flex flex-wrap gap-2">
        {FRANJAS.map((f) => {
          const selected = f.id === franja;
          return (
            <Link
              key={f.id}
              href={listUrl(f.id)}
              scroll={false}
              aria-current={selected ? "true" : undefined}
              data-testid="franja"
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-4 text-sm font-extrabold
                ${selected ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-ink hover:border-primary"}`}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      <p className="mt-4 mb-3 text-sm text-ink-muted" data-testid="con-lugar">
        {venues.length === 0
          ? "No hay complejos disponibles en esta localidad todavía."
          : withRoom === 0
            ? "Ningún complejo tiene lugar en esta franja hoy."
            : `${plural(withRoom, "complejo", "complejos")} con lugar`}
      </p>

      <ul className="grid gap-3">
        {rows.map(({ v, next }) => {
          const minutes = [...new Set(v.courts.map((c) => c.slot_minutes))].sort((a, b) => a - b);
          return (
            <li key={v.id} data-testid="complejo" className="rounded-3xl border border-line bg-surface p-4 shadow-sm">
              <div className="flex gap-3">
                <MiniMap id={v.id} />
                <div className="min-w-0 flex-1">
                  <Link href={`/${lSlug}/${sSlug}/${v.id}`} className="inline-flex min-h-11 items-center text-lg font-extrabold text-ink hover:underline">
                    {v.name}
                  </Link>
                  <p className="text-sm text-ink-muted">
                    {v.address}<VenueDistance lat={v.lat} lng={v.lng} />
                  </p>
                  {/* Etiquetas: hasta que exista la migración 023, solo lo que hay */}
                  <p className="mt-1 text-xs text-ink-muted" data-testid="etiquetas">
                    {plural(v.courts.length, "cancha", "canchas")} · turnos de {minutes.join(" y ")} min
                  </p>
                </div>
              </div>

              {next.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2" aria-label={`Próximos turnos en ${v.name}`}>
                  {next.map((s) => (
                    <li key={`${s.courtId}-${s.start.toISOString()}`}>
                      <Link
                        href={slotHref(lSlug, sSlug, s)}
                        data-testid="turno-chip"
                        className="flex min-h-11 min-w-[4.5rem] flex-col items-center justify-center rounded-xl bg-accent px-3 py-1.5 text-on-accent hover:opacity-90"
                      >
                        <span className="text-base font-extrabold leading-tight">{formatTimeMendoza(s.start)}</span>
                        <span className="text-xs leading-tight">${s.price.toLocaleString("es-AR")}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-ink-muted">Sin turnos libres en esta franja.</p>
              )}
            </li>
          );
        })}
      </ul>

      {venues.length > 0 && <VenuesMapToggle venues={venues.map(({ id, name, address, lat, lng }) => ({ id, name, address, lat, lng }))} />}
    </div>
  );
}
