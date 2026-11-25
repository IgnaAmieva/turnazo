'use client';

import { useEffect, useState } from 'react';
import { distanceKm, formatKm } from '@/lib/geo';

export { distanceKm, formatKm };

/**
 * " · 1,2 km" SOLO si el jugador ya le dio permiso de ubicación al sitio.
 * Nunca pide el permiso: sin permiso (o sin la API de permisos) no muestra nada.
 */
export function VenueDistance({ lat, lng }: { lat: number; lng: number }) {
  const [km, setKm] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    navigator.permissions?.query({ name: 'geolocation' as PermissionName })
      .then((p) => {
        if (p.state !== 'granted' || !alive) return;
        navigator.geolocation.getCurrentPosition(
          (pos) => { if (alive) setKm(distanceKm({ lat: pos.coords.latitude, lng: pos.coords.longitude }, { lat, lng })); },
          () => {},
          { maximumAge: 5 * 60_000, timeout: 8000 },
        );
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [lat, lng]);
  if (km === null) return null;
  return <span data-testid="distancia"> · {formatKm(km)}</span>;
}
