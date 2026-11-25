/**
 * Mensajes en español para los códigos de error que devuelven los RPC
 * create_booking / create_booking_hold y la acción de pago.
 * (Módulo aparte: los archivos "use server" solo pueden exportar funciones.)
 *
 * Los textos salen del catálogo lib/booking-errors.ts (mensaje + acción por código).
 */
import { bookingMessages } from '@/lib/booking-errors';

const ALL = bookingMessages();

export const RPC_ERROR_MESSAGES: Record<string, string> = ALL;
export const PAYMENT_ERROR_MESSAGES: Record<string, string> = ALL;
export const GENERIC_BOOKING_ERROR = ALL.generic;
