"use client";

import { useActionState } from "react";
import type { PanelActionState } from "@/app/actions/panel";

interface Sport { id: string; name: string; default_slot_minutes: number }
interface CourtFormProps {
  action: (state: PanelActionState, formData: FormData) => Promise<PanelActionState>;
  sports: Sport[];
  court?: {
    name: string; sport_id: string; slot_minutes: number; active: boolean;
  };
  submitLabel?: string;
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="mt-1 text-xs text-red-600">{errors[0]}</p>;
}

export function CourtForm({ action, sports, court, submitLabel = "Guardar" }: CourtFormProps) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-5 max-w-md">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de la cancha</label>
        <input
          type="text" name="name" defaultValue={court?.name ?? ""}
          placeholder="Cancha 1"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
        />
        <FieldError errors={state?.fieldErrors?.name} />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Deporte</label>
        <select
          name="sport_id" defaultValue={court?.sport_id ?? ""}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
        >
          <option value="">Seleccioná un deporte…</option>
          {sports.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <FieldError errors={state?.fieldErrors?.sport_id} />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Duración del turno (minutos)</label>
        <input
          type="number" name="slot_minutes"
          defaultValue={court?.slot_minutes ?? 90}
          min={30} max={240} step={15}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
        />
        <FieldError errors={state?.fieldErrors?.slot_minutes} />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox" name="active" id="active"
          defaultChecked={court?.active ?? true}
          className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
        />
        <label htmlFor="active" className="text-sm text-gray-700">Cancha activa (visible al público)</label>
      </div>

      <div>
        <button
          type="submit" disabled={pending}
          className="rounded-xl bg-green-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:opacity-60 transition-colors"
        >
          {pending ? "Guardando…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
