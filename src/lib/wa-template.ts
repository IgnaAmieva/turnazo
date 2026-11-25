/**
 * Plantilla del mensaje de WhatsApp del complejo. En la base se guarda como
 * hoy: texto con {variables} (venues.whatsapp_template). El editor del panel
 * muestra las variables como pastillas y las inserta con botones.
 */

export const WA_VARS = [
  { key: 'nombre', label: 'Nombre' },
  { key: 'cancha', label: 'Cancha' },
  { key: 'dia', label: 'Día' },
  { key: 'hora', label: 'Hora' },
  { key: 'total', label: 'Total' },
] as const;

export type WaVar = (typeof WA_VARS)[number]['key'];

export const WA_TEMPLATE_MAX = 500;

/** Mensaje armado que viene cargado por defecto (y el de "Volver al mensaje original"). */
export const DEFAULT_WA_TEMPLATE =
  '¡Hola {nombre}! Tu turno en {cancha} el {dia} a las {hora} está confirmado. Total: {total}. ¡Te esperamos!';

export const isWaVar = (k: string): k is WaVar => WA_VARS.some((v) => v.key === k);
export const waVarLabel = (k: WaVar) => WA_VARS.find((v) => v.key === k)!.label;

export type Segment = { type: 'text'; text: string } | { type: 'var'; key: WaVar };

/** "Hola {nombre}!" → [texto "Hola ", variable nombre, texto "!"]. Llaves desconocidas quedan como texto. */
export function parseTemplate(template: string): Segment[] {
  const out: Segment[] = [];
  const push = (text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last?.type === 'text') last.text += text;
    else out.push({ type: 'text', text });
  };
  let i = 0;
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    push(template.slice(i, m.index));
    if (isWaVar(m[1])) out.push({ type: 'var', key: m[1] });
    else push(m[0]);
    i = m.index! + m[0].length;
  }
  push(template.slice(i));
  return out;
}

export function serializeSegments(segments: Segment[]): string {
  return segments.map((s) => (s.type === 'var' ? `{${s.key}}` : s.text)).join('');
}

/** Valores de ejemplo para la vista previa. */
export const WA_SAMPLES: Record<WaVar, string> = {
  nombre: 'Juan Pérez',
  cancha: 'Cancha 1',
  dia: 'miércoles 15 de enero',
  hora: '10:00–11:30',
  total: '$4.000',
};

export function previewTemplate(template: string): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => (isWaVar(key) ? WA_SAMPLES[key] : all));
}
