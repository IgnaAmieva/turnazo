/**
 * Localidad de un complejo a partir del pin (propuesta aprobada con la 027).
 * SOLO servidor: crea localidades con la clave de servicio; el navegador nunca
 * las crea (no hay grants de escritura en localities para anon/authenticated).
 *
 *   1. Una localidad existente a menos de NEAR_KM del pin → esa.
 *      (Georef devuelve el MUNICIPIO, y en Mendoza municipio = departamento:
 *      un complejo en La Consulta daría "San Carlos". Por eso va primero.)
 *   2. Si no hay: Georef /ubicacion → municipio (o departamento). Si ya hay
 *      una localidad con ese slug, esa; si no, se crea con el centro del
 *      municipio (o el pin, si Georef no lo da).
 *   3. Si Georef falla o el pin cae fuera de Argentina: la más cercana, y queda
 *      marcada para que el superadmin la revise al aprobar el complejo
 *      (source = 'fallback' en audit_log).
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { byDistance, slugify, type LatLng } from '@/lib/geo';

export const NEAR_KM = 6;
const GEOREF = 'https://apis.datos.gob.ar/georef/api';
const TIMEOUT_MS = 3000;

export type LocalityRow = { id: string; name: string; slug: string; lat: number; lng: number };

export type ResolvedLocality = {
  id: string;
  name: string;
  /** near: había una a menos de NEAR_KM; georef: la nombró Georef (existente o creada); fallback: la más cercana porque Georef falló */
  source: 'near' | 'georef' | 'fallback';
  created: boolean;
};

type Fetch = typeof fetch;

type Deps = {
  fetch?: Fetch;
  /** Para tests: localidades y alta sin tocar la base */
  listLocalities?: () => Promise<LocalityRow[]>;
  insertLocality?: (row: Omit<LocalityRow, 'id'>) => Promise<LocalityRow>;
};

type GeorefPlace = { id?: string | null; nombre?: string | null };

async function getJson(f: Fetch, url: string): Promise<unknown> {
  const res = await f(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
  if (!res.ok) throw new Error(`georef ${res.status}`);
  return res.json();
}

/** Municipio (o departamento) del punto, con su centro. null si no está en Argentina. */
export async function georefPlace(at: LatLng, f: Fetch = fetch): Promise<{ name: string; center: LatLng | null } | null> {
  const u = (await getJson(f, `${GEOREF}/ubicacion?lat=${at.lat}&lon=${at.lng}`)) as {
    ubicacion?: { provincia?: GeorefPlace; departamento?: GeorefPlace; municipio?: GeorefPlace };
  };
  const ub = u.ubicacion;
  if (!ub?.provincia?.id) return null;
  const level = ub.municipio?.nombre ? 'municipios' : ub.departamento?.nombre ? 'departamentos' : null;
  const place = level === 'municipios' ? ub.municipio! : ub.departamento;
  if (!level || !place?.nombre) return null;

  let center: LatLng | null = null;
  try {
    const c = (await getJson(f, `${GEOREF}/${level}?id=${encodeURIComponent(String(place.id))}&campos=centroide`)) as
      Record<string, { centroide?: { lat: number; lon: number } }[] | undefined>;
    const cen = c[level]?.[0]?.centroide;
    if (cen && Number.isFinite(cen.lat) && Number.isFinite(cen.lon)) center = { lat: cen.lat, lng: cen.lon };
  } catch { /* sin centro: se usa el pin */ }
  return { name: place.nombre, center };
}

export async function resolveLocality(pin: LatLng, deps: Deps = {}): Promise<ResolvedLocality | null> {
  const f = deps.fetch ?? fetch;
  const admin = deps.listLocalities && deps.insertLocality ? null : createAdminClient();

  const list = deps.listLocalities ?? (async () => {
    const { data, error } = await admin!.from('localities').select('id, name, slug, lat, lng');
    if (error) throw error;
    return data as LocalityRow[];
  });
  const insert = deps.insertLocality ?? (async (row: Omit<LocalityRow, 'id'>) => {
    const { data, error } = await admin!.from('localities').insert(row).select('id, name, slug, lat, lng').single();
    if (error) {
      // Otro complejo la creó en el mismo momento (slug único): se usa esa
      if (error.code === '23505') {
        const { data: again } = await admin!.from('localities').select('id, name, slug, lat, lng').eq('slug', row.slug).single();
        if (again) return again as LocalityRow;
      }
      throw error;
    }
    return data as LocalityRow;
  });

  const localities = await list();
  const sorted = byDistance(pin, localities);
  const nearest = sorted[0];
  if (nearest && nearest.km <= NEAR_KM) return { id: nearest.id, name: nearest.name, source: 'near', created: false };

  let place: Awaited<ReturnType<typeof georefPlace>> = null;
  try {
    place = await georefPlace(pin, f);
  } catch (e) {
    console.error('[locality] georef failed:', (e as Error).message);
  }

  if (place) {
    const slug = slugify(place.name);
    const existing = localities.find((l) => l.slug === slug);
    if (existing) return { id: existing.id, name: existing.name, source: 'georef', created: false };
    if (slug) {
      const center = place.center ?? pin;
      const row = await insert({ name: place.name, slug, lat: center.lat, lng: center.lng });
      return { id: row.id, name: row.name, source: 'georef', created: true };
    }
  }

  if (!nearest) return null;
  return { id: nearest.id, name: nearest.name, source: 'fallback', created: false };
}
