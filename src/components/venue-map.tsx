'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';

interface Venue {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface Props {
  venues: Venue[];
  className?: string;
}

const VALLE_DE_UCO: [number, number] = [-33.57, -69.0];
const DEFAULT_ZOOM = 11;

function computeCentroid(venues: Venue[]): [number, number] {
  if (venues.length === 0) return VALLE_DE_UCO;
  const lat = venues.reduce((sum, v) => sum + v.lat, 0) / venues.length;
  const lng = venues.reduce((sum, v) => sum + v.lng, 0) / venues.length;
  return [lat, lng];
}

export default function VenueMap({ venues, className }: Props) {
  const [mounted, setMounted] = useState(false);
  const [L, setL] = useState<typeof import('leaflet') | null>(null);

  useEffect(() => {
    import('leaflet/dist/leaflet.css');
    import('leaflet').then((mod) => {
      setL(mod.default);
      setMounted(true);
    });
  }, []);

  if (!mounted || !L) return null;

  const center = computeCentroid(venues);
  const zoom = venues.length > 0 ? 13 : DEFAULT_ZOOM;

  const icon = L.divIcon({
    html: '<div style="width:14px;height:14px;background:#16a34a;border-radius:50%;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>',
    className: '',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });

  const containerClass =
    className ?? 'h-64 md:h-80 w-full rounded-xl overflow-hidden';

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom={false}
      className={containerClass}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {venues.map((venue) => (
        <Marker key={venue.id} position={[venue.lat, venue.lng]} icon={icon}>
          <Popup>
            <p className="font-semibold">{venue.name}</p>
            <p className="text-sm text-gray-600">{venue.address}</p>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
