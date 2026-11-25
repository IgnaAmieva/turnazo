/** Historias de turnos libres: lo que comparten el servidor y el selector del panel. */

export const STORY_STYLES = [
  { id: 'pizarra', label: 'Pizarra' },
  { id: 'invitacion', label: 'Invitación' },
  { id: 'urgencia', label: 'Urgencia' },
] as const;
export type StoryStyle = (typeof STORY_STYLES)[number]['id'];
export const parseStyle = (v: string | null | undefined): StoryStyle =>
  STORY_STYLES.some((s) => s.id === v) ? (v as StoryStyle) : 'pizarra';

export type StorySport = { slug: string; name: string };
