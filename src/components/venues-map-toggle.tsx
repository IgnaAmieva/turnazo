'use client';

import { useState } from 'react';
import VenueMap from '@/components/venue-map-wrapper';

type V = { id: string; name: string; address: string; lat: number; lng: number };

/** "Ver todos en el mapa": el mapa grande (Leaflet + OpenStreetMap) se carga recién al tocarlo. */
export function VenuesMapToggle({ venues }: { venues: V[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="mapa-complejos"
        className="mx-auto flex min-h-11 items-center px-4 text-sm font-extrabold text-ink underline underline-offset-4 hover:opacity-80"
      >
        {open ? 'Ocultar el mapa' : 'Ver todos en el mapa'}
      </button>
      {open && (
        <div id="mapa-complejos" className="mt-3">
          <VenueMap venues={venues} className="h-72 w-full overflow-hidden rounded-2xl border border-line shadow-sm" />
        </div>
      )}
    </div>
  );
}
