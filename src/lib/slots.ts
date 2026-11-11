/**
 * Lógica de generación de franjas horarias (slots) para una cancha y fecha.
 *
 * Toda la aritmética se hace en UTC.
 * Argentina/Mendoza = UTC-3 (sin horario de verano).
 */

import { APP_TIMEZONE } from "@/lib/constants";

export interface CourtHour {
  weekday: number;   // 0=domingo … 6=sábado
  open_time: string; // "08:00:00"
  close_time: string;
}

export interface BookedPeriod {
  start: Date;
  end: Date;
}

export interface TimeSlot {
  start: Date;
  end: Date;
  available: boolean;
  /** Precio del slot según court_prices; null si no hay precio configurado */
  price: number | null;
}

// ---------------------------------------------------------------------------
// Helpers de timezone
// ---------------------------------------------------------------------------

/**
 * Devuelve la fecha de hoy en Mendoza como "YYYY-MM-DD".
 */
export function todayInMendoza(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // en-CA usa YYYY-MM-DD
}

/**
 * Convierte una fecha "YYYY-MM-DD" y hora "HH:MM:SS" (en Mendoza, UTC-3) a un objeto Date (UTC).
 */
export function mendozaToUtc(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, m, s] = time.split(":").map(Number);
  // UTC = Mendoza + 3h
  return new Date(Date.UTC(y, mo - 1, d, h + 3, m ?? 0, s ?? 0));
}

/**
 * Formatea un Date (UTC) como "HH:MM" en la zona horaria de Mendoza.
 */
export function formatTimeMendoza(utcDate: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(utcDate);
}

/**
 * Formatea un Date (UTC) como "dddd D de MMMM" en español (ej: "miércoles 12 de noviembre").
 */
export function formatDateMendoza(utcDate: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: APP_TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(utcDate);
}

/**
 * Devuelve el día de la semana (0=dom…6=sáb) para una fecha "YYYY-MM-DD" en Mendoza.
 */
export function weekdayInMendoza(date: string): number {
  // Crear un Date a las 12:00 Mendoza para evitar problemas de borde de día
  const d = mendozaToUtc(date, "12:00:00");
  // JS getUTCDay() en ese timestamp equivale al día en Mendoza
  // (a las 15:00 UTC = 12:00 Mendoza, el día UTC coincide con el Mendoza)
  return d.getUTCDay(); // 0=dom
}

// ---------------------------------------------------------------------------
// Parser de tstzrange (formato de PostgREST)
// ---------------------------------------------------------------------------

/**
 * Parsea un tstzrange de Postgres, ej:
 *   ["2026-11-12T13:00:00+00:00","2026-11-12T14:30:00+00:00")
 */
export function parseTstzrange(range: string): BookedPeriod {
  const inner = range.replace(/^[\[(]/, "").replace(/[\])]$/, "");
  const comma = inner.indexOf(",");
  const startStr = inner.slice(0, comma).trim().replace(/"/g, "");
  const endStr   = inner.slice(comma + 1).trim().replace(/"/g, "");
  return { start: new Date(startStr), end: new Date(endStr) };
}

// ---------------------------------------------------------------------------
// Generador principal
// ---------------------------------------------------------------------------

export interface CourtPrice {
  weekday: number;
  from_time: string; // "08:00:00"
  to_time: string;   // "14:00:00"
  price: number;
}

/**
 * Genera todas las franjas horarias de una cancha para una fecha dada.
 *
 * @param date       - Fecha en Mendoza "YYYY-MM-DD"
 * @param hours      - Tramos de apertura de la cancha (filtrados por weekday externamente)
 * @param slotMinutes - Duración de cada turno en minutos
 * @param booked     - Períodos ya reservados/bloqueados
 * @param prices     - Precios por franja (filtrados por weekday externamente)
 */
export function generateSlots(params: {
  date: string;
  hours: CourtHour[];
  slotMinutes: number;
  booked: BookedPeriod[];
  prices: CourtPrice[];
}): TimeSlot[] {
  const { date, hours, slotMinutes, booked, prices } = params;
  const slots: TimeSlot[] = [];
  const slotMs = slotMinutes * 60 * 1000;

  for (const hour of hours) {
    const open  = mendozaToUtc(date, hour.open_time);
    const close = mendozaToUtc(date, hour.close_time);

    let cursor = open.getTime();
    while (cursor + slotMs <= close.getTime()) {
      const start = new Date(cursor);
      const end   = new Date(cursor + slotMs);

      // Chequear solapamiento con reservas activas
      const available = !booked.some(
        (b) => start < b.end && end > b.start
      );

      // Buscar precio aplicable: la primera franja que contenga start
      const matchPrice = prices.find((p) => {
        const from = mendozaToUtc(date, p.from_time);
        const to   = mendozaToUtc(date, p.to_time);
        return start >= from && start < to;
      });

      slots.push({ start, end, available, price: matchPrice?.price ?? null });
      cursor += slotMs;
    }
  }

  // Ordenar por hora de inicio
  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  return slots;
}
