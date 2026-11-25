/** Distancias y localidades más cercanas (sirve en el servidor y en el navegador). */

export type LatLng = { lat: number; lng: number };

/** Distancia en línea recta (km), fórmula de haversine. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatKm(km: number): string {
  return km < 10 ? `${km.toLocaleString('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} km`
    : `${Math.round(km)} km`;
}

/** Los lugares ordenados del más cercano al más lejano, con su distancia. */
export function byDistance<T extends LatLng>(from: LatLng, places: T[]): (T & { km: number })[] {
  return places
    .map((p) => ({ ...p, km: distanceKm(from, p) }))
    .sort((a, b) => a.km - b.km);
}

/** Slug de una localidad: minúsculas, sin acentos, guiones. "Guaymallén" → "guaymallen". */
export function slugify(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
