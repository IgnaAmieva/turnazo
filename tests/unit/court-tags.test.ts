import { describe, expect, it } from "vitest";
import { isSurface, venueTags, venueTagsLine } from "@/lib/court-tags";

const c = (o: Partial<Parameters<typeof venueTags>[0][number]> = {}) => ({ slot_minutes: 90, ...o });

describe("etiquetas de cancha (023)", () => {
  it("sin nada cargado: cantidad de canchas y duración", () => {
    expect(venueTagsLine([c(), c()])).toBe("2 canchas · turnos de 90 min");
    expect(venueTagsLine([c({ slot_minutes: 60 })])).toBe("1 cancha · turnos de 60 min");
    expect(venueTagsLine([c({ slot_minutes: 90 }), c({ slot_minutes: 60 })])).toBe("2 canchas · turnos de 60 y 90 min");
  });

  it("con datos: superficies distintas y lo que tenga alguna cancha, en orden fijo", () => {
    expect(venueTagsLine([c({ surface: "sintetico", lit: true }), c({ surface: "sintetico", covered: true })]))
      .toBe("Sintético · Techada · Iluminada");
    expect(venueTags([c({ surface: "blindex", has_locker_room: true }), c({ surface: "cemento" })]))
      .toEqual(["Cemento", "Blindex", "Vestuario"]);
  });

  it("isSurface acepta solo las 5 del CHECK de la 023", () => {
    for (const s of ["sintetico", "pasto", "cemento", "polvo_ladrillo", "blindex"]) expect(isSurface(s)).toBe(true);
    for (const s of ["", "arena", null, undefined]) expect(isSurface(s)).toBe(false);
  });
});
