/**
 * Franjas de la lista de complejos (V2b, filtro por hora de M5):
 * Ahora · 18–20 · 20–22 · 22+. Siempre del día de hoy (hora de Mendoza).
 */
import { mendozaToUtc } from '@/lib/slots';

export const FRANJAS = [
  { id: 'ahora', label: 'Ahora' },
  { id: '18-20', label: '18–20' },
  { id: '20-22', label: '20–22' },
  { id: '22', label: '22+' },
] as const;

export type FranjaId = (typeof FRANJAS)[number]['id'];

export function parseFranja(v: string | undefined): FranjaId {
  return FRANJAS.some((f) => f.id === v) ? (v as FranjaId) : 'ahora';
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
