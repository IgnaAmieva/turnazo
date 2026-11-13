/**
 * Tests de integración para push notifications:
 *   - create_booking (v4) deja fila en notification_outbox
 *   - el booking existe incluso si el envío push falla
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
// Fixtures
// ---------------------------------------------------------------------------

let ownerUserId: string;
let venueId: string;
let courtId: string;

function slotAt08(daysFromNow: number) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  const start = new Date(d.getTime() + 11 * 3600 * 1000); // 11:00 UTC = 08:00 Mendoza
  const end   = new Date(start.getTime() + 90 * 60 * 1000);
  return { start, end };
}

beforeAll(async () => {
  const { data: userData, error: userErr } = await db.auth.admin.createUser({
    email:         `test-push-${Date.now()}@turnazo.test`,
    password:      'TestPass123!',
    email_confirm: true,
  });
  if (userErr || !userData.user) throw new Error('No se pudo crear usuario: ' + userErr?.message);
  ownerUserId = userData.user.id;

  await db.from('profiles').insert({ id: ownerUserId, role: 'owner' });

  const { data: loc } = await db.from('localities').select('id').eq('slug', 'tunuyan').single();
  if (!loc) throw new Error("Locality 'tunuyan' no encontrada");

  const { data: sport } = await db.from('sports').select('id').eq('slug', 'padel').single();
  if (!sport) throw new Error("Sport 'padel' no encontrado");

  const { data: venue, error: venueErr } = await db
    .from('venues')
    .insert({
      owner_id:           ownerUserId,
      name:               'Test Venue Push',
      phone:              '2622000011',
      address:            'Push Test 123',
      lat:                -33.56,
      lng:                -69.00,
      locality_id:        loc.id,
      status:             'approved',
      deposit_required:   false,
      allow_pay_at_venue: true,
      cancel_limit_hours: 2,
    })
    .select('id')
    .single();
  if (venueErr || !venue) throw new Error('No se pudo crear venue: ' + venueErr?.message);
  venueId = venue.id;

  const { data: court, error: courtErr } = await db
    .from('courts')
    .insert({ venue_id: venueId, sport_id: sport.id, name: 'Cancha Push', slot_minutes: 90, active: true })
    .select('id')
    .single();
  if (courtErr || !court) throw new Error('No se pudo crear court: ' + courtErr?.message);
  courtId = court.id;

  // Horarios: 7 días, 08:00-22:00
  const hours = Array.from({ length: 7 }, (_, i) => ({
    court_id: courtId, weekday: i, open_time: '08:00:00', close_time: '22:00:00',
  }));
  await db.from('court_hours').insert(hours);

  // Precio: todos los días, 08:00-22:00 = $5000
  const prices = Array.from({ length: 7 }, (_, i) => ({
    court_id: courtId, weekday: i, from_time: '08:00:00', to_time: '22:00:00', price: 5000,
  }));
  await db.from('court_prices').insert(prices);
});

afterAll(async () => {
  // notification_outbox: eliminar explícitamente antes que venues (ON DELETE CASCADE también lo haría)
  if (venueId) await db.from('notification_outbox').delete().eq('venue_id', venueId);
  await db.from('bookings').delete().eq('venue_id', venueId);
  await db.from('court_prices').delete().eq('court_id', courtId);
  await db.from('court_hours').delete().eq('court_id', courtId);
  await db.from('courts').delete().eq('id', courtId);
  await db.from('venues').delete().eq('id', venueId);
  await db.from('profiles').delete().eq('id', ownerUserId);
  await db.auth.admin.deleteUser(ownerUserId);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('create_booking v4 — notification_outbox', () => {
  it('inserta fila en notification_outbox al crear reserva', async () => {
    const { start, end } = slotAt08(3);

    const { data: result, error } = await anonClient.rpc('create_booking', {
      p_court_id:       courtId,
      p_venue_id:       venueId,
      p_start:          start.toISOString(),
      p_end:            end.toISOString(),
      p_customer_name:  'Juan Outbox',
      p_customer_phone: '2615001001',
    });

    expect(error).toBeNull();
    const res = result as Record<string, unknown>;
    expect(res.error).toBeUndefined();
    expect(res.booking_id).toBeTruthy();

    const bookingId = res.booking_id as string;

    // Verificar fila en notification_outbox
    const { data: outboxRows } = await db
      .from('notification_outbox')
      .select('id, type, payload, status')
      .eq('venue_id', venueId)
      .eq('type', 'booking_created');

    const outboxRow = (outboxRows ?? []).find(
      (r) => (r.payload as Record<string, unknown>).booking_id === bookingId
    );

    expect(outboxRow).toBeDefined();
    expect(outboxRow!.type).toBe('booking_created');
    expect(outboxRow!.status).toBe('pending');
    expect((outboxRow!.payload as Record<string, unknown>).customer_name).toBe('Juan Outbox');
  });

  it('el booking existe aunque el envío push no esté disponible', async () => {
    // La lógica de envío (triggerPushSend) se ejecuta fuera de la transacción DB.
    // Aquí verificamos que el booking fue creado y persiste independientemente.
    const { start, end } = slotAt08(4);

    const { data: result, error } = await anonClient.rpc('create_booking', {
      p_court_id:       courtId,
      p_venue_id:       venueId,
      p_start:          start.toISOString(),
      p_end:            end.toISOString(),
      p_customer_name:  'Pedro SinPush',
      p_customer_phone: '2615001002',
    });

    expect(error).toBeNull();
    const res = result as Record<string, unknown>;
    expect(res.error).toBeUndefined();
    expect(res.booking_id).toBeTruthy();

    const bookingId = res.booking_id as string;

    // El booking existe en la DB
    const { data: booking } = await db
      .from('bookings')
      .select('id, status, customer_name')
      .eq('id', bookingId)
      .single();

    expect(booking).toBeDefined();
    expect(booking!.status).toBe('confirmed');
    expect(booking!.customer_name).toBe('Pedro SinPush');

    // La fila en outbox también existe (misma transacción que el booking)
    const { data: outboxRows } = await db
      .from('notification_outbox')
      .select('id, type, payload, status')
      .eq('venue_id', venueId)
      .eq('type', 'booking_created');

    const outboxRow = (outboxRows ?? []).find(
      (r) => (r.payload as Record<string, unknown>).booking_id === bookingId
    );
    expect(outboxRow).toBeDefined();
  });
});

describe('cancel_booking_by_token — notification_outbox', () => {
  let cancelToken: string;
  let bookingId:   string;

  it('create_booking retorna cancel_token válido', async () => {
    const { start, end } = slotAt08(5);

    const { data: result, error } = await anonClient.rpc('create_booking', {
      p_court_id:       courtId,
      p_venue_id:       venueId,
      p_start:          start.toISOString(),
      p_end:            end.toISOString(),
      p_customer_name:  'María Cancel',
      p_customer_phone: '2615001003',
    });

    expect(error).toBeNull();
    const res = result as Record<string, unknown>;
    cancelToken = res.cancel_token as string;
    bookingId   = res.booking_id   as string;
    expect(cancelToken).toBeTruthy();
  });

  it('cancel_booking_by_token inserta fila booking_cancelled en outbox', async () => {
    const { data: result, error } = await anonClient.rpc('cancel_booking_by_token', {
      p_cancel_token: cancelToken,
    });

    expect(error).toBeNull();
    const res = result as Record<string, unknown>;
    expect(res.error).toBeUndefined();
    expect(res.success).toBe(true);

    // Outbox debe tener fila booking_cancelled
    const { data: outboxRows } = await db
      .from('notification_outbox')
      .select('id, type, payload, status')
      .eq('venue_id', venueId)
      .eq('type', 'booking_cancelled');

    const outboxRow = (outboxRows ?? []).find(
      (r) => (r.payload as Record<string, unknown>).booking_id === bookingId
    );

    expect(outboxRow).toBeDefined();
    expect(outboxRow!.status).toBe('pending');
  });
});
