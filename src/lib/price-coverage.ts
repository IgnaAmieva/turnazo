import { generateSlots, formatTimeMendoza, type CourtHour, type CourtPrice } from '@/lib/slots';

/** Fecha de referencia para calcular la grilla de un día de la semana (sin feriados ni DST en Mendoza). */
function dateForWeekday(weekday: number): string {
  // 2026-01-04 fue domingo (weekday 0)
  const d = new Date(Date.UTC(2026, 0, 4 + weekday));
  return d.toISOString().slice(0, 10);
}

export type UnpricedRange = { weekday: number; from: string; to: string };

/**
 * Fila que propone "Agregar franja" en el editor de precios: el primer tramo
 * abierto que todavía no tiene precio (ej. futmates: 22:00 a 00:00) o, si ya
 * está todo cubierto, el horario de apertura de la cancha (nunca 08:00–22:00 fijo).
 */
export function defaultPriceRow(
  hours: CourtHour[],
  prices: CourtPrice[],
  slotMinutes: number,
): { weekday: number; from_time: string; to_time: string } {
  const gap = unpricedRanges(hours, prices, slotMinutes)[0];
  if (gap) return { weekday: gap.weekday, from_time: gap.from, to_time: gap.to };
  const first = [1, 2, 3, 4, 5, 6, 0]
    .map((d) => hours.filter((h) => h.weekday === d).sort((a, b) => a.open_time.localeCompare(b.open_time))[0])
    .find(Boolean);
  if (first) return { weekday: first.weekday, from_time: first.open_time.slice(0, 5), to_time: first.close_time.slice(0, 5) };
  return { weekday: 1, from_time: '08:00', to_time: '22:00' };
}

/**
 * Tramos del horario de apertura que no tienen precio cargado, por día.
 * Esos turnos no se pueden reservar (create_booking devuelve price_not_set):
 * el panel los avisa y la grilla pública no los ofrece.
 * Usa la misma grilla que ve el jugador (generateSlots).
 */
export function unpricedRanges(
  hours: CourtHour[],
  prices: CourtPrice[],
  slotMinutes: number,
): UnpricedRange[] {
  const out: UnpricedRange[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    const slots = generateSlots({
      date: dateForWeekday(weekday),
      hours: hours.filter((h) => h.weekday === weekday),
      slotMinutes,
      booked: [],
      prices: prices.filter((p) => p.weekday === weekday),
    });
    let cur: { start: Date; end: Date } | null = null;
    const flush = () => {
      if (cur) out.push({ weekday, from: formatTimeMendoza(cur.start), to: formatTimeMendoza(cur.end) });
      cur = null;
    };
    for (const s of slots) {
      if (s.price !== null) { flush(); continue; }
      if (cur && cur.end.getTime() === s.start.getTime()) cur.end = s.end;
      else { flush(); cur = { start: s.start, end: s.end }; }
    }
    flush();
  }
  return out;
}
