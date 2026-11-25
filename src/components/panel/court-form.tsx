"use client";

import { useActionState, useState } from "react";
import type { PanelActionState } from "@/app/actions/panel";
import { SURFACES } from "@/lib/court-tags";
import { useSavedNotice } from "@/components/panel/saved-toast";

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

/** Duraciones que se ofrecen como botones (más la de la cancha, si es otra). */
const DURATIONS = [60, 90, 120];

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="mt-1 text-sm text-danger">{errors[0]}</p>;
}

/** Botón de opción: un radio nativo (sale en el FormData) con forma de botón de 44 px. */
function Choice({ name, value, checked, onChange, children }: {
  name: string; value: string; checked: boolean; onChange: () => void; children: React.ReactNode;
}) {
  return (
    <label className="relative block">
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="peer sr-only" />
      <span className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface px-3 text-center text-sm font-extrabold text-ink
        hover:border-primary peer-checked:border-transparent peer-checked:bg-primary peer-checked:text-on-primary
        peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
        {children}
      </span>
    </label>
  );
}

export function CourtForm({ action, sports, court, submitLabel = "Guardar" }: CourtFormProps) {
  const [state, formAction, pending] = useActionState(action, null);
  // Al editar, cada vez que se guarda bien: "Guardado". Al crear, la acción
  // lleva al paso de precios con el aviso "Cancha cargada".
  useSavedNotice(pending, court ? state : { error: "crear" });

  const [sportId, setSportId] = useState(court?.sport_id ?? "");
  const [minutes, setMinutes] = useState(court?.slot_minutes ?? 90);
  // Mientras no se toca la duración, sigue a la del deporte (pádel 90, fútbol 60…)
  const [minutesTouched, setMinutesTouched] = useState(Boolean(court));
  const durations = DURATIONS.includes(minutes) ? DURATIONS : [...DURATIONS, minutes].sort((a, b) => a - b);

  function pickSport(s: Sport) {
    setSportId(s.id);
    if (!minutesTouched) setMinutes(s.default_slot_minutes);
  }

  return (
    <form action={formAction} className="space-y-6 max-w-md">
      {state?.error && (
        <div role="alert" className="rounded-lg bg-danger-soft border border-danger/40 px-4 py-3 text-sm text-danger">
          {state.error}
        </div>
      )}

      <div>
        <label htmlFor="court-name" className="block text-sm font-extrabold text-ink mb-1.5">Nombre</label>
        <input
          id="court-name" type="text" name="name" defaultValue={court?.name ?? ""}
          placeholder="Cancha 1"
          className="w-full min-h-12 rounded-xl border border-line bg-surface px-3 text-base text-ink shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/25"
        />
        <FieldError errors={state?.fieldErrors?.name} />
      </div>

      <fieldset>
        <legend className="block text-sm font-extrabold text-ink mb-1.5">Deporte</legend>
        <div className="grid grid-cols-3 gap-2">
          {sports.map((s) => (
            <Choice key={s.id} name="sport_id" value={s.id} checked={sportId === s.id} onChange={() => pickSport(s)}>
              {s.name}
            </Choice>
          ))}
        </div>
        <FieldError errors={state?.fieldErrors?.sport_id} />
      </fieldset>

      <fieldset>
        <legend className="block text-sm font-extrabold text-ink mb-1.5">Duración del turno</legend>
        <div className="grid grid-cols-3 gap-2">
          {durations.map((m) => (
            <Choice key={m} name="slot_minutes" value={String(m)} checked={minutes === m}
              onChange={() => { setMinutes(m); setMinutesTouched(true); }}>
              {m} min
            </Choice>
          ))}
        </div>
        <FieldError errors={state?.fieldErrors?.slot_minutes} />
      </fieldset>

      {/* Etiquetas (migración 023): se ven en la lista y en la portada del complejo */}
      <fieldset className="space-y-3">
        <legend className="block text-sm font-extrabold text-ink mb-1.5">Cómo es la cancha</legend>
        <div>
          <label htmlFor="surface" className="block text-sm text-ink mb-1">Superficie</label>
          <select
            id="surface" name="surface" defaultValue={court?.surface ?? ""}
            className="w-full min-h-11 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/25"
          >
            <option value="">Sin indicar</option>
            {SURFACES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <FieldError errors={state?.fieldErrors?.surface} />
        </div>
        <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {([
            ["covered", "Techada", court?.covered ?? false],
            ["lit", "Iluminada", court?.lit ?? false],
            ["has_locker_room", "Vestuario", court?.has_locker_room ?? false],
            ["active", "Visible para los jugadores", court?.active ?? true],
          ] as const).map(([name, label, value]) => (
            <label key={name} className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4">
              <span className="text-base text-ink">{label}</span>
              <input type="checkbox" role="switch" name={name} defaultChecked={value} className="peer sr-only" />
              <span aria-hidden="true"
                className="relative h-7 w-12 shrink-0 rounded-full bg-line transition-colors peer-checked:bg-primary
                  peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring
                  after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-surface after:shadow after:transition-transform
                  peer-checked:after:translate-x-5" />
            </label>
          ))}
        </div>
      </fieldset>

      <button
        type="submit" disabled={pending}
        className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-primary px-5 text-base font-extrabold text-on-primary shadow-sm hover:opacity-90 disabled:opacity-60 transition-colors"
      >
        {pending ? "Guardando…" : submitLabel}
      </button>
    </form>
  );
}
