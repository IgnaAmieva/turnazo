/**
 * Etiquetas de cancha (migración 023): superficie, techada, iluminada, vestuario.
 * La lista de complejos y la portada del complejo muestran lo que esté cargado
 * ("Sintético · Techada · Iluminada"); si no hay nada, "2 canchas · turnos de 90 min".
 * Fútbol (027): el formato va primero ("Fútbol 5 · Sintético · Iluminada").
 */
import { venueFormats } from '@/lib/court-format';

export const SURFACES = [
  { value: 'sintetico', label: 'Sintético' },
  { value: 'pasto', label: 'Pasto' },
  { value: 'cemento', label: 'Cemento' },
  { value: 'polvo_ladrillo', label: 'Polvo de ladrillo' },
  { value: 'blindex', label: 'Blindex' },
] as const;

export type Surface = (typeof SURFACES)[number]['value'];

export const isSurface = (v: unknown): v is Surface => SURFACES.some((s) => s.value === v);

export type CourtFeatures = {
  slot_minutes: number;
  surface?: string | null;
  covered?: boolean | null;
  lit?: boolean | null;
  has_locker_room?: boolean | null;
  /** 027: formato de fútbol */
  format?: string | null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Etiquetas del complejo (para un deporte): formatos de fútbol, superficies distintas y lo que tenga alguna cancha. */
export function venueTags(courts: CourtFeatures[]): string[] {
  const tags: string[] = venueFormats(courts);
  for (const s of SURFACES) if (courts.some((c) => c.surface === s.value)) tags.push(s.label);
  if (courts.some((c) => c.covered)) tags.push('Techada');
  if (courts.some((c) => c.lit)) tags.push('Iluminada');
  if (courts.some((c) => c.has_locker_room)) tags.push('Vestuario');
  return tags;
}

/** Texto de la tarjeta: las etiquetas, o "2 canchas · turnos de 90 min" si no hay ninguna cargada. */
export function venueTagsLine(courts: CourtFeatures[]): string {
  const tags = venueTags(courts);
  const formats = venueFormats(courts);
  // Con etiquetas además del formato, alcanzan; con solo el formato (o nada), también la cantidad y la duración
  if (tags.length > formats.length) return tags.join(' · ');
  const minutes = [...new Set(courts.map((c) => c.slot_minutes))].sort((a, b) => a - b);
  return [...formats, `${plural(courts.length, 'cancha', 'canchas')} · turnos de ${minutes.join(' y ')} min`].join(' · ');
}
