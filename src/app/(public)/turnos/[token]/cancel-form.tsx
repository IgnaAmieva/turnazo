'use client';

import { useActionState, useState } from 'react';
import { type CancelActionState } from '@/app/actions/booking';

type Props = {
  action: (prevState: CancelActionState, formData: FormData) => Promise<CancelActionState>;
  cancelLimitHours: number;
  periodStart: string;
  /** Lo que pagó online (0 si pagó en el lugar o todavía no pagó) */
  amountPaid: number;
  refundPolicy: 'full' | 'none';
  /** Hay un pago online acreditado por Mercado Pago que se puede devolver */
  refundAvailable: boolean;
};

export default function CancelForm({
  action, cancelLimitHours, periodStart, amountPaid, refundPolicy, refundAvailable,
}: Props) {
  const [state, formAction, isPending] = useActionState(action, {});
  const [acknowledged, setAcknowledged] = useState(false);
  // Momento en que se montó el formulario: alcanza para decidir qué mostrar
  // (el servidor vuelve a decidir con su propio reloj al cancelar).
  const [now] = useState(() => Date.now());
  const start = new Date(periodStart).getTime();
  const deadline = start - cancelLimitHours * 3600 * 1000;
  const withinWindow = now < deadline;
  const started = now >= start;
  const amountLabel = `$${amountPaid.toLocaleString('es-AR')}`;

  // Sin pago online: igual que siempre (solo hasta cancel_limit_hours antes).
  if (!refundAvailable && !withinWindow) {
    return (
      <div className="rounded-2xl bg-surface-2 border border-line p-4 text-sm text-ink-muted">
        No es posible cancelar (límite de {cancelLimitHours}h antes del turno alcanzado).
      </div>
    );
  }
  if (refundAvailable && started) {
    return (
      <div className="rounded-2xl bg-surface-2 border border-line p-4 text-sm text-ink-muted">
        No es posible cancelar: el turno ya empezó.
      </div>
    );
  }

  if (state.success) {
    return (
      <div className="rounded-2xl bg-accent border border-transparent p-4 text-sm text-on-accent font-medium">
        {state.refund === 'refunded' && `Tu turno fue cancelado. Te devolvimos $${(state.refundAmount ?? 0).toLocaleString('es-AR')} por Mercado Pago.`}
        {state.refund === 'pending' && `Tu turno fue cancelado. La devolución de $${(state.refundAmount ?? 0).toLocaleString('es-AR')} está en proceso.`}
        {(!state.refund || state.refund === 'none') && 'Tu turno fue cancelado exitosamente.'}
      </div>
    );
  }

  const refundDue = refundAvailable && withinWindow && refundPolicy === 'full';
  const noRefund  = refundAvailable && !refundDue;

  return (
    <div>
      {state.error && (
        <div className="rounded-xl bg-danger-soft border border-danger/40 p-4 text-danger text-sm mb-4">
          {state.error}
        </div>
      )}

      {refundDue && (
        <div className="rounded-xl bg-accent border border-transparent p-4 text-sm text-on-accent mb-4">
          Si cancelás ahora, te devolvemos <strong>{amountLabel}</strong> a tu medio de pago de Mercado Pago.
        </div>
      )}

      {noRefund && (
        <div className="rounded-xl bg-warning-soft border border-warning/40 p-4 text-sm text-warning mb-4 space-y-2">
          <p>
            <strong>Si cancelás ahora, NO se te devuelve lo que pagaste ({amountLabel}).</strong>
          </p>
          <p className="text-warning">
            {refundPolicy === 'none'
              ? 'Este complejo no hace devoluciones por cancelación.'
              : `Pasó el plazo para cancelar con devolución (hasta ${cancelLimitHours} h antes del turno).`}
          </p>
          <label className="flex items-start gap-2 pt-1">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-warning text-warning focus:ring-warning"
            />
            <span>Entiendo que no hay devolución.</span>
          </label>
        </div>
      )}

      <form action={formAction}>
        <button
          type="submit"
          disabled={isPending || (noRefund && !acknowledged)}
          className="w-full rounded-2xl border-2 border-danger bg-surface py-3.5 text-sm font-extrabold text-danger
            shadow-sm hover:bg-danger-soft active:bg-danger-soft transition-colors
            disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending
            ? 'Cancelando…'
            : refundDue
              ? 'Cancelar turno y pedir devolución'
              : noRefund
                ? 'Cancelar turno sin devolución'
                : 'Cancelar turno'}
        </button>

        <p className="mt-2 text-xs text-ink-muted text-center">
          Esta acción no se puede deshacer.
        </p>
      </form>
    </div>
  );
}
