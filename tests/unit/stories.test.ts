import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
import { initials, dayLabel, parseStyle } from "@/lib/stories";

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

  it("estilo desconocido → Pizarra", () => {
    expect(parseStyle("urgencia")).toBe("urgencia");
    expect(parseStyle("x")).toBe("pizarra");
    expect(parseStyle(null)).toBe("pizarra");
  });
});
