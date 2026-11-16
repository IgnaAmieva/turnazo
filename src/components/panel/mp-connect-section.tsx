"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { disconnectMpAction } from "@/app/actions/mp";
import type { PanelActionState } from "@/app/actions/panel";

const MP_ERROR_MESSAGES: Record<string, string> = {
  invalid_params:    "Parámetros inválidos en la respuesta de Mercado Pago.",
  expired:           "El enlace expiró o es inválido. Intentá de nuevo.",
  not_authenticated: "Necesitás estar logueado para conectar Mercado Pago.",
  not_owner:         "No tenés permisos para conectar este complejo.",
  exchange_failed:   "Error al conectar con Mercado Pago. Intentá de nuevo.",
  save_failed:       "Error al guardar la conexión. Intentá de nuevo.",
};

interface MpConnectSectionProps {
  venueId: string;
  mpConnection: {
    mp_user_id: string;
    mp_email: string | null;
    expires_at: string;
  } | null;
}

export function MpConnectSection({ venueId, mpConnection }: MpConnectSectionProps) {
  const searchParams = useSearchParams();
  const mpStatus = searchParams.get("mp");
  const mpErrorCode = searchParams.get("mp_error");
  const mpErrorMessage = mpErrorCode
    ? MP_ERROR_MESSAGES[mpErrorCode] ?? "Ocurrió un error con Mercado Pago. Intentá de nuevo."
    : null;

  const [showConfirm, setShowConfirm] = useState(false);

  const [state, formAction, pending] = useActionState<PanelActionState, FormData>(
    disconnectMpAction,
    null
  );

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Mercado Pago</h2>

      {mpStatus === "connected" && (
        <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          Cuenta de Mercado Pago conectada exitosamente.
        </div>
      )}

      {mpErrorMessage && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {mpErrorMessage}
        </div>
      )}

      {state?.error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      {mpConnection ? (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
            <span className="text-sm font-medium text-gray-900">Conectado</span>
          </div>
          <div className="text-sm text-gray-600 space-y-1 mb-4">
            {mpConnection.mp_email && <p>Cuenta: {mpConnection.mp_email}</p>}
            <p className="text-xs text-gray-400">ID: {mpConnection.mp_user_id}</p>
          </div>

          {!showConfirm ? (
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              Desconectar Mercado Pago
            </button>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm text-amber-800 mb-3">
                Al desconectar se desactivará el cobro de seña y pago online.
                Las reservas pasarán a ser sin pago previo. ¿Confirmar?
              </p>
              <div className="flex gap-2">
                <form action={formAction}>
                  <input type="hidden" name="venue_id" value={venueId} />
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60 transition-colors"
                  >
                    {pending ? "Desconectando…" : "Sí, desconectar"}
                  </button>
                </form>
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div>
          <p className="text-sm text-gray-600 mb-4">
            Conectá tu cuenta de Mercado Pago para recibir pagos online de tus clientes.
          </p>
          <a
            href={`/api/mp/oauth/connect?venueId=${venueId}`}
            className="inline-flex items-center gap-2 rounded-xl bg-[#009ee3] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#007eb5] transition-colors"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.5 14.5h-9a.5.5 0 010-1h9a.5.5 0 010 1zm0-3h-9a.5.5 0 010-1h9a.5.5 0 010 1zm0-3h-9a.5.5 0 010-1h9a.5.5 0 010 1z" />
            </svg>
            Conectar con Mercado Pago
          </a>
        </div>
      )}
    </div>
  );
}
