import { SlotLink } from '@/components/booking-sheet';
import {
  generateSlots,
  weekdayInMendoza,
  formatTimeMendoza,
  type CourtHour,
  type CourtPrice,
  type BookedPeriod,
} from '@/lib/slots';
import { APP_TIMEZONE } from '@/lib/constants';

const CELL = 'min-h-14 rounded-2xl border px-1 py-2 flex flex-col items-center justify-center gap-0.5 text-center';

interface Court {
  id: string;
  name: string;
  slot_minutes: number;
  /** Aclaraciones (027), para la hoja de reserva */
  notes?: string | null;
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
      <div className="rounded-xl border border-line p-6 text-center text-ink-muted text-sm">
        Sin horario este día
      </div>
    );
  }

  if (slots.length === 0) {
    // Had hours but all slots are in the past
    return (
      <div className="rounded-xl border border-line p-6 text-center text-ink-muted text-sm">
        No quedan turnos para hoy
      </div>
    );
  }

  return (
    // V2c: 4 columnas. Libre en tarjeta neutra con precio; elegido en lima con
    // borde primary; ocupado punteado y tachado.
    <div className="grid grid-cols-4 gap-2">
      {slots.map((slot) => {
        const startIso = slot.start.toISOString();
        const endIso   = slot.end.toISOString();
        const label    = formatTimeMendoza(slot.start);

        if (!slot.available) {
          return (
            <div
              key={startIso}
              data-testid="slot-taken"
              className={`${CELL} border-dashed border-line bg-transparent cursor-not-allowed`}
            >
              <span className="text-base text-ink-muted line-through">
                {label}
              </span>
              <span className="text-xs text-ink-muted">Ocupado</span>
            </div>
          );
        }

        // Sin precio cargado para ese horario (ej. futmates de 22:00 a 00:00): la base
        // rechaza la reserva (price_not_set), así que no se ofrece como libre.
        if (slot.price === null) {
          return (
            <div
              key={startIso}
              data-testid="slot-no-price"
              className={`${CELL} border-dashed border-line bg-transparent cursor-not-allowed`}
            >
              <span className="text-base text-ink-muted">{label}</span>
              <span className="text-xs leading-tight text-ink-muted">Consultá</span>
            </div>
          );
        }

        const href = `/${localitySlug}/${sportSlug}/${venueId}/reservar?cancha=${court.id}&inicio=${startIso}&fin=${endIso}&fecha=${date}`;

        return (
          <SlotLink
            key={startIso}
            href={href}
            slot={{
              courtId: court.id,
              courtName: court.name,
              start: startIso,
              end: endIso,
              date,
              timeLabel: `${label} – ${formatTimeMendoza(slot.end)}`,
              price: slot.price,
              courtNotes: court.notes ?? null,
            }}
            className={`group ${CELL} border-line bg-surface shadow-sm hover:border-primary transition-colors
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
            selectedClassName="!border-2 !border-primary !bg-accent"
          >
            <span className="text-base font-extrabold text-ink group-data-[selected=true]:text-on-accent">{label}</span>
            <span className="text-xs text-ink-muted group-data-[selected=true]:font-extrabold group-data-[selected=true]:text-on-accent">
              ${slot.price.toLocaleString('es-AR')}
            </span>
          </SlotLink>
        );
      })}
    </div>
  );
}
