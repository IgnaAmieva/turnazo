import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/queries", () => ({ getCourtAvailability: vi.fn() }));

import { noRoomLeftToday, LATE_MINUTES } from "@/lib/free-slots";
import { addDays, dayChip, dayTitle, dayWord, listDays, parseListDate } from "@/lib/list-day";
import { whenLabel } from "@/lib/franjas";
import { mendozaToUtc } from "@/lib/slots";

// Miércoles 25 de noviembre de 2026
const T = "2026-11-25";
const slot = (hhmm: string, date = T) => {
  const start = mendozaToUtc(date, `${hhmm}:00`);
  return { venueId: "v", venueName: "v", courtId: "c", courtName: "", date, start, end: start, price: 1000 };
};

describe("de noche pasa solo a mañana", () => {
  const now = mendozaToUtc(T, "22:45:00");

  it("sin turnos libres hoy → no hay lugar", () => {
    expect(noRoomLeftToday([], now)).toBe(true);
  });

  it(`falta poco para cerrar: si solo quedan turnos que empiezan en menos de ${LATE_MINUTES} min → no hay lugar`, () => {
    expect(noRoomLeftToday([slot("23:00")], now)).toBe(true);
    expect(noRoomLeftToday([slot("23:15")], now)).toBe(false);   // justo 30 min: todavía llegás
    expect(noRoomLeftToday([slot("23:00"), slot("23:30")], now)).toBe(false);
  });
});

describe("fila de días y título", () => {
  it("7 días desde hoy; una ?fecha= vieja, lejana o mal escrita se ignora", () => {
    expect(listDays(T)).toEqual(["2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01"]);
    expect(parseListDate("2026-11-26", T)).toBe("2026-11-26");
    expect(parseListDate(T, T)).toBe(T);                 // hoy explícito: se vuelve a hoy aunque esté vacío
    expect(parseListDate("2026-11-24", T)).toBeNull();
    expect(parseListDate("2026-12-02", T)).toBeNull();
    expect(parseListDate("mañana", T)).toBeNull();
    expect(parseListDate(undefined, T)).toBeNull();
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("título: 'Hoy ya no hay lugar · Mañana, jueves 26' solo si pasó solo", () => {
    expect(dayTitle("2026-11-26", T, true)).toBe("Hoy ya no hay lugar · Mañana, jueves 26");
    expect(dayTitle("2026-11-26", T, false)).toBe("Mañana, jueves 26");
    expect(dayTitle(T, T, false)).toBe("Hoy, miércoles 25");
    expect(dayTitle("2026-11-28", T, false)).toBe("Sábado 28");
  });

  it("frases del día: hoy / mañana / el sábado 28, también con hora", () => {
    expect(dayWord(T, T)).toBe("hoy");
    expect(dayWord("2026-11-26", T)).toBe("mañana");
    expect(dayWord("2026-11-28", T)).toBe("el sábado 28");
    expect(whenLabel({ kind: "any" })).toBe("hoy");
    expect(whenLabel({ kind: "any" }, "mañana")).toBe("mañana");
    expect(whenLabel({ kind: "time", hhmm: "20:00" }, "mañana")).toBe("a las 20:00 mañana");
    expect(whenLabel({ kind: "time", hhmm: "18:30" })).toBe("a las 18:30");
  });

  it("chips: 'Hoy' y después el día corto", () => {
    expect(dayChip(T, T)).toEqual({ top: "Hoy", day: "25" });
    expect(dayChip("2026-11-26", T)).toEqual({ top: "Jue", day: "26" });
  });
});
