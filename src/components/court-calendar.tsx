import Link from 'next/link';
import {
  generateSlots,
  weekdayInMendoza,
  formatTimeMendoza,
  type CourtHour,
  type CourtPrice,
  type BookedPeriod,
} from '@/lib/slots';
import { APP_TIMEZONE } from '@/lib/constants';

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
  /** Override for current UTC time — used in dev/test via ?_now= param. */
  nowUtc?: Date;
}

export default function CourtCalendar({
  court,
  date,
  bookedPeriods,
  venueId,
  localitySlug,
  sportSlug,
  nowUtc,
}: Props) {
  const weekday = weekdayInMendoza(date);
  const hours   = court.hours.filter((h) => h.weekday === weekday);
  const prices  = court.prices.filter((p) => p.weekday === weekday);

  // Determine cutoff: use it only when viewing today (or when _now puts us "inside" this date).
  // nowUtc defaults to the real current time if not provided.
  const effectiveNow = nowUtc ?? new Date();
  // Derive "today" from effectiveNow so the _now override works in tests.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(effectiveNow);
  // "Is this date in the past relative to effectiveNow?"
  // We consider a date past if its midnight-end (00:00 next day Mendoza = 03:00 UTC next day) ≤ effectiveNow.
  // Simpler: compare date string to today string; if date ≤ today, apply cutoff.
  const cutoff = date <= today ? effectiveNow : undefined;

  // Generate slots without cutoff first, to distinguish "no hours" from "all passed"
  const allSlots = generateSlots({ date, hours, slotMinutes: court.slot_minutes, booked: bookedPeriods, prices });
  const slots    = cutoff
    ? generateSlots({ date, hours, slotMinutes: court.slot_minutes, booked: bookedPeriods, prices, cutoff })
    : allSlots;

  if (allSlots.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 p-6 text-center text-gray-500 text-sm">
        Sin horario este día
      </div>
    );
  }

  if (slots.length === 0) {
    // Had hours but all slots are in the past
    return (
      <div className="rounded-xl border border-gray-200 p-6 text-center text-gray-500 text-sm">
        No quedan turnos para hoy
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {slots.map((slot) => {
        const startIso = slot.start.toISOString();
        const endIso   = slot.end.toISOString();
        const label    = formatTimeMendoza(slot.start);

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
