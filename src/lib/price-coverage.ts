import { generateSlots, formatTimeMendoza, type CourtHour, type CourtPrice } from '@/lib/slots';

/** Fecha de referencia para calcular la grilla de un día de la semana (sin feriados ni DST en Mendoza). */
function dateForWeekday(weekday: number): string {
  // 2026-01-04 fue domingo (weekday 0)
  const d = new Date(Date.UTC(2026, 0, 4 + weekday));
  return d.toISOString().slice(0, 10);
}

export type UnpricedRange = { weekday: number; from: string; to: string };

/**
 * Tramos del horario de apertura que no tienen precio cargado, por día.
 * Esos turnos no se pueden reservar (create_booking devuelve price_not_set):
 * el panel los avisa y la grilla pública no los ofrece.
 * Usa la misma grilla que ve el jugador (generateSlots).
 */
export function unpricedRanges(
  hours: (CourtHour & { weekday: number })[],
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
