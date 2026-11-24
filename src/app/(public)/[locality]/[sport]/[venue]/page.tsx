import {
  getLocalityBySlug,
  getSportBySlug,
  getVenueWithCourts,
  getCourtAvailability,
} from "@/lib/supabase/queries";
import {
  todayInMendoza, mendozaToUtc, parseTstzrange, generateSlots, weekdayInMendoza, formatTimeMendoza,
} from "@/lib/slots";
import CourtCalendar from "@/components/court-calendar";
import AvailabilityWatcher from "@/components/availability-watcher";
import DateNavigator from "@/components/date-navigator";
import { BookingSheetProvider, type SheetSlot } from "@/components/booking-sheet";
import { RememberSearch } from "@/components/player-memory-ui";
import type { Metadata } from "next";
import Breadcrumbs from "@/components/breadcrumbs";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ locality: string; sport: string; venue: string }>;
  searchParams: Promise<{ fecha?: string; _now?: string; cancha?: string; inicio?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { venue: venueId, sport: sSlug } = await params;
  const venue = await getVenueWithCourts(venueId, sSlug);
  if (!venue) return { title: "Complejo no encontrado" };
  return { title: venue.name };
}

export default async function VenuePage({ params, searchParams }: Props) {
  const { locality: lSlug, sport: sSlug, venue: venueId } = await params;
  const { fecha, _now, cancha, inicio } = await searchParams;

  const today = todayInMendoza();
  const date = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : today;

  // Dev-only: allow overriding current time via ?_now= for E2E tests.
  const nowUtc =
    process.env.NODE_ENV !== "production" && _now
      ? new Date(_now)
      : undefined;

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

  // Turno elegido en el inicio o en la lista (?cancha=&inicio=): la hoja arranca
  // abierta, solo si el turno sigue libre, con precio y todavía no empezó.
  let initialSlot: SheetSlot | null = null;
  const chosenCourt = cancha ? venue.courts.find((c) => c.id === cancha) : undefined;
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

  return (
    <div>
      <RememberSearch
        localidad={{ slug: locality.slug, nombre: locality.name }}
        deporte={{ slug: sport.slug, nombre: sport.name }}
      />
      <Breadcrumbs
        back={`/${lSlug}/${sSlug}`}
        items={[
          { href: "/", label: "Inicio" },
          { href: `/${lSlug}`, label: locality.name },
          { href: `/${lSlug}/${sSlug}`, label: sport.name },
        ]}
        current={venue.name}
      />

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">{venue.name}</h1>
          <p className="text-sm text-ink-muted mt-1">{venue.address}</p>
        </div>
        <a
          href={`https://maps.google.com/?q=${venue.lat},${venue.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center text-sm bg-surface text-ink border border-line
            rounded-full px-4 py-2 hover:bg-surface-2 transition-colors whitespace-nowrap"
        >
          Cómo llegar
        </a>
      </div>

      <DateNavigator date={date} basePath={basePath} />

      {venue.courts.length === 0 ? (
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
        <div className="mt-6 space-y-8">
          {venue.courts.map((court) => (
            <section key={court.id}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-ink">{court.name}</h2>
                <span className="text-xs text-ink-muted">{court.slot_minutes} min</span>
              </div>

              <CourtCalendar
                court={court}
                date={date}
                bookedPeriods={availabilityByCourtId[court.id] ?? []}
                venueId={venueId}
                localitySlug={lSlug}
                sportSlug={sSlug}
                nowUtc={nowUtc}
              />

              <AvailabilityWatcher courtId={court.id} date={date} />
            </section>
          ))}
        </div>
        </BookingSheetProvider>
      )}
    </div>
  );
}
