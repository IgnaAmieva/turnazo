/**
 * Panel de superadmin (028). El rol se verifica en el servidor con
 * is_superadmin() (requireSuperadmin) y la base lo vuelve a verificar en cada
 * función superadmin_* y en las políticas *_superadmin_*: nunca solo en el cliente.
 */
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { VenueStatus } from '@/lib/venue-status';

type Client = Awaited<ReturnType<typeof createClient>>;

export async function isSuperadmin(supabase: Client): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_superadmin');
  if (error) {
    console.error('[admin] is_superadmin', error.code, error.message);
    return false;
  }
  return data === true;
}

/** Sin sesión → login. Con sesión pero sin rol → 404 (no se revela que existe). */
export async function requireSuperadmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!(await isSuperadmin(supabase))) notFound();
  return { supabase, user };
}

export type AdminVenueRow = {
  id: string;
  name: string;
  status: string;
  status_reason: string | null;
  status_changed_at: string | null;
  owner_id: string;
  owner_email: string | null;
  phone: string;
  locality_name: string | null;
  created_at: string;
  mp_connected: boolean;
  courts_count: number;
};

export async function getAdminVenues(supabase: Client, status: VenueStatus | null): Promise<AdminVenueRow[]> {
  const { data, error } = await supabase.rpc('superadmin_venues', { p_status: status });
  if (error) throw error;
  return (data ?? []) as AdminVenueRow[];
}

export type AdminSummary = {
  venues_by_status: Partial<Record<VenueStatus, number>>;
  bookings_7d: number;
  new_owners_7d: number;
};

export async function getAdminSummary(supabase: Client): Promise<AdminSummary> {
  const { data, error } = await supabase.rpc('superadmin_summary');
  if (error) throw error;
  const s = (data ?? {}) as Partial<AdminSummary>;
  return {
    venues_by_status: s.venues_by_status ?? {},
    bookings_7d: Number(s.bookings_7d ?? 0),
    new_owners_7d: Number(s.new_owners_7d ?? 0),
  };
}

export type AdminCourt = {
  id: string;
  name: string;
  slot_minutes: number;
  active: boolean;
  surface: string | null;
  covered: boolean;
  lit: boolean;
  format: string | null;
  notes: string | null;
  sport_name: string;
  hours: { weekday: number; open_time: string; close_time: string }[];
  prices: { weekday: number; from_time: string; to_time: string; price: number }[];
};

/** Detalle de cualquier complejo (también pendientes): políticas venues/courts_superadmin_all y *_superadmin_read. */
export async function getAdminVenueDetail(supabase: Client, venueId: string) {
  const [{ data: venue, error }, list] = await Promise.all([
    supabase
      .from('venues')
      .select('id, name, phone, address, lat, lng, status, status_reason, status_changed_at, created_at, logo_path, localities(name)')
      .eq('id', venueId)
      .maybeSingle(),
    getAdminVenues(supabase, null),
  ]);
  if (error) throw error;
  if (!venue) return null;

  const { data: courts, error: cErr } = await supabase
    .from('courts')
    .select(`id, name, slot_minutes, active, surface, covered, lit, format, notes, sports(name),
      court_hours(weekday, open_time, close_time),
      court_prices(weekday, from_time, to_time, price)`)
    .eq('venue_id', venueId)
    .order('name');
  if (cErr) throw cErr;

  const row = list.find((v) => v.id === venueId);
  return {
    ...venue,
    locality_name: (venue.localities as { name: string } | null)?.name ?? '',
    owner_email: row?.owner_email ?? null,
    mp_connected: row?.mp_connected ?? false,
    courts: (courts ?? []).map((c): AdminCourt => ({
      id: c.id, name: c.name, slot_minutes: c.slot_minutes, active: c.active,
      surface: c.surface, covered: c.covered, lit: c.lit, format: c.format, notes: c.notes,
      sport_name: (c.sports as { name: string } | null)?.name ?? '',
      hours: [...(c.court_hours ?? [])].sort((a, b) => a.weekday - b.weekday || a.open_time.localeCompare(b.open_time)),
      prices: [...(c.court_prices ?? [])]
        .map((p) => ({ ...p, price: Number(p.price) }))
        .sort((a, b) => a.weekday - b.weekday || a.from_time.localeCompare(b.from_time)),
    })),
  };
}

export type AdminVenueDetail = NonNullable<Awaited<ReturnType<typeof getAdminVenueDetail>>>;
