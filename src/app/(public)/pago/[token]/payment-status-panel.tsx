'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cancelHoldAction, reconcilePaymentAction } from '@/app/actions/payment';
import type { PaymentStatus } from '@/lib/payment-status';

/**
 * Cada tick consulta la orden en Mercado Pago (misma lógica que el webhook) y
 * devuelve el estado real de la reserva. 15 s para no martillar la API de MP:
 * el webhook es el camino principal, esto es el respaldo.
 */
const RECONCILE_MS = 15_000;

type Props = {
  token: string;
  initial: PaymentStatus;
};

export default function PaymentStatusPanel({ token, initial }: Props) {
  const [status, setStatus] = useState<PaymentStatus>(initial);
  // La hora se toma solo en el navegador: si el servidor la calculara, el
  // texto de la cuenta regresiva no coincidiría al hidratar.
  const [now, setNow] = useState<number | null>(null);

  // Reconciliación mientras el pago está pendiente
  useEffect(() => {
    if (status.state !== 'pendiente') return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const next = await reconcilePaymentAction(token);
        if (!cancelled) setStatus(next);
      } catch {
        // Reintenta en el próximo tick
      }
    }, RECONCILE_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [status.state, token]);

  // Cuenta regresiva (1 s)
  useEffect(() => {
    if (status.state !== 'pendiente') return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status.state]);

  const remainingMs = now === null ? null : status.expiresAt ? new Date(status.expiresAt).getTime() - now : 0;
  const remaining = remainingMs === null ? null : Math.max(0, Math.floor(remainingMs / 1000));
  const countdown = remaining === null
    ? '--:--'
    : `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;

  // Al llegar a cero, reconciliar enseguida (sin esperar el próximo tick): si
  // el pago entró en los últimos segundos, se confirma en vez de mostrar "vencida".
  useEffect(() => {
    if (status.state !== 'pendiente' || remaining === null || remaining > 0) return;
    let cancelled = false;
    reconcilePaymentAction(token)
      .then((next) => { if (!cancelled) setStatus(next); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [status.state, remaining, token]);

  if (status.state === 'confirmada') {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 text-center">
        <span aria-hidden="true" className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-on-accent text-2xl font-extrabold">✓</span>
        <p className="text-ink text-xl font-extrabold mb-2">¡Pago confirmado!</p>
        <p className="text-ink-muted text-sm mb-5">Tu turno quedó reservado.</p>
        <Link
          href={`/turnos/${token}`}
          className="inline-block rounded-2xl bg-primary px-6 py-3 text-sm font-extrabold text-on-primary
            shadow-sm hover:opacity-90"
        >
          Ver mi turno
        </Link>
      </div>
    );
  }

  if (status.state === 'pendiente') {
    const cancelWithToken = cancelHoldAction.bind(null, token);
    return (
      <div className="rounded-2xl border border-warning/40 bg-warning-soft p-6 text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-warning/30 border-t-warning" />
        <p className="text-warning text-xl font-bold mb-2">Estamos confirmando tu pago</p>
        <p className="text-warning text-sm">
          Apenas Mercado Pago nos avise, tu turno queda confirmado. No cierres esta pantalla.
        </p>
        <p className="mt-4 text-warning text-sm">
          El turno queda reservado para vos durante{' '}
          <span className="font-mono font-semibold tabular-nums" data-testid="countdown">
            {countdown}
          </span>
        </p>
        {status.amount !== undefined && (
          <p className="mt-1 text-warning text-xs">
            Monto: ${status.amount.toLocaleString('es-AR')}
          </p>
        )}
        <form action={cancelWithToken} className="mt-5">
          <button
            type="submit"
            className="text-sm text-warning underline underline-offset-2 hover:text-warning"
          >
            Cancelar y elegir otro horario
          </button>
          <p className="mt-1 text-xs text-warning">
            Si todavía no pagaste, el horario se libera al instante.
          </p>
        </form>
      </div>
    );
  }

  if (status.state === 'vencida') {
    return (
      <div className="rounded-2xl border border-line bg-surface-2 p-6 text-center">
        <p className="text-ink text-xl font-bold mb-2">Se venció el tiempo para pagar</p>
        <p className="text-ink-muted text-sm">
          El turno se liberó. Si llegaste a pagar, Mercado Pago te devuelve el dinero
          automáticamente. Podés volver a elegir un horario.
        </p>
        <Link href="/" className="mt-5 inline-block text-sm text-brand hover:underline">
          Buscar otro turno
        </Link>
      </div>
    );
  }

  if (status.state === 'cancelada') {
    return (
      <div className="rounded-2xl border border-line bg-surface-2 p-6 text-center">
        <p className="text-ink text-xl font-bold mb-2">Este turno fue cancelado</p>
        <Link href="/" className="mt-3 inline-block text-sm text-brand hover:underline">
          Buscar otro turno
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-6 text-center">
      <p className="text-ink-muted text-lg mb-3">Pago no encontrado.</p>
      <Link href="/" className="text-sm text-brand hover:underline">
        Volver al inicio
      </Link>
    </div>
  );
}
