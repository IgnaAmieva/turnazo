"use client";

import { useActionState } from "react";
import type { PanelActionState } from "@/app/actions/panel";
import { SURFACES } from "@/lib/court-tags";

interface Sport { id: string; name: string; default_slot_minutes: number }
interface CourtFormProps {
  action: (state: PanelActionState, formData: FormData) => Promise<PanelActionState>;
  sports: Sport[];
  court?: {
    name: string; sport_id: string; slot_minutes: number; active: boolean;
    surface?: string | null; covered?: boolean; lit?: boolean; has_locker_room?: boolean;
  };
  submitLabel?: string;
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="mt-1 text-xs text-danger">{errors[0]}</p>;
}

export function CourtForm({ action, sports, court, submitLabel = "Guardar" }: CourtFormProps) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-5 max-w-md">
      {state?.error && (
        <div className="rounded-lg bg-danger-soft border border-danger/40 px-4 py-3 text-sm text-danger">
          {state.error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-ink mb-1">Nombre de la cancha</label>
        <input
          type="text" name="name" defaultValue={court?.name ?? ""}
          placeholder="Cancha 1"
          className="w-full rounded-lg border border-line px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/25"
        />
        <FieldError errors={state?.fieldErrors?.name} />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">Deporte</label>
        <select
          name="sport_id" defaultValue={court?.sport_id ?? ""}
          className="w-full rounded-lg border border-line px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/25"
        >
          <option value="">Seleccioná un deporte…</option>
          {sports.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <FieldError errors={state?.fieldErrors?.sport_id} />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">Duración del turno (minutos)</label>
        <input
          type="number" name="slot_minutes"
          defaultValue={court?.slot_minutes ?? 90}
          min={30} max={240} step={15}
          className="w-full rounded-lg border border-line px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/25"
        />
        <FieldError errors={state?.fieldErrors?.slot_minutes} />
      </div>

      {/* Etiquetas (migración 023): se ven en la lista y en la portada del complejo */}
      <fieldset className="space-y-3">
        <legend className="block text-sm font-medium text-ink mb-1">Cómo es la cancha</legend>
        <div>
          <label htmlFor="surface" className="block text-sm text-ink mb-1">Superficie</label>
          <select
            id="surface" name="surface" defaultValue={court?.surface ?? ""}
            className="w-full min-h-11 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/25"
          >
            <option value="">Sin indicar</option>
            {SURFACES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <FieldError errors={state?.fieldErrors?.surface} />
        </div>
        {([
          ["covered", "Techada", court?.covered],
          ["lit", "Iluminada", court?.lit],
          ["has_locker_room", "Vestuario", court?.has_locker_room],
        ] as const).map(([name, label, value]) => (
          <label key={name} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3">
            <span className="text-sm text-ink">{label}</span>
            <input type="checkbox" role="switch" name={name} defaultChecked={value ?? false} className="peer sr-only" />
            <span aria-hidden="true"
              className="relative h-7 w-12 shrink-0 rounded-full bg-line transition-colors peer-checked:bg-primary
                peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring
                after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-surface after:shadow after:transition-transform
                peer-checked:after:translate-x-5" />
          </label>
        ))}
      </fieldset>

      <div className="flex items-center gap-2">
        <input
          type="checkbox" name="active" id="active"
          defaultChecked={court?.active ?? true}
          className="h-4 w-4 rounded border-line text-brand focus:ring-primary/25"
        />
        <label htmlFor="active" className="text-sm text-ink">Cancha activa (visible al público)</label>
      </div>

      <div>
        <button
          type="submit" disabled={pending}
          className="rounded-xl bg-primary px-5 py-2 text-sm font-medium text-on-primary shadow-sm hover:opacity-90 disabled:opacity-60 transition-colors"
        >
          {pending ? "Guardando…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
