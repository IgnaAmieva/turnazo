'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getMpToken } from '@/lib/mp/token';
import { createMpOrder, cancelMpOrder } from '@/lib/mp/orders';
import { processMpOrder } from '@/lib/mp/process-order';
import { getPaymentStatus, type PaymentStatus } from '@/lib/payment-status';
import { PAYMENT_ERROR_MESSAGES, GENERIC_BOOKING_ERROR } from '@/lib/booking-messages';
import { APP_TIMEZONE } from '@/lib/constants';
import type { BookingActionState } from '@/app/actions/booking';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const PaymentSchema = z.object({
  court_id:        z.string().guid(),
  venue_id:        z.string().guid(),
  start:           z.string().min(1),
  end:             z.string().min(1),
  payment_type:    z.enum(['deposit', 'full']),
  customer_name:   z.string().trim().min(2).max(100),
  customer_phone:  z.string().min(8).max(20).regex(/^[0-9+\s\-(). ]+$/),
  // Checkout Pro exige payer.email: ahí Mercado Pago manda el comprobante.
  customer_email:  z.email({ message: 'Ingresá un email válido: ahí te llega el comprobante del pago.' }).max(254),
});

export type BoundPaymentParams = {
  court_id: string;
  venue_id: string;
  start: string;
  end: string;
  payment_type: 'deposit' | 'full';
};

/** El hold y la orden de MP vencen juntos. Debe coincidir con create_booking_hold (10 min). */
const HOLD_DURATION_ISO = 'PT10M';

// ---------------------------------------------------------------------------
// startPaymentAction — crea el hold, la orden en MP y redirige al checkout
// ---------------------------------------------------------------------------

export async function startPaymentAction(
  bound: BoundPaymentParams,
  _prevState: BookingActionState,
  formData: FormData
): Promise<BookingActionState> {
  const parsed = PaymentSchema.safeParse({
    court_id:       bound.court_id,
    venue_id:       bound.venue_id,
    start:          bound.start,
    end:            bound.end,
    payment_type:   bound.payment_type,
    customer_name:  formData.get('customer_name'),
    customer_phone: formData.get('customer_phone'),
    customer_email: String(formData.get('customer_email') ?? '').trim().toLowerCase(),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
      fieldErrors[field] = messages as string[];
    }
    return { fieldErrors };
  }

  const data = parsed.data;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    console.error('[pago] falta NEXT_PUBLIC_APP_URL');
    return { error: PAYMENT_ERROR_MESSAGES.mp_order_failed };
  }

  // 1. Hold en la base: valida todo y calcula el monto. Si el jugador toca dos
  //    veces, el segundo intento devuelve hold_limit_reached o slot_taken:
  //    nunca hay dos holds (ni dos órdenes) para el mismo intento.
  const supabase = await createClient();
  const { data: result, error: rpcError } = await supabase.rpc('create_booking_hold', {
    p_court_id:       data.court_id,
    p_venue_id:       data.venue_id,
    p_start:          data.start,
    p_end:            data.end,
    p_customer_name:  data.customer_name,
    p_customer_phone: data.customer_phone,
    p_payment_type:   data.payment_type,
  });

  if (rpcError) {
    console.error('[pago] create_booking_hold:', rpcError.message);
    return { error: 'Ocurrió un error al procesar la reserva. Intentá de nuevo.' };
  }

  const res = result as Record<string, unknown>;

  if (res.error) {
    const code = res.error as string;
    return { error: PAYMENT_ERROR_MESSAGES[code] ?? GENERIC_BOOKING_ERROR };
  }

  const bookingId   = res.booking_id as string;
  const cancelToken = res.cancel_token as string;
  // El monto sale SIEMPRE de la base (amount_to_pay), nunca del formulario.
  const amount      = Number(res.amount_to_pay);

  if (!bookingId || !cancelToken || !Number.isFinite(amount) || amount <= 0) {
    // No se loguea la respuesta completa: trae cancel_token.
    const missing = !bookingId ? 'booking_id' : !cancelToken ? 'cancel_token' : 'amount_to_pay';
    console.error('[pago] respuesta inválida de create_booking_hold', { booking_id: bookingId ?? null, missing });
    await expireHold(bookingId);
    return { error: PAYMENT_ERROR_MESSAGES.mp_order_failed };
  }

  // 2. Token del dueño (OAuth). Sin token no hay cobro: liberar el horario.
  const token = await getMpToken(data.venue_id);
  if (!token) {
    await expireHold(bookingId);
    return { error: PAYMENT_ERROR_MESSAGES.mp_token_unavailable };
  }

  // 3. Orden en Mercado Pago con el token del dueño, sin comisión de plataforma.
  const order = await createMpOrder({
    accessToken:       token.accessToken,
    idempotencyKey:    bookingId,
    externalReference: bookingId,
    amount,
    title:             data.payment_type === 'deposit' ? 'Seña de turno' : 'Pago de turno',
    payerEmail:        data.customer_email,
    payerName:         data.customer_name,
    backUrl:           `${appUrl.replace(/\/$/, '')}/pago/${cancelToken}`,
    expiresIn:         HOLD_DURATION_ISO,
  });

  if (!order.ok) {
    console.error('[pago] no se pudo crear la orden MP:', order.status, order.code, order.message);
    await expireHold(bookingId);
    return { error: PAYMENT_ERROR_MESSAGES.mp_order_failed };
  }

  // 4. Guardar mp_order_id en la reserva (solo si sigue en hold).
  const admin = createAdminClient();
  const { error: updError, count } = await admin
    .from('bookings')
    .update({ mp_order_id: order.orderId }, { count: 'exact' })
    .eq('id', bookingId)
    .eq('status', 'hold');

  if (updError || count === 0) {
    // La orden existe en MP pero no quedó asociada: liberar el horario.
    // Si el jugador llegara a pagarla, el webhook la encuentra por
    // external_reference, ve la reserva vencida y la reembolsa.
    console.error('[pago] no se pudo guardar mp_order_id', bookingId, order.orderId, updError?.message);
    await expireHold(bookingId);
    return { error: PAYMENT_ERROR_MESSAGES.mp_order_failed };
  }

  redirect(order.checkoutUrl);
}

/** Libera el horario: pasa el hold a 'expired' (solo si todavía está en hold). */
async function expireHold(bookingId: string | undefined) {
  if (!bookingId) return;
  const admin = createAdminClient();
  const { error } = await admin
    .from('bookings')
    .update({ status: 'expired' })
    .eq('id', bookingId)
    .eq('status', 'hold');
  if (error) {
    console.error('[pago] no se pudo expirar el hold', bookingId, error.message);
  }
}

// ---------------------------------------------------------------------------
// getPaymentStatusAction — polling desde la pantalla de vuelta
// ---------------------------------------------------------------------------

export async function getPaymentStatusAction(token: string): Promise<PaymentStatus> {
  return getPaymentStatus(token);
}

// ---------------------------------------------------------------------------
// reconcilePaymentAction — la pantalla /pago consulta la orden en MP
// ---------------------------------------------------------------------------

/**
 * Cada ~15 s, mientras el pago está pendiente, usa la misma lógica del webhook
 * (processMpOrder) para consultar la orden en Mercado Pago y confirmar la
 * reserva si ya se pagó. Cubre el caso en que el webhook se demora o no llega.
 * Siempre devuelve el estado real de la reserva en la base.
 */
export async function reconcilePaymentAction(token: string): Promise<PaymentStatus> {
  if (!token || token.length > 128) return { state: 'no_encontrada' };

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from('bookings')
    .select('id, status, mp_order_id')
    .eq('cancel_token', token)
    .maybeSingle();

  if (booking && booking.status === 'hold' && booking.mp_order_id) {
    try {
      await processMpOrder(booking.mp_order_id, 'reconcile');
    } catch (err) {
      console.error('[pago] reconcile failed', booking.id, err instanceof Error ? err.message : err);
    }
  }

  return getPaymentStatus(token);
}

// ---------------------------------------------------------------------------
// cancelHoldAction — "Cancelar y elegir otro horario"
// ---------------------------------------------------------------------------

/**
 * El jugador se arrepintió en Mercado Pago: libera el hold ahora (solo si
 * sigue en hold y el token coincide) en vez de dejarlo bloqueado 10 minutos
 * por hold_limit_reached, y lo lleva de vuelta a la pantalla de reserva del
 * mismo complejo/cancha/horario.
 */
export async function cancelHoldAction(token: string): Promise<void> {
  if (!token || token.length > 128) redirect('/');

  const admin = createAdminClient();
  const { data: booking } = await admin
    .from('bookings')
    .select('id, status, venue_id, court_id, period, mp_order_id')
    .eq('cancel_token', token)
    .maybeSingle();

  if (!booking) redirect('/');

  if (booking.status === 'hold') {
    const { error } = await admin
      .from('bookings')
      .update({ status: 'expired' })
      .eq('id', booking.id)
      .eq('status', 'hold');
    if (error) console.error('[pago] no se pudo cancelar el hold', booking.id, error.message);

    // Best-effort: cancelar la orden en MP para que no se pueda pagar después.
    // Si igual se paga (orden ya en proceso), el webhook la reembolsa.
    if (booking.mp_order_id) {
      const mpToken = await getMpToken(booking.venue_id);
      if (mpToken) {
        const res = await cancelMpOrder(mpToken.accessToken, booking.mp_order_id, `cancel-${booking.id}`);
        if (!res.ok) console.warn('[pago] no se pudo cancelar la orden MP', booking.id, res.status, res.code);
      }
    }
  }

  redirect(await reservarUrl(booking.venue_id, booking.court_id, booking.period as string));
}

/** Arma /{localidad}/{deporte}/{venue}/reservar?cancha=&inicio=&fin=&fecha= a partir de la reserva. */
async function reservarUrl(venueId: string, courtId: string, period: string): Promise<string> {
  const admin = createAdminClient();
  const [{ data: venue }, { data: court }] = await Promise.all([
    admin.from('venues').select('localities(slug)').eq('id', venueId).maybeSingle(),
    admin.from('courts').select('sports(slug)').eq('id', courtId).maybeSingle(),
  ]);
  const localitySlug = (venue?.localities as { slug: string } | null)?.slug;
  const sportSlug    = (court?.sports as { slug: string } | null)?.slug;
  if (!localitySlug || !sportSlug) return '/';

  // tstzrange: ["2026-11-12T11:00:00+00:00","2026-11-12T12:30:00+00:00")
  const inner = period.replace(/^[\[(]/, '').replace(/[\])]$/, '');
  const comma = inner.indexOf(',');
  const start = new Date(inner.slice(0, comma).trim().replace(/"/g, ''));
  const end   = new Date(inner.slice(comma + 1).trim().replace(/"/g, ''));
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return `/${localitySlug}/${sportSlug}/${venueId}`;

  const fecha = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(start);

  const qs = new URLSearchParams({
    cancha: courtId,
    inicio: start.toISOString(),
    fin:    end.toISOString(),
    fecha,
  });
  return `/${localitySlug}/${sportSlug}/${venueId}/reservar?${qs.toString()}`;
}
