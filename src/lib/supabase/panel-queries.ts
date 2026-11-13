/**
 * Queries del panel (dueño) — usan el cliente con sesión del usuario.
 * Solo devuelven datos del complejo propio.
 */
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Complejos
// ---------------------------------------------------------------------------

export async function getOwnerVenues() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("venues")
    .select("id, name, address, status, localities(name)")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    address: v.address,
    status: v.status,
    locality_name: (v.localities as { name: string } | null)?.name ?? "",
  }));
}

export async function getOwnerVenue(venueId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("id", venueId)
    .eq("owner_id", user.id)
    .single();

  if (error) return null;
  return data;
}

// ---------------------------------------------------------------------------
// Canchas
// ---------------------------------------------------------------------------

export async function getVenueCourts(venueId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("courts")
    .select("id, name, slot_minutes, active, sport_id, sports(name, slug)")
    .eq("venue_id", venueId)
    .order("name");

  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    slot_minutes: c.slot_minutes,
    active: c.active,
    sport_id: c.sport_id,
    sport_name: (c.sports as { name: string } | null)?.name ?? "",
    sport_slug: (c.sports as { slug: string } | null)?.slug ?? "",
  }));
}

export async function getCourt(courtId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("courts")
    .select(`
      id, name, slot_minutes, active, venue_id, sport_id,
      sports(name, slug),
      court_hours(id, weekday, open_time, close_time),
      court_prices(id, weekday, from_time, to_time, price)
    `)
    .eq("id", courtId)
    .single();

  if (error) return null;
  return {
    id: data.id,
    name: data.name,
    slot_minutes: data.slot_minutes,
    active: data.active,
    venue_id: data.venue_id,
    sport_id: data.sport_id,
    sport_name: (data.sports as { name: string } | null)?.name ?? "",
    hours: (data.court_hours as { id: string; weekday: number; open_time: string; close_time: string }[]) ?? [],
    prices: (data.court_prices as { id: string; weekday: number; from_time: string; to_time: string; price: number }[]) ?? [],
  };
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

export type AgendaBooking = {
  id: string;
  court_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  start: string; // ISO UTC
  end: string;   // ISO UTC
  status: string;
  booking_kind: string;
  price_total: number;
  amount_paid: number;
  payment_status: string;
  cancel_token: string | null;
};

export type AgendaCourtHour = {
  weekday: number;
  open_time: string;  // "HH:MM:SS"
  close_time: string; // "HH:MM:SS"
};

export type AgendaCourt = {
  id: string;
  name: string;
  slot_minutes: number;
  sport_name: string;
  sport_id: string;
  hours: AgendaCourtHour[];
};

export type AgendaData = {
  venueId: string;
  venueName: string;
  whatsappTemplate: string | null;
  date: string;
  courts: AgendaCourt[];
  bookings: AgendaBooking[];
};

export async function getAgendaData(venueId: string, date: string): Promise<AgendaData | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: venue } = await supabase
    .from("venues")
    .select("id, name, whatsapp_template")
    .eq("id", venueId)
    .eq("owner_id", user.id)
    .single();
  if (!venue) return null;

  const { data: rawCourts } = await supabase
    .from("courts")
    .select("id, name, slot_minutes, sport_id, sports(name), court_hours(weekday, open_time, close_time)")
    .eq("venue_id", venueId)
    .eq("active", true)
    .order("name");

  const courts: AgendaCourt[] = (rawCourts ?? []).map((c) => ({
    id:           c.id,
    name:         c.name,
    slot_minutes: c.slot_minutes,
    sport_name:   (c.sports as { name: string } | null)?.name ?? "",
    sport_id:     c.sport_id,
    hours:        (c.court_hours as AgendaCourtHour[]) ?? [],
  }));

  // Mendoza is UTC-3 year-round. The day [date] starts at 03:00 UTC and ends at 03:00 UTC next day.
  const [y, mo, d] = date.split("-").map(Number);
  const dayStart = new Date(Date.UTC(y, mo - 1, d,     3, 0, 0));
  const dayEnd   = new Date(Date.UTC(y, mo - 1, d + 1, 3, 0, 0));

  const rangeFilter = `[${dayStart.toISOString()},${dayEnd.toISOString()})`;

  const { data: rawBookings } = await supabase
    .from("bookings")
    .select("id, court_id, customer_name, customer_phone, period, status, kind, price_total, amount_paid, payment_status, cancel_token")
    .eq("venue_id", venueId)
    .filter("period", "ov", rangeFilter)
    .in("status", ["confirmed", "hold", "completed", "no_show", "cancelled"]);

  // Parse tstzrange → {start, end} ISO strings
  // PostgREST returns ranges as strings like: ["2026-11-12T11:00:00+00:00","2026-11-12T12:30:00+00:00")
  const bookings: AgendaBooking[] = (rawBookings ?? []).map((b) => {
    const rawPeriod = b.period as string;
    const inner     = rawPeriod.replace(/^[\[(]/, "").replace(/[\])]$/, "");
    const comma     = inner.indexOf(",");
    const start     = inner.slice(0, comma).trim().replace(/"/g, "");
    const end       = inner.slice(comma + 1).trim().replace(/"/g, "");
    return {
      id:             b.id,
      court_id:       b.court_id,
      customer_name:  b.customer_name,
      customer_phone: b.customer_phone,
      start,
      end,
      status:         b.status,
      booking_kind:   b.kind,
      price_total:    b.price_total ?? 0,
      amount_paid:    b.amount_paid,
      payment_status: b.payment_status,
      cancel_token:   b.cancel_token,
    };
  });

  return {
    venueId:          venue.id,
    venueName:        venue.name,
    whatsappTemplate: (venue as { whatsapp_template?: string | null }).whatsapp_template ?? null,
    date,
    courts,
    bookings,
  };
}

// ---------------------------------------------------------------------------
// Teléfonos bloqueados
// ---------------------------------------------------------------------------

export async function getBlockedPhones(venueId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // Verify ownership before returning data
  const { data: venue } = await supabase
    .from("venues")
    .select("id")
    .eq("id", venueId)
    .eq("owner_id", user.id)
    .single();
  if (!venue) return [];

  const { data, error } = await supabase
    .from("blocked_phones")
    .select("id, phone, created_at")
    .eq("venue_id", venueId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as { id: string; phone: string; created_at: string }[];
}

// Todas las canchas del complejo con sus horarios y precios (para "copiar desde otra cancha")
export async function getVenueCourtsWithSchedules(venueId: string, excludeCourtId?: string) {
  const supabase = await createClient();

  let query = supabase
    .from("courts")
    .select(`
      id, name,
      court_hours(weekday, open_time, close_time),
      court_prices(weekday, from_time, to_time, price)
    `)
    .eq("venue_id", venueId)
    .order("name");

  if (excludeCourtId) {
    query = query.neq("id", excludeCourtId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((c) => ({
    id:   c.id,
    name: c.name,
    hours: (c.court_hours as { weekday: number; open_time: string; close_time: string }[]) ?? [],
    prices: (c.court_prices as { weekday: number; from_time: string; to_time: string; price: number }[]) ?? [],
  }));
}
