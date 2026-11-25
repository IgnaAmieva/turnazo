"use client";

import { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";

interface VenuePinMapProps {
  initialLat?: number;
  initialLng?: number;
}

// Centro del mapa sin pin: Valle de Uco y Gran Mendoza a la vista. NO es un pin:
// antes el marcador arrancaba en el centro de Mendoza y, si el dueño no lo movía,
// el complejo quedaba ahí (así le pasó a padelmates). La localidad sale del pin.
const VIEW_CENTER = { lat: -33.25, lng: -68.95 };
const VIEW_ZOOM = 9;

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

export default function VenuePinMap({ initialLat, initialLng }: VenuePinMapProps) {
  const [mounted, setMounted] = useState(false);
  const [L, setL] = useState<typeof import("leaflet") | null>(null);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(
    initialLat !== undefined && initialLng !== undefined ? { lat: initialLat, lng: initialLng } : null,
  );
  const hidden = (
    <>
      <input type="hidden" name="lat" value={pos ? String(pos.lat) : ""} readOnly />
      <input type="hidden" name="lng" value={pos ? String(pos.lng) : ""} readOnly />
    </>
  );

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
        {hidden}
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
        center={pos ? [pos.lat, pos.lng] : [VIEW_CENTER.lat, VIEW_CENTER.lng]}
        zoom={pos ? 13 : VIEW_ZOOM}
        scrollWheelZoom={false}
        style={{ height: 256 }}
        className="w-full rounded-lg border border-gray-300"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onMove={(lat, lng) => setPos({ lat, lng })} />
        {pos && (
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
        )}
      </MapContainer>
      {hidden}
      <p className="mt-1.5 text-xs text-ink-muted" data-testid="pin-estado">
        {pos
          ? `Arrastrá el marcador o tocá el mapa para corregirlo. Coordenadas: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`
          : "Tocá el mapa justo donde está el complejo. Con eso sabemos en qué localidad aparece."}
      </p>
    </div>
  );
}
