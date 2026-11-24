export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { getPaymentStatus } from '@/lib/payment-status';
import PaymentStatusPanel from './payment-status-panel';

/**
 * Pantalla de vuelta de Mercado Pago.
 * No se confía en nada de la URL salvo el token: el estado se lee de la base
 * al cargar y después cada pocos segundos (la confirmación real la hace el
 * webhook, Bloque 4).
 */

type Props = {
  params: Promise<{ token: string }>;
};

export default async function PagoPage({ params }: Props) {
  const { token } = await params;
  const initial = await getPaymentStatus(token);

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <nav className="text-sm text-ink-muted mb-6">
        <Link href="/" className="hover:text-ink">Inicio</Link>
        <span className="mx-2">/</span>
        <span className="text-ink">Tu pago</span>
      </nav>

      <PaymentStatusPanel token={token} initial={initial} />
    </div>
  );
}
