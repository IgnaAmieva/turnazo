export const dynamic = 'force-dynamic';

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocalityBySlug, getSportBySlug } from "@/lib/supabase/queries";
import { getVenuesForList, listDaySlots } from "@/lib/free-slots";
import { parseListDate } from "@/lib/list-day";
import { parseWhen, whenParams } from "@/lib/franjas";
import { filterByFormat, formatLabel, isFormat } from "@/lib/court-format";
import { FormatChips } from "@/components/format-chips";
import { todayInMendoza } from "@/lib/slots";
import Breadcrumbs from "@/components/breadcrumbs";
import { RememberSearch } from "@/components/player-memory-ui";
import { VenuesMapToggle } from "@/components/venues-map-toggle";
import { VenueResults } from "@/components/venue-results";

type Props = {
  params: Promise<{ locality: string; sport: string }>;
  searchParams: Promise<{ franja?: string; hora?: string; formato?: string; fecha?: string; _now?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locality: lSlug, sport: sSlug } = await params;
  const [locality, sport] = await Promise.all([getLocalityBySlug(lSlug), getSportBySlug(sSlug)]);
  if (!locality || !sport) return { title: "No encontrado" };
  return { title: `${sport.name} en ${locality.name}` };
}

/**
 * Lista de complejos (V2b, la misma de abajo del inicio): "¿A qué hora querés
 * jugar?" y solo los complejos con lugar, primero el que tiene más turnos
 * libres; por complejo, mapa chiquito esquemático, distancia (solo con
 * permiso de ubicación ya dado) y los próximos 4 horarios libres con precio.
 */
export default async function VenuesPage({ params, searchParams }: Props) {
  const { locality: lSlug, sport: sSlug } = await params;
  const { franja, hora, formato: formatoParam, fecha, _now } = await searchParams;
  const when = parseWhen(franja, hora);

  const [locality, sport] = await Promise.all([getLocalityBySlug(lSlug), getSportBySlug(sSlug)]);
  if (!locality || !sport) notFound();

  // Solo en desarrollo/tests: ?_now= fija la hora actual (igual que la página del complejo)
  const fixedNow = process.env.NODE_ENV !== "production" && _now && !Number.isNaN(Date.parse(_now)) ? _now : null;
  const nowUtc = fixedNow ? new Date(fixedNow) : new Date();
  const today = todayInMendoza(nowUtc);

  // Fútbol: ?formato= deja solo las canchas de ese formato (027)
  const formato = sport.slug === "futbol" && isFormat(formatoParam) ? formatoParam : null;
  const venues = filterByFormat(await getVenuesForList(locality.id, sport.id), formato);
  // Sin ?fecha=, de noche, si hoy ya no hay lugar, pasa sola a mañana (título en VenueResults)
  const chosen = parseListDate(fecha, today);
  const day = await listDaySlots(venues, today, chosen, nowUtc);
  const keep = { ...(fixedNow ? { _now: fixedNow } : {}), ...(chosen ? { fecha: chosen } : {}) };

  const homeUrl = `/?localidad=${locality.slug}&deporte=${sport.slug}`;

  return (
    <div className="max-w-lg mx-auto">
      <RememberSearch
        localidad={{ slug: locality.slug, nombre: locality.name }}
        deporte={{ slug: sport.slug, nombre: sport.name }}
      />
      <Breadcrumbs back={homeUrl} items={[{ href: homeUrl, label: "Inicio" }]} current={`${sport.name} en ${locality.name}`} />

      <h1 className="text-2xl font-extrabold text-ink leading-tight">{sport.name} en {locality.name}</h1>

      <VenueResults
        venues={venues}
        slots={day.slots}
        when={when}
        today={today}
        date={day.date}
        rolled={day.rolled}
        localitySlug={lSlug}
        sportSlug={sSlug}
        basePath={`/${lSlug}/${sSlug}`}
        baseParams={{ ...keep, ...(formato ? { formato } : {}) }}
        noVenuesText={formato ? `Ningún complejo de ${locality.name} cargó canchas de ${formatLabel(formato)} todavía.` : undefined}
        filters={sport.slug === "futbol" ? (
          <FormatChips basePath={`/${lSlug}/${sSlug}`} current={formato}
            params={{ ...keep, ...whenParams(when) }} />
        ) : undefined}
      />
      {venues.length > 0 && <VenuesMapToggle venues={venues.map(({ id, name, address, lat, lng }) => ({ id, name, address, lat, lng }))} />}
    </div>
  );
}
