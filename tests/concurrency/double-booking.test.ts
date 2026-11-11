/**
 * Test de concurrencia: doble reserva
 *
 * Lanza N inserts simultáneos al mismo horario en la misma cancha.
 * La constraint `no_overlap` de la DB debe garantizar que solo uno entre.
 *
 * Requiere variables de entorno:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Cliente admin (bypasea RLS para fixtures de test)
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno"
  );
}

const db = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// IDs de fixtures
// ---------------------------------------------------------------------------
let testUserId: string;
let localityId: string;
let sportId: string;
let venueId: string;
let courtId: string;

// Período de prueba: mañana 13:00-14:30 UTC (10:00-11:30 Mendoza)
const tomorrow = new Date();
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
tomorrow.setUTCHours(13, 0, 0, 0);
const slotStart = tomorrow.toISOString();
const slotEnd   = new Date(tomorrow.getTime() + 90 * 60 * 1000).toISOString();
const period    = `[${slotStart},${slotEnd})`;

// ---------------------------------------------------------------------------
// beforeAll: crear fixtures mínimos
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // 1. Crear usuario de prueba en auth.users vía Admin API
  const { data: userData, error: userErr } = await db.auth.admin.createUser({
    email: `test-concurrency-${Date.now()}@turnazo.test`,
    password: "TestPass123!",
    email_confirm: true,
  });
  if (userErr || !userData.user) throw new Error("No se pudo crear usuario de prueba: " + userErr?.message);
  testUserId = userData.user.id;

  // 2. Crear perfil (owner)
  const { error: profileErr } = await db
    .from("profiles")
    .insert({ id: testUserId, role: "owner" });
  if (profileErr) throw new Error("No se pudo crear perfil: " + profileErr.message);

  // 3. Locality y Sport del seed
  const { data: loc } = await db.from("localities").select("id").eq("slug", "tunuyan").single();
  if (!loc) throw new Error("Locality tunuyan no encontrada — ¿se aplicó el seed?");
  localityId = loc.id;

  const { data: sport } = await db.from("sports").select("id").eq("slug", "padel").single();
  if (!sport) throw new Error("Sport padel no encontrado — ¿se aplicó el seed?");
  sportId = sport.id;

  // 4. Venue de prueba
  const { data: venue, error: venueErr } = await db
    .from("venues")
    .insert({
      owner_id:    testUserId,
      name:        "Complejo Test Concurrencia",
      phone:       "2611234567",
      address:     "Calle Test 123",
      lat:         -33.57,
      lng:         -69.0,
      locality_id: localityId,
      status:      "approved",
    })
    .select("id")
    .single();
  if (venueErr || !venue) throw new Error("No se pudo crear venue: " + venueErr?.message);
  venueId = venue.id;

  // 5. Court de prueba
  const { data: court, error: courtErr } = await db
    .from("courts")
    .insert({
      venue_id:     venueId,
      sport_id:     sportId,
      name:         "Cancha Test 1",
      slot_minutes: 90,
      active:       true,
    })
    .select("id")
    .single();
  if (courtErr || !court) throw new Error("No se pudo crear court: " + courtErr?.message);
  courtId = court.id;
});

// ---------------------------------------------------------------------------
// afterAll: limpiar fixtures
// ---------------------------------------------------------------------------

afterAll(async () => {
  if (courtId)   await db.from("bookings").delete().eq("court_id", courtId);
  if (courtId)   await db.from("courts").delete().eq("id", courtId);
  if (venueId)   await db.from("venues").delete().eq("id", venueId);
  if (testUserId) await db.auth.admin.deleteUser(testUserId);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Constraint no_overlap — doble reserva", () => {
  it("solo permite UN insert cuando N clientes intentan el mismo horario simultáneamente", async () => {
    const CONCURRENT = 10;

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT }, (_, i) =>
        db
          .from("bookings")
          .insert({
            court_id:       courtId,
            venue_id:       venueId,
            period,
            kind:           "booking",
            source:         "app",
            status:         "confirmed",
            customer_name:  `Cliente ${i + 1}`,
            customer_phone: `2610000${String(i).padStart(3, "0")}`,
            price_total:    5000,
            amount_paid:    0,
            payment_status: "unpaid",
            cancel_token:   crypto.randomUUID(),
          })
          .select("id")
          .single()
      )
    );

    const successes = results.filter(
      (r) => r.status === "fulfilled" && r.value.data !== null && r.value.error === null
    );
    const failures = results.filter(
      (r) => r.status === "rejected" || (r.status === "fulfilled" && r.value.error !== null)
    );

    console.log(`\n  ✓ Éxitos:    ${successes.length}`);
    console.log(`  ✗ Rechazados: ${failures.length}`);

    // La constraint debe dejar pasar exactamente 1
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(CONCURRENT - 1);

    // Confirmar en la DB: 1 sola reserva activa
    const { data: booked } = await db
      .from("bookings")
      .select("id, customer_name")
      .eq("court_id", courtId)
      .in("status", ["confirmed", "hold"]);

    expect(booked).toHaveLength(1);
    console.log(`  → Reserva ganadora: ${booked![0].customer_name}`);
  });

  it("permite reservas en horarios distintos (sin bloqueo cruzado)", async () => {
    const start2  = new Date(tomorrow.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const end2    = new Date(tomorrow.getTime() + 3.5 * 60 * 60 * 1000).toISOString();
    const period2 = `[${start2},${end2})`;

    const { data, error } = await db
      .from("bookings")
      .insert({
        court_id:       courtId,
        venue_id:       venueId,
        period:         period2,
        kind:           "booking",
        source:         "app",
        status:         "confirmed",
        customer_name:  "Cliente Otro Horario",
        customer_phone: "2619999999",
        price_total:    5000,
        amount_paid:    0,
        payment_status: "unpaid",
        cancel_token:   crypto.randomUUID(),
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });

  it("cancelled/expired no bloquean el mismo horario", async () => {
    // Cancelar la reserva del primer test
    await db
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("court_id", courtId)
      .eq("status", "confirmed")
      .eq("period", period);

    // Ahora debe entrar una nueva reserva en el mismo período
    const { data, error } = await db
      .from("bookings")
      .insert({
        court_id:       courtId,
        venue_id:       venueId,
        period,
        kind:           "booking",
        source:         "app",
        status:         "confirmed",
        customer_name:  "Cliente Post-Cancelación",
        customer_phone: "2618888888",
        price_total:    5000,
        amount_paid:    0,
        payment_status: "unpaid",
        cancel_token:   crypto.randomUUID(),
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });
});
