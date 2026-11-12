/**
 * Tests de seguridad de autenticación:
 *   - trigger auto-crea profile con role='owner'
 *   - usuario no puede escalar su propio rol a 'superadmin'
 */

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !serviceKey || !anonKey) {
  throw new Error('Faltan variables de entorno');
}

const db = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let testUserId: string;
let testEmail:  string;
const TEST_PASSWORD = 'TestPass123!';

beforeAll(async () => {
  testEmail = `test-auth-sec-${Date.now()}@turnazo.test`;
  const { data, error } = await db.auth.admin.createUser({
    email:         testEmail,
    password:      TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error('No se pudo crear usuario: ' + error?.message);
  testUserId = data.user.id;
}, 20_000);

afterAll(async () => {
  if (testUserId) await db.auth.admin.deleteUser(testUserId);
}, 20_000);

describe('auth security', () => {
  it('trigger auto-crea profile con role=owner', async () => {
    const { data, error } = await db
      .from('profiles')
      .select('role')
      .eq('id', testUserId)
      .single();

    expect(error).toBeNull();
    expect(data?.role).toBe('owner');
  });

  it('usuario no puede cambiar su propio rol a superadmin', async () => {
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErr } = await userClient.auth.signInWithPassword({
      email:    testEmail,
      password: TEST_PASSWORD,
    });
    expect(signInErr).toBeNull();

    // Intentar escalar rol (debe fallar por RLS)
    await userClient
      .from('profiles')
      .update({ role: 'superadmin' })
      .eq('id', testUserId);

    // Verificar con admin que el rol no cambió
    const { data: profile } = await db
      .from('profiles')
      .select('role')
      .eq('id', testUserId)
      .single();

    expect(profile?.role).toBe('owner');
  });

  it('usuario autenticado no puede insertar en profiles', async () => {
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await userClient.auth.signInWithPassword({ email: testEmail, password: TEST_PASSWORD });

    // Intentar insertar perfil propio (debe fallar por ausencia de policy)
    const { error } = await userClient
      .from('profiles')
      .insert({ id: testUserId, role: 'owner' });

    expect(error).not.toBeNull();

    // También intentar insertar un perfil con id aleatorio
    const { error: error2 } = await userClient
      .from('profiles')
      .insert({ id: '00000000-0000-0000-0000-000000000001', role: 'superadmin' });

    expect(error2).not.toBeNull();
  });
});
