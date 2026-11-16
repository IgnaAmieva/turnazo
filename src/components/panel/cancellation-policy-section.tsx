"use client";

import { useActionState } from "react";
import type { PanelActionState } from "@/app/actions/panel";

interface CancellationPolicySectionProps {
  action: (state: PanelActionState, formData: FormData) => Promise<PanelActionState>;
  settings: {
    cancel_limit_hours: number;
    refund_policy: "full" | "none";
  };
}

export function CancellationPolicySection({ action, settings }: CancellationPolicySectionProps) {
  const [state, formAction, pending] = useActionState(action, null);
  const saved = state !== null && !state.error && !state.fieldErrors;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Cancelaciones</h2>
      <p className="text-sm text-gray-600 mb-4">
        Hasta cuándo puede cancelar el cliente y qué pasa con lo que pagó online.
      </p>

      <form action={formAction} className="space-y-4 max-w-2xl">
        {state?.error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {state.error}
          </div>
        )}
        {saved && (
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
            Política de cancelación guardada.
          </div>
        )}

        <div>
          <label htmlFor="cancel_limit_hours" className="block text-sm font-medium text-gray-700 mb-1">
            Plazo para cancelar (horas antes del turno)
          </label>
          <div className="flex items-center gap-2">
            <input
              id="cancel_limit_hours"
              type="number" name="cancel_limit_hours" inputMode="numeric"
              defaultValue={settings.cancel_limit_hours}
              min={0} max={168} step={1} required
              className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            <span className="text-sm text-gray-500">horas</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Sin pago online, pasado este plazo ya no se puede cancelar. Con pago online se puede
            cancelar hasta que empieza el turno, pero la devolución solo aplica dentro del plazo.
          </p>
          {state?.fieldErrors?.cancel_limit_hours && (
            <p className="mt-1 text-xs text-red-600">{state.fieldErrors.cancel_limit_hours[0]}</p>
          )}
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-gray-700 mb-2">Devolución de pagos online</legend>
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="radio" name="refund_policy" value="full"
                defaultChecked={settings.refund_policy === "full"}
                className="mt-0.5 h-4 w-4 border-gray-300 text-green-600 focus:ring-green-500"
              />
              <span>
                <span className="font-medium">Devolución total</span>
                <span className="block text-xs text-gray-500">
                  Si cancela dentro del plazo, se le devuelve lo pagado por Mercado Pago.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="radio" name="refund_policy" value="none"
                defaultChecked={settings.refund_policy === "none"}
                className="mt-0.5 h-4 w-4 border-gray-300 text-green-600 focus:ring-green-500"
              />
              <span>
                <span className="font-medium">Sin devolución</span>
                <span className="block text-xs text-gray-500">
                  Puede cancelar, pero lo pagado queda para el complejo. Se le avisa antes de confirmar.
                </span>
              </span>
            </label>
          </div>
          {state?.fieldErrors?.refund_policy && (
            <p className="mt-1 text-xs text-red-600">{state.fieldErrors.refund_policy[0]}</p>
          )}
        </fieldset>

        <div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-green-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:opacity-60 transition-colors"
          >
            {pending ? "Guardando…" : "Guardar cancelaciones"}
          </button>
        </div>
      </form>
    </div>
  );
}
