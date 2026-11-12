/**
 * Queries públicas (lado servidor) — usan el cliente anon con RLS.
 * Ninguna devuelve datos personales de reservas.
 */
import { createClient } from "@/lib/supabase/server";
import { cache } from "react";

// ---------------------------------------------------------------------------
// Localidades
// ---------------------------------------------------------------------------

export const getLocalities = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("localities")
    .select("id, name, slug")
    .order("name");
  if (error) throw error;
  return data;
});

export const getLocalityBySlug = cache(async (slug: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("localities")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();
  if (error) return null;
  return data;
});

// ---------------------------------------------------------------------------
// Deportes
// ---------------------------------------------------------------------------

export const getSports = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sports")
    .select("id, name, slug, default_slot_minutes")
    .order("name");
  if (error) throw error;
  return data;
});

export const getSportBySlug = cache(async (slug: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sports")
    .select("id, name, slug, default_slot_minutes")
    .eq("slug", slug)
    .single();
  if (error) return null;
  return data;
});

// ---------------------------------------------------------------------------
// Complejos (venues)
// ---------------------------------------------------------------------------

/**
 * Devuelve complejos aprobados de una localidad que tengan canchas activas
 * del deporte solicitado, con la cantidad de canchas de ese deporte.
 */
export async function getVenuesByLocalityAndSport(
  localitySlug: string,
  sportSlug: string
) {
  const supabase = await createClient();

  // Resolvemos los IDs primero
  const [locality, sport] = await Promise.all([
    getLocalityBySlug(localitySlug),
    getSportBySlug(sportSlug),
  ]);
  if (!locality || !sport) return [];

  const { data, error } = await supabase
    .from("venues")
    .select(
      `id, name, address, lat, lng, phone, payment_alias, payment_link,
       courts!inner(id, sport_id, active)`
    )
    .eq("locality_id", locality.id)
    .eq("status", "approved")
    .eq("courts.sport_id", sport.id)
    .eq("courts.active", true);

  if (error) throw error;

  // Deduplicamos venues y contamos canchas
  const map = new Map<
    string,
    { id: string; name: string; address: string; lat: number; lng: number; phone: string; payment_alias: string | null; payment_link: string | null; courtCount: number }
  >();

  for (const v of data ?? []) {
    if (!map.has(v.id)) {
      map.set(v.id, {
        id: v.id,
        name: v.name,
        address: v.address,
        lat: v.lat,
        lng: v.lng,
        phone: v.phone,
        payment_alias: v.payment_alias,
        payment_link: v.payment_link,
        courtCount: 0,
      });
    }
    // Contar las canchas del deporte
    const courts = (v as { courts: { id: string }[] }).courts;
    map.get(v.id)!.courtCount += courts.length;
  }

  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Detalle de complejo con canchas
// ---------------------------------------------------------------------------

export type VenueWithCourts = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string;
  payment_alias: string | null;
  payment_link: string | null;
  deposit_required: boolean;
  allow_full_payment: boolean;
  allow_pay_at_venue: boolean;
  courts: CourtWithSchedule[];
};

export type CourtWithSchedule = {
  id: string;
  name: string;
  slot_minutes: number;
  sport_id: string;
  hours: { weekday: number; open_time: string; close_time: string }[];
  prices: { weekday: number; from_time: string; to_time: string; price: number }[];
};

export async function getVenueWithCourts(
  venueId: string,
  sportSlug: string
): Promise<VenueWithCourts | null> {
  const supabase = await createClient();

  const sport = await getSportBySlug(sportSlug);
  if (!sport) return null;

  const { data: venue, error: venueErr } = await supabase
    .from("venues")
    .select(
      `id, name, address, lat, lng, phone,
       payment_alias, payment_link,
       deposit_required, allow_full_payment, allow_pay_at_venue`
    )
    .eq("id", venueId)
    .eq("status", "approved")
    .single();

  if (venueErr || !venue) return null;

  const { data: courts, error: courtsErr } = await supabase
    .from("courts")
    .select(
      `id, name, slot_minutes, sport_id,
       court_hours(weekday, open_time, close_time),
       court_prices(weekday, from_time, to_time, price)`
    )
    .eq("venue_id", venueId)
    .eq("sport_id", sport.id)
    .eq("active", true)
    .order("name");

  if (courtsErr) throw courtsErr;

  return {
    ...venue,
    courts: (courts ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      slot_minutes: c.slot_minutes,
      sport_id: c.sport_id,
      hours: (c.court_hours as { weekday: number; open_time: string; close_time: string }[]) ?? [],
      prices: (c.court_prices as { weekday: number; from_time: string; to_time: string; price: number }[]) ?? [],
    })),
  };
}

// ---------------------------------------------------------------------------
// Disponibilidad (períodos ocupados) vía RPC pública
// ---------------------------------------------------------------------------

export async function getCourtAvailability(
  courtId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ period: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_court_availability", {
    p_court_id: courtId,
    p_from: dateFrom,
    p_to: dateTo,
  });
  if (error) throw error;
  return (data ?? []) as { period: string }[];
}

// ---------------------------------------------------------------------------
// Venue counts (para home page y página de deportes)
// ---------------------------------------------------------------------------

/** Localidades con conteo de venues aprobados */
export async function getLocalitiesWithVenueCount() {
  const supabase = await createClient();

  const [{ data: localities }, { data: venueRows }] = await Promise.all([
    supabase.from("localities").select("id, name, slug").order("name"),
    supabase.from("venues").select("locality_id").eq("status", "approved"),
  ]);

  const countMap = new Map<string, number>();
  for (const v of venueRows ?? []) {
    countMap.set(v.locality_id, (countMap.get(v.locality_id) ?? 0) + 1);
  }

  return (localities ?? []).map((l) => ({
    ...l,
    venueCount: countMap.get(l.id) ?? 0,
  }));
}

/** Deportes con conteo de venues aprobados en una localidad */
export async function getSportsWithVenueCount(localityId: string) {
  const supabase = await createClient();

  const [{ data: sports }, { data: venueRows }] = await Promise.all([
    supabase.from("sports").select("id, name, slug, default_slot_minutes").order("name"),
    supabase
      .from("venues")
      .select("id, courts!inner(sport_id)")
      .eq("locality_id", localityId)
      .eq("status", "approved"),
  ]);

  // Contar venues únicos por deporte
  const countMap = new Map<string, Set<string>>();
  for (const v of venueRows ?? []) {
    for (const c of (v.courts as { sport_id: string }[]) ?? []) {
      if (!countMap.has(c.sport_id)) countMap.set(c.sport_id, new Set());
      countMap.get(c.sport_id)!.add(v.id);
    }
  }

  return (sports ?? []).map((s) => ({
    ...s,
    venueCount: countMap.get(s.id)?.size ?? 0,
  }));
}
