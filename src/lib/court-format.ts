/**
 * Formato de la cancha de fútbol (migración 027, courts.format). Solo fútbol:
 * en pádel y tenis es NULL (lo hace cumplir el trigger enforce_court_format).
 */

export const FORMATS = [
  { value: 'futbol_5', short: '5', label: 'Fútbol 5' },
  { value: 'futbol_6', short: '6', label: 'Fútbol 6' },
  { value: 'futbol_7', short: '7', label: 'Fútbol 7' },
  { value: 'futbol_9', short: '9', label: 'Fútbol 9' },
  { value: 'futbol_11', short: '11', label: 'Fútbol 11' },
  { value: 'futsal', short: 'Futsal', label: 'Futsal' },
] as const;

export type CourtFormat = (typeof FORMATS)[number]['value'];

export const FORMAT_VALUES = FORMATS.map((f) => f.value) as [CourtFormat, ...CourtFormat[]];

export const isFormat = (v: unknown): v is CourtFormat => FORMATS.some((f) => f.value === v);

export const formatLabel = (v: string | null | undefined): string | null =>
  FORMATS.find((f) => f.value === v)?.label ?? null;

/** Formatos distintos de esas canchas, en el orden de FORMATS ("Fútbol 5", "Fútbol 7"). */
export function venueFormats(courts: { format?: string | null }[]): string[] {
  return FORMATS.filter((f) => courts.some((c) => c.format === f.value)).map((f) => f.label);
}

/** Solo las canchas de ese formato (sin formato pedido, todas); los complejos sin ninguna se van. */
export function filterByFormat<V extends { courts: { format?: string | null }[] }>(venues: V[], format: CourtFormat | null): V[] {
  if (!format) return venues;
  return venues
    .map((v) => ({ ...v, courts: v.courts.filter((c) => c.format === format) }))
    .filter((v) => v.courts.length > 0);
}
