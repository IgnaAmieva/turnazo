/**
 * Tests de integración para las funciones RPC de reservas:
 *   - create_booking (006 + 007 fixes)
 *   - cancel_booking_by_token
 *   - get_booking_by_token
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
    'Faltan variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY'
  );
}

const db         = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anonClient = createClient(supabaseUrl, anonKey);

// ---------------------------------------------------------------------------
// Estado de fixtures
// ---------------------------------------------------------------------------

let ownerUserId:         string;
let localityId:          string;
let sportId:             string;   // pádel
let sportFutbolId:       string;   // fútbol
let venueId:             string;
let courtId:             string;   // principal: pádel 90 min, 08:00-22:00

// Courts para los tests de migración 007
let midnightCourtId:     string;   // pádel 90 min, 23:00-00:30
let midnightCloseCourtId: string;  // fútbol 60 min, 14:00-00:00
let noPriceCourtId:      string;   // pádel 90 min, 08:00-22:00, sin precios

// cancelToken persiste entre tests de un mismo describe
let cancelToken: string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Slot válido mañana a las 08:00 Mendoza = 11:00 UTC */
function futureSlot() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  const dateStr = d.toISOString().slice(0, 10);
  const start   = new Date(`${dateStr}T11:00:00Z`);
  const end     = new Date(start.getTime() + 90 * 60 * 1000);
  return { start, end };
}

/** Slot N días en el futuro a las 08:00 Mendoza = 11:00 UTC */
function slotAt08(daysFromNow: number, slotMinutes = 90) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  const start = new Date(d.getTime() + 11 * 3600 * 1000); // 11:00 UTC = 08:00 Mendoza
  const end   = new Date(start.getTime() + slotMinutes * 60 * 1000);
  return { start, end };
}

/**
 * Slot a las 23:00 Mendoza (= 02:00 UTC del día siguiente UTC).
 * daysFromNow: días adelante respecto al día UTC actual.
 */
function slotAt23(daysFromNow: number, slotMinutes = 90) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  // 23:00 Mendoza del día D = 02:00 UTC del día D+1
  d.setUTCDate(d.getUTCDate() + daysFromNow + 1);
  const start = new Date(d.getTime() + 2 * 3600 * 1000); // 02:00 UTC
  const end   = new Date(start.getTime() + slotMinutes * 60 * 1000);
  return { start, end };
}

// ---------------------------------------------------------------------------
// beforeAll: fixtures
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Auth user
  const { data: userData, error: userErr } = await db.auth.admin.createUser({
    email:         `test-booking-${Date.now()}@turnazo.test`,
    password:      'TestPass123!',
    email_confirm: true,
  });
  if (userErr || !userData.user) throw new Error('No se pudo crear usuario: ' + userErr?.message);
  ownerUserId = userData.user.id;

  await db.from('profiles').insert({ id: ownerUserId, role: 'owner' });

  const { data: loc } = await db.from('localities').select('id').eq('slug', 'tunuyan').single();
  if (!loc) throw new Error("Locality 'tunuyan' no encontrada");
  localityId = loc.id;

  const { data: sport } = await db.from('sports').select('id').eq('slug', 'padel').single();
  if (!sport) throw new Error("Sport 'padel' no encontrado");
  sportId = sport.id;

  const { data: sportF } = await db.from('sports').select('id').eq('slug', 'futbol').single();
  if (!sportF) throw new Error("Sport 'futbol' no encontrado");
  sportFutbolId = sportF.id;

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

  // ── Cancha principal: pádel 90 min, 08:00-22:00 ──────────────
  const { data: court } = await db.from('courts')
    .insert({ venue_id: venueId, sport_id: sportId, name: 'Cancha A', slot_minutes: 90, active: true })
    .select('id').single();
  courtId = court!.id;

  const hours7 = (cid: string, o: string, c: string) =>
    Array.from({ length: 7 }, (_, i) => ({ court_id: cid, weekday: i, open_time: o, close_time: c }));
  const prices7 = (cid: string, f: string, t: string, p: number) =>
    Array.from({ length: 7 }, (_, i) => ({ court_id: cid, weekday: i, from_time: f, to_time: t, price: p }));

  await db.from('court_hours').insert(hours7(courtId, '08:00:00', '22:00:00'));
  await db.from('court_prices').insert(prices7(courtId, '08:00:00', '22:00:00', 5000));

  // ── Cancha noche: pádel 90 min, 23:00-00:30 (cruza medianoche) ─
  const { data: mc } = await db.from('courts')
    .insert({ venue_id: venueId, sport_id: sportId, name: 'Cancha Noche', slot_minutes: 90, active: true })
    .select('id').single();
  midnightCourtId = mc!.id;
  await db.from('court_hours').insert(hours7(midnightCourtId, '23:00:00', '00:30:00'));
  // Precio cubre inicio 23:00 (to_time 23:59 > 23:00)
  await db.from('court_prices').insert(prices7(midnightCourtId, '20:00:00', '23:59:00', 6000));

  // ── Cancha fútbol nocturna: 60 min, 14:00-00:00 ──────────────
  const { data: mcc } = await db.from('courts')
    .insert({ venue_id: venueId, sport_id: sportFutbolId, name: 'Cancha Fútbol Nocturna', slot_minutes: 60, active: true })
    .select('id').single();
  midnightCloseCourtId = mcc!.id;
  await db.from('court_hours').insert(hours7(midnightCloseCourtId, '14:00:00', '00:00:00'));
  await db.from('court_prices').insert(prices7(midnightCloseCourtId, '14:00:00', '23:59:00', 4000));

  // ── Cancha sin precio: pádel 90 min, 08:00-22:00, sin precios ─
  const { data: npc } = await db.from('courts')
    .insert({ venue_id: venueId, sport_id: sportId, name: 'Cancha Sin Precio', slot_minutes: 90, active: true })
    .select('id').single();
  noPriceCourtId = npc!.id;
  await db.from('court_hours').insert(hours7(noPriceCourtId, '08:00:00', '22:00:00'));
  // No se insertan court_prices

}, 30_000);

// ---------------------------------------------------------------------------
// afterAll: limpiar
// ---------------------------------------------------------------------------

afterAll(async () => {
  if (venueId)     await db.from('bookings').delete().eq('venue_id', venueId);
  if (venueId)     await db.from('venues').delete().eq('id', venueId);
  if (ownerUserId) await db.auth.admin.deleteUser(ownerUserId);
}, 30_000);

// ---------------------------------------------------------------------------
// Tests originales (create_booking básico)
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

  it('rejects phone_blocked (normalized digits-only phone)', async () => {
    // Insertar teléfono bloqueado (ya normalizado, solo dígitos)
    await db.from('blocked_phones').insert({ venue_id: venueId, phone: '2622000987' });

    const { start, end } = slotAt08(2);

    const { data, error } = await anonClient.rpc('create_booking', {
      p_court_id:       courtId,
      p_venue_id:       venueId,
      p_start:          start.toISOString(),
      p_end:            end.toISOString(),
      p_customer_name:  'Blocked User',
      p_customer_phone: '2622000987',
    });

    expect(error).toBeNull();
    expect((data as Record<string, unknown>).error).toBe('phone_blocked');

    await db.from('blocked_phones').delete().eq('venue_id', venueId).eq('phone', '2622000987');
  });
});

// ---------------------------------------------------------------------------
// Tests de migration 007 — 5 correcciones
// ---------------------------------------------------------------------------

describe('create_booking v2 (migration 007)', () => {

  // ── Fix 1: horarios que cruzan medianoche ───────────────────────

  it('fix1a: pádel 23:00-00:30 (slot que cruza medianoche) es válido', async () => {
    const { start, end } = slotAt23(3, 90);

    const { data, error } = await anonClient.rpc('create_booking', {
      p_court_id:       midnightCourtId,
      p_venue_id:       venueId,
      p_start:          start.toISOString(),
      p_end:            end.toISOString(),
      p_customer_name:  'Pádel Nocturno',
      p_customer_phone: '2622111000',
    });

    expect(error).toBeNull();
    const result = data as Record<string, unknown>;
    expect(result.error).toBeUndefined();
    expect(result.cancel_token).toBeTruthy();
    expect(result.price_total).toBe(6000);
  });

  it('fix1b: fútbol 23:00-00:00 (cierre a medianoche exacta) es válido', async () => {
    const { start, end } = slotAt23(3, 60);

    const { data, error } = await anonClient.rpc('create_booking', {
      p_court_id:       midnightCloseCourtId,
      p_venue_id:       venueId,
      p_start:          start.toISOString(),
      p_end:            end.toISOString(),
      p_customer_name:  'Fútbol Nocturno',
      p_customer_phone: '2622111001',
    });

    expect(error).toBeNull();
    const result = data as Record<string, unknown>;
    expect(result.error).toBeUndefined();
    expect(result.price_total).toBe(4000);
  });

  // ── Fix 2: alineación a la grilla ──────────────────────────────

  it('fix2: inicio no alineado a la grilla retorna invalid_slot', async () => {
    // 08:30 Mendoza = 11:30 UTC — no es múltiplo de 90 min desde 08:00
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + 4);
    const start = new Date(d.getTime() + (11 * 60 + 30) * 60 * 1000); // 11:30 UTC
    const end   = new Date(start.getTime() + 90 * 60 * 1000);

    const { data, error } = await anonClient.rpc('create_booking', {
      p_court_id:       courtId,
      p_venue_id:       venueId,
      p_start:          start.toISOString(),
      p_end:            end.toISOString(),
      p_customer_name:  'Grid Test',
      p_customer_phone: '2622555000',
    });

    expect(error).toBeNull();
    expect((data as Record<string, unknown>).error).toBe('invalid_slot');
  });

  // ── Fix 3: validación de nombre y teléfono en la función ───────

  it('fix3a: nombre menor a 2 caracteres retorna invalid_name', async () => {
    const { start, end } = slotAt08(5);

    const { data, error } = await anonClient.rpc('create_booking', {
      p_court_id:       courtId,
      p_venue_id:       venueId,
      p_start:          start.toISOString(),
      p_end:            end.toISOString(),
      p_customer_name:  'X',
      p_customer_phone: '2622777000',
    });

    expect(error).toBeNull();
    expect((data as Record<string, unknown>).error).toBe('invalid_name');
  });

  it('fix3b: teléfono con formato normalizado a dígitos válidos es aceptado', async () => {
    // "+54 2622-123456" → normalizado a "542622123456" (12 dígitos)
    const { start, end } = slotAt08(4);

    const { data, error } = await anonClient.rpc('create_booking', {
      p_court_id:       courtId,
      p_venue_id:       venueId,
      p_start:          start.toISOString(),
      p_end:            end.toISOString(),
      p_customer_name:  'Teléfono Formateado',
      p_customer_phone: '+54 2622-123456',
    });

    expect(error).toBeNull();
    const result = data as Record<string, unknown>;
    expect(result.error).toBeUndefined();
    expect(result.cancel_token).toBeTruthy();
  });

  // ── Fix 4: límite de abuso ──────────────────────────────────────

  it('fix4: más de 3 turnos futuros confirmados retorna too_many_bookings', async () => {
    const phone = '2622400000';
    // Crear 3 turnos confirmados en días distintos
    for (const day of [6, 7, 8]) {
      const { start, end } = slotAt08(day);
      const { data } = await anonClient.rpc('create_booking', {
        p_court_id:       courtId,
        p_venue_id:       venueId,
        p_start:          start.toISOString(),
        p_end:            end.toISOString(),
        p_customer_name:  'Abusador',
        p_customer_phone: phone,
      });
      expect((data as Record<string, unknown>).error).toBeUndefined();
    }

    // 4.º intento → debe fallar
    const { start, end } = slotAt08(9);
    const { data, error } = await anonClient.rpc('create_booking', {
      p_court_id:       courtId,
      p_venue_id:       venueId,
      p_start:          start.toISOString(),
      p_end:            end.toISOString(),
      p_customer_name:  'Abusador',
      p_customer_phone: phone,
    });

    expect(error).toBeNull();
    expect((data as Record<string, unknown>).error).toBe('too_many_bookings');
  });

  // ── Fix 5: precio obligatorio ───────────────────────────────────

  it('fix5: cancha sin precio configurado retorna price_not_set', async () => {
    const { start, end } = slotAt08(10);

    const { data, error } = await anonClient.rpc('create_booking', {
      p_court_id:       noPriceCourtId,
      p_venue_id:       venueId,
      p_start:          start.toISOString(),
      p_end:            end.toISOString(),
      p_customer_name:  'Sin Precio',
      p_customer_phone: '2622999001',
    });

    expect(error).toBeNull();
    expect((data as Record<string, unknown>).error).toBe('price_not_set');
  });
});

// ---------------------------------------------------------------------------
// get_booking_by_token
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// cancel_booking_by_token
// ---------------------------------------------------------------------------

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
