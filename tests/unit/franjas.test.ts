import { describe, expect, it } from "vitest";
import { ANY, inWhen, parseWhen, startTimes, whenLabel, whenParams } from "@/lib/franjas";
import { rankVenues } from "@/lib/rank-venues";
import { mendozaToUtc } from "@/lib/slots";

const D = "2026-12-01";
const at = (hhmm: string, date = D) => mendozaToUtc(date, `${hhmm}:00`);

describe("¿A qué hora querés jugar? — horarios reales", () => {
  it("parseWhen: ?hora=HH:MM válida; lo demás (franjas viejas, hora entera, basura) → cualquier hora", () => {
    expect(parseWhen("18:30")).toEqual({ kind: "time", hhmm: "18:30" });
    expect(parseWhen("00:30")).toEqual({ kind: "time", hhmm: "00:30" });
    expect(parseWhen("19")).toEqual(ANY);
    expect(parseWhen("24:00")).toEqual(ANY);
    expect(parseWhen("18:30&x")).toEqual(ANY);
    expect(parseWhen(undefined)).toEqual(ANY);
    expect(whenParams(ANY)).toEqual({});
    expect(whenParams({ kind: "time", hhmm: "20:00" })).toEqual({ hora: "20:00" });
  });

  it("inWhen: empieza exactamente a esa hora (de Mendoza)", () => {
    const w = { kind: "time", hhmm: "18:30" } as const;
    expect(inWhen(at("18:30"), w)).toBe(true);
    expect(inWhen(at("18:00"), w)).toBe(false);
    expect(inWhen(at("20:00"), w)).toBe(false);
    expect(inWhen(at("09:00"), ANY)).toBe(true);
  });

  it("startTimes: horarios distintos en orden; los de después de medianoche al final", () => {
    const slots = [at("20:00"), at("18:30"), at("18:30"), at("00:30", "2026-12-02"), at("21:30")].map((start) => ({ start }));
    expect(startTimes(slots)).toEqual(["18:30", "20:00", "21:30", "00:30"]);
  });

  it("whenLabel: 'hoy' / 'a las 18:30' / con el día si no es hoy", () => {
    expect(whenLabel(ANY)).toBe("hoy");
    expect(whenLabel(ANY, "mañana")).toBe("mañana");
    expect(whenLabel({ kind: "time", hhmm: "18:30" })).toBe("a las 18:30");
    expect(whenLabel({ kind: "time", hhmm: "18:30" }, "el sábado 28")).toBe("a las 18:30 el sábado 28");
  });
});

describe("orden de los complejos", () => {
  const venue = (id: string, name: string) => ({ id, name, address: "", lat: 0, lng: 0, courts: [] });
  const slot = (venueId: string, hhmm: string, courtId = "c1") =>
    ({ venueId, venueName: venueId, courtId, courtName: "", date: D, start: at(hhmm), end: at(hhmm), price: 1000 });

  const venues = [venue("a", "Alfa"), venue("b", "Beta"), venue("c", "Charly")];
  const slots = [
    slot("a", "10:00"), slot("a", "18:30"),
    slot("b", "17:00"), slot("b", "18:30"), slot("b", "18:30", "c2"), slot("b", "20:00"), slot("b", "21:30"),
    slot("c", "20:00"),
  ];

  it("cualquier hora: todos los que tienen lugar, primero el que tiene más libres en el día", () => {
    const r = rankVenues(venues, slots, ANY);
    expect(r.map((x) => [x.v.id, x.free])).toEqual([["b", 5], ["a", 2], ["c", 1]]);
  });

  it("a las 18:30: solo los que tienen un turno que empieza a esa hora; los chips arrancan ahí", () => {
    const r = rankVenues(venues, slots, { kind: "time", hhmm: "18:30" });
    expect(r.map((x) => [x.v.id, x.free])).toEqual([["b", 2], ["a", 1]]);
    // Dos canchas libres a las 18:30 → un solo chip; después los siguientes del día
    expect(r[0].next.map((s) => s.start.getTime())).toEqual([at("18:30"), at("20:00"), at("21:30")].map((d) => d.getTime()));
  });
});
