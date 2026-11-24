import { getLocalitiesWithVenueCount } from "@/lib/supabase/queries";
import { APP_NAME } from "@/lib/constants";
import type { Metadata } from "next";
import Link from "next/link";
import { ContinueSearch } from "@/components/player-memory-ui";

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: "¿Dónde querés jugar?" };

export default async function HomePage() {
  const localities = await getLocalitiesWithVenueCount();

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-ink mb-1">{APP_NAME}</h1>
      <p className="text-ink-muted mb-6">¿En qué localidad querés reservar?</p>

      <ContinueSearch />

      {localities.length === 0 ? (
        <p className="text-center text-ink-muted py-16">
          No hay localidades disponibles todavía.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3">
          {localities.map((loc) => {
            const hasVenues = loc.venueCount > 0;
            return (
              <li key={loc.id}>
                {hasVenues ? (
                  <Link
                    href={`/${loc.slug}`}
                    className="block rounded-2xl border border-line bg-surface p-6 text-center
                      shadow-sm hover:border-primary hover:shadow-md transition-all"
                  >
                    <span className="text-lg font-semibold text-ink block">{loc.name}</span>
                    <span className="text-xs text-ink-muted mt-1 block">
                      {loc.venueCount} complejo{loc.venueCount !== 1 ? "s" : ""}
                    </span>
                  </Link>
                ) : (
                  <div
                    aria-disabled="true"
                    data-testid="locality-soon"
                    className="block rounded-2xl border border-dashed border-line bg-surface-2 p-6 text-center cursor-default select-none"
                  >
                    <span className="text-lg font-semibold text-ink-muted block">{loc.name}</span>
                    <span className="text-sm text-ink-muted mt-1 block">Próximamente</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
