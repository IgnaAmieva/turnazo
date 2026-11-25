"use client";

import { startTransition, useActionState, useState } from "react";
import type { PanelActionState } from "@/app/actions/panel";
import { useSavedNotice } from "@/components/panel/saved-toast";

interface PaymentSettingsSectionProps {
  action: (state: PanelActionState, formData: FormData) => Promise<PanelActionState>;
  mpConnected: boolean;
  settings: {
    deposit_required: boolean;
    deposit_type: "fixed" | "percent" | null;
    deposit_value: number | null;
    allow_full_payment: boolean;
    allow_pay_at_venue: boolean;
  };
}

export function PaymentSettingsSection({ action, mpConnected, settings }: PaymentSettingsSectionProps) {
  const [state, formAction, pending] = useActionState(action, null);
  useSavedNotice(pending, state);

  // Seña y pago total solo existen con Mercado Pago conectado.
  // (El servidor valida lo mismo: esto es solo para no ofrecer lo que va a rechazar.)
  const [depositRequired, setDepositRequired] = useState(mpConnected && settings.deposit_required);
  const [depositType, setDepositType]         = useState<"fixed" | "percent">(settings.deposit_type ?? "percent");
  const [depositValue, setDepositValue]       = useState(settings.deposit_value?.toString() ?? "");
  const [allowFull, setAllowFull]             = useState(mpConnected && settings.allow_full_payment);
  const [payAtVenue, setPayAtVenue]           = useState(settings.allow_pay_at_venue);

  const saved = state !== null && !state.error && !state.fieldErrors;

  return (
    <div className="bg-surface rounded-2xl border border-line p-6">
      <h2 className="text-lg font-semibold text-ink mb-1">Cobro de reservas</h2>
      <p className="text-sm text-ink-muted mb-4">
        Elegí cómo pagan tus clientes al reservar.
      </p>

      {!mpConnected && (
        <div className="mb-4 rounded-lg bg-warning-soft border border-warning/40 px-4 py-3 text-sm text-warning">
          Para pedir seña o cobrar el total online, primero conectá Mercado Pago.
          Mientras tanto las reservas son sin pago previo.
        </div>
      )}

      <form
        // Se envía desde onSubmit y no con `action=`: al terminar una acción
        // de formulario React 19 hace form.reset(), y los inputs controlados
        // quedan en el DOM con sus valores por defecto (seña destildada, "%"
        // y monto vacío) aunque lo guardado y el estado sean correctos.
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          startTransition(() => formAction(formData));
        }}
        className="space-y-4 max-w-2xl"
      >
        {state?.error && (
          <div className="rounded-lg bg-danger-soft border border-danger/40 px-4 py-3 text-sm text-danger">
            {state.error}
          </div>
        )}
        {saved && (
          <div className="rounded-lg bg-accent border border-transparent px-4 py-3 text-sm text-on-accent">
            Configuración de cobro guardada.
          </div>
        )}

        {/* Seña */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox" name="deposit_required"
              checked={depositRequired}
              disabled={!mpConnected}
              onChange={(e) => setDepositRequired(e.target.checked)}
              className="h-4 w-4 rounded border-line text-brand focus:ring-primary/25 disabled:opacity-50"
            />
            Pedir seña para reservar
          </label>
          <p className="mt-1 ml-6 text-xs text-ink-muted">
            El turno se confirma recién cuando se paga la seña. Se descuenta del total.
          </p>

          {depositRequired && (
            <div className="mt-3 ml-6 space-y-3">
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="radio" name="deposit_type" value="percent"
                    checked={depositType === "percent"}
                    onChange={() => setDepositType("percent")}
                    className="h-4 w-4 border-line text-brand focus:ring-primary/25"
                  />
                  Porcentaje del turno
                </label>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="radio" name="deposit_type" value="fixed"
                    checked={depositType === "fixed"}
                    onChange={() => setDepositType("fixed")}
                    className="h-4 w-4 border-line text-brand focus:ring-primary/25"
                  />
                  Monto fijo
                </label>
              </div>
              {state?.fieldErrors?.deposit_type && (
                <p className="text-xs text-danger">{state.fieldErrors.deposit_type[0]}</p>
              )}

              <div>
                <label htmlFor="deposit_value" className="block text-sm font-medium text-ink mb-1">
                  {depositType === "percent" ? "Porcentaje de seña (1 a 100)" : "Monto de la seña en pesos"}
                </label>
                <div className="flex items-center gap-2">
                  {depositType === "fixed" && <span className="text-sm text-ink-muted">$</span>}
                  <input
                    id="deposit_value"
                    type="number" name="deposit_value" inputMode="decimal"
                    value={depositValue}
                    onChange={(e) => setDepositValue(e.target.value)}
                    min={depositType === "percent" ? 1 : 0.01}
                    max={depositType === "percent" ? 100 : undefined}
                    step="any"
                    required
                    className="w-32 rounded-lg border border-line px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/25"
                  />
                  {depositType === "percent" && <span className="text-sm text-ink-muted">%</span>}
                </div>
                {state?.fieldErrors?.deposit_value && (
                  <p className="mt-1 text-xs text-danger">{state.fieldErrors.deposit_value[0]}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Pago total */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox" name="allow_full_payment"
              checked={allowFull}
              disabled={!mpConnected}
              onChange={(e) => setAllowFull(e.target.checked)}
              className="h-4 w-4 rounded border-line text-brand focus:ring-primary/25 disabled:opacity-50"
            />
            Permitir pagar el total online
          </label>
          <p className="mt-1 ml-6 text-xs text-ink-muted">
            El cliente puede pagar el turno completo por Mercado Pago al reservar.
          </p>
        </div>

        {/* Pago en el lugar */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input
              type="checkbox" name="allow_pay_at_venue"
              checked={!depositRequired && payAtVenue}
              disabled={depositRequired}
              onChange={(e) => setPayAtVenue(e.target.checked)}
              className="h-4 w-4 rounded border-line text-brand focus:ring-primary/25 disabled:opacity-50"
            />
            Permitir pagar en el lugar
          </label>
          <p className="mt-1 ml-6 text-xs text-ink-muted">
            {depositRequired
              ? "Con seña obligatoria no se puede reservar sin pagar antes."
              : "El cliente reserva sin pagar y abona en la cancha."}
          </p>
        </div>

        <div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-primary px-5 py-2 text-sm font-medium text-on-primary shadow-sm hover:opacity-90 disabled:opacity-60 transition-colors"
          >
            {pending ? "Guardando…" : "Guardar cobro"}
          </button>
        </div>
      </form>
    </div>
  );
}
