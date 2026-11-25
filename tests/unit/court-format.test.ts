import { describe, expect, it } from "vitest";
import { FORMATS, filterByFormat, formatLabel, isFormat, venueFormats } from "@/lib/court-format";

describe("formato de cancha de fútbol (027)", () => {
  it("los 6 valores del CHECK de la 027, con su etiqueta corta y larga", () => {
    expect(FORMATS.map((f) => f.value)).toEqual(["futbol_5", "futbol_6", "futbol_7", "futbol_9", "futbol_11", "futsal"]);
    expect(FORMATS.map((f) => f.short)).toEqual(["5", "6", "7", "9", "11", "Futsal"]);
    expect(formatLabel("futbol_11")).toBe("Fútbol 11");
    expect(formatLabel(null)).toBeNull();
    for (const v of ["futbol_8", "", null, "FUTBOL_5"]) expect(isFormat(v)).toBe(false);
  });

  it("venueFormats: distintos y en orden", () => {
    expect(venueFormats([{ format: "futsal" }, { format: "futbol_5" }, { format: null }, { format: "futbol_5" }]))
      .toEqual(["Fútbol 5", "Futsal"]);
  });

  it("filterByFormat: deja solo esas canchas y saca los complejos sin ninguna", () => {
    const venues = [
      { id: "a", courts: [{ id: "a1", format: "futbol_5" }, { id: "a2", format: "futbol_7" }] },
      { id: "b", courts: [{ id: "b1", format: null }] },
    ];
    expect(filterByFormat(venues, null)).toBe(venues);
    expect(filterByFormat(venues, "futbol_7")).toEqual([{ id: "a", courts: [{ id: "a2", format: "futbol_7" }] }]);
    expect(filterByFormat(venues, "futsal")).toEqual([]);
  });
});
