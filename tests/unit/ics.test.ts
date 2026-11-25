import { describe, expect, it } from "vitest";
import { buildIcs, escapeIcsText } from "@/lib/ics";

describe("buildIcs — Agregar al calendario", () => {
  const ics = buildIcs({
    uid: "abc@turnazo",
    start: new Date("2026-12-05T23:00:00Z"),   // 20:00 Mendoza
    end:   new Date("2026-12-06T00:30:00Z"),
    summary: "Turno en Club Norte · Cancha 1",
    location: "Club Norte, San Martín 123, Tunuyán",
    description: "Ver o cancelar tu turno: https://turnazo.test/turnos/xyz",
    url: "https://turnazo.test/turnos/xyz",
  }, new Date("2026-11-24T12:00:00Z"));

  it("es un VCALENDAR con un VEVENT, líneas CRLF y horas en UTC", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("\r\nDTSTART:20261205T230000Z\r\n");
    expect(ics).toContain("\r\nDTEND:20261206T003000Z\r\n");
    expect(ics).toContain("\r\nDTSTAMP:20261124T120000Z\r\n");
    expect(ics).toContain("\r\nUID:abc@turnazo\r\n");
    expect(ics.split("\r\n").filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
  });

  it("escapa comas y punto y coma, y corta las líneas largas (≤ 75 octetos)", () => {
    expect(ics).toContain("LOCATION:Club Norte\\, San Martín 123\\, Tunuyán");
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("DESCRIPTION:Ver o cancelar tu turno: https://turnazo.test/turnos/xyz");
  });

  it("escapeIcsText", () => {
    expect(escapeIcsText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
  });
});
