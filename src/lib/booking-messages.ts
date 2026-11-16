/**
 * Mensajes en español para los códigos de error que devuelven los RPC
 * create_booking / create_booking_hold y la acción de pago.
 * (Módulo aparte: los archivos "use server" solo pueden exportar funciones.)
 */

export const RPC_ERROR_MESSAGES: Record<string, string> = {
  past_slot:        'Este horario ya pasó.',
  slot_taken:       'Este turno ya fue reservado por alguien más. Por favor elegí otro horario.',
  venue_not_found:  'El complejo no fue encontrado o no está disponible.',
  court_not_found:  'La cancha no fue encontrada o no está disponible.',
  outside_hours:    'El horario elegido está fuera del horario de apertura.',
  phone_blocked:    'No podés reservar en este complejo con ese número de teléfono.',
  deposit_required: 'Este complejo requiere seña: elegí pagar la seña online.',
  pay_at_venue_not_allowed: 'Este complejo solo acepta reservas pagando online.',
  invalid_duration: 'La duración del turno no es válida para esta cancha.',
  invalid_slot:     'El horario elegido no coincide con la grilla de turnos de la cancha.',
  too_many_bookings: 'Ya tenés el máximo de turnos reservados en este complejo.',
  price_not_set:    'Esta cancha no tiene precio configurado para ese horario.',
  invalid_name:     'Ingresá tu nombre completo.',
  invalid_phone:    'Ingresá un teléfono válido.',
};

export const PAYMENT_ERROR_MESSAGES: Record<string, string> = {
  ...RPC_ERROR_MESSAGES,
  hold_limit_reached:
    'Ya tenés una reserva en proceso de pago en este complejo. Esperá unos minutos (el turno se libera solo si no se paga) e intentá de nuevo.',
  mp_not_connected:
    'Este complejo no tiene Mercado Pago conectado, así que no se puede pagar online.',
  full_payment_not_allowed:
    'Este complejo no acepta el pago total online. Elegí otra forma de pago.',
  deposit_not_configured:
    'Este complejo no tiene configurada la seña. Elegí otra forma de pago.',
  invalid_payment_type:
    'La forma de pago elegida no es válida.',
  mp_token_unavailable:
    'No pudimos acceder a la cuenta de Mercado Pago del complejo. El horario quedó libre; intentá más tarde.',
  mp_order_failed:
    'No pudimos iniciar el pago con Mercado Pago. El horario quedó libre; intentá de nuevo en unos minutos.',
};

export const GENERIC_BOOKING_ERROR = 'Error al crear la reserva. Intentá de nuevo.';
