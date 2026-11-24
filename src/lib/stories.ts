/**
 * Historias de turnos libres (panel): datos de la imagen 1080×1920.
 *
 * Solo el dueño del complejo: se verifica la sesión y venues.owner_id con el
 * cliente del servidor (RLS del dueño). Si no es el dueño, null (la ruta
 * responde 404 sin decir si el complejo existe).
 */
import { createClient } from '@/lib/supabase/server';
import { freeSlots, type VenueForList } from '@/lib/free-slots';
import { formatDateMendoza, formatTimeMendoza, mendozaToUtc, todayInMendoza } from '@/lib/slots';
import type { CourtWithSchedule } from '@/lib/supabase/queries';

import type { StorySport } from '@/lib/stories-shared';
export { STORY_STYLES, parseStyle, type StoryStyle, type StorySport } from '@/lib/stories-shared';

/** Máximo de turnos en la imagen. */
export const STORY_MAX_SLOTS = 6;
/** Días que se ofrecen para la historia (hoy + 6). */
export const STORY_DAYS = 7;

export type StoryData = {
  venueId: string;
  venueName: string;
  initials: string;
  localityName: string;
  localitySlug: string;
  sport: StorySport;
  sports: StorySport[];
  date: string;
  dayLabel: string;          // "Hoy · martes 24" / "Miércoles 25"
  slots: { time: string; price: number }[];
  minPrice: number | null;
};

/** Iniciales del club para el círculo del logo: "futmates" → "FU", "Club Norte" → "CN". */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const stop = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y']);
  const main = words.filter((w) => !stop.has(w.toLowerCase()));
  const pick = main.length >= 2 ? main[0][0] + main[1][0] : (main[0] ?? words[0] ?? '?').slice(0, 2);
  return pick.toUpperCase();
}

export function dayLabel(date: string, today: string): string {
  const long = formatDateMendoza(mendozaToUtc(date, '12:00:00'));      // "martes 24 de noviembre"
  const short = long.replace(/ de \p{L}+$/u, '').replace(',', '');      // "martes 24"
  return date === today ? `Hoy · ${short}` : short.charAt(0).toUpperCase() + short.slice(1);
}

/** Datos de la historia, o null si el que pide no es el dueño del complejo. */
export async function getStoryData(
  venueId: string,
  opts: { sport?: string | null; date?: string | null; now?: Date },
): Promise<StoryData | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: venue } = await supabase
    .from('venues')
    .select('id, name, owner_id, localities(name, slug)')
    .eq('id', venueId)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (!venue || venue.owner_id !== user.id) return null;
  const locality = venue.localities as unknown as { name: string; slug: string } | null;

  const { data: courtRows } = await supabase
    .from('courts')
    .select(`id, name, slot_minutes, sport_id, surface, covered, lit, has_locker_room,
      sports(name, slug),
      court_hours(weekday, open_time, close_time),
      court_prices(weekday, from_time, to_time, price)`)
    .eq('venue_id', venueId)
    .eq('active', true)
    .order('name');

  type Row = CourtWithSchedule & { sports: StorySport | null; court_hours: CourtWithSchedule['hours']; court_prices: CourtWithSchedule['prices'] };
  const courts = (courtRows ?? []) as unknown as Row[];
  const sports: StorySport[] = [];
  for (const c of courts) if (c.sports && !sports.some((s) => s.slug === c.sports!.slug)) sports.push(c.sports);
  sports.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (sports.length === 0) return null;
  const sport = sports.find((s) => s.slug === opts.sport) ?? sports[0];

  const now = opts.now ?? new Date();
  const today = todayInMendoza(now);
  const date = opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) && opts.date >= today ? opts.date : today;

  const forList: VenueForList = {
    id: venue.id, name: venue.name, address: '', lat: 0, lng: 0,
    courts: courts.filter((c) => c.sports?.slug === sport.slug).map((c) => ({
      id: c.id, name: c.name, slot_minutes: c.slot_minutes, sport_id: c.sport_id,
      surface: c.surface, covered: c.covered, lit: c.lit, has_locker_room: c.has_locker_room,
      hours: c.court_hours ?? [], prices: (c.court_prices ?? []).map((p) => ({ ...p, price: Number(p.price) })),
    })),
  };
  const free = await freeSlots([forList], date, now);
  // Horarios distintos (con dos canchas libres a la misma hora, uno solo; el precio más bajo)
  const byTime = new Map<string, number>();
  for (const s of free) {
    const t = formatTimeMendoza(s.start);
    byTime.set(t, Math.min(byTime.get(t) ?? Infinity, s.price));
  }
  const slots = [...byTime.entries()].slice(0, STORY_MAX_SLOTS).map(([time, price]) => ({ time, price }));

  return {
    venueId: venue.id,
    venueName: venue.name,
    initials: initials(venue.name),
    localityName: locality?.name ?? '',
    localitySlug: locality?.slug ?? '',
    sport, sports, date,
    dayLabel: dayLabel(date, today),
    slots,
    minPrice: slots.length ? Math.min(...slots.map((s) => s.price)) : null,
  };
}
