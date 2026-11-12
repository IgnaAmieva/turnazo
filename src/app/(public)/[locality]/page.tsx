import { getLocalityBySlug, getSportsWithVenueCount } from "@/lib/supabase/queries";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = { params: Promise<{ locality: string }> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locality: slug } = await params;
  const locality = await getLocalityBySlug(slug);
  if (!locality) return { title: "Localidad no encontrada" };
  return { title: `${locality.name} — ¿Qué deporte?` };
}

const SPORT_ICON: Record<string, string> = {
  padel:  "🏸",
  futbol: "⚽",
  tenis:  "🎾",
};

export default async function LocalityPage({ params }: Props) {
  const { locality: slug } = await params;
  const locality = await getLocalityBySlug(slug);
  if (!locality) notFound();

  const sports = await getSportsWithVenueCount(locality.id);
  const availableSports = sports.filter((s) => s.venueCount > 0);

  return (
    <div className="max-w-lg mx-auto">
      <nav className="text-sm text-gray-400 mb-6">
        <Link href="/" className="hover:text-green-600">Inicio</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-700">{locality.name}</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">{locality.name}</h1>
      <p className="text-gray-500 mb-8">¿Qué deporte querés jugar?</p>

      {availableSports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 p-12 text-center">
          <p className="text-gray-400 text-sm">
            Todavía no hay complejos disponibles en {locality.name}.
          </p>
          <p className="text-gray-400 text-xs mt-1">Volvé pronto.</p>
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {sports.map((sport) => {
              const hasVenues = sport.venueCount > 0;
              return (
                <li key={sport.id}>
                  {hasVenues ? (
                    <Link
                      href={`/${locality.slug}/${sport.slug}`}
                      className="block rounded-2xl border border-gray-200 bg-white p-6 text-center
                        shadow-sm hover:border-green-400 hover:shadow-md transition-all"
                    >
                      <div className="text-4xl mb-2">{SPORT_ICON[sport.slug] ?? "🏅"}</div>
                      <span className="text-lg font-semibold text-gray-800 block">{sport.name}</span>
                      <span className="text-xs text-gray-400 mt-1 block">
                        {sport.venueCount} complejo{sport.venueCount !== 1 ? "s" : ""}
                      </span>
                    </Link>
                  ) : (
                    <div className="block rounded-2xl border border-gray-100 bg-gray-50 p-6 text-center opacity-40 cursor-not-allowed">
                      <div className="text-4xl mb-2 grayscale">{SPORT_ICON[sport.slug] ?? "🏅"}</div>
                      <span className="text-lg font-semibold text-gray-400 block">{sport.name}</span>
                      <span className="text-xs text-gray-400 mt-1 block">Sin complejos</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
