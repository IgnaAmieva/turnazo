/**
 * Tests de integración — usuario público (anon)
 *
 * Verifica que las rutas públicas funcionan sin autenticación y sin
 * lanzar 42501 (error que ocurría porque auth_role() no tenía EXECUTE para anon).
 */

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !serviceKey || !anonKey) {
  throw new Error('Faltan variables de entorno');
}

/** Cliente admin solo para fixtures de setup/teardown */
const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Cliente anon: simula un navegador sin sesión */
const anon = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let localityId: string;
let sportId:    string;
let venueId:    string;
let courtId:    string;
let ownerId:    string;

const tomorrow = new Date();
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
tomorrow.setUTCHours(14, 0, 0, 0); // 11:00 Mendoza (aligns with 90-min grid from 08:00)
const slotStart = tomorrow.toISOString();
const slotEnd   = new Date(tomorrow.getTime() + 90 * 60 * 1000).toISOString();

beforeAll(async () => {
  // Locality y sport del seed
  const { data: loc } = await admin.from('localities').select('id').eq('slug', 'tunuyan').single();
  if (!loc) throw new Error('Locality tunuyan no encontrada');
  localityId = loc.id;

  const { data: sport } = await admin.from('sports').select('id').eq('slug', 'padel').single();
  if (!sport) throw new Error('Sport padel no encontrado');
  sportId = sport.id;

  // Usuario dueño
  const { data: userData } = await admin.auth.admin.createUser({
    email: `test-public-${Date.now()}@turnazo.test`,
    password: 'TestPass123!',
    email_confirm: true,
  });
  if (!userData.user) throw new Error('No se pudo crear usuario');
  ownerId = userData.user.id;

  // Venue aprobado
  const { data: venue } = await admin.from('venues').insert({
    owner_id:    ownerId,
    name:        'Complejo Test Público',
    phone:       '2612000001',
    address:     'Test 1',
    lat:         -33.57,
    lng:         -69.0,
    locality_id: localityId,
    status:      'approved',
  }).select('id').single();
  if (!venue) throw new Error('No se pudo crear venue');
  venueId = venue.id;

  // Cancha con horarios y precios
  const { data: court } = await admin.from('courts').insert({
    venue_id:     venueId,
    sport_id:     sportId,
    name:         'Cancha Test',
    slot_minutes: 90,
    active:       true,
  }).select('id').single();
  if (!court) throw new Error('No se pudo crear cancha');
  courtId = court.id;

  // Horario que cubre el slot de prueba (todos los días 08:00-22:00 Mendoza)
  const days = Array.from({ length: 7 }, (_, i) => ({
    court_id:   courtId,
    weekday:    i,
    open_time:  '08:00:00',
    close_time: '22:00:00',
  }));
  await admin.from('court_hours').insert(days);

  // Precio único para todos los días
  const prices = Array.from({ length: 7 }, (_, i) => ({
    court_id:  courtId,
    weekday:   i,
    from_time: '08:00:00',
    to_time:   '22:00:00',
    price:     5000,
  }));
  await admin.from('court_prices').insert(prices);
}, 30_000);

afterAll(async () => {
  if (venueId) {
    await admin.from('bookings').delete().eq('venue_id', venueId);
    await admin.from('court_prices').delete().eq('court_id', courtId);
    await admin.from('court_hours').delete().eq('court_id', courtId);
    await admin.from('courts').delete().eq('id', courtId);
    await admin.from('venues').delete().eq('id', venueId);
  }
  if (ownerId) await admin.auth.admin.deleteUser(ownerId);
}, 30_000);

// ---------------------------------------------------------------------------
// Tests — usuario anon (sin sesión)
// ---------------------------------------------------------------------------

describe('anon — listar venues y canchas', () => {
  it('puede listar venues aprobados por localidad sin 42501', async () => {
    const { data, error } = await anon
      .from('venues')
      .select('id, name, status')
      .eq('status', 'approved')
      .eq('locality_id', localityId);

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it('no ve venues pending ni suspended', async () => {
    // Crear venue pending con admin (no el ownerId del test)
    const { data: pending } = await admin.from('venues').insert({
      owner_id:    ownerId,
      name:        'Venue Pending',
      phone:       '2612000099',
      address:     'x',
      lat:         -33.57,
      lng:         -69.0,
      locality_id: localityId,
      status:      'pending',
    }).select('id').single();

    const { data, error } = await anon
      .from('venues')
      .select('id')
      .eq('id', pending!.id);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    await admin.from('venues').delete().eq('id', pending!.id);
  });

  it('puede listar canchas activas de un venue aprobado', async () => {
    const { data, error } = await anon
      .from('courts')
      .select('id, name')
      .eq('venue_id', venueId);

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it('puede consultar court_hours de una cancha activa', async () => {
    const { data, error } = await anon
      .from('court_hours')
      .select('weekday, open_time, close_time')
      .eq('court_id', courtId);

    expect(error).toBeNull();
    expect(data!.length).toBe(7);
  });
});

describe('anon — disponibilidad y reservas', () => {
  it('puede consultar disponibilidad via RPC get_court_availability', async () => {
    const { data, error } = await anon.rpc('get_court_availability', {
      p_court_id: courtId,
      p_from:     slotStart,
      p_to:       slotEnd,
    });

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it('puede crear un turno via RPC create_booking', async () => {
    const { data, error } = await anon.rpc('create_booking', {
      p_court_id:       courtId,
      p_venue_id:       venueId,
      p_start:          slotStart,
      p_end:            slotEnd,
      p_customer_name:  'Cliente Anon',
      p_customer_phone: '2615000001',
    });

    expect(error).toBeNull();
    expect(data).toHaveProperty('booking_id');
    expect(data.booking_id).not.toBeNull();
    expect(data.price_total).toBe(5000);
  });

  it('no puede leer bookings directamente (sin policy pública)', async () => {
    const { data, error } = await anon.from('bookings').select('id');

    // RLS no tiene política pública para bookings; devuelve array vacío, no error 42501
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});

describe('anon — no puede acceder a datos privados', () => {
  it('no puede leer audit_log', async () => {
    const { data, error } = await anon.from('audit_log').select('id');
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it('no puede leer profiles', async () => {
    const { data, error } = await anon.from('profiles').select('id, role');
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it('no puede insertar en venues directamente', async () => {
    const { error } = await anon.from('venues').insert({
      owner_id:    '00000000-0000-0000-0000-000000000000',
      name:        'Hack',
      phone:       '2612000000',
      address:     'x',
      lat:         0,
      lng:         0,
      locality_id: localityId,
    });
    expect(error).not.toBeNull();
  });
});
