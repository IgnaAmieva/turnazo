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
  const [now, setNow] = useState(() => Date.now());

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
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status.state]);

  const remainingMs = status.expiresAt ? new Date(status.expiresAt).getTime() - now : 0;
  const remaining = Math.max(0, Math.floor(remainingMs / 1000));
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  // Al llegar a cero, reconciliar enseguida (sin esperar el próximo tick): si
  // el pago entró en los últimos segundos, se confirma en vez de mostrar "vencida".
  useEffect(() => {
    if (status.state !== 'pendiente' || remaining > 0) return;
    let cancelled = false;
    reconcilePaymentAction(token)
      .then((next) => { if (!cancelled) setStatus(next); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [status.state, remaining, token]);

  if (status.state === 'confirmada') {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-6 text-center">
        <p className="text-green-800 text-xl font-bold mb-2">¡Pago confirmado!</p>
        <p className="text-green-700 text-sm mb-5">Tu turno quedó reservado.</p>
        <Link
          href={`/turnos/${token}`}
          className="inline-block rounded-2xl bg-green-600 px-6 py-3 text-sm font-semibold text-white
            shadow-sm hover:bg-green-700"
        >
          Ver mi turno
        </Link>
      </div>
    );
  }

  if (status.state === 'pendiente') {
    const cancelWithToken = cancelHoldAction.bind(null, token);
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-amber-300 border-t-amber-700" />
        <p className="text-amber-900 text-xl font-bold mb-2">Estamos confirmando tu pago</p>
        <p className="text-amber-800 text-sm">
          Apenas Mercado Pago nos avise, tu turno queda confirmado. No cierres esta pantalla.
        </p>
        <p className="mt-4 text-amber-900 text-sm">
          El turno queda reservado para vos durante{' '}
          <span className="font-mono font-semibold tabular-nums" data-testid="countdown">
            {mm}:{ss}
          </span>
        </p>
        {status.amount !== undefined && (
          <p className="mt-1 text-amber-800 text-xs">
            Monto: ${status.amount.toLocaleString('es-AR')}
          </p>
        )}
        <form action={cancelWithToken} className="mt-5">
          <button
            type="submit"
            className="text-sm text-amber-900 underline underline-offset-2 hover:text-amber-700"
          >
            Cancelar y elegir otro horario
          </button>
          <p className="mt-1 text-xs text-amber-700">
            Si todavía no pagaste, el horario se libera al instante.
          </p>
        </form>
      </div>
    );
  }

  if (status.state === 'vencida') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 text-center">
        <p className="text-gray-800 text-xl font-bold mb-2">Se venció el tiempo para pagar</p>
        <p className="text-gray-600 text-sm">
          El turno se liberó. Si llegaste a pagar, Mercado Pago te devuelve el dinero
          automáticamente. Podés volver a elegir un horario.
        </p>
        <Link href="/" className="mt-5 inline-block text-sm text-green-700 hover:underline">
          Buscar otro turno
        </Link>
      </div>
    );
  }

  if (status.state === 'cancelada') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 text-center">
        <p className="text-gray-800 text-xl font-bold mb-2">Este turno fue cancelado</p>
        <Link href="/" className="mt-3 inline-block text-sm text-green-700 hover:underline">
          Buscar otro turno
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 text-center">
      <p className="text-gray-600 text-lg mb-3">Pago no encontrado.</p>
      <Link href="/" className="text-sm text-green-700 hover:underline">
        Volver al inicio
      </Link>
    </div>
  );
}
