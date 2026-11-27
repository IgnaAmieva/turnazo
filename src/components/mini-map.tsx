/**
 * Mapa chiquito con LOOK de mapa (para que se entienda que se toca): fondo
 * gris claro, calles blancas, una avenida amarilla, una plaza verde, un poco
 * de agua y el pin rojo clásico en el centro, con "Ver en el mapa ↗" abajo.
 * Es un dibujo en SVG, no la geografía real: no pide nada afuera (sin tiles,
 * sin claves). Al tocarlo abre Google Maps con la ubicación REAL.
 * Colores: --map-* de globals.css (claro y la versión oscura del mismo estilo).
 * El trazado varía con el id del complejo para que las tarjetas no sean iguales.
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
  // Calles: dos verticales y dos horizontales; avenida en diagonal suave; plaza y agua en esquinas
  const v1 = 12 + r() * 12, v2 = 52 + r() * 12;
  const h1 = 12 + r() * 10, h2 = 54 + r() * 10;
  const a0 = 40 + r() * 16, a1 = 26 + r() * 16;
  const parkLeft = r() > 0.5;
  const waterTop = r() > 0.5;
  return (
    <svg viewBox="0 0 76 76" width={size} height={size} aria-hidden="true" data-testid="mapa-mini"
      className={`shrink-0 overflow-hidden rounded-2xl ${className}`}>
      <rect width="76" height="76" fill="var(--map-land)" />
      {/* Agua: una franja de río en un borde */}
      <path d={waterTop ? 'M0 0H76V7C60 11 44 4 28 9 16 13 8 9 0 11Z' : 'M0 76H76V68C60 64 46 71 30 66 18 62 8 67 0 65Z'}
        fill="var(--map-water)" />
      {/* Plaza */}
      <rect x={parkLeft ? v1 + 4 : v2 - 22} y={h1 + 4} width="18" height={h2 - h1 - 8} rx="2" fill="var(--map-park)" />
      {/* Calles blancas */}
      <g stroke="var(--map-road)" strokeWidth="4" strokeLinecap="square">
        <path d={`M${v1} 0V76M${v2} 0V76M0 ${h1}H76M0 ${h2}H76`} />
      </g>
      {/* Avenida amarilla (con borde) */}
      <path d={`M0 ${a0}L76 ${a1}`} stroke="var(--map-avenue-edge)" strokeWidth="7.5" />
      <path d={`M0 ${a0}L76 ${a1}`} stroke="var(--map-avenue)" strokeWidth="5.5" />
      {/* Pin rojo clásico, la punta en el centro */}
      <g transform="translate(38 44)">
        <ellipse cx="0" cy="0.5" rx="4" ry="1.4" fill="#000" opacity=".18" />
        <path d="M0 0C-1.6-4.5-8-8.6-8-15A8 8 0 0 1 8-15C8-8.6 1.6-4.5 0 0Z" fill="var(--map-pin)" stroke="var(--map-pin-edge)" strokeWidth="1" />
        <circle cx="0" cy="-15" r="2.9" fill="var(--map-pin-edge)" />
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
      className="relative z-10 flex shrink-0 flex-col items-center gap-1 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring hover:opacity-90"
      style={{ minWidth: 44, minHeight: 44 }}
    >
      <MiniMap id={id} size={size} className="block shadow-sm ring-1 ring-line" />
      <span className="text-[11px] font-extrabold leading-none text-ink" data-testid="mapa-etiqueta" aria-hidden="true">
        Ver en el mapa ↗
      </span>
    </a>
  );
}
