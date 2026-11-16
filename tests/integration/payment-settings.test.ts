/**
 * Integration tests for the venue payment settings (Fase 6, Bloque 2).
 *
 * Calls the real server action `updatePaymentSettingsAction` as the owner
 * (user session + RLS, not service_role) and checks what ends up in the DB:
 *   - Seña / pago total need Mercado Pago connected (server-side rule)
 *   - Seña obligatoria ⇒ no pago en el lugar
 *   - Seña por porcentaje entre 1 y 100, seña fija mayor a 0
 *   - Only the owner of the venue can change them
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { updatePaymentSettingsAction } from "@/app/actions/panel";

// The action runs outside a Next request: no cookies and no cache to revalidate.
// createClient() returns a client holding the test owner's session instead.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ownerClient,
}));

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !serviceKey || !anonKey) {
  throw new Error("Faltan variables de entorno");
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Client with the owner's session — what the action gets from createClient() */
const ownerClient = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PASSWORD = "TestPass123!";

let ownerId: string;
let otherOwnerId: string;
let venueId: string;
let otherVenueId: string;

const PAY_AT_VENUE_ONLY = {
  deposit_required:   false,
  deposit_type:       null,
  deposit_value:      null,
  allow_full_payment: false,
  allow_pay_at_venue: true,
};

beforeAll(async () => {
  const { data: loc } = await admin.from("localities").select("id").eq("slug", "tunuyan").single();
  if (!loc) throw new Error("Locality tunuyan no encontrada");

  const ownerEmail = `test-paycfg-${Date.now()}@turnazo.test`;
  const { data: u1, error: u1Err } = await admin.auth.admin.createUser({
    email: ownerEmail, password: PASSWORD, email_confirm: true,
  });
  if (u1Err) throw u1Err;
  ownerId = u1.user.id;

  const { data: u2, error: u2Err } = await admin.auth.admin.createUser({
    email: `test-paycfg-other-${Date.now()}@turnazo.test`, password: PASSWORD, email_confirm: true,
  });
  if (u2Err) throw u2Err;
  otherOwnerId = u2.user.id;

  const venueBase = {
    phone: "2612000030", address: "Cobro 123", lat: -33.57, lng: -69.0,
    locality_id: loc.id, status: "pending" as const,
  };

  const { data: v1, error: v1Err } = await admin.from("venues")
    .insert({ ...venueBase, owner_id: ownerId, name: "Test Cobro Venue" })
    .select("id").single();
  if (v1Err) throw v1Err;
  venueId = v1.id;

  const { data: v2, error: v2Err } = await admin.from("venues")
    .insert({ ...venueBase, owner_id: otherOwnerId, name: "Test Cobro Venue Ajeno" })
    .select("id").single();
  if (v2Err) throw v2Err;
  otherVenueId = v2.id;

  const { error: signInErr } = await ownerClient.auth.signInWithPassword({
    email: ownerEmail, password: PASSWORD,
  });
  if (signInErr) throw signInErr;
}, 30_000);

afterAll(async () => {
  await ownerClient.auth.signOut();
  for (const id of [venueId, otherVenueId]) {
    if (!id) continue;
    await admin.from("mp_accounts").delete().eq("venue_id", id);
    await admin.from("audit_log").delete().eq("venue_id", id);
    await admin.from("venues").delete().eq("id", id);
  }
  for (const id of [ownerId, otherOwnerId]) {
    if (!id) continue;
    await admin.from("profiles").delete().eq("id", id);
    await admin.auth.admin.deleteUser(id);
  }
}, 30_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setMpConnected(id: string, connected: boolean) {
  if (connected) {
    const { error } = await admin.from("mp_accounts").upsert({
      venue_id: id,
      mp_user_id: "12345678",
      mp_email: "test@mp.com",
      access_token_enc: "fake:enc:token",
      refresh_token_enc: "fake:enc:refresh",
      expires_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
    }, { onConflict: "venue_id" });
    if (error) throw error;
  } else {
    const { error } = await admin.from("mp_accounts").delete().eq("venue_id", id);
    if (error) throw error;
  }
}

/** Starting point of every test: pago en el lugar only. */
async function resetSettings(id: string) {
  const { error } = await admin.from("venues").update(PAY_AT_VENUE_ONLY).eq("id", id);
  if (error) throw error;
}

async function readSettings(id: string) {
  const { data, error } = await admin
    .from("venues")
    .select("deposit_required, deposit_type, deposit_value, allow_full_payment, allow_pay_at_venue")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

/** Submits the form the way the browser does: a checked checkbox sends "on". */
function save(id: string, fields: Record<string, string>) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.set(name, value);
  return updatePaymentSettingsAction(id, null, formData);
}

// ---------------------------------------------------------------------------
// Sin Mercado Pago conectado
// ---------------------------------------------------------------------------

describe("cobro — sin Mercado Pago conectado", () => {
  beforeAll(async () => {
    await setMpConnected(venueId, false);
  });

  it("no deja activar la seña", async () => {
    await resetSettings(venueId);
    const result = await save(venueId, {
      deposit_required: "on", deposit_type: "percent", deposit_value: "50",
    });
    expect(result?.error).toMatch(/Mercado Pago/);
    expect(await readSettings(venueId)).toEqual(PAY_AT_VENUE_ONLY);
  });

  it("no deja activar el pago total", async () => {
    await resetSettings(venueId);
    const result = await save(venueId, { allow_full_payment: "on", allow_pay_at_venue: "on" });
    expect(result?.error).toMatch(/Mercado Pago/);
    expect(await readSettings(venueId)).toEqual(PAY_AT_VENUE_ONLY);
  });

  it("deja guardar solo pago en el lugar", async () => {
    await resetSettings(venueId);
    const result = await save(venueId, { allow_pay_at_venue: "on" });
    expect(result).toEqual({});
    expect(await readSettings(venueId)).toEqual(PAY_AT_VENUE_ONLY);
  });

  it("no deja quedarse sin ninguna forma de pago", async () => {
    await resetSettings(venueId);
    const result = await save(venueId, {});
    expect(result?.error).toMatch(/al menos una forma de pago/);
    expect(await readSettings(venueId)).toEqual(PAY_AT_VENUE_ONLY);
  });
});

// ---------------------------------------------------------------------------
// Con Mercado Pago conectado
// ---------------------------------------------------------------------------

describe("cobro — con Mercado Pago conectado", () => {
  beforeAll(async () => {
    await setMpConnected(venueId, true);
  });

  it("guarda seña por porcentaje y apaga el pago en el lugar aunque el form lo mande", async () => {
    await resetSettings(venueId);
    const result = await save(venueId, {
      deposit_required: "on", deposit_type: "percent", deposit_value: "50",
      allow_pay_at_venue: "on",
    });
    expect(result).toEqual({});
    expect(await readSettings(venueId)).toEqual({
      deposit_required:   true,
      deposit_type:       "percent",
      deposit_value:      50,
      allow_full_payment: false,
      allow_pay_at_venue: false,
    });
  });

  it("guarda seña fija junto con pago total", async () => {
    await resetSettings(venueId);
    const result = await save(venueId, {
      deposit_required: "on", deposit_type: "fixed", deposit_value: "2500",
      allow_full_payment: "on",
    });
    expect(result).toEqual({});
    expect(await readSettings(venueId)).toEqual({
      deposit_required:   true,
      deposit_type:       "fixed",
      deposit_value:      2500,
      allow_full_payment: true,
      allow_pay_at_venue: false,
    });
  });

  it("sin seña: guarda pago total + pago en el lugar y limpia tipo y valor", async () => {
    await admin.from("venues").update({
      deposit_required: true, deposit_type: "percent", deposit_value: 30,
      allow_full_payment: false, allow_pay_at_venue: false,
    }).eq("id", venueId);

    const result = await save(venueId, { allow_full_payment: "on", allow_pay_at_venue: "on" });
    expect(result).toEqual({});
    expect(await readSettings(venueId)).toEqual({
      deposit_required:   false,
      deposit_type:       null,
      deposit_value:      null,
      allow_full_payment: true,
      allow_pay_at_venue: true,
    });
  });

  it.each(["0", "0.4", "101", "100.5", "-10", "", "abc"])(
    "rechaza seña por porcentaje = %j",
    async (value) => {
      await resetSettings(venueId);
      const result = await save(venueId, {
        deposit_required: "on", deposit_type: "percent", deposit_value: value,
      });
      expect(result?.fieldErrors?.deposit_value?.[0]).toMatch(/entre 1 y 100/);
      expect(await readSettings(venueId)).toEqual(PAY_AT_VENUE_ONLY);
    }
  );

  it.each([["1", 1], ["100", 100]])(
    "acepta seña por porcentaje en el borde: %s",
    async (value, stored) => {
      await resetSettings(venueId);
      const result = await save(venueId, {
        deposit_required: "on", deposit_type: "percent", deposit_value: value,
      });
      expect(result).toEqual({});
      expect((await readSettings(venueId)).deposit_value).toBe(stored);
    }
  );

  it.each(["0", "-500", "0.001", "", "abc", "Infinity"])(
    "rechaza seña fija = %j",
    async (value) => {
      await resetSettings(venueId);
      const result = await save(venueId, {
        deposit_required: "on", deposit_type: "fixed", deposit_value: value,
      });
      expect(result?.fieldErrors?.deposit_value?.[0]).toMatch(/mayor a 0/);
      expect(await readSettings(venueId)).toEqual(PAY_AT_VENUE_ONLY);
    }
  );

  it("rechaza un tipo de seña desconocido", async () => {
    await resetSettings(venueId);
    const result = await save(venueId, {
      deposit_required: "on", deposit_type: "gratis", deposit_value: "50",
    });
    expect(result?.fieldErrors?.deposit_type).toBeDefined();
    expect(await readSettings(venueId)).toEqual(PAY_AT_VENUE_ONLY);
  });

  it("escribe audit_log con la configuración guardada", async () => {
    await resetSettings(venueId);
    await admin.from("audit_log").delete().eq("venue_id", venueId);

    const result = await save(venueId, {
      deposit_required: "on", deposit_type: "percent", deposit_value: "25",
    });
    expect(result).toEqual({});

    const { data: rows } = await admin
      .from("audit_log")
      .select("profile_id, entity, entity_id, action, new_data")
      .eq("venue_id", venueId);
    expect(rows).toEqual([{
      profile_id: ownerId,
      entity:     "venue",
      entity_id:  venueId,
      action:     "update_payment_settings",
      new_data: {
        deposit_required:   true,
        deposit_type:       "percent",
        deposit_value:      25,
        allow_full_payment: false,
        allow_pay_at_venue: false,
      },
    }]);
  });
});

// ---------------------------------------------------------------------------
// Reglas en la base (migración 018) — escribiendo directo en venues,
// sin pasar por la acción
// ---------------------------------------------------------------------------
// ROJO hasta que el revisor aplique 018_payment_rules.sql.
// ---------------------------------------------------------------------------

describe("cobro — reglas en la base (migración 018)", () => {
  it("rechaza seña sin Mercado Pago aunque se escriba directo", async () => {
    await setMpConnected(venueId, false);
    await resetSettings(venueId);

    const { error } = await admin
      .from("venues")
      .update({ deposit_required: true, deposit_type: "percent", deposit_value: 50 })
      .eq("id", venueId);

    expect(error?.message).toBe("mp_not_connected");
    expect(await readSettings(venueId)).toEqual(PAY_AT_VENUE_ONLY);
  });

  it("con seña obligatoria fuerza allow_pay_at_venue = false", async () => {
    await setMpConnected(venueId, true);
    await resetSettings(venueId);

    const { error } = await admin
      .from("venues")
      .update({ deposit_required: true, deposit_type: "fixed", deposit_value: 1000, allow_pay_at_venue: true })
      .eq("id", venueId);

    expect(error).toBeNull();
    expect((await readSettings(venueId)).allow_pay_at_venue).toBe(false);
  });

  it("rechaza porcentaje fuera de 1–100 y seña fija en 0", async () => {
    await setMpConnected(venueId, true);
    await resetSettings(venueId);

    const { error: pct } = await admin
      .from("venues")
      .update({ deposit_required: true, deposit_type: "percent", deposit_value: 150 })
      .eq("id", venueId);
    expect(pct?.message).toBe("deposit_percent_out_of_range");

    const { error: fixed } = await admin
      .from("venues")
      .update({ deposit_required: true, deposit_type: "fixed", deposit_value: 0 })
      .eq("id", venueId);
    // El CHECK deposit_config_valid de 001 (deposit_value > 0) también lo cubre;
    // el trigger corre antes y da el código propio.
    expect(fixed?.message).toBe("deposit_fixed_not_positive");

    expect(await readSettings(venueId)).toEqual(PAY_AT_VENUE_ONLY);
  });

  it("no deja quedarse sin ninguna forma de pago", async () => {
    await resetSettings(venueId);

    const { error } = await admin
      .from("venues")
      .update({ allow_pay_at_venue: false })
      .eq("id", venueId);

    expect(error?.message).toBe("no_payment_method");
    expect(await readSettings(venueId)).toEqual(PAY_AT_VENUE_ONLY);
  });

  it("editar nombre o dirección no dispara las reglas", async () => {
    await resetSettings(venueId);

    const { error } = await admin
      .from("venues")
      .update({ name: "Test Cobro Venue (renombrado)", address: "Cobro 456" })
      .eq("id", venueId);

    expect(error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Autorización
// ---------------------------------------------------------------------------

describe("cobro — autorización", () => {
  it("no deja tocar el complejo de otro dueño", async () => {
    await setMpConnected(otherVenueId, true);
    await resetSettings(otherVenueId);

    const result = await save(otherVenueId, {
      deposit_required: "on", deposit_type: "percent", deposit_value: "50",
    });
    expect(result?.error).toBe("No autorizado");
    expect(await readSettings(otherVenueId)).toEqual(PAY_AT_VENUE_ONLY);
  });
});
