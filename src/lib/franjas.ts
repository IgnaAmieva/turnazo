/**
 * "¿A qué hora querés jugar?" (inicio y lista de complejos): Ahora · 18–20 ·
 * 20–22 · 22+ o una hora exacta (?hora=19 → turnos que empiezan de 18:30 a
 * 19:59, ver inWhen), del día elegido en la fila de días (hora de Mendoza).
 * Otro día que no es hoy: "Ahora" se muestra como "Todo el día".
 */
import { mendozaToUtc } from '@/lib/slots';

export const FRANJAS = [
  { id: 'ahora', label: 'Ahora' },
  { id: '18-20', label: '18–20' },
  { id: '20-22', label: '20–22' },
  { id: '22', label: '22+' },
] as const;

export type FranjaId = (typeof FRANJAS)[number]['id'];

/** Horas exactas que se ofrecen (08:00 a 23:00). */
export const HORAS = Array.from({ length: 16 }, (_, i) => i + 8);

export type When = { kind: 'franja'; id: FranjaId } | { kind: 'hora'; h: number };

export function parseFranja(v: string | undefined): FranjaId {
  return FRANJAS.some((f) => f.id === v) ? (v as FranjaId) : 'ahora';
}

/** ?hora= (una de HORAS) gana sobre ?franja=. */
export function parseWhen(franja: string | undefined, hora: string | undefined): When {
  const h = hora !== undefined && /^\d{1,2}$/.test(hora) ? Number(hora) : NaN;
  if (HORAS.includes(h)) return { kind: 'hora', h };
  return { kind: 'franja', id: parseFranja(franja) };
}

/** Parámetros de URL de esa elección ("Ahora" no lleva ninguno). */
export function whenParams(w: When): Record<string, string> {
  if (w.kind === 'hora') return { hora: String(w.h) };
  return w.id === 'ahora' ? {} : { franja: w.id };
}

/** "hoy", "de 18–20", "cerca de las 19:00"; otro día: "mañana", "de 18–20 mañana"… (day: ver dayWord). */
export function whenLabel(w: When, day = 'hoy'): string {
  const suffix = day === 'hoy' ? '' : ` ${day}`;
  if (w.kind === 'hora') return `cerca de las ${String(w.h).padStart(2, '0')}:00${suffix}`;
  return w.id === 'ahora' ? day : `de ${FRANJAS.find((f) => f.id === w.id)!.label}${suffix}`;
}

/**
 * ¿El turno empieza dentro de la franja? "Ahora" = cualquiera que todavía no
 * empezó (la lista ya viene sin los pasados). "22+" incluye los que empiezan
 * después de medianoche dentro del horario del día.
 */
export function inFranja(start: Date, franja: FranjaId, date: string): boolean {
  if (franja === 'ahora') return true;
  const at = (hhmm: string) => mendozaToUtc(date, `${hhmm}:00`).getTime();
  const t = start.getTime();
  if (franja === '18-20') return t >= at('18:00') && t < at('20:00');
  if (franja === '20-22') return t >= at('20:00') && t < at('22:00');
  return t >= at('22:00');
}

/**
 * Hora exacta = "cerca de esa hora": turnos que empiezan desde media hora antes
 * hasta antes de la hora siguiente (a las 19 → de 18:30 a 19:59). Con turnos de
 * 90 min desde las 08:00 ninguno empieza a las 19:00 justo; así igual aparece 18:30.
 */
export function inWhen(start: Date, w: When, date: string): boolean {
  if (w.kind === 'franja') return inFranja(start, w.id, date);
  const h = mendozaToUtc(date, `${String(w.h).padStart(2, '0')}:00:00`).getTime();
  const t = start.getTime();
  return t >= h - 30 * 60_000 && t < h + 60 * 60_000;
}
