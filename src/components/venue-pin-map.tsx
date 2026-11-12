"use client";

import { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";

interface VenuePinMapProps {
  initialLat?: number;
  initialLng?: number;
}

// Default: Mendoza city center
const DEFAULT_LAT = -32.8908;
const DEFAULT_LNG = -68.8272;

function ClickHandler({
  onMove,
}: {
  onMove: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onMove(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function VenuePinMap({
  initialLat = DEFAULT_LAT,
  initialLng = DEFAULT_LNG,
}: VenuePinMapProps) {
  const [mounted, setMounted] = useState(false);
  const [L, setL] = useState<typeof import("leaflet") | null>(null);
  const [pos, setPos] = useState({ lat: initialLat, lng: initialLng });

  useEffect(() => {
    import("leaflet/dist/leaflet.css");
    import("leaflet").then((mod) => {
      setL(mod.default);
      setMounted(true);
    });
  }, []);

  if (!mounted || !L) {
    return (
      <div>
        <div
          style={{ height: 256 }}
          className="w-full rounded-lg bg-gray-100 animate-pulse flex items-center justify-center text-gray-400 text-sm"
        >
          Cargando mapa…
        </div>
        <input type="hidden" name="lat" value={String(pos.lat)} readOnly />
        <input type="hidden" name="lng" value={String(pos.lng)} readOnly />
      </div>
    );
  }

  const icon = L.divIcon({
    html: '<div style="width:20px;height:20px;background:#16a34a;border-radius:50%;border:3px solid white;box-shadow:0 2px 4px rgba(0,0,0,.4)"></div>',
    className: "",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

  return (
    <div>
      <MapContainer
        center={[pos.lat, pos.lng]}
        zoom={13}
        scrollWheelZoom={false}
        style={{ height: 256 }}
        className="w-full rounded-lg border border-gray-300"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onMove={(lat, lng) => setPos({ lat, lng })} />
        <Marker
          position={[pos.lat, pos.lng]}
          icon={icon}
          draggable
          eventHandlers={{
            dragend(e) {
              const { lat, lng } = (e.target as import("leaflet").Marker).getLatLng();
              setPos({ lat, lng });
            },
          }}
        />
      </MapContainer>
      <input type="hidden" name="lat" value={String(pos.lat)} readOnly />
      <input type="hidden" name="lng" value={String(pos.lng)} readOnly />
      <p className="mt-1.5 text-xs text-gray-500">
        Hacé clic en el mapa o arrastrá el marcador para fijar la ubicación.
        Coordenadas: {pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}
      </p>
    </div>
  );
}
