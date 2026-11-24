export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatTimeMendoza, formatDateMendoza } from '@/lib/slots';
import CancelForm from './cancel-form';
import { cancelBookingAction, type CancelActionState } from '@/app/actions/booking';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type BookingDetail = {
  id: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  price_total: number;
  amount_paid: number;
  payment_status: string;
  cancel_token: string;
  cancel_limit_hours: number;
  /** Desde migración 020 (antes de aplicarla llegan undefined) */
  refund_policy?: 'full' | 'none';
  refund_available?: boolean;
  refund_status?: string | null;
  venue_name: string;
  venue_phone: string;
  venue_address: string;
  court_name: string;
  period_start: string;
  period_end: string;
};

/** Estados que no son confirmado ni cancelado, en palabras del jugador. */
const STATUS_LABEL: Record<string, string> = {
  hold:      'Esperando el pago',
  expired:   'Vencido',
  completed: 'Jugado',
  no_show:   'No se presentó',
};

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function getBookingDetails(token: string): Promise<BookingDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_booking_by_token', {
    p_cancel_token: token,
  });
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  if (d.error) return null;
  return d as unknown as BookingDetail;
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

type Props = {
  params: Promise<{ token: string }>;
};

export default async function TurnoPage({ params }: Props) {
  const { token } = await params;
  const booking = await getBookingDetails(token);

  // Inline server action — captures token from closure so no hidden input needed
  async function cancelAction(prevState: CancelActionState, formData: FormData) {
    'use server';
    return cancelBookingAction(token, prevState, formData);
  }

  if (!booking) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center">
        <p className="text-ink-muted text-lg mb-4">Turno no encontrado.</p>
        <Link href="/" className="inline-flex min-h-11 items-center text-brand underline underline-offset-2 text-sm">
          Volver al inicio
        </Link>
      </div>
    );
  }

  const periodStart = new Date(booking.period_start);
  const periodEnd   = new Date(booking.period_end);

  const startLabel = formatTimeMendoza(periodStart);
  const endLabel   = formatTimeMendoza(periodEnd);
  const dateRaw    = formatDateMendoza(periodStart);
  const dateLabel  = dateRaw.charAt(0).toUpperCase() + dateRaw.slice(1);

  const debeEnCancha = booking.price_total - booking.amount_paid;

  const isConfirmed = booking.status === 'confirmed';
  const isCancelled = booking.status === 'cancelled';

  const paidLabel = `$${booking.amount_paid.toLocaleString('es-AR')}`;
  const refundStatus = booking.refund_status ?? null;
  const refundNote = !isCancelled || booking.amount_paid <= 0
    ? null
    : refundStatus === 'refunded' || booking.payment_status === 'refunded'
      ? `Te devolvimos ${paidLabel} por Mercado Pago.`
      : refundStatus === 'refund_pending' || refundStatus === 'refund_failed'
        ? `La devolución de ${paidLabel} está en proceso. Puede demorar unos minutos.`
        : `Lo que pagaste (${paidLabel}) no se devolvió automáticamente. Consultá con el complejo.`;

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-ink-muted mb-6">
        <Link href="/" className="inline-flex min-h-11 min-w-11 items-center justify-center hover:text-ink">Inicio</Link>
        <span className="mx-2">/</span>
        <span className="text-ink">Mi turno</span>
      </nav>

      {/* Badge de estado */}
      <div className="mb-6">
        {isConfirmed && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5
            text-sm font-extrabold text-on-accent">
            Confirmado ✓
          </span>
        )}
        {isCancelled && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-4 py-1.5
            text-sm font-semibold text-ink-muted border border-line">
            Cancelado
          </span>
        )}
        {!isConfirmed && !isCancelled && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-4 py-1.5
            text-sm font-semibold text-warning border border-warning/40">
            {STATUS_LABEL[booking.status] ?? 'En proceso'}
          </span>
        )}
      </div>

      {/* Card con detalles */}
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm space-y-4 mb-6">
        <div>
          <h1 className="text-lg font-bold text-ink">{booking.venue_name}</h1>
          <p className="text-sm text-ink-muted">{booking.venue_address}</p>
        </div>

        <div className="pt-3 border-t border-line space-y-2">
          <Row label="Cancha"   value={booking.court_name} />
          <Row label="Día"      value={dateLabel} />
          <Row label="Horario"  value={`${startLabel} – ${endLabel}`} />
          <Row label="A nombre" value={booking.customer_name} />
          <Row label="Teléfono" value={booking.customer_phone} />
        </div>

        {/* Precio */}
        <div className="pt-3 border-t border-line">
          <p className="text-sm text-ink">
            <span className="font-medium">Total:</span>{' '}
            ${booking.price_total.toLocaleString('es-AR')}
          </p>
          {booking.amount_paid > 0 ? (
            <p className="text-sm text-brand font-medium mt-0.5">
              {booking.payment_status === 'refunded'
                ? `Devuelto: ${paidLabel}`
                : booking.amount_paid >= booking.price_total
                  ? 'Pagado ✓'
                  : `Seña pagada: ${paidLabel} · Pagás en la cancha: $${debeEnCancha.toLocaleString('es-AR')}`}
            </p>
          ) : (
            <p className="text-sm text-ink-muted mt-0.5">
              Pagás en la cancha: ${debeEnCancha.toLocaleString('es-AR')}
            </p>
          )}
        </div>
      </div>

      {/* Cancelación */}
      {isConfirmed && (
        <CancelForm
          action={cancelAction}
          cancelLimitHours={booking.cancel_limit_hours}
          periodStart={booking.period_start}
          amountPaid={booking.amount_paid}
          refundPolicy={booking.refund_policy ?? 'none'}
          refundAvailable={booking.refund_available === true}
        />
      )}

      {isCancelled && (
        <div className="rounded-2xl bg-surface-2 border border-line p-4 text-center">
          <p className="text-ink-muted text-sm">Este turno fue cancelado.</p>
          {refundNote && <p className="text-ink text-sm mt-1">{refundNote}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente auxiliar
// ---------------------------------------------------------------------------

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <p className="text-sm text-ink">
      <span className="font-medium">{label}:</span>{' '}
      <span>{value}</span>
    </p>
  );
}
