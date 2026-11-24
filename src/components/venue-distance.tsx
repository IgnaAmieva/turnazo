'use client';

import { useEffect, useState } from 'react';

/** Distancia en línea recta (km), fórmula de haversine. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
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
