export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { formatTimeMendoza, formatDateMendoza } from '@/lib/slots';
import CancelForm from './cancel-form';

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
  venue_name: string;
  venue_phone: string;
  venue_address: string;
  court_name: string;
  period_start: string;
  period_end: string;
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

  if (!booking) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center">
        <p className="text-gray-500 text-lg mb-4">Turno no encontrado.</p>
        <Link href="/" className="text-green-700 hover:underline text-sm">
          Volver al inicio
        </Link>
      </div>
    );
  }

  const periodStart = new Date(booking.period_start);
  const periodEnd   = new Date(booking.period_end);

  const startLabel = formatTimeMendoza(periodStart);
  const endLabel   = formatTimeMendoza(periodEnd);
  const dateLabel  = formatDateMendoza(periodStart);

  const debeEnCancha = booking.price_total - booking.amount_paid;

  const isConfirmed = booking.status === 'confirmed';
  const isCancelled = booking.status === 'cancelled';

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-400 mb-6">
        <Link href="/" className="hover:text-green-600">Inicio</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-700">Mi turno</span>
      </nav>

      {/* Badge de estado */}
      <div className="mb-6">
        {isConfirmed && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-4 py-1.5
            text-sm font-semibold text-green-800 border border-green-200">
            Confirmado ✓
          </span>
        )}
        {isCancelled && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-4 py-1.5
            text-sm font-semibold text-gray-600 border border-gray-200">
            Cancelado
          </span>
        )}
        {!isConfirmed && !isCancelled && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-4 py-1.5
            text-sm font-semibold text-amber-800 border border-amber-200">
            {booking.status}
          </span>
        )}
      </div>

      {/* Card con detalles */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4 mb-6">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{booking.venue_name}</h1>
          <p className="text-sm text-gray-500">{booking.venue_address}</p>
        </div>

        <div className="pt-3 border-t border-gray-100 space-y-2">
          <Row label="Cancha"   value={booking.court_name} />
          <Row label="Día"      value={<span className="capitalize">{dateLabel}</span>} />
          <Row label="Horario"  value={`${startLabel} – ${endLabel}`} />
          <Row label="A nombre" value={booking.customer_name} />
          <Row label="Teléfono" value={booking.customer_phone} />
        </div>

        {/* Precio */}
        <div className="pt-3 border-t border-gray-100">
          <p className="text-sm text-gray-700">
            <span className="font-medium">Total:</span>{' '}
            ${booking.price_total.toLocaleString('es-AR')}
          </p>
          {booking.amount_paid > 0 ? (
            <p className="text-sm text-green-700 font-medium mt-0.5">Pagado ✓</p>
          ) : (
            <p className="text-sm text-gray-500 mt-0.5">
              Pagás en la cancha: ${debeEnCancha.toLocaleString('es-AR')}
            </p>
          )}
        </div>
      </div>

      {/* Cancelación */}
      {isConfirmed && (
        <CancelForm
          cancelToken={token}
          cancelLimitHours={booking.cancel_limit_hours}
          periodStart={booking.period_start}
        />
      )}

      {isCancelled && (
        <div className="rounded-2xl bg-gray-50 border border-gray-200 p-4 text-center">
          <p className="text-gray-500 text-sm">Este turno fue cancelado.</p>
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
    <p className="text-sm text-gray-700">
      <span className="font-medium">{label}:</span>{' '}
      <span>{value}</span>
    </p>
  );
}
