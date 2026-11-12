/**
 * Tests de integración — usuario dueño (authenticated, role=owner)
 *
 * Verifica que un dueño puede gestionar sus propios recursos del panel
 * y NO puede acceder a los de otros dueños.
 * No usa service_role para assertions de permisos.
 */

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !serviceKey || !anonKey) {
  throw new Error('Faltan variables de entorno');
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let owner1Id:  string;
let owner2Id:  string;
let owner1Email: string;
let venue1Id:  string;
let venue2Id:  string;
let court1Id:  string;
let localityId: string;
let sportId:    string;

const PASSWORD = 'TestPass123!';

/** Cliente del dueño 1, con sesión */
const owner1Client = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

beforeAll(async () => {
  const { data: loc } = await admin.from('localities').select('id').eq('slug', 'tunuyan').single();
  if (!loc) throw new Error('Locality tunuyan no encontrada');
  localityId = loc.id;

  const { data: sport } = await admin.from('sports').select('id').eq('slug', 'padel').single();
  if (!sport) throw new Error('Sport padel no encontrado');
  sportId = sport.id;

  // Dueño 1
  owner1Email = `test-owner1-${Date.now()}@turnazo.test`;
  const { data: u1 } = await admin.auth.admin.createUser({
    email:         owner1Email,
    password:      PASSWORD,
    email_confirm: true,
  });
  if (!u1.user) throw new Error('No se pudo crear owner1');
  owner1Id = u1.user.id;

  // Dueño 2 (otro usuario — owner1 no debería ver sus datos)
  const { data: u2 } = await admin.auth.admin.createUser({
    email:         `test-owner2-${Date.now()}@turnazo.test`,
    password:      PASSWORD,
    email_confirm: true,
  });
  if (!u2.user) throw new Error('No se pudo crear owner2');
  owner2Id = u2.user.id;

  // Venue de owner1
  const { data: v1 } = await admin.from('venues').insert({
    owner_id:    owner1Id,
    name:        'Complejo Owner1',
    phone:       '2612000010',
    address:     'Owner1 123',
    lat:         -33.57, lng: -69.0,
    locality_id: localityId,
    status:      'pending',
  }).select('id').single();
  if (!v1) throw new Error('No se pudo crear venue1');
  venue1Id = v1.id;

  // Venue de owner2
  const { data: v2 } = await admin.from('venues').insert({
    owner_id:    owner2Id,
    name:        'Complejo Owner2',
    phone:       '2612000020',
    address:     'Owner2 456',
    lat:         -33.57, lng: -69.0,
    locality_id: localityId,
    status:      'pending',
  }).select('id').single();
  if (!v2) throw new Error('No se pudo crear venue2');
  venue2Id = v2.id;

  // Cancha en venue1
  const { data: c1 } = await admin.from('courts').insert({
    venue_id:     venue1Id,
    sport_id:     sportId,
    name:         'Cancha Owner1',
    slot_minutes: 90,
    active:       true,
  }).select('id').single();
  if (!c1) throw new Error('No se pudo crear court1');
  court1Id = c1.id;

  // Iniciar sesión como owner1
  const { error: signInErr } = await owner1Client.auth.signInWithPassword({
    email:    owner1Email,
    password: PASSWORD,
  });
  if (signInErr) throw new Error('No se pudo iniciar sesión: ' + signInErr.message);
}, 30_000);

afterAll(async () => {
  await owner1Client.auth.signOut();
  if (court1Id) await admin.from('courts').delete().eq('id', court1Id);
  if (venue1Id) await admin.from('venues').delete().eq('id', venue1Id);
  if (venue2Id) await admin.from('venues').delete().eq('id', venue2Id);
  if (owner1Id) await admin.auth.admin.deleteUser(owner1Id);
  if (owner2Id) await admin.auth.admin.deleteUser(owner2Id);
}, 30_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('owner — panel: leer sus propios recursos', () => {
  it('puede leer su propio venue', async () => {
    const { data, error } = await owner1Client
      .from('venues')
      .select('id, name, owner_id')
      .eq('id', venue1Id)
      .single();

    expect(error).toBeNull();
    expect(data!.owner_id).toBe(owner1Id);
  });

  it('puede listar sus canchas', async () => {
    const { data, error } = await owner1Client
      .from('courts')
      .select('id, name')
      .eq('venue_id', venue1Id);

    expect(error).toBeNull();
    expect(data!.length).toBe(1);
    expect(data![0].id).toBe(court1Id);
  });

  it('puede actualizar su venue', async () => {
    const { error } = await owner1Client
      .from('venues')
      .update({ name: 'Complejo Owner1 Actualizado' })
      .eq('id', venue1Id);

    expect(error).toBeNull();

    // Verificar con admin
    const { data } = await admin.from('venues').select('name').eq('id', venue1Id).single();
    expect(data!.name).toBe('Complejo Owner1 Actualizado');
  });
});

describe('owner — aislamiento: no puede ver datos de otros dueños', () => {
  it('no puede leer el venue de otro dueño', async () => {
    const { data, error } = await owner1Client
      .from('venues')
      .select('id')
      .eq('id', venue2Id);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);  // RLS filtra, no lanza error
  });

  it('no puede actualizar el venue de otro dueño', async () => {
    const { error } = await owner1Client
      .from('venues')
      .update({ name: 'Hack' })
      .eq('id', venue2Id);

    // Sin error (RLS simplemente no afecta filas), pero la fila no cambió
    const { data } = await admin.from('venues').select('name').eq('id', venue2Id).single();
    expect(data!.name).toBe('Complejo Owner2');
  });

  it('no puede insertar una cancha en el venue de otro dueño', async () => {
    const { error } = await owner1Client.from('courts').insert({
      venue_id:     venue2Id,
      sport_id:     sportId,
      name:         'Cancha Intrusa',
      slot_minutes: 90,
      active:       true,
    });

    expect(error).not.toBeNull();
  });
});
