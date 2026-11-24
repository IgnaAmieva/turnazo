import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
import { initials, dayLabel, parseStyle } from "@/lib/stories";
import { todayInMendoza } from "@/lib/slots";

describe("historias de turnos libres", () => {
  it("iniciales del club para el círculo (hasta que haya logo)", () => {
    expect(initials("futmates")).toBe("FU");
    expect(initials("Club Norte")).toBe("CN");
    expect(initials("Complejo de Pádel El Sol")).toBe("CP");
    expect(initials("La Cancha")).toBe("CA");
    expect(initials("¡5 a 5!")).toBe("5A");
  });

  it("día: 'Hoy · martes 1' o 'Miércoles 2', sin mes ni coma", () => {
    expect(dayLabel("2026-12-01", "2026-12-01")).toBe("Hoy · martes 1");
    expect(dayLabel("2026-12-02", "2026-12-01")).toBe("Miércoles 2");
  });

  it("'hoy' es el día de Mendoza (UTC-3), también cerca de medianoche", () => {
    // 02:30 UTC del miércoles 25 = 23:30 del martes 24 en Mendoza
    const late = new Date("2026-11-25T02:30:00Z");
    expect(todayInMendoza(late)).toBe("2026-11-24");
    expect(dayLabel(todayInMendoza(late), todayInMendoza(late))).toBe("Hoy · martes 24");
    // 03:00 UTC = 00:00 del miércoles 25 en Mendoza
    expect(todayInMendoza(new Date("2026-11-25T03:00:00Z"))).toBe("2026-11-25");
    // El día elegido se dibuja tal cual, sin correrse por la zona horaria del servidor
    expect(dayLabel("2026-11-26", "2026-11-24")).toBe("Jueves 26");
  });

  it("estilo desconocido → Pizarra", () => {
    expect(parseStyle("urgencia")).toBe("urgencia");
    expect(parseStyle("x")).toBe("pizarra");
    expect(parseStyle(null)).toBe("pizarra");
  });
});
