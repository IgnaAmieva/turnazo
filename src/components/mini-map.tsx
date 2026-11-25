/**
 * Mapa chiquito ESQUEMÁTICO (V2b/V2c): calles dibujadas en SVG y el pin. No es
 * la geografía real ni pide nada afuera (sin tiles, sin atribución): la
 * ubicación real queda en "Ir" / "Cómo llegar". Usa las variables del tema,
 * así se ve bien en claro y en oscuro. El trazado varía con el id del complejo
 * para que las tarjetas no sean todas iguales.
 */

import { mapsUrl } from '@/lib/geo';

function seeded(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function MiniMap({ id, size = 76, className = '' }: { id: string; size?: number; className?: string }) {
  const r = seeded(id);
  // Dos calles verticales y dos horizontales, una avenida en diagonal suave
  const v1 = 14 + r() * 14, v2 = 50 + r() * 18;
  const h1 = 16 + r() * 12, h2 = 52 + r() * 16;
  const a0 = 44 + r() * 20, a1 = 30 + r() * 20;
  return (
    <svg viewBox="0 0 76 76" width={size} height={size} aria-hidden="true" data-testid="mapa-mini"
      className={`shrink-0 overflow-hidden rounded-2xl ${className}`}>
      <rect width="76" height="76" fill="var(--bg)" />
      <g stroke="var(--line)" strokeWidth="5" strokeLinecap="square">
        <path d={`M${v1} 0V76M${v2} 0V76M0 ${h1}H76M0 ${h2}H76`} />
      </g>
      {/* Avenida: el verde del tema, suave */}
      <path d={`M0 ${a0}L76 ${a1}`} stroke="var(--primary)" strokeOpacity=".25" strokeWidth="6" />
      {/* Pin */}
      <g transform="translate(38 40)">
        <path d="M0 0c-6-7-10-11-10-16a10 10 0 0 1 20 0c0 5-4 9-10 16Z" fill="var(--primary)" />
        <circle cx="0" cy="-16" r="4" fill="var(--surface)" />
      </g>
    </svg>
  );
}

/**
 * El mapa chiquito como link: abre Google Maps con el pin real (lo mismo que
 * "Ir"), en otra pestaña. Va por encima del link de la tarjeta (z-10).
 */
export function MiniMapLink({ id, name, lat, lng, size = 76 }: {
  id: string; name: string; lat: number; lng: number; size?: number;
}) {
  return (
    <a
      href={mapsUrl({ lat, lng })}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Ver ubicación de ${name} en el mapa`}
      data-testid="mapa-link"
      className="relative z-10 shrink-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring hover:opacity-90"
      style={{ minWidth: 44, minHeight: 44 }}
    >
      <MiniMap id={id} size={size} className="block" />
    </a>
  );
}
