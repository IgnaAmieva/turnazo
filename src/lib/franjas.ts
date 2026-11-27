/**
 * "¿A qué hora querés jugar?" (inicio y lista de complejos): "Cualquier hora"
 * o un horario de inicio REAL de ese día (?hora=18:30). Las opciones salen de
 * los turnos libres de los complejos de esa localidad y deporte (con turnos de
 * 90 min desde las 08:00: 08:00, 09:30, 11:00…), no de franjas inventadas.
 * Al elegir uno, quedan solo los complejos con un turno libre que empieza a
 * esa hora. La hora es la de Mendoza.
 */
import { formatTimeMendoza } from '@/lib/slots';

export type When = { kind: 'any' } | { kind: 'time'; hhmm: string };

export const ANY: When = { kind: 'any' };

/** ?hora=HH:MM válida → ese horario; cualquier otra cosa (o las franjas viejas) → cualquier hora. */
export function parseWhen(hora: string | undefined): When {
  if (hora && /^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return { kind: 'time', hhmm: hora };
  return ANY;
}

/** Parámetros de URL de esa elección ("Cualquier hora" no lleva ninguno). */
export function whenParams(w: When): Record<string, string> {
  return w.kind === 'time' ? { hora: w.hhmm } : {};
}

/** "hoy" / "mañana" / "el sábado 28" (day) o "a las 18:30" (+ el día si no es hoy). */
export function whenLabel(w: When, day = 'hoy'): string {
  if (w.kind === 'any') return day;
  return `a las ${w.hhmm}${day === 'hoy' ? '' : ` ${day}`}`;
}

/** ¿El turno empieza exactamente a esa hora? (hora de Mendoza) */
export function inWhen(start: Date, w: When): boolean {
  return w.kind === 'any' || formatTimeMendoza(start) === w.hhmm;
}

/**
 * Horarios de inicio distintos de esos turnos libres, en orden (los que
 * empiezan pasada la medianoche quedan al final, como en la grilla del día).
 */
export function startTimes(slots: { start: Date }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...slots].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    const t = formatTimeMendoza(s.start);
    if (!seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}
