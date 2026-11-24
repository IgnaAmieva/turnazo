export const dynamic = 'force-dynamic';

import {
  getLocalityBySlug,
  getSportBySlug,
  getVenuesByLocalityAndSport,
} from "@/lib/supabase/queries";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import VenueMap from "@/components/venue-map-wrapper";

type Props = { params: Promise<{ locality: string; sport: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locality: lSlug, sport: sSlug } = await params;
  const [locality, sport] = await Promise.all([
    getLocalityBySlug(lSlug),
    getSportBySlug(sSlug),
  ]);
  if (!locality || !sport) return { title: "No encontrado" };
  return { title: `${sport.name} en ${locality.name}` };
}

export default async function VenuesPage({ params }: Props) {
  const { locality: lSlug, sport: sSlug } = await params;

  const [locality, sport] = await Promise.all([
    getLocalityBySlug(lSlug),
    getSportBySlug(sSlug),
  ]);
  if (!locality || !sport) notFound();

  const venues = await getVenuesByLocalityAndSport(lSlug, sSlug);

  return (
    <div>
      <nav className="text-sm text-ink-muted mb-6">
        <Link href="/" className="hover:text-ink">Inicio</Link>
        <span className="mx-2">/</span>
        <Link href={`/${locality.slug}`} className="hover:text-ink">{locality.name}</Link>
        <span className="mx-2">/</span>
        <span className="text-ink">{sport.name}</span>
      </nav>

      <h1 className="text-2xl font-bold text-ink mb-1">
        {sport.name} en {locality.name}
      </h1>
      <p className="text-ink-muted mb-6">
        {venues.length === 0
          ? "No hay complejos disponibles en esta localidad todavía."
          : `${venues.length} complejo${venues.length !== 1 ? "s" : ""} disponible${venues.length !== 1 ? "s" : ""}`}
      </p>

      {venues.length > 0 && (
        <>
          <VenueMap venues={venues} className="mb-6 h-64 md:h-80 w-full rounded-2xl overflow-hidden border border-line shadow-sm" />

          <ul className="grid gap-3">
            {venues.map((venue) => (
              <li key={venue.id}>
                <div className="rounded-2xl border border-line bg-surface p-5
                  shadow-sm hover:border-primary hover:shadow-md transition-all flex items-start gap-4">
                  <Link
                    href={`/${lSlug}/${sSlug}/${venue.id}`}
                    className="min-w-0 flex-1"
                  >
                    <h2 className="font-semibold text-ink truncate">{venue.name}</h2>
                    <p className="text-sm text-ink-muted mt-0.5 truncate">{venue.address}</p>
                    <p className="text-sm text-ink-muted mt-1">
                      {venue.courtCount} cancha{venue.courtCount !== 1 ? "s" : ""}
                    </p>
                  </Link>
                  <div className="shrink-0">
                    <a
                      href={`https://maps.google.com/?q=${venue.lat},${venue.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs bg-surface text-ink border border-line
                        rounded-full px-3 py-1 hover:bg-surface-2 transition-colors whitespace-nowrap"
                    >
                      Cómo llegar
                    </a>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
