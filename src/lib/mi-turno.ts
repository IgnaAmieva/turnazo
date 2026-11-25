import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type BookingDetail = {
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

/** Reserva por su token (RPC público get_booking_by_token). */
export async function getBookingByToken(token: string): Promise<BookingDetail | null> {
  if (!token || token.length > 128) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_booking_by_token', { p_cancel_token: token });
  if (error || !data) return null;
  const d = data as Record<string, unknown>;
  if (d.error) return null;
  return d as unknown as BookingDetail;
}

/**
 * "Cómo llegar": Google Maps con el pin del complejo (lat/lng, que el RPC no
 * trae) y, si no hay pin, con el nombre y la dirección.
 */
export async function directionsUrl(token: string, b: Pick<BookingDetail, 'venue_name' | 'venue_address'>): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('bookings')
    .select('venues(lat, lng)')
    .eq('cancel_token', token)
    .maybeSingle();
  const v = data?.venues as { lat: number | null; lng: number | null } | null | undefined;
  const destination = v?.lat != null && v?.lng != null
    ? `${v.lat},${v.lng}`
    : `${b.venue_name}, ${b.venue_address}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

/** Origen del pedido (sirve igual en local, en el Preview y en producción). */
export function originFrom(h: Headers): string {
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3001';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}
