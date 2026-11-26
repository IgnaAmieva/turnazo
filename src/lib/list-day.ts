/**
 * Día de la lista de complejos (inicio y lista): la fila de días (?fecha=) y
 * el título. Sin ?fecha=, hoy; de noche, si hoy ya no hay lugar, mañana
 * (ver noRoomLeftToday en free-slots). Con ?fecha= de hoy, hoy aunque esté vacío:
 * así se vuelve a hoy desde la fila de días.
 */
import { formatDateMendoza, mendozaToUtc } from '@/lib/slots';

/** Días de la fila, contando hoy. */
export const LIST_DAYS = 7;

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Hoy y los días siguientes de la fila. */
export function listDays(today: string): string[] {
  return Array.from({ length: LIST_DAYS }, (_, i) => addDays(today, i));
}

/** ?fecha= válida (de hoy a LIST_DAYS − 1 días), o null: una fecha vieja o lejana se ignora. */
export function parseListDate(fecha: string | undefined, today: string): string | null {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  return fecha >= today && fecha <= addDays(today, LIST_DAYS - 1) ? fecha : null;
}

/** "jueves 27" (sin mes ni coma). */
export function weekdayDay(date: string): string {
  return formatDateMendoza(mendozaToUtc(date, '12:00:00')).replace(/ de \p{L}+$/u, '').replace(',', '');
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Para las frases: "hoy", "mañana" o "el sábado 29". */
export function dayWord(date: string, today: string): string {
  if (date === today) return 'hoy';
  if (date === addDays(today, 1)) return 'mañana';
  return `el ${weekdayDay(date)}`;
}

/** Título del día: "Hoy, miércoles 26", "Mañana, jueves 27", "Sábado 29" o "Hoy ya no hay lugar · Mañana, jueves 27". */
export function dayTitle(date: string, today: string, rolled: boolean): string {
  const wd = weekdayDay(date);
  if (date === today) return `Hoy, ${wd}`;
  if (date === addDays(today, 1)) return `${rolled ? 'Hoy ya no hay lugar · ' : ''}Mañana, ${wd}`;
  return cap(wd);
}

/** Chip de la fila de días: arriba "Hoy" o el día de la semana corto; abajo el número. */
export function dayChip(date: string, today: string): { top: string; day: string } {
  const [y, m, d] = date.split('-').map(Number);
  const wd = new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', weekday: 'short' })
    .format(new Date(Date.UTC(y, m - 1, d, 12))).replace('.', '');
  return { top: date === today ? 'Hoy' : cap(wd), day: String(d) };
}
