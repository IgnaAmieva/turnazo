import { describe, expect, it } from "vitest";
import { DEFAULT_WA_TEMPLATE, parseTemplate, previewTemplate, serializeSegments, WA_VARS } from "@/lib/wa-template";
import { buildWhatsAppUrl } from "@/lib/phone";

describe("plantilla de WhatsApp", () => {
  it("el mensaje por defecto usa las 5 variables y entra en 500", () => {
    for (const v of WA_VARS) expect(DEFAULT_WA_TEMPLATE).toContain(`{${v.key}}`);
    expect(DEFAULT_WA_TEMPLATE.length).toBeLessThanOrEqual(500);
  });

  it("parse → serialize devuelve el mismo texto (lo que se guarda en la base no cambia)", () => {
    for (const t of [DEFAULT_WA_TEMPLATE, "", "Sin variables", "{nombre}{hora}", "Para cancelar: {link} {nombre}", "{ nombre }", "a\nb {dia}"]) {
      expect(serializeSegments(parseTemplate(t))).toBe(t);
    }
  });

  it("variables conocidas → pastillas; llaves desconocidas quedan como texto", () => {
    expect(parseTemplate("Hola {nombre}, {link}!")).toEqual([
      { type: "text", text: "Hola " },
      { type: "var", key: "nombre" },
      { type: "text", text: ", {link}!" },
    ]);
  });

  it("vista previa y link de WhatsApp con el mensaje por defecto", () => {
    expect(previewTemplate(DEFAULT_WA_TEMPLATE)).toBe(
      "¡Hola Juan Pérez! Tu turno en Cancha 1 el miércoles 15 de enero a las 10:00–11:30 está confirmado. Total: $4.000. ¡Te esperamos!");
    const url = buildWhatsAppUrl("2622 123456", DEFAULT_WA_TEMPLATE, { nombre: "Ana", cancha: "C1", dia: "hoy", hora: "18:00", total: "$1" });
    expect(decodeURIComponent(url.split("?text=")[1])).toBe("¡Hola Ana! Tu turno en C1 el hoy a las 18:00 está confirmado. Total: $1. ¡Te esperamos!");
  });
});
