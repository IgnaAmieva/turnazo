"use client";

import { useActionState } from "react";
import VenuePinMap from "@/components/venue-pin-map-wrapper";
import type { PanelActionState } from "@/app/actions/panel";

interface Locality { id: string; name: string }
interface VenueFormProps {
  action: (state: PanelActionState, formData: FormData) => Promise<PanelActionState>;
  localities: Locality[];
  venue?: {
    name: string; phone: string; address: string; locality_id: string;
    lat: number; lng: number; payment_alias: string | null; payment_link: string | null;
  };
  submitLabel?: string;
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="mt-1 text-xs text-red-600">{errors[0]}</p>;
}

export function VenueForm({ action, localities, venue, submitLabel = "Guardar" }: VenueFormProps) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-6 max-w-2xl">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      {/* Nombre */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del complejo</label>
        <input
          type="text" name="name" defaultValue={venue?.name ?? ""}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
        />
        <FieldError errors={state?.fieldErrors?.name} />
      </div>

      {/* Teléfono */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
        <input
          type="tel" name="phone" defaultValue={venue?.phone ?? ""}
          placeholder="2612345678"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
        />
        <FieldError errors={state?.fieldErrors?.phone} />
      </div>

      {/* Dirección */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
        <input
          type="text" name="address" defaultValue={venue?.address ?? ""}
          placeholder="Calle Falsa 123, Mendoza"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
        />
        <FieldError errors={state?.fieldErrors?.address} />
      </div>

      {/* Localidad */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Localidad</label>
        <select
          name="locality_id"
          defaultValue={venue?.locality_id ?? ""}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
        >
          <option value="">Seleccioná una localidad…</option>
          {localities.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <FieldError errors={state?.fieldErrors?.locality_id} />
      </div>

      {/* Mapa */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Ubicación en el mapa</label>
        <VenuePinMap initialLat={venue?.lat} initialLng={venue?.lng} />
        <FieldError errors={state?.fieldErrors?.lat} />
      </div>

      {/* Alias de pago */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Alias de pago (opcional)</label>
        <input
          type="text" name="payment_alias" defaultValue={venue?.payment_alias ?? ""}
          placeholder="complejo.padel.mp"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
        />
      </div>

      {/* Link de pago */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Link de pago (opcional)</label>
        <input
          type="url" name="payment_link" defaultValue={venue?.payment_link ?? ""}
          placeholder="https://mpago.la/..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
        />
      </div>

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-green-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:opacity-60 transition-colors"
        >
          {pending ? "Guardando…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
