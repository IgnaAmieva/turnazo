'use client';

/**
 * Inicio: "¿Dónde?" en una sola barra desplegable (reemplaza a los chips).
 * Solo trae localidades con complejos aprobados.
 *
 * Qué localidad se muestra si la URL no dice ninguna:
 *   - con permiso de ubicación YA dado: la más cercana, y la lista se ordena
 *     por distancia;
 *   - sin permiso: la última que usó el jugador (localStorage) o la primera
 *     (la elige el servidor).
 * "Usar mi ubicación" pide el permiso solo si el jugador lo toca.
 * La posición no se guarda en ningún lado (localStorage solo tiene nombre,
 * celular, localidad y deporte).
 */
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { byDistance, formatKm, type LatLng } from '@/lib/geo';
import { PLAYER_KEY, parsePlayerMemory, rememberPlayer } from '@/lib/player-memory';

type Place = { slug: string; name: string; lat: number; lng: number; venueCount: number };

type Props = {
  localities: Place[];
  current: string;
  sport: { slug: string; name: string } | null;
  /** La URL ya trae ?localidad= o ?deporte=: no se cambia sola */
  explicit: boolean;
  /** Parámetros que se conservan al cambiar de localidad (franja / hora) */
  keep: Record<string, string>;
};

type Geo = 'unknown' | 'granted' | 'prompt' | 'denied' | 'unavailable';

function getPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      reject,
      { maximumAge: 5 * 60_000, timeout: 10_000 },
    ));
}

export function WhereBar({ localities, current, sport, explicit, keep }: Props) {
  const router = useRouter();
  const [here, setHere] = useState<LatLng | null>(null);
  const [geo, setGeo] = useState<Geo>('unknown');
  const [locating, setLocating] = useState(false);

  const urlFor = (slug: string, sportSlug = sport?.slug) => {
    const qs = new URLSearchParams({ localidad: slug, ...(sportSlug ? { deporte: sportSlug } : {}), ...keep });
    return `/?${qs.toString()}`;
  };

  const go = (slug: string, how: 'push' | 'replace', sportSlug?: string) => {
    const place = localities.find((l) => l.slug === slug);
    if (place) rememberPlayer({ localidad: { slug, nombre: place.name } });
    router[how](urlFor(slug, sportSlug), { scroll: false });
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!('geolocation' in navigator)) { setGeo('unavailable'); return; }
      let state: PermissionState | 'unknown' = 'unknown';
      try { state = (await navigator.permissions?.query({ name: 'geolocation' as PermissionName }))?.state ?? 'unknown'; } catch { /* sin API de permisos */ }
      if (!alive) return;
      setGeo(state === 'unknown' ? 'prompt' : state);

      if (state === 'granted') {
        try {
          const pos = await getPosition();
          if (!alive) return;
          setHere(pos);
          if (!explicit) {
            const nearest = byDistance(pos, localities)[0];
            if (nearest && nearest.slug !== current) go(nearest.slug, 'replace');
          }
          return;
        } catch { /* sin posición: se sigue como sin permiso */ }
      }

      // Sin permiso: la última que usó (si sigue teniendo complejos)
      if (explicit) return;
      let mem = {} as ReturnType<typeof parsePlayerMemory>;
      try { mem = parsePlayerMemory(localStorage.getItem(PLAYER_KEY)); } catch { /* sin almacenamiento */ }
      const l = mem.localidad?.slug;
      const d = mem.deporte?.slug;
      if (l && localities.some((x) => x.slug === l) && (l !== current || (d && d !== sport?.slug))) {
        router.replace(urlFor(l, d ?? sport?.slug), { scroll: false });
      }
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const options = useMemo(
    () => (here ? byDistance(here, localities) : localities.map((l) => ({ ...l, km: null as number | null }))),
    [here, localities],
  );

  async function useMyLocation() {
    if (!('geolocation' in navigator)) { setGeo('unavailable'); return; }
    setLocating(true);
    try {
      const pos = await getPosition();
      setHere(pos);
      setGeo('granted');
      const nearest = byDistance(pos, localities)[0];
      if (nearest && nearest.slug !== current) go(nearest.slug, 'push');
    } catch {
      setGeo('denied');
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="flex flex-wrap items-stretch gap-2">
      <label className="relative flex min-h-12 min-w-0 flex-1 basis-56 items-center rounded-2xl border border-line bg-surface shadow-sm focus-within:border-primary">
        <span className="sr-only">Localidad</span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute left-3 h-5 w-5 text-ink" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
        </svg>
        <select
          data-testid="donde"
          value={current}
          onChange={(e) => go(e.target.value, 'push')}
          className="h-full min-h-12 w-full appearance-none rounded-2xl bg-transparent pl-10 pr-10 text-base font-extrabold text-ink focus:outline-none"
        >
          {options.map((l) => (
            <option key={l.slug} value={l.slug}>
              {l.name} · {l.venueCount} complejo{l.venueCount !== 1 ? 's' : ''}{l.km !== null ? ` · a ${formatKm(l.km)}` : ''}
            </option>
          ))}
        </select>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute right-3 h-5 w-5 text-ink" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </label>
      {/* Visible desde el primer render (sin saltos de diseño); se va si ya hay permiso o no hay GPS */}
      {(geo === 'prompt' || geo === 'unknown') && (
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          data-testid="usar-ubicacion"
          className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-line bg-surface px-4 text-sm font-extrabold text-ink hover:border-primary disabled:opacity-60"
        >
          {locating ? 'Buscando…' : 'Usar mi ubicación'}
        </button>
      )}
    </div>
  );
}
