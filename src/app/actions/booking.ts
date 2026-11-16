'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { triggerPushSend } from '@/lib/push';
import { createAdminClient } from '@/lib/supabase/admin';
import { refundPayment } from '@/lib/mp/refunds';
import { RPC_ERROR_MESSAGES, GENERIC_BOOKING_ERROR } from '@/lib/booking-messages';

// ---------------------------------------------------------------------------
// Schema de validación
// ---------------------------------------------------------------------------

const BookingSchema = z.object({
  court_id:        z.string().guid(),
  venue_id:        z.string().guid(),
  start:           z.string().min(1),
  end:             z.string().min(1),
  customer_name:   z.string().trim().min(2).max(100),
  customer_phone:  z.string().min(8).max(20).regex(/^[0-9+\s\-(). ]+$/),
});

// Mensajes de error RPC → src/lib/booking-messages.ts (compartidos con el pago)

// ---------------------------------------------------------------------------
// createBookingAction — para useActionState
// ---------------------------------------------------------------------------

export type BookingActionState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

export type BoundBookingParams = {
  court_id: string;
  venue_id: string;
  start: string;
  end: string;
};

export async function createBookingAction(
  bound: BoundBookingParams,
  _prevState: BookingActionState,
  formData: FormData
): Promise<BookingActionState> {
  const raw = {
    court_id:       bound.court_id,
    venue_id:       bound.venue_id,
    start:          bound.start,
    end:            bound.end,
    customer_name:  formData.get('customer_name'),
    customer_phone: formData.get('customer_phone'),
  };

  const parsed = BookingSchema.safeParse(raw);

  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const [field, messages] of Object.entries(parsed.error.flatten().fieldErrors)) {
      fieldErrors[field] = messages as string[];
    }
    return { fieldErrors };
  }

  const data = parsed.data;

  const supabase = await createClient();

  const { data: result, error: rpcError } = await supabase.rpc('create_booking', {
    p_court_id:       data.court_id,
    p_venue_id:       data.venue_id,
    p_start:          data.start,
    p_end:            data.end,
    p_customer_name:  data.customer_name,
    p_customer_phone: data.customer_phone,
  });

  if (rpcError) {
    return { error: 'Ocurrió un error al procesar la reserva. Intentá de nuevo.' };
  }

  const res = result as Record<string, unknown>;

  if (res.error) {
    const code = res.error as string;
    return { error: RPC_ERROR_MESSAGES[code] ?? GENERIC_BOOKING_ERROR };
  }

  const cancelToken = res.cancel_token as string;
  // El RPC ya insertó en notification_outbox; disparar envío inmediato (best-effort)
  void triggerPushSend();
  redirect('/turnos/' + cancelToken);
}

// ---------------------------------------------------------------------------
// cancelBookingAction
// ---------------------------------------------------------------------------

export type CancelActionState = {
  error?: string;
  success?: boolean;
  /** 'refunded': la plata ya volvió; 'pending': la devolución falló y la reintenta el cron; 'none': sin devolución */
  refund?: 'refunded' | 'pending' | 'none';
  refundAmount?: number;
};

export async function cancelBookingAction(
  token: string,
  _prevState: unknown,
  _formData: FormData
): Promise<CancelActionState> {
  const cancelToken = token;

  if (!cancelToken) {
    return { error: 'Token inválido.' };
  }

  const supabase = await createClient();

  // La base decide: cancela (o no) y dice si corresponde devolución según
  // cancel_limit_hours y refund_policy del complejo (migración 020).
  const { data: result, error: rpcError } = await supabase.rpc('cancel_booking_by_token', {
    p_cancel_token: cancelToken,
  });

  if (rpcError) {
    return { error: 'Ocurrió un error al cancelar el turno. Intentá de nuevo.' };
  }

  const res = result as Record<string, unknown>;

  if (res.error) {
    const code = res.error as string;
    if (code === 'too_late') return { error: 'Ya no es posible cancelar este turno.' };
    if (code === 'not_found') return { error: 'Turno no encontrado o ya cancelado.' };
    return { error: 'Error al cancelar el turno.' };
  }

  let refund: CancelActionState['refund'] = 'none';
  let refundAmount = 0;

  // Devolución: la reserva ya quedó cancelada y el pago en 'refund_pending'.
  // Si el reembolso falla acá, el cron (/api/mp/refund-retry) lo reintenta.
  if (res.refund_due === true && typeof res.mp_order_id === 'string' && typeof res.mp_payment_id === 'string') {
    refundAmount = Number(res.refund_amount ?? 0);
    const r = await refundPayment(createAdminClient(), {
      bookingId:   String(res.booking_id),
      venueId:     String(res.venue_id),
      orderId:     res.mp_order_id,
      paymentId:   res.mp_payment_id,
      amount:      refundAmount,
      paymentType: res.payment_type === 'full' ? 'full' : 'deposit',
      reason:      'player_cancelled',
      source:      'player_cancel',
      markBookingRefunded: true,
    });
    refund = r.ok ? 'refunded' : 'pending';
  }

  // El RPC ya insertó en notification_outbox; disparar envío (best-effort)
  void triggerPushSend();
  revalidatePath('/turnos/' + cancelToken);
  return { success: true, refund, refundAmount };
}
