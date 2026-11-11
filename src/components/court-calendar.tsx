import Link from 'next/link';
import {
  generateSlots,
  weekdayInMendoza,
  formatTimeMendoza,
  type CourtHour,
  type CourtPrice,
  type BookedPeriod,
} from '@/lib/slots';

interface Court {
  id: string;
  name: string;
  slot_minutes: number;
  hours: CourtHour[];
  prices: CourtPrice[];
}

interface Props {
  court: Court;
  date: string;
  bookedPeriods: BookedPeriod[];
  venueId: string;
  localitySlug: string;
  sportSlug: string;
}

export default function CourtCalendar({
  court,
  date,
  bookedPeriods,
  venueId,
  localitySlug,
  sportSlug,
}: Props) {
  const weekday = weekdayInMendoza(date);

  const hours = court.hours.filter((h) => h.weekday === weekday);
  const prices = court.prices.filter((p) => p.weekday === weekday);

  const slots = generateSlots({
    date,
    hours,
    slotMinutes: court.slot_minutes,
    booked: bookedPeriods,
    prices,
  });

  if (slots.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 p-6 text-center text-gray-500 text-sm">
        Sin horario este dia
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {slots.map((slot) => {
        const startIso = slot.start.toISOString();
        const endIso = slot.end.toISOString();
        const label = formatTimeMendoza(slot.start);

        if (!slot.available) {
          return (
            <div
              key={startIso}
              className="rounded-lg border border-gray-200 bg-gray-100 p-3 flex flex-col items-center gap-1 cursor-not-allowed"
            >
              <span className="text-sm font-medium text-gray-400 line-through">
                {label}
              </span>
              <span className="text-xs text-gray-400">Ocupado</span>
            </div>
          );
        }

        const href = `/${localitySlug}/${sportSlug}/${venueId}/reservar?cancha=${court.id}&inicio=${startIso}&fin=${endIso}&fecha=${date}`;

        return (
          <Link
            key={startIso}
            href={href}
            className="rounded-lg border border-green-200 bg-green-50 p-3 flex flex-col items-center gap-1
              hover:bg-green-100 hover:border-green-300 active:bg-green-200 transition-colors"
          >
            <span className="text-sm font-semibold text-green-900">{label}</span>
            {slot.price !== null && (
              <span className="text-xs text-green-700">
                ${slot.price.toLocaleString('es-AR')}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
