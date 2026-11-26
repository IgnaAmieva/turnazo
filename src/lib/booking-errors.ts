/**
 * Catálogo de errores de la reserva (create_booking, create_booking_hold, la
 * acción de pago y los límites de S2): para cada código, un mensaje corto y
 * qué puede hacer el jugador. Es la única fuente de los textos: de acá salen
 * los mensajes que devuelven las server actions (lib/booking-messages.ts) y el
 * formulario usa el mismo catálogo para elegir el botón.
 *
 * tests/integration/booking-errors.test.ts verifica que todo código que puede
 * devolver la base o la acción de pago esté acá.
 */

export type BookingErrorAction =
  /** Terminal: el turno no se puede reservar → "Ver otros horarios" reemplaza a Confirmar. */
  | { kind: 'other_times' }
  /** Hay que corregir un campo: se marca el campo con el mensaje; Confirmar sigue. */
  | { kind: 'field'; field: 'customer_name' | 'customer_phone' }
  /** Terminal sin reintento: solo el mensaje (sin Confirmar). */
  | { kind: 'none' }
  /** Esperar y probar de nuevo: Confirmar sigue. */
  | { kind: 'wait' }
  /** Falló Mercado Pago: "Pagar en el lugar" si el complejo lo permite; si no, reintentar. */
  | { kind: 'pay_at_venue_or_retry' }
  /** Elegir otra forma de pago: Confirmar sigue. */
  | { kind: 'change_payment' }
  /** Error pasajero: Confirmar sigue para reintentar. */
  | { kind: 'retry' };

export type BookingError = { code: string; message: string; action: BookingErrorAction };

const OTHER_TIMES = { kind: 'other_times' } as const;

const CATALOG: Record<string, { message: string; action: BookingErrorAction; aliases?: string[] }> = {
  // El turno ya no se puede reservar
  slot_taken:      { message: 'Este turno ya fue reservado. Elegí otro horario.', action: OTHER_TIMES },
  past_slot:       { message: 'Este horario ya pasó.', action: OTHER_TIMES },
  too_far_ahead:   { message: 'Solo se puede reservar hasta 30 días adelante.', action: OTHER_TIMES },
  invalid_slot:    { message: 'Ese horario ya no está disponible.', action: OTHER_TIMES },
  invalid_duration:{ message: 'Ese turno ya no está disponible para esta cancha.', action: OTHER_TIMES },
  invalid_period:  { message: 'Ese horario no es válido.', action: OTHER_TIMES },
  outside_hours:   { message: 'Ese horario está fuera del horario del complejo.', action: OTHER_TIMES },

  // Datos del jugador
  invalid_name:    { message: 'Escribí tu nombre y apellido.', action: { kind: 'field', field: 'customer_name' } },
  invalid_phone:   {
    message: 'Revisá el celular: código de área y número, sin 0 ni 15. Ej: 2622 123456.',
    action: { kind: 'field', field: 'customer_phone' },
  },

  // No se puede seguir (sin reintento)
  phone_blocked:     { message: 'Este número no puede reservar en este complejo. Consultá con el complejo.', action: { kind: 'none' } },
  too_many_bookings: { message: 'Ya tenés 3 turnos por jugar en este complejo. Vas a poder reservar otro después de jugar uno.', action: { kind: 'none' } },
  venue_not_found:   { message: 'Este complejo no está disponible ahora.', action: { kind: 'none' } },
  court_not_found:   { message: 'Esta cancha no está disponible ahora.', action: { kind: 'none' } },
  price_not_set:     { message: 'Este turno no tiene precio cargado. Consultá con el complejo.', action: { kind: 'none' } },

  // Esperar
  hold_limit_reached: { message: 'Ya tenés un pago en curso en este complejo. Terminalo o esperá 10 minutos.', action: { kind: 'wait' } },
  // Límites de S2 (lib/abuse.ts): por IP en una hora, por teléfono en un día
  too_many_attempts:  { message: 'Hiciste demasiados intentos. Esperá un rato y probá de nuevo.', action: { kind: 'wait' } },

  // Captcha (S2, lib/turnstile.ts): el servidor siempre verifica el token
  captcha_failed:      { message: 'No pudimos verificar que no seas un robot. Probá de nuevo.', action: { kind: 'retry' } },
  // Cloudflare no respondió (ya se reintentó una vez): no es culpa del jugador, puede volver a tocar
  captcha_unavailable: { message: 'No pudimos hacer la verificación en este momento. Probá de nuevo en unos segundos.', action: { kind: 'retry' } },

  // Forma de pago
  deposit_required:         { message: 'Este complejo pide seña: elegí "Pagar la seña online".', action: { kind: 'change_payment' } },
  pay_at_venue_not_allowed: { message: 'Este complejo solo acepta pago online.', action: { kind: 'change_payment' } },
  full_payment_not_allowed: { message: 'Este complejo no acepta el pago total online. Elegí otra opción.', action: { kind: 'change_payment' } },
  deposit_not_configured:   { message: 'Este complejo no tiene la seña configurada. Elegí otra opción.', action: { kind: 'change_payment' } },
  invalid_payment_type:     { message: 'Elegí una forma de pago.', action: { kind: 'change_payment' } },

  // Mercado Pago
  mp_not_connected:     { message: 'Este complejo no tiene Mercado Pago conectado.', action: { kind: 'pay_at_venue_or_retry' } },
  mp_token_unavailable: { message: 'No pudimos acceder a la cuenta de Mercado Pago del complejo. El turno quedó libre.', action: { kind: 'pay_at_venue_or_retry' } },
  mp_order_failed:      { message: 'No pudimos iniciar el pago con Mercado Pago. El turno quedó libre.', action: { kind: 'pay_at_venue_or_retry' } },
  // Falló el pago y además no se pudo liberar el hold: el turno sigue apartado a su nombre
  // hasta que venza; ofrecer "Pagar en el lugar" daría "turno ya reservado" (por su propio hold).
  mp_hold_not_released: { message: 'No pudimos iniciar el pago. El turno queda apartado a tu nombre 10 minutos: probá de nuevo después.', action: { kind: 'wait' } },

  // Cualquier otro
  generic: {
    message: 'No pudimos hacer la reserva. Probá de nuevo.',
    action: { kind: 'retry' },
    aliases: ['Ocurrió un error al procesar la reserva. Intentá de nuevo.'],
  },
};

export const BOOKING_ERROR_CODES = Object.keys(CATALOG);

export function bookingError(code: string): BookingError {
  const e = CATALOG[code] ?? CATALOG.generic;
  return { code: CATALOG[code] ? code : 'generic', message: e.message, action: e.action };
}

/** Mensaje que devolvió una server action → error del catálogo (desconocido = genérico). */
export function bookingErrorFromMessage(message: string): BookingError {
  for (const [code, e] of Object.entries(CATALOG)) {
    if (e.message === message || e.aliases?.includes(message)) return bookingError(code);
  }
  return { ...bookingError('generic'), message };
}

/** code → mensaje, para las server actions. */
export function bookingMessages(): Record<string, string> {
  return Object.fromEntries(Object.entries(CATALOG).map(([code, e]) => [code, e.message]));
}
