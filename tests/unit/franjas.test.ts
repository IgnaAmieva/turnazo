import { describe, expect, it } from "vitest";
import { inFranja, parseFranja } from "@/lib/franjas";
import { mendozaToUtc } from "@/lib/slots";

const D = "2026-12-01";
const at = (hhmm: string, date = D) => mendozaToUtc(date, `${hhmm}:00`);

describe("franjas de la lista de complejos", () => {
  it("parseFranja: valor desconocido → Ahora", () => {
    expect(parseFranja(undefined)).toBe("ahora");
    expect(parseFranja("x")).toBe("ahora");
    expect(parseFranja("20-22")).toBe("20-22");
  });

  it("18–20 incluye 18:00 y 19:30, no 20:00", () => {
    expect(inFranja(at("18:00"), "18-20", D)).toBe(true);
    expect(inFranja(at("19:30"), "18-20", D)).toBe(true);
    expect(inFranja(at("20:00"), "18-20", D)).toBe(false);
    expect(inFranja(at("17:59"), "18-20", D)).toBe(false);
  });

  it("22+ incluye después de medianoche (del mismo día de turnos)", () => {
    expect(inFranja(at("22:00"), "22", D)).toBe(true);
    expect(inFranja(at("00:30", "2026-12-02"), "22", D)).toBe(true);
    expect(inFranja(at("21:00"), "22", D)).toBe(false);
  });

  it("Ahora: todos (la lista ya viene sin los turnos pasados)", () => {
    expect(inFranja(at("09:00"), "ahora", D)).toBe(true);
  });
});
