import type { Metadata } from "next";
import Link from "next/link";
import { getLocalitiesWithVenueCount, getSportsWithVenueCount } from "@/lib/supabase/queries";
import { getVenuesForList, earliestFreeSlot, slotHref, type FreeSlot } from "@/lib/free-slots";
import { formatTimeMendoza, todayInMendoza } from "@/lib/slots";
import { CoverGreeting, OpenRememberedSearch } from "@/components/player-memory-ui";
import { CourtLines, SportIcon } from "@/components/sport-art";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "¿Jugamos hoy?" };

type Props = { searchParams: Promise<{ localidad?: string; deporte?: string }> };

const plural = (n: number) => `${n} complejo${n !== 1 ? "s" : ""}`;

/**
 * Inicio (V2a): deporte y lugar en una sola pantalla, y arriba el primer turno
 * libre ("Lo antes posible"). La elección va en la URL (?localidad=&deporte=);
 * sin elección, la búsqueda recordada en el dispositivo o la primera con complejos.
 * Las URLs /[localidad] y /[localidad]/[deporte] siguen funcionando.
 */
export default async function HomePage({ searchParams }: Props) {
  const params = await searchParams;
  const localities = await getLocalitiesWithVenueCount();
  // Una localidad pedida sin complejos (ej. /la-consulta) se muestra igual, con su aviso
  const locality =
    localities.find((l) => l.slug === params.localidad) ??
    localities.find((l) => l.venueCount > 0) ??
    null;

  if (!locality) {
    return (
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-extrabold text-ink mb-2">¿Jugamos hoy?</h1>
        <p className="text-center text-ink-muted py-16">No hay complejos disponibles todavía.</p>
      </div>
    );
  }

  const sports = await getSportsWithVenueCount(locality.id);
  const sport =
    sports.find((s) => s.slug === params.deporte && s.venueCount > 0) ??
    sports.find((s) => s.venueCount > 0) ??
    null;

  let earliest: FreeSlot | null = null;
  if (sport) {
    const venues = await getVenuesForList(locality.id, sport.id);
    earliest = await earliestFreeSlot(venues);
  }

  const homeHref = (l: string, d?: string) => `/?localidad=${l}${d ? `&deporte=${d}` : ""}`;
  const listHref = sport ? `/${locality.slug}/${sport.slug}` : null;

  return (
    <div className="max-w-lg mx-auto">
      <OpenRememberedSearch shown={{ localidad: locality.slug, deporte: sport?.slug ?? null }} />

      {/* Portada: saludo, "¿Jugamos hoy?" y el próximo turno libre */}
      <section className="cover relative overflow-hidden rounded-3xl p-5 shadow-sm" data-testid="portada">
        <CourtLines slug={sport?.slug ?? "futbol"} className="opacity-[0.14]" />
        <div className="relative">
          <CoverGreeting />
          <h1 className="text-[2rem] font-extrabold leading-tight">¿Jugamos hoy?</h1>

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
                  {earliest.date === todayInMendoza() ? "" : "Mañana "}
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
      <ul className="flex flex-wrap gap-2">
        {localities.map((l) => {
          const selected = l.id === locality.id;
          return (
            <li key={l.id}>
              {l.venueCount > 0 ? (
                <Link
                  href={homeHref(l.slug, sport?.slug)}
                  scroll={false}
                  aria-current={selected ? "true" : undefined}
                  data-testid="localidad"
                  className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-extrabold
                    ${selected ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-ink hover:border-primary"}`}
                >
                  {l.name} · {l.venueCount}
                </Link>
              ) : (
                <span aria-disabled="true" data-testid="locality-soon"
                  className="inline-flex min-h-11 items-center rounded-full border border-dashed border-line px-4 text-sm font-extrabold text-ink-muted select-none">
                  {l.name} · pronto
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {listHref && sport && (
        <Link
          href={listHref}
          data-testid="ver-complejos"
          className="mt-8 flex min-h-11 items-center justify-center rounded-2xl bg-primary px-4 py-3.5 text-sm font-extrabold text-on-primary shadow-sm hover:opacity-90"
        >
          Ver {plural(sport.venueCount)} de {sport.name} en {locality.name}
        </Link>
      )}
    </div>
  );
}
