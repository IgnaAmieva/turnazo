export const dynamic = 'force-dynamic';

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocalityBySlug, getSportBySlug } from "@/lib/supabase/queries";
import { getVenuesForList, freeSlots } from "@/lib/free-slots";
import { parseWhen } from "@/lib/franjas";
import { formatDateMendoza, todayInMendoza, mendozaToUtc } from "@/lib/slots";
import Breadcrumbs from "@/components/breadcrumbs";
import { RememberSearch } from "@/components/player-memory-ui";
import { VenuesMapToggle } from "@/components/venues-map-toggle";
import { VenueResults } from "@/components/venue-results";

type Props = {
  params: Promise<{ locality: string; sport: string }>;
  searchParams: Promise<{ franja?: string; hora?: string; _now?: string }>;
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
  const { franja, hora, _now } = await searchParams;
  const when = parseWhen(franja, hora);

  const [locality, sport] = await Promise.all([getLocalityBySlug(lSlug), getSportBySlug(sSlug)]);
  if (!locality || !sport) notFound();

  // Solo en desarrollo/tests: ?_now= fija la hora actual (igual que la página del complejo)
  const fixedNow = process.env.NODE_ENV !== "production" && _now && !Number.isNaN(Date.parse(_now)) ? _now : null;
  const nowUtc = fixedNow ? new Date(fixedNow) : new Date();
  const today = todayInMendoza(nowUtc);

  const venues = await getVenuesForList(locality.id, sport.id);
  const slots = await freeSlots(venues, today, nowUtc);

  const todayLabel = formatDateMendoza(mendozaToUtc(today, "12:00:00"));
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

      <VenueResults
        venues={venues}
        slots={slots}
        when={when}
        today={today}
        localitySlug={lSlug}
        sportSlug={sSlug}
        basePath={`/${lSlug}/${sSlug}`}
        baseParams={fixedNow ? { _now: fixedNow } : {}}
      />
      {venues.length > 0 && <VenuesMapToggle venues={venues.map(({ id, name, address, lat, lng }) => ({ id, name, address, lat, lng }))} />}
    </div>
  );
}
