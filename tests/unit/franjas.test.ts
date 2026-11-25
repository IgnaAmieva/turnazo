import { describe, expect, it } from "vitest";
import { inFranja, inWhen, parseFranja, parseWhen, whenParams } from "@/lib/franjas";
import { rankVenues } from "@/lib/rank-venues";
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

describe("hora exacta (?hora=)", () => {
  it("parseWhen: ?hora= válida gana sobre ?franja=; inválida → la franja", () => {
    expect(parseWhen("20-22", "19")).toEqual({ kind: "hora", h: 19 });
    expect(parseWhen("20-22", "3")).toEqual({ kind: "franja", id: "20-22" });   // fuera de 08–23
    expect(parseWhen(undefined, "abc")).toEqual({ kind: "franja", id: "ahora" });
    expect(whenParams({ kind: "hora", h: 9 })).toEqual({ hora: "9" });
    expect(whenParams({ kind: "franja", id: "ahora" })).toEqual({});
  });

  it("cerca de las 19: turnos que empiezan de 18:30 a 19:59", () => {
    const w = { kind: "hora", h: 19 } as const;
    expect(inWhen(at("18:30"), w, D)).toBe(true);   // grilla de 90 min: el que hay "a las 19"
    expect(inWhen(at("19:00"), w, D)).toBe(true);
    expect(inWhen(at("19:30"), w, D)).toBe(true);
    expect(inWhen(at("20:00"), w, D)).toBe(false);
    expect(inWhen(at("18:29"), w, D)).toBe(false);
  });

  it("con la grilla de 90 min desde las 08:00, todas las horas de 08 a 23 tienen algún turno", () => {
    const grid = Array.from({ length: 11 }, (_, i) => new Date(at("08:00").getTime() + i * 90 * 60_000));
    for (let h = 8; h <= 23; h++) {
      expect(grid.some((s) => inWhen(s, { kind: "hora", h }, D)), `hora ${h}`).toBe(true);
    }
  });
});

describe("orden de los complejos", () => {
  const venue = (id: string, name: string) => ({ id, name, address: "", lat: 0, lng: 0, courts: [] });
  const slot = (venueId: string, hhmm: string, courtId = "c1") =>
    ({ venueId, venueName: venueId, courtId, courtName: "", date: D, start: at(hhmm), end: at(hhmm), price: 1000 });

  it("primero el que tiene más turnos libres en la franja; sin lugar no aparece; empate por nombre", () => {
    const venues = [venue("a", "Alfa"), venue("b", "Beta"), venue("c", "Charly"), venue("d", "Delta")];
    const slots = [
      slot("a", "10:00"),
      slot("b", "18:30"), slot("b", "19:00"), slot("b", "19:00", "c2"),
      slot("c", "18:00"), slot("c", "19:30"),
      slot("d", "18:00"), slot("d", "19:00"),
    ];
    const r = rankVenues(venues, slots, { kind: "franja", id: "18-20" }, D);
    expect(r.map((x) => [x.v.id, x.free])).toEqual([["b", 3], ["c", 2], ["d", 2]]);
    // Dos canchas libres a las 19:00 → un solo chip
    expect(r[0].next.map((s) => s.start.getTime())).toEqual([at("18:30").getTime(), at("19:00").getTime()]);
  });
});
