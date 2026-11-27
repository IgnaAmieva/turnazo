/**
 * Turnos libres (y con precio) de varias canchas, para el inicio ("Lo antes
 * posible") y la lista de complejos (próximos turnos por franja).
 *
 * Cuidado con la carga: la disponibilidad sale de get_court_availability,
 * una llamada por cancha. Por eso:
 *   - las canchas se traen con UNA consulta (complejos + canchas + horarios + precios);
 *   - la disponibilidad se pide una sola vez por cancha y fecha en cada
 *     request (React cache), y como mucho para MAX_COURTS canchas;
 *   - solo se pide la fecha que hace falta (hoy y, si hoy no hay nada, mañana).
 */
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getCourtAvailability, type CourtWithSchedule } from '@/lib/supabase/queries';
import {
  generateSlots, mendozaToUtc, parseTstzrange, todayInMendoza, weekdayInMendoza,
} from '@/lib/slots';

/** Tope de canchas consultadas por pantalla (una llamada a la base por cancha). */
export const MAX_COURTS = 24;

export type VenueForList = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** Logo del club (024): círculo en la tarjeta y en "Lo antes posible" */
  logo_path: string | null;
  courts: CourtWithSchedule[];
};

export type FreeSlot = {
  venueId: string;
  venueName: string;
  courtId: string;
  courtName: string;
  date: string;   // YYYY-MM-DD Mendoza
  start: Date;
  end: Date;
  price: number;
};

/** Complejos aprobados de la localidad con canchas activas del deporte (una consulta). */
export const getVenuesForList = cache(async (localityId: string, sportId: string): Promise<VenueForList[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('venues')
    .select(`id, name, address, lat, lng, logo_path,
      courts!inner(id, name, slot_minutes, sport_id, active, surface, covered, lit, has_locker_room, format,
        court_hours(weekday, open_time, close_time),
        court_prices(weekday, from_time, to_time, price))`)
    .eq('locality_id', localityId)
    .eq('status', 'approved')
    .eq('courts.sport_id', sportId)
    .eq('courts.active', true)
    .order('name');
  if (error) throw error;

  return (data ?? []).map((v) => ({
    id: v.id, name: v.name, address: v.address, lat: v.lat, lng: v.lng, logo_path: v.logo_path,
    courts: ((v.courts ?? []) as unknown as {
      id: string; name: string; slot_minutes: number; sport_id: string;
      surface: string | null; covered: boolean; lit: boolean; has_locker_room: boolean; format: string | null;
      court_hours: CourtWithSchedule['hours'] | null; court_prices: CourtWithSchedule['prices'] | null;
    }[])
      .map((c) => ({
        id: c.id, name: c.name, slot_minutes: c.slot_minutes, sport_id: c.sport_id,
        surface: c.surface, covered: c.covered, lit: c.lit, has_locker_room: c.has_locker_room,
        format: c.format,
        hours: c.court_hours ?? [], prices: (c.court_prices ?? []).map((p) => ({ ...p, price: Number(p.price) })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  }));
});

/** Ocupados de una cancha en el día (30 h desde la medianoche, como la página del complejo). */
const bookedFor = cache(async (courtId: string, date: string) => {
  const from = mendozaToUtc(date, '00:00:00');
  const to = new Date(from.getTime() + 30 * 3600 * 1000);
  const rows = await getCourtAvailability(courtId, from.toISOString(), to.toISOString());
  return rows.map((r) => parseTstzrange(r.period as string));
});

/** Día siguiente a una fecha YYYY-MM-DD. */
export function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Turnos libres con precio de esos complejos en la fecha, ordenados por hora.
 * Si la fecha es hoy, solo los que todavía no empezaron.
 */
export async function freeSlots(venues: VenueForList[], date: string, now = new Date()): Promise<FreeSlot[]> {
  const weekday = weekdayInMendoza(date);
  const cutoff = date <= todayInMendoza(now) ? now : undefined;
  const courts = venues.flatMap((v) => v.courts.map((c) => ({ v, c }))).slice(0, MAX_COURTS);

  const perCourt = await Promise.all(courts.map(async ({ v, c }) => {
    const hours = c.hours.filter((h) => h.weekday === weekday);
    if (hours.length === 0) return [];
    const booked = await bookedFor(c.id, date);
    return generateSlots({
      date, hours, slotMinutes: c.slot_minutes, booked, cutoff,
      prices: c.prices.filter((p) => p.weekday === weekday),
    })
      // Un turno sin precio no se puede reservar (price_not_set): no se ofrece
      .filter((s) => s.available && s.price !== null)
      .map((s): FreeSlot => ({
        venueId: v.id, venueName: v.name, courtId: c.id, courtName: c.name,
        date, start: s.start, end: s.end, price: s.price as number,
      }));
  }));

  return perCourt.flat().sort((a, b) => a.start.getTime() - b.start.getTime() || a.venueName.localeCompare(b.venueName, 'es'));
}

/**
 * "Falta poco para cerrar": un turno que empieza en menos de LATE_MINUTES ya no
 * alcanza para quedarse en hoy (no llegás). Si hoy solo quedan esos, o ninguno,
 * el inicio, "Lo antes posible" y la lista pasan solos a mañana.
 */
export const LATE_MINUTES = 30;

export function noRoomLeftToday(todaySlots: FreeSlot[], now: Date): boolean {
  return !todaySlots.some((s) => s.start.getTime() - now.getTime() >= LATE_MINUTES * 60_000);
}

/** "Lo antes posible": el primer turno libre de hoy o, si hoy ya no hay lugar, de mañana. */
export async function earliestFreeSlot(venues: VenueForList[], now = new Date()): Promise<FreeSlot | null> {
  const today = todayInMendoza(now);
  const todays = await freeSlots(venues, today, now);
  if (!noRoomLeftToday(todays, now)) return todays[0];
  return (await freeSlots(venues, nextDate(today), now))[0] ?? null;
}

/**
 * Día que muestra la lista: el pedido (?fecha=), o hoy, o mañana si hoy ya no
 * hay lugar (rolled). Devuelve también los libres de ese día.
 */
export async function listDaySlots(venues: VenueForList[], today: string, chosen: string | null, now: Date) {
  const todays = await freeSlots(venues, today, now);
  const rolled = chosen === null && venues.length > 0 && noRoomLeftToday(todays, now);
  const date = chosen ?? (rolled ? nextDate(today) : today);
  const slots = date === today ? todays : await freeSlots(venues, date, now);
  return { date, rolled, slots };
}

/** Link al complejo con la hoja de ese turno abierta. */
export function slotHref(localitySlug: string, sportSlug: string, s: Pick<FreeSlot, 'venueId' | 'courtId' | 'date' | 'start'>): string {
  const qs = new URLSearchParams({ fecha: s.date, cancha: s.courtId, inicio: s.start.toISOString() });
  return `/${localitySlug}/${sportSlug}/${s.venueId}?${qs.toString()}`;
}
