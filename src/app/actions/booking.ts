'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

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

// ---------------------------------------------------------------------------
// Mapeo de errores RPC → mensajes en español
// ---------------------------------------------------------------------------

const RPC_ERROR_MESSAGES: Record<string, string> = {
  past_slot:        'Este horario ya pasó.',
  slot_taken:       'Este turno ya fue reservado por alguien más. Por favor elegí otro horario.',
  venue_not_found:  'El complejo no fue encontrado o no está disponible.',
  court_not_found:  'La cancha no fue encontrada o no está disponible.',
  outside_hours:    'El horario elegido está fuera del horario de apertura.',
  phone_blocked:    'No podés reservar en este complejo con ese número de teléfono.',
  deposit_required: 'Este complejo requiere seña (disponible próximamente).',
  invalid_duration: 'La duración del turno no es válida para esta cancha.',
};

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
    return { error: RPC_ERROR_MESSAGES[code] ?? 'Error al crear la reserva. Intentá de nuevo.' };
  }

  const cancelToken = res.cancel_token as string;
  redirect('/turnos/' + cancelToken);
}

// ---------------------------------------------------------------------------
// cancelBookingAction
// ---------------------------------------------------------------------------

export type CancelActionState = {
  error?: string;
  success?: boolean;
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

  revalidatePath('/turnos/' + cancelToken);
  return { success: true };
}
