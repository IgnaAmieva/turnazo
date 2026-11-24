import {
  getLocalityBySlug,
  getSportBySlug,
  getVenueWithCourts,
  getCourtAvailability,
} from "@/lib/supabase/queries";
import {
  todayInMendoza, mendozaToUtc, parseTstzrange, generateSlots, weekdayInMendoza, formatTimeMendoza,
} from "@/lib/slots";
import { nextDate } from "@/lib/free-slots";
import CourtCalendar from "@/components/court-calendar";
import AvailabilityWatcher from "@/components/availability-watcher";
import { BookingSheetProvider, type SheetSlot } from "@/components/booking-sheet";
import { RememberSearch } from "@/components/player-memory-ui";
import { CourtLines } from "@/components/sport-art";
import { MiniMap } from "@/components/mini-map";
import { VenueDistance } from "@/components/venue-distance";
import { ScrollIntoViewOnMount } from "@/components/scroll-into-view";
import type { Metadata } from "next";
import Link from "next/link";
import Breadcrumbs from "@/components/breadcrumbs";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ locality: string; sport: string; venue: string }>;
  searchParams: Promise<{ fecha?: string; _now?: string; cancha?: string; inicio?: string; c?: string }>;
};

/**
 * Días que se pueden reservar contando hoy. La base rechaza turnos que
 * empiezan a más de 30 días de ahora (too_far_ahead, migración 021): con 30
 * días calendario (hoy + 29) todos los turnos visibles entran en ese límite.
 */
const BOOKING_DAYS = 30;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { venue: venueId, sport: sSlug } = await params;
  const venue = await getVenueWithCourts(venueId, sSlug);
  if (!venue) return { title: "Complejo no encontrado" };
  return { title: venue.name };
}

function dayChip(date: string, today: string) {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short" })
    .format(new Date(Date.UTC(y, m - 1, d, 12))).replace(".", "");
  return { top: date === today ? "Hoy" : wd.charAt(0).toUpperCase() + wd.slice(1), day: String(d) };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function VenuePage({ params, searchParams }: Props) {
  const { locality: lSlug, sport: sSlug, venue: venueId } = await params;
  const { fecha, _now, cancha, inicio, c } = await searchParams;

  // Dev-only: allow overriding current time via ?_now= for E2E tests.
  const nowUtc =
    process.env.NODE_ENV !== "production" && _now && !Number.isNaN(Date.parse(_now))
      ? new Date(_now)
      : undefined;

  const today = todayInMendoza(nowUtc);
  const date = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : today;

  const [locality, sport, venue] = await Promise.all([
    getLocalityBySlug(lSlug),
    getSportBySlug(sSlug),
    getVenueWithCourts(venueId, sSlug),
  ]);

  if (!locality || !sport || !venue) notFound();

  // Rango de 30 horas desde la medianoche de Mendoza para cubrir canchas
  // con cierre después de medianoche (ej. 08:00-02:00 del día siguiente).
  const dayStart = mendozaToUtc(date, "00:00:00").toISOString();
  const dayEnd   = new Date(
    mendozaToUtc(date, "00:00:00").getTime() + 30 * 60 * 60 * 1000
  ).toISOString();

  // Obtener disponibilidad de todas las canchas en paralelo
  const availabilityByCourtId = Object.fromEntries(
    await Promise.all(
      venue.courts.map(async (court) => {
        const rows = await getCourtAvailability(court.id, dayStart, dayEnd);
        const booked = rows.map((r) => parseTstzrange(r.period as string));
        return [court.id, booked] as const;
      })
    )
  );

  const basePath = `/${lSlug}/${sSlug}/${venueId}`;
  const listPath = `/${lSlug}/${sSlug}`;

  // Turno elegido en el inicio o en la lista (?cancha=&inicio=): la hoja arranca
  // abierta, solo si el turno sigue libre, con precio y todavía no empezó.
  let initialSlot: SheetSlot | null = null;
  const chosenCourt = cancha ? venue.courts.find((ct) => ct.id === cancha) : undefined;
  if (chosenCourt && inicio && !Number.isNaN(Date.parse(inicio))) {
    const weekday = weekdayInMendoza(date);
    const slot = generateSlots({
      date,
      hours: chosenCourt.hours.filter((h) => h.weekday === weekday),
      slotMinutes: chosenCourt.slot_minutes,
      booked: availabilityByCourtId[chosenCourt.id] ?? [],
      prices: chosenCourt.prices.filter((p) => p.weekday === weekday),
      cutoff: date <= today ? (nowUtc ?? new Date()) : undefined,
    }).find((s) => s.start.toISOString() === new Date(inicio).toISOString());
    if (slot && slot.available && slot.price !== null) {
      initialSlot = {
        courtId: chosenCourt.id, courtName: chosenCourt.name,
        start: slot.start.toISOString(), end: slot.end.toISOString(), date,
        timeLabel: `${formatTimeMendoza(slot.start)} – ${formatTimeMendoza(slot.end)}`,
        price: slot.price,
      };
    }
  }

  // Pestaña de cancha (?c=): la del turno elegido, la pedida o la primera
  const activeCourt =
    venue.courts.find((ct) => ct.id === (initialSlot?.courtId ?? c)) ?? venue.courts[0];

  const minutes = [...new Set(venue.courts.map((ct) => ct.slot_minutes))].sort((a, b) => a - b);
  const subtitle = [sport.name, plural(venue.courts.length, "cancha", "canchas")].join(" · ");

  const days: string[] = [];
  for (let d = today, i = 0; i < BOOKING_DAYS; i++, d = nextDate(d)) days.push(d);
  const q = (params: Record<string, string>) => `${basePath}?${new URLSearchParams(params).toString()}`;

  return (
    <div className="max-w-lg mx-auto pb-28">
      <RememberSearch
        localidad={{ slug: locality.slug, nombre: locality.name }}
        deporte={{ slug: sport.slug, nombre: sport.name }}
      />
      {/* Escritorio: migas. En el celular, la flecha de la portada. */}
      <Breadcrumbs
        back={listPath}
        hideMobileBack
        items={[
          { href: `/?localidad=${lSlug}&deporte=${sSlug}`, label: "Inicio" },
          { href: listPath, label: `${sport.name} en ${locality.name}` },
        ]}
        current={venue.name}
      />

      {/* Portada verde con las líneas de la cancha */}
      <header className="cover relative -mx-4 -mt-6 overflow-hidden px-5 pt-4 pb-16 sm:mx-0 sm:mt-0 sm:rounded-3xl" data-testid="portada-complejo">
        <CourtLines slug={sport.slug} className="opacity-[0.16]" />
        <div className="relative flex min-h-[9.5rem] flex-col justify-between gap-6">
          <Link
            href={listPath}
            data-testid="volver"
            aria-label="Volver"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-current/15 text-xl sm:hidden"
          >
            <span aria-hidden="true">←</span>
          </Link>
          <div>
            <h1 className="text-[2rem] font-extrabold leading-tight">{venue.name}</h1>
            <p className="text-sm">{subtitle}</p>
          </div>
        </div>
      </header>

      {/* Tarjeta flotante: dirección, mapa chiquito e "Ir" */}
      <div className="relative z-10 -mt-12 flex items-center gap-3 rounded-3xl border border-line bg-surface p-3 shadow-md" data-testid="ubicacion">
        <MiniMap id={venue.id} size={56} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold text-ink">{venue.address}</p>
          <p className="text-xs text-ink-muted">{locality.name}<VenueDistance lat={venue.lat} lng={venue.lng} /></p>
        </div>
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Ir: cómo llegar"
          data-testid="ir"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-extrabold text-ink
            border border-line hover:border-primary"
        >
          Ir
        </a>
      </div>

      {/* Días deslizables */}
      <nav aria-label="Día" className="-mx-4 mt-5 overflow-x-auto px-4 [scrollbar-width:none]">
        <ul className="flex gap-2 pb-1">
          {days.map((d) => {
            const { top, day } = dayChip(d, today);
            const selected = d === date;
            return (
              <li key={d}>
                <Link
                  href={q({ fecha: d, ...(activeCourt ? { c: activeCourt.id } : {}) })}
                  scroll={false}
                  aria-current={selected ? "date" : undefined}
                  data-testid="dia"
                  className={`flex h-16 w-14 flex-col items-center justify-center rounded-2xl border text-center
                    ${selected ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-ink hover:border-primary"}`}
                >
                  <span className="text-xs">{top}</span>
                  <span className="text-xl font-extrabold leading-tight">{day}</span>
                  {selected && <ScrollIntoViewOnMount />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {venue.courts.length === 0 || !activeCourt ? (
        <p className="text-center text-ink-muted py-16">
          No hay canchas de {sport.name} disponibles en este complejo.
        </p>
      ) : (
        <BookingSheetProvider
          initialSlot={initialSlot}
          venue={{
            id: venue.id, name: venue.name, address: venue.address,
            deposit_required: venue.deposit_required, deposit_type: venue.deposit_type,
            deposit_value: venue.deposit_value, allow_full_payment: venue.allow_full_payment,
            allow_pay_at_venue: venue.allow_pay_at_venue,
          }}
        >
          {/* Pestañas por cancha */}
          <div className="mt-4 flex items-center justify-between gap-3">
            <nav aria-label="Cancha" className="flex flex-wrap gap-2">
              {venue.courts.map((ct) => {
                const selected = ct.id === activeCourt.id;
                return (
                  <Link
                    key={ct.id}
                    href={q({ fecha: date, c: ct.id })}
                    scroll={false}
                    aria-current={selected ? "page" : undefined}
                    data-testid="cancha-tab"
                    className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-extrabold
                      ${selected ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-ink hover:border-primary"}`}
                  >
                    {ct.name}
                  </Link>
                );
              })}
            </nav>
            <span className="shrink-0 text-xs text-ink-muted">Turnos de {minutes.join(" y ")} min</span>
          </div>

          <section className="mt-4" aria-label={activeCourt.name}>
            <h2 className="sr-only">{activeCourt.name}</h2>
            <CourtCalendar
              court={activeCourt}
              date={date}
              bookedPeriods={availabilityByCourtId[activeCourt.id] ?? []}
              venueId={venueId}
              localitySlug={lSlug}
              sportSlug={sSlug}
              nowUtc={nowUtc}
            />
            <AvailabilityWatcher courtId={activeCourt.id} date={date} />
          </section>
        </BookingSheetProvider>
      )}
    </div>
  );
}
