/**
 * Estado real de una reserva pagada online, leído de la base por cancel_token.
 * Lo usan la pantalla de vuelta (/pago/[token]) y la acción de polling.
 * Nunca se confía en los parámetros con los que Mercado Pago redirige.
 *
 * Usa service_role porque el anon no puede leer bookings y el RPC
 * get_booking_by_token no devuelve hold_expires_at. Solo corre en el servidor
 * y solo devuelve estado, nunca datos personales.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export type PaymentState =
  | "confirmada"
  | "pendiente"
  | "vencida"
  | "cancelada"
  | "no_encontrada";

export type PaymentStatus = {
  state: PaymentState;
  /** Solo en "pendiente": hasta cuándo vale el hold (ISO) */
  expiresAt?: string;
  /** Solo en "pendiente": cuánto se está cobrando */
  amount?: number;
};

export async function getPaymentStatus(token: string): Promise<PaymentStatus> {
  if (!token || token.length > 128) return { state: "no_encontrada" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select("status, hold_expires_at, deposit_amount, mp_order_id")
    .eq("cancel_token", token)
    .maybeSingle();

  if (error || !data) return { state: "no_encontrada" };

  switch (data.status) {
    case "confirmed":
    case "completed":
    case "no_show":
      return { state: "confirmada" };
    case "cancelled":
      return { state: "cancelada" };
    case "hold": {
      const expiresAt = data.hold_expires_at ? new Date(data.hold_expires_at).getTime() : 0;
      if (expiresAt > Date.now()) {
        return {
          state: "pendiente",
          expiresAt: new Date(expiresAt).toISOString(),
          amount: data.deposit_amount ?? undefined,
        };
      }
      return { state: "vencida" };
    }
    case "expired":
    default:
      return { state: "vencida" };
  }
}
