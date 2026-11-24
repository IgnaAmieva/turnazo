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
      <nav className="text-sm text-ink-muted mb-6">
        <Link href="/" className="inline-flex min-h-11 min-w-11 items-center justify-center hover:text-ink">Inicio</Link>
        <span className="mx-2">/</span>
        <span className="text-ink">{locality.name}</span>
      </nav>

      <h1 className="text-2xl font-bold text-ink mb-1">{locality.name}</h1>
      <p className="text-ink-muted mb-8">¿Qué deporte querés jugar?</p>

      {availableSports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-12 text-center">
          <p className="text-ink-muted text-sm">
            Todavía no hay complejos disponibles en {locality.name}.
          </p>
          <p className="text-ink-muted text-xs mt-1">Volvé pronto.</p>
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
                      className="block rounded-2xl border border-line bg-surface p-6 text-center
                        shadow-sm hover:border-primary hover:shadow-md transition-all"
                    >
                      <div className="text-4xl mb-2">{SPORT_ICON[sport.slug] ?? "🏅"}</div>
                      <span className="text-lg font-semibold text-ink block">{sport.name}</span>
                      <span className="text-xs text-ink-muted mt-1 block">
                        {sport.venueCount} complejo{sport.venueCount !== 1 ? "s" : ""}
                      </span>
                    </Link>
                  ) : (
                    <div className="block rounded-2xl border border-line bg-surface-2 p-6 text-center opacity-40 cursor-not-allowed">
                      <div className="text-4xl mb-2 grayscale">{SPORT_ICON[sport.slug] ?? "🏅"}</div>
                      <span className="text-lg font-semibold text-ink-muted block">{sport.name}</span>
                      <span className="text-xs text-ink-muted mt-1 block">Sin complejos</span>
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
