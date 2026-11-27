import type { Metadata } from "next";
import Link from "next/link";
import { getLocalitiesAndSportsWithCounts } from "@/lib/supabase/queries";
import { getVenuesForList, listDaySlots, earliestFreeSlot, slotHref, type FreeSlot } from "@/lib/free-slots";
import { dayWord, parseListDate } from "@/lib/list-day";
import { parseWhen, whenParams } from "@/lib/franjas";
import { formatTimeMendoza, todayInMendoza } from "@/lib/slots";
import { CoverGreeting, RememberSearch } from "@/components/player-memory-ui";
import { CourtLines, SportIcon } from "@/components/sport-art";
import { WhereBar } from "@/components/where-bar";
import { VenueResults } from "@/components/venue-results";
import { VenuesMapToggle } from "@/components/venues-map-toggle";
import { FormatSelect } from "@/components/format-select";
import { filterByFormat, formatLabel, isFormat } from "@/lib/court-format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "¿Jugamos hoy?" };

type Props = {
  searchParams: Promise<{ localidad?: string; deporte?: string; hora?: string; formato?: string; fecha?: string; _now?: string }>;
};

const plural = (n: number) => `${n} complejo${n !== 1 ? "s" : ""}`;

/**
 * Inicio: deporte, "¿Dónde?" (una barra desplegable, la más cercana si el
 * jugador dio permiso de ubicación), "¿A qué hora querés jugar?" y, en la
 * MISMA pantalla, los complejos con lugar (primero el que tiene más turnos
 * libres). La elección va en la URL (?localidad=&deporte=&hora=); sin
 * elección, la más cercana, la recordada o la primera con complejos.
 */
export default async function HomePage({ searchParams }: Props) {
  const params = await searchParams;
  const { localities: all, sportsFor } = await getLocalitiesAndSportsWithCounts();
  // Solo localidades con al menos un complejo aprobado
  const localities = all.filter((l) => l.venueCount > 0);
  const locality = localities.find((l) => l.slug === params.localidad) ?? localities[0] ?? null;

  if (!locality) {
    return (
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-extrabold text-ink mb-2">¿Jugamos hoy?</h1>
        <p className="text-center text-ink-muted py-16">No hay complejos disponibles todavía.</p>
      </div>
    );
  }

  // Solo en desarrollo/tests: ?_now= fija la hora actual (igual que la lista y el complejo)
  const fixedNow = process.env.NODE_ENV !== "production" && params._now && !Number.isNaN(Date.parse(params._now))
    ? params._now : null;
  const now = fixedNow ? new Date(fixedNow) : new Date();
  const today = todayInMendoza(now);
  const when = parseWhen(params.hora);

  const sports = sportsFor(locality.id);
  const sport =
    sports.find((s) => s.slug === params.deporte && s.venueCount > 0) ??
    sports.find((s) => s.venueCount > 0) ??
    null;

  // Fútbol: ?formato= deja solo las canchas de ese formato (027)
  const formato = sport?.slug === "futbol" && isFormat(params.formato) ? params.formato : null;
  const venues = sport ? filterByFormat(await getVenuesForList(locality.id, sport.id), formato) : [];
  // Los libres se piden una vez por cancha y fecha (React cache): los usan la lista y "Lo antes posible".
  // Sin ?fecha=, de noche, si hoy ya no hay lugar, los dos pasan solos a mañana.
  const chosen = parseListDate(params.fecha, today);
  const [day, earliest] = sport
    ? await Promise.all([listDaySlots(venues, today, chosen, now), earliestFreeSlot(venues, now)])
    : [{ date: today, rolled: false, slots: [] as FreeSlot[] }, null];

  const explicit = params.localidad !== undefined || params.deporte !== undefined;
  const keep: Record<string, string> = {
    ...(fixedNow ? { _now: fixedNow } : {}), ...(chosen ? { fecha: chosen } : {}), ...whenParams(when),
  };
  const homeHref = (l: string, d?: string) =>
    `/?${new URLSearchParams({ localidad: l, ...(d ? { deporte: d } : {}), ...keep }).toString()}`;

  return (
    <div className="max-w-lg mx-auto">
      {explicit && sport && (
        <RememberSearch localidad={{ slug: locality.slug, nombre: locality.name }} deporte={{ slug: sport.slug, nombre: sport.name }} />
      )}

      {/* Portada: saludo, "¿Jugamos hoy?" y el próximo turno libre */}
      <section className="cover relative overflow-hidden rounded-3xl p-5 shadow-sm" data-testid="portada">
        <CourtLines slug={sport?.slug ?? "futbol"} className="opacity-[0.14]" />
        <div className="relative">
          <CoverGreeting />
          <h1 className="text-[2rem] font-extrabold leading-tight">¿Jugamos {dayWord(day.date, today)}?</h1>

          {sport && earliest ? (
            <Link
              href={slotHref(locality.slug, sport.slug, earliest)}
              data-testid="lo-antes-posible"
              className="mt-4 flex min-h-11 items-center justify-between gap-3 rounded-2xl bg-accent px-4 py-3 text-on-accent
                shadow-sm hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
            >
              <span className="min-w-0">
                <span className="block text-sm">Lo antes posible</span>
                <span className="block text-lg font-extrabold leading-tight">
                  {earliest.date === today ? "" : "Mañana "}
                  {formatTimeMendoza(earliest.start)} · {earliest.venueName}
                </span>
              </span>
              <span aria-hidden="true" className="text-2xl font-extrabold">→</span>
            </Link>
          ) : sport ? (
            <p className="mt-4 rounded-2xl border border-current/30 px-4 py-3 text-sm" data-testid="sin-turnos">
              No quedan turnos libres hoy ni mañana. Mirá los complejos para otros días.
            </p>
          ) : (
            <p className="mt-4 rounded-2xl border border-current/30 px-4 py-3 text-sm" data-testid="sin-complejos">
              Todavía no hay complejos en {locality.name}. Volvé pronto.
            </p>
          )}

          <p className="mt-4 text-sm">
            <span>{locality.name}{sport ? ` · ${sport.name}` : ""} · </span>
            <a href="#elegir" className="inline-flex min-h-11 items-center font-extrabold underline underline-offset-4">
              cambiar
            </a>
          </p>
        </div>
      </section>

      {/* ¿Qué querés jugar? */}
      <h2 id="elegir" className="mt-7 mb-3 scroll-mt-20 text-lg text-ink">¿Qué querés jugar?</h2>
      <ul className="grid grid-cols-3 gap-2">
        {sports.map((s) => {
          const selected = s.id === sport?.id;
          const has = s.venueCount > 0;
          const body = (
            <>
              <SportIcon slug={s.slug} className="mx-auto h-8 w-8" />
              <span className="mt-1.5 block text-base font-extrabold">{s.name}</span>
              <span className={`block text-xs ${selected ? "" : "text-ink-muted"}`}>{has ? plural(s.venueCount) : "Pronto"}</span>
            </>
          );
          return (
            <li key={s.id}>
              {has ? (
                <Link
                  href={homeHref(locality.slug, s.slug)}
                  scroll={false}
                  aria-current={selected ? "true" : undefined}
                  data-testid="deporte"
                  className={`block min-h-11 rounded-2xl border p-3 text-center shadow-sm transition-colors
                    ${selected ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-ink hover:border-primary"}`}
                >
                  {body}
                </Link>
              ) : (
                <div aria-disabled="true" data-testid="deporte-pronto"
                  className="block rounded-2xl border border-dashed border-line bg-surface-2 p-3 text-center text-ink-muted select-none">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* ¿Dónde? */}
      <h2 className="mt-7 mb-3 text-lg text-ink">¿Dónde?</h2>
      <WhereBar
        localities={localities.map(({ slug, name, lat, lng, venueCount }) => ({ slug, name, lat, lng, venueCount }))}
        current={locality.slug}
        sport={sport ? { slug: sport.slug, name: sport.name } : null}
        explicit={explicit}
        keep={keep}
      />

      {/* Complejos de ese deporte, en esta misma pantalla */}
      {sport && (
        <div id="complejos" data-testid="complejos-inicio">
          <VenueResults
            venues={venues}
            slots={day.slots}
            when={when}
            today={today}
            date={day.date}
            rolled={day.rolled}
            localitySlug={locality.slug}
            sportSlug={sport.slug}
            basePath="/"
            baseParams={{
              localidad: locality.slug, deporte: sport.slug,
              ...(keep._now ? { _now: keep._now } : {}),
              ...(chosen ? { fecha: chosen } : {}),
              ...(formato ? { formato } : {}),
            }}
            noVenuesText={formato ? `Ningún complejo de ${locality.name} cargó canchas de ${formatLabel(formato)} todavía.` : undefined}
            filters={sport.slug === "futbol" ? (
              <FormatSelect basePath="/" current={formato} params={{ localidad: locality.slug, deporte: sport.slug, ...keep }} />
            ) : undefined}
          />
          {venues.length > 0 && (
            <VenuesMapToggle venues={venues.map(({ id, name, address, lat, lng }) => ({ id, name, address, lat, lng }))} />
          )}
        </div>
      )}
    </div>
  );
}
