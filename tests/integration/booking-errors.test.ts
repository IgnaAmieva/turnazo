/**
 * Rediseño M3: cada error que puede devolver la reserva tiene mensaje corto y
 * acción (src/lib/booking-errors.ts). Ningún código queda sin cubrir:
 *
 * 1. Se leen de las migraciones las definiciones VIGENTES (la última) de
 *    create_booking, create_booking_hold y _validate_booking_slot, y de
 *    src/app/actions/payment.ts los códigos propios de la acción de pago.
 * 2. Contra la base real, la server action devuelve mensajes del catálogo
 *    (turno pasado, celular inválido para la base, cancha inexistente).
 *    No crea nada: todos los intentos fallan antes de insertar.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Captcha y límites (S2) se prueban en security-s2.test.ts; acá no interfieren.
vi.mock("@/lib/abuse", () => ({ checkBookingAbuse: async () => null, checkAuthAbuse: async () => null, allowReconcile: async () => true }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("NEXT_REDIRECT " + url); } }));
vi.mock("@/lib/push", () => ({ triggerPushSend: async () => {} }));

import { BOOKING_ERROR_CODES, bookingError, bookingErrorFromMessage } from "@/lib/booking-errors";
import { PAYMENT_ERROR_MESSAGES, RPC_ERROR_MESSAGES, GENERIC_BOOKING_ERROR } from "@/lib/booking-messages";
import { createBookingAction } from "@/app/actions/booking";

const ROOT = resolve(import.meta.dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");

/** Cuerpo de la última definición de la función en las migraciones (en orden). */
function latestDefinition(fn: string): string {
  let body = "";
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(resolve(MIGRATIONS, file), "utf8");
    const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      // El cuerpo va entre delimitadores $$ o $nombre$ (la 021 usa uno con nombre)
      const start = m.index;
      const tag = /\$[A-Za-z_]*\$/.exec(sql.slice(start))?.[0];
      if (!tag) continue;
      const open = sql.indexOf(tag, start);
      const close = sql.indexOf(tag, open + tag.length);
      if (close < 0) continue;
      body = sql.slice(start, close + tag.length);
    }
  }
  if (!body) throw new Error(`No encontré ${fn} en las migraciones`);
  return body;
}

function codesIn(body: string): string[] {
  const codes = new Set<string>();
  for (const m of body.matchAll(/'error',\s*'([a-z_]+)'/g)) codes.add(m[1]);
  for (const m of body.matchAll(/SELECT\s+'([a-z_]+)'::text/g)) codes.add(m[1]);
  return [...codes];
}

const DB_CODES = [...new Set([
  ...codesIn(latestDefinition("create_booking")),
  ...codesIn(latestDefinition("create_booking_hold")),
  ...codesIn(latestDefinition("_validate_booking_slot")),
])].sort();

const PAYMENT_SRC = readFileSync(resolve(ROOT, "src/app/actions/payment.ts"), "utf8");
const ACTION_CODES = [...new Set([
  ...[...PAYMENT_SRC.matchAll(/PAYMENT_ERROR_MESSAGES\.([a-z_]+)/g)].map((m) => m[1]),
  // Códigos de Mercado Pago escritos como texto (failAndRelease(id, 'mp_…'), PAYMENT_ERROR_MESSAGES['mp_…'])
  ...[...PAYMENT_SRC.matchAll(/'(mp_[a-z_]+)'/g)].map((m) => m[1]),
])];

const KINDS = ["other_times", "field", "none", "wait", "pay_at_venue_or_retry", "change_payment", "retry"];

describe("catálogo de errores de la reserva", () => {
  it("se encontraron los códigos de la base (sanidad del lector de migraciones)", () => {
    for (const c of ["slot_taken", "past_slot", "too_far_ahead", "invalid_phone", "too_many_bookings", "phone_blocked", "hold_limit_reached"]) {
      expect(DB_CODES).toContain(c);
    }
    expect(ACTION_CODES).toEqual(expect.arrayContaining(["mp_order_failed", "mp_token_unavailable", "mp_hold_not_released"]));
  });

  it.each([...DB_CODES, ...ACTION_CODES, "too_many_attempts", "captcha_failed", "captcha_unavailable", "generic"])("'%s' tiene mensaje corto y acción", (code) => {
    expect(BOOKING_ERROR_CODES, `falta '${code}' en src/lib/booking-errors.ts`).toContain(code);
    const e = bookingError(code);
    expect(e.code).toBe(code);
    expect(e.message.length).toBeGreaterThan(5);
    expect(e.message.length).toBeLessThanOrEqual(110);
    expect(KINDS).toContain(e.action.kind);
  });

  it("los mensajes que devuelven las server actions vuelven a su código y acción", () => {
    for (const code of BOOKING_ERROR_CODES) {
      const msg = PAYMENT_ERROR_MESSAGES[code];
      expect(msg).toBe(RPC_ERROR_MESSAGES[code]);
      expect(bookingErrorFromMessage(msg).action).toEqual(bookingError(code).action);
    }
    expect(bookingErrorFromMessage(GENERIC_BOOKING_ERROR).action.kind).toBe("retry");
    expect(bookingErrorFromMessage("Algo que nadie previó").action.kind).toBe("retry");
  });

  it("reglas pedidas: tomado/vencido → otros horarios; celular → campo; límite y bloqueo → sin reintento; MP → pagar en el lugar", () => {
    expect(bookingError("slot_taken").action.kind).toBe("other_times");
    expect(bookingError("past_slot").action.kind).toBe("other_times");
    expect(bookingError("invalid_phone").action).toEqual({ kind: "field", field: "customer_phone" });
    expect(bookingError("too_many_bookings").action.kind).toBe("none");
    expect(bookingError("phone_blocked").action.kind).toBe("none");
    expect(bookingError("too_many_attempts").action.kind).toBe("wait");
    expect(bookingError("too_many_attempts").message).toBe("Hiciste demasiados intentos. Esperá un rato y probá de nuevo.");
    for (const c of ["mp_order_failed", "mp_token_unavailable", "mp_not_connected"]) {
      expect(bookingError(c).action.kind).toBe("pay_at_venue_or_retry");
    }
    // Si el hold no se liberó, NO se ofrece "Pagar en el lugar" (chocaría con su propio hold)
    expect(bookingError("mp_hold_not_released").action.kind).toBe("wait");
  });
});

describe("contra la base real: la server action devuelve errores del catálogo", () => {
  const VENUE_ID = "b2c3d4e5-0000-0000-0000-000000000001";
  const COURT_ID = "c3d4e5f6-0000-0000-0000-000000000001";
  const yesterday = () => {
    const d = new Date(); d.setUTCHours(11, 0, 0, 0); d.setUTCDate(d.getUTCDate() - 1);
    return { start: d.toISOString(), end: new Date(d.getTime() + 90 * 60_000).toISOString() };
  };
  const form = (name: string, phone: string) => {
    const fd = new FormData(); fd.set("customer_name", name); fd.set("customer_phone", phone); return fd;
  };

  it("turno pasado → past_slot (Ver otros horarios)", async () => {
    const res = await createBookingAction({ court_id: COURT_ID, venue_id: VENUE_ID, ...yesterday() }, {}, form("Test M3", "2622 123456"));
    const e = bookingErrorFromMessage(res.error!);
    expect(e.code).toBe("past_slot");
    expect(e.action.kind).toBe("other_times");
  });

  it("cancha que no es del complejo → código del catálogo, no genérico", async () => {
    const res = await createBookingAction(
      { court_id: "00000000-0000-0000-0000-000000000000", venue_id: VENUE_ID, ...yesterday() }, {}, form("Test M3", "2622 123456"));
    expect(bookingErrorFromMessage(res.error!).code).not.toBe("generic");
  });

  it("celular con formato inválido → error del campo (no un error general)", async () => {
    const res = await createBookingAction({ court_id: COURT_ID, venue_id: VENUE_ID, ...yesterday() }, {}, form("Test M3", "12"));
    expect(res.error).toBeUndefined();
    expect(res.fieldErrors?.customer_phone?.length).toBeGreaterThan(0);
  });
});
