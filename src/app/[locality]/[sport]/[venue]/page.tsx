import {
  getLocalityBySlug,
  getSportBySlug,
  getVenueWithCourts,
  getCourtAvailability,
} from "@/lib/supabase/queries";
import { todayInMendoza, mendozaToUtc, parseTstzrange } from "@/lib/slots";
import CourtCalendar from "@/components/court-calendar";
import AvailabilityWatcher from "@/components/availability-watcher";
import DateNavigator from "@/components/date-navigator";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ locality: string; sport: string; venue: string }>;
  searchParams: Promise<{ fecha?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { venue: venueId, sport: sSlug } = await params;
  const venue = await getVenueWithCourts(venueId, sSlug);
  if (!venue) return { title: "Complejo no encontrado" };
  return { title: venue.name };
}

export default async function VenuePage({ params, searchParams }: Props) {
  const { locality: lSlug, sport: sSlug, venue: venueId } = await params;
  const { fecha } = await searchParams;

  const today = todayInMendoza();
  const date = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : today;

  const [locality, sport, venue] = await Promise.all([
    getLocalityBySlug(lSlug),
    getSportBySlug(sSlug),
    getVenueWithCourts(venueId, sSlug),
  ]);

  if (!locality || !sport || !venue) notFound();

  // Rango del día completo en UTC para la consulta de disponibilidad
  const dayStart = mendozaToUtc(date, "00:00:00").toISOString();
  const dayEnd   = mendozaToUtc(date, "23:59:59").toISOString();

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

  return (
    <div>
      <nav className="text-sm text-gray-400 mb-6">
        <Link href="/" className="hover:text-green-600">Inicio</Link>
        <span className="mx-2">/</span>
        <Link href={`/${lSlug}`} className="hover:text-green-600">{locality.name}</Link>
        <span className="mx-2">/</span>
        <Link href={`/${lSlug}/${sSlug}`} className="hover:text-green-600">{sport.name}</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-700">{venue.name}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{venue.name}</h1>
          <p className="text-sm text-gray-500 mt-1">{venue.address}</p>
        </div>
        <a
          href={`https://maps.google.com/?q=${venue.lat},${venue.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm bg-blue-50 text-blue-700 border border-blue-200
            rounded-full px-4 py-2 hover:bg-blue-100 transition-colors whitespace-nowrap"
        >
          Cómo llegar
        </a>
      </div>

      <DateNavigator date={date} basePath={basePath} />

      {venue.courts.length === 0 ? (
        <p className="text-center text-gray-400 py-16">
          No hay canchas de {sport.name} disponibles en este complejo.
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          {venue.courts.map((court) => (
            <section key={court.id}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-gray-800">{court.name}</h2>
                <span className="text-xs text-gray-400">{court.slot_minutes} min</span>
              </div>

              <CourtCalendar
                court={court}
                date={date}
                bookedPeriods={availabilityByCourtId[court.id] ?? []}
                venueId={venueId}
                localitySlug={lSlug}
                sportSlug={sSlug}
              />

              <AvailabilityWatcher courtId={court.id} date={date} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
