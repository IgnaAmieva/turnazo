'use client';

import { useActionState } from 'react';
import { type CancelActionState } from '@/app/actions/booking';

type Props = {
  action: (prevState: CancelActionState, formData: FormData) => Promise<CancelActionState>;
  cancelLimitHours: number;
  periodStart: string;
};

export default function CancelForm({ action, cancelLimitHours, periodStart }: Props) {
  const [state, formAction, isPending] = useActionState(action, {});

  // Calcular si aún es posible cancelar
  const deadline = new Date(periodStart).getTime() - cancelLimitHours * 3600 * 1000;
  const canCancel = new Date().getTime() < deadline;

  if (!canCancel) {
    return (
      <div className="rounded-2xl bg-gray-50 border border-gray-200 p-4 text-sm text-gray-500">
        No es posible cancelar (límite de {cancelLimitHours}h antes del turno alcanzado).
      </div>
    );
  }

  if (state.success) {
    return (
      <div className="rounded-2xl bg-green-50 border border-green-200 p-4 text-sm text-green-800 font-medium">
        Tu turno fue cancelado exitosamente.
      </div>
    );
  }

  return (
    <div>
      {state.error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm mb-4">
          {state.error}
        </div>
      )}

      <form action={formAction}>
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-2xl bg-red-600 py-3.5 text-sm font-semibold text-white
            shadow-sm hover:bg-red-700 active:bg-red-800 transition-colors
            disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending ? 'Cancelando…' : 'Cancelar turno'}
        </button>

        <p className="mt-2 text-xs text-gray-400 text-center">
          Esta acción no se puede deshacer.
        </p>
      </form>
    </div>
  );
}
