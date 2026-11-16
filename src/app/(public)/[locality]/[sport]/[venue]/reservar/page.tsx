export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getLocalityBySlug,
  getSportBySlug,
  getVenueWithCourts,
} from '@/lib/supabase/queries';
import { formatTimeMendoza, formatDateMendoza, weekdayInMendoza } from '@/lib/slots';
import BookingForm, { type PaymentOption } from './booking-form';
import { createBookingAction, type BookingActionState } from '@/app/actions/booking';
import { startPaymentAction } from '@/app/actions/payment';

type Props = {
  params: Promise<{ locality: string; sport: string; venue: string }>;
  searchParams: Promise<{
    cancha?: string;
    inicio?: string;
    fin?: string;
    fecha?: string;
  }>;
};

export default async function ReservarPage({ params, searchParams }: Props) {
  const { locality: lSlug, sport: sSlug, venue: venueId } = await params;
  const { cancha, inicio, fin, fecha } = await searchParams;

  // Validar que todos los parámetros estén presentes
  if (!cancha || !inicio || !fin || !fecha) notFound();

  // Validar formato de fecha
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) notFound();

  // Parsear fechas
  const startDate = new Date(inicio);
  const endDate   = new Date(fin);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) notFound();

  // Cargar datos en paralelo
  const [locality, sport, venue] = await Promise.all([
    getLocalityBySlug(lSlug),
    getSportBySlug(sSlug),
    getVenueWithCourts(venueId, sSlug),
  ]);

  if (!locality || !sport || !venue) notFound();

  // Encontrar la cancha
  const court = venue.courts.find((c) => c.id === cancha);
  if (!court) notFound();

  // Calcular precio a mostrar
  const dow = weekdayInMendoza(fecha);
  const startHour = formatTimeMendoza(startDate); // "HH:MM"
  const startTimeStr = startHour + ':00';

  const priceEntry = court.prices.find((p) => {
    if (p.weekday !== dow) return false;
    return p.from_time <= startTimeStr && p.to_time > startTimeStr;
  });

  const displayPrice = priceEntry?.price ?? null;

  // Opciones de pago habilitadas por el complejo. Los montos que se muestran
  // son orientativos: el monto real lo calcula create_booking_hold en la base.
  const paymentOptions: PaymentOption[] = [];
  if (venue.deposit_required) {
    let depositAmount: number | null = null;
    if (displayPrice !== null && venue.deposit_value !== null) {
      depositAmount = venue.deposit_type === 'percent'
        ? Math.round(displayPrice * venue.deposit_value / 100)
        : Math.min(venue.deposit_value, displayPrice);
    }
    paymentOptions.push({
      value: 'deposit',
      label: 'Pagar la seña online',
      detail: 'El resto lo pagás en el lugar.',
      amount: depositAmount,
    });
  }
  if (venue.allow_full_payment) {
    paymentOptions.push({
      value: 'full',
      label: 'Pagar el total online',
      detail: 'Pagás todo ahora con Mercado Pago.',
      amount: displayPrice,
    });
  }
  if (venue.allow_pay_at_venue) {
    paymentOptions.push({
      value: 'venue',
      label: 'Pagar en el lugar',
      detail: 'Reservás ahora y pagás cuando vas a jugar.',
      amount: displayPrice,
    });
  }

  // Labels de fecha y hora
  const startLabel = formatTimeMendoza(startDate);
  const endLabel   = formatTimeMendoza(endDate);
  const dateLabel  = formatDateMendoza(startDate);

  const isPast = startDate <= new Date();

  // Inline server action — captures slot params via closure (Next.js serializes them)
  async function bookingAction(prevState: BookingActionState, formData: FormData) {
    'use server';
    const bound = { court_id: cancha!, venue_id: venue!.id, start: inicio!, end: fin! };
    const option = formData.get('payment_option');
    if (option === 'deposit' || option === 'full') {
      return startPaymentAction({ ...bound, payment_type: option }, prevState, formData);
    }
    // "Pagar en el lugar" (o sin opción): reserva sin pago previo. Si el
    // complejo no lo permite, create_booking lo rechaza en la base.
    return createBookingAction(bound, prevState, formData);
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-400 mb-6 flex flex-wrap gap-1 items-center">
        <Link href="/" className="hover:text-green-600">Inicio</Link>
        <span>/</span>
        <Link href={`/${lSlug}`} className="hover:text-green-600">{locality.name}</Link>
        <span>/</span>
        <Link href={`/${lSlug}/${sSlug}`} className="hover:text-green-600">{sport.name}</Link>
        <span>/</span>
        <Link href={`/${lSlug}/${sSlug}/${venueId}`} className="hover:text-green-600">{venue.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Reservar</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-900 mb-5">Confirmar reserva</h1>

      {/* Resumen del turno */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm mb-6">
        <p className="font-semibold text-gray-900 text-lg">{venue.name}</p>
        <p className="text-gray-500 text-sm mt-0.5">{venue.address}</p>
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
          <p className="text-sm text-gray-700">
            <span className="font-medium">Cancha:</span> {court.name}
          </p>
          <p className="text-sm text-gray-700 capitalize">
            <span className="font-medium">Día:</span> {dateLabel}
          </p>
          <p className="text-sm text-gray-700">
            <span className="font-medium">Horario:</span> {startLabel} – {endLabel}
          </p>
          <p className="text-sm text-gray-700">
            <span className="font-medium">Precio:</span>{' '}
            {displayPrice !== null
              ? `$${displayPrice.toLocaleString('es-AR')}`
              : <span className="text-gray-400 italic">Consultar precio</span>}
          </p>
        </div>
      </div>

      {/* Estado: horario pasado */}
      {isPast ? (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5 text-center">
          <p className="text-amber-800 font-medium mb-3">Este horario ya pasó.</p>
          <Link
            href={`/${lSlug}/${sSlug}/${venueId}`}
            className="text-sm text-green-700 hover:underline"
          >
            Volver al complejo
          </Link>
        </div>
      ) : paymentOptions.length === 0 ? (
        /* No debería pasar (la base exige al menos una forma de pago) */
        <div className="rounded-2xl bg-blue-50 border border-blue-200 p-5">
          <p className="text-blue-800 font-medium">
            Este complejo no tiene habilitada ninguna forma de pago por ahora.
          </p>
        </div>
      ) : (
        /* Formulario de reserva */
        <BookingForm action={bookingAction} options={paymentOptions} />
      )}
    </div>
  );
}
