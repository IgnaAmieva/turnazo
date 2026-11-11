/**
 * Tests de integración para las funciones RPC de reservas:
 *   - create_booking
 *   - cancel_booking_by_token
 *   - get_booking_by_token
 *
 * Requiere variables de entorno:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !serviceKey || !anonKey) {
  throw new Error(
    'Faltan variables de entorno: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY'
  );
}

// Admin: para fixtures (bypasea RLS)
const db = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Anon: para testear los RPCs como lo haría un usuario real
const anonClient = createClient(supabaseUrl, anonKey);

// ---------------------------------------------------------------------------
// Estado de fixtures
// ---------------------------------------------------------------------------

let ownerUserId: string;
let localityId: string;
let sportId: string;
let venueId: string;
let courtId: string;

// Token de cancelación guardado entre tests
let cancelToken: string;

// ---------------------------------------------------------------------------
// Helper: slot válido mañana a las 08:00 Mendoza
// Mendoza = UTC-3, entonces 08:00 Mendoza = 11:00 UTC
// ---------------------------------------------------------------------------

function futureSlot() {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const dateStr = tomorrow.toISOString().slice(0, 10);
  const start   = new Date(`${dateStr}T11:00:00Z`);
  const end     = new Date(start.getTime() + 90 * 60 * 1000);
  return { start, end, dateStr };
}

// ---------------------------------------------------------------------------
// beforeAll: crear fixtures
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // 1. Auth user
  const { data: userData, error: userErr } = await db.auth.admin.createUser({
    email:         `test-booking-${Date.now()}@turnazo.test`,
    password:      'TestPass123!',
    email_confirm: true,
  });
  if (userErr || !userData.user) throw new Error('No se pudo crear usuario: ' + userErr?.message);
  ownerUserId = userData.user.id;

  // 2. Perfil owner
  const { error: profileErr } = await db
    .from('profiles')
    .insert({ id: ownerUserId, role: 'owner' });
  if (profileErr) throw new Error('No se pudo crear perfil: ' + profileErr.message);

  // 3. Locality tunuyan
  const { data: loc } = await db.from('localities').select('id').eq('slug', 'tunuyan').single();
  if (!loc) throw new Error("Locality 'tunuyan' no encontrada — ¿se aplicó el seed?");
  localityId = loc.id;

  // 4. Sport padel
  const { data: sport } = await db.from('sports').select('id').eq('slug', 'padel').single();
  if (!sport) throw new Error("Sport 'padel' no encontrado — ¿se aplicó el seed?");
  sportId = sport.id;

  // 5. Venue
  const { data: venue, error: venueErr } = await db
    .from('venues')
    .insert({
      owner_id:           ownerUserId,
      name:               'Test Venue Phase3',
      phone:              '2622000000',
      address:            'Test 123',
      lat:                -33.56,
      lng:                -69.00,
      locality_id:        localityId,
      status:             'approved',
      deposit_required:   false,
      allow_pay_at_venue: true,
      cancel_limit_hours: 2,
    })
    .select('id')
    .single();
  if (venueErr || !venue) throw new Error('No se pudo crear venue: ' + venueErr?.message);
  venueId = venue.id;

  // 6. Court
  const { data: court, error: courtErr } = await db
    .from('courts')
    .insert({
      venue_id:     venueId,
      sport_id:     sportId,
      name:         'Cancha A',
      slot_minutes: 90,
      active:       true,
    })
    .select('id')
    .single();
  if (courtErr || !court) throw new Error('No se pudo crear court: ' + courtErr?.message);
  courtId = court.id;

  // 7. Court hours para todos los días (0-6)
  const hoursRows = Array.from({ length: 7 }, (_, i) => ({
    court_id:   courtId,
    weekday:    i,
    open_time:  '08:00:00',
    close_time: '22:00:00',
  }));
  const { error: hoursErr } = await db.from('court_hours').insert(hoursRows);
  if (hoursErr) throw new Error('No se pudieron crear court_hours: ' + hoursErr.message);

  // 8. Court prices para todos los días (0-6)
  const priceRows = Array.from({ length: 7 }, (_, i) => ({
    court_id:  courtId,
    weekday:   i,
    from_time: '08:00:00',
    to_time:   '22:00:00',
    price:     5000,
  }));
  const { error: pricesErr } = await db.from('court_prices').insert(priceRows);
  if (pricesErr) throw new Error('No se pudieron crear court_prices: ' + pricesErr.message);
}, 30_000);

// ---------------------------------------------------------------------------
// afterAll: limpiar fixtures
// ---------------------------------------------------------------------------

afterAll(async () => {
  if (venueId)     await db.from('bookings').delete().eq('venue_id', venueId);
  if (venueId)     await db.from('venues').delete().eq('id', venueId);
  if (ownerUserId) await db.auth.admin.deleteUser(ownerUserId);
}, 30_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('create_booking', () => {
  it('creates a booking for a valid future slot', async () => {
    const { start, end } = futureSlot();

    const { data, error } = await anonClient.rpc('create_booking', {
      p_court_id:       courtId,
      p_venue_id:       venueId,
      p_start:          start.toISOString(),
      p_end:            end.toISOString(),
      p_customer_name:  'Test User',
      p_customer_phone: '2622111111',
    });

    expect(error).toBeNull();
    expect(data).toBeTruthy();

    const result = data as Record<string, unknown>;
    expect(result.error).toBeUndefined();
    expect(typeof result.cancel_token).toBe('string');
    expect((result.cancel_token as string).length).toBe(64);
    expect(result.price_total).toBe(5000);

    cancelToken = result.cancel_token as string;
  });

  it('rejects a duplicate booking (slot_taken)', async () => {
    const { start, end } = futureSlot();

    const { data, error } = await anonClient.rpc('create_booking', {
      p_court_id:       courtId,
      p_venue_id:       venueId,
      p_start:          start.toISOString(),
      p_end:            end.toISOString(),
      p_customer_name:  'Another User',
      p_customer_phone: '2622222222',
    });

    expect(error).toBeNull();
    expect((data as Record<string, unknown>).error).toBe('slot_taken');
  });

  it('rejects past slots', async () => {
    const pastStart = new Date(Date.now() - 3_600_000).toISOString();
    const pastEnd   = new Date(Date.now() - 3_600_000 + 90 * 60 * 1000).toISOString();

    const { data, error } = await anonClient.rpc('create_booking', {
      p_court_id:       courtId,
      p_venue_id:       venueId,
      p_start:          pastStart,
      p_end:            pastEnd,
      p_customer_name:  'Past User',
      p_customer_phone: '2622333333',
    });

    expect(error).toBeNull();
    expect((data as Record<string, unknown>).error).toBe('past_slot');
  });

  it('rejects phone_blocked', async () => {
    // Insertar teléfono bloqueado
    const { error: insertErr } = await db
      .from('blocked_phones')
      .insert({ venue_id: venueId, phone: '2622BLOCKED' });
    expect(insertErr).toBeNull();

    // Crear un slot diferente (el de mañana ya está tomado)
    const tomorrow2 = new Date();
    tomorrow2.setUTCDate(tomorrow2.getUTCDate() + 2);
    const dateStr2 = tomorrow2.toISOString().slice(0, 10);
    const start2 = new Date(`${dateStr2}T11:00:00Z`);
    const end2   = new Date(start2.getTime() + 90 * 60 * 1000);

    const { data, error } = await anonClient.rpc('create_booking', {
      p_court_id:       courtId,
      p_venue_id:       venueId,
      p_start:          start2.toISOString(),
      p_end:            end2.toISOString(),
      p_customer_name:  'Blocked User',
      p_customer_phone: '2622BLOCKED',
    });

    expect(error).toBeNull();
    expect((data as Record<string, unknown>).error).toBe('phone_blocked');

    // Limpiar
    await db
      .from('blocked_phones')
      .delete()
      .eq('venue_id', venueId)
      .eq('phone', '2622BLOCKED');
  });
});

describe('get_booking_by_token', () => {
  it('returns booking details', async () => {
    expect(cancelToken).toBeTruthy();

    const { data, error } = await anonClient.rpc('get_booking_by_token', {
      p_cancel_token: cancelToken,
    });

    expect(error).toBeNull();
    const result = data as Record<string, unknown>;
    expect(result.venue_name).toBe('Test Venue Phase3');
    expect(result.status).toBe('confirmed');
    expect(result.cancel_token).toBe(cancelToken);
  });
});

describe('cancel_booking_by_token', () => {
  it('cancels a booking', async () => {
    expect(cancelToken).toBeTruthy();

    const { data, error } = await anonClient.rpc('cancel_booking_by_token', {
      p_cancel_token: cancelToken,
    });

    expect(error).toBeNull();
    expect((data as Record<string, unknown>).success).toBe(true);
  });

  it('returns not_found for unknown token', async () => {
    const { data, error } = await anonClient.rpc('cancel_booking_by_token', {
      p_cancel_token: 'invalid_token_xyz',
    });

    expect(error).toBeNull();
    expect((data as Record<string, unknown>).error).toBe('not_found');
  });
});
