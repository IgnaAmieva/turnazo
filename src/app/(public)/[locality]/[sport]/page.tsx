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
      <nav className="text-sm text-gray-400 mb-6">
        <Link href="/" className="hover:text-green-600">Inicio</Link>
        <span className="mx-2">/</span>
        <Link href={`/${locality.slug}`} className="hover:text-green-600">{locality.name}</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-700">{sport.name}</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        {sport.name} en {locality.name}
      </h1>
      <p className="text-gray-500 mb-6">
        {venues.length === 0
          ? "No hay complejos disponibles en esta localidad todavía."
          : `${venues.length} complejo${venues.length !== 1 ? "s" : ""} disponible${venues.length !== 1 ? "s" : ""}`}
      </p>

      {venues.length > 0 && (
        <>
          <VenueMap venues={venues} className="mb-6 h-64 md:h-80 w-full rounded-2xl overflow-hidden border border-gray-200 shadow-sm" />

          <ul className="grid gap-3">
            {venues.map((venue) => (
              <li key={venue.id}>
                <div className="rounded-2xl border border-gray-200 bg-white p-5
                  shadow-sm hover:border-green-400 hover:shadow-md transition-all flex items-start gap-4">
                  <Link
                    href={`/${lSlug}/${sSlug}/${venue.id}`}
                    className="min-w-0 flex-1"
                  >
                    <h2 className="font-semibold text-gray-900 truncate">{venue.name}</h2>
                    <p className="text-sm text-gray-500 mt-0.5 truncate">{venue.address}</p>
                    <p className="text-sm text-gray-400 mt-1">
                      {venue.courtCount} cancha{venue.courtCount !== 1 ? "s" : ""}
                    </p>
                  </Link>
                  <div className="shrink-0">
                    <a
                      href={`https://maps.google.com/?q=${venue.lat},${venue.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs bg-blue-50 text-blue-700 border border-blue-200
                        rounded-full px-3 py-1 hover:bg-blue-100 transition-colors whitespace-nowrap"
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
