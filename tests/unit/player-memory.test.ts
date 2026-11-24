/**
 * Rediseño M1: lo que se recuerda en el dispositivo son solo 4 campos.
 */
import { describe, expect, it } from "vitest";
import { parsePlayerMemory, sanitizePlayerMemory } from "@/lib/player-memory";

describe("sanitizePlayerMemory", () => {
  it("se queda solo con nombre, celular, localidad y deporte", () => {
    const out = sanitizePlayerMemory({
      nombre: " Juan ", celular: "2622 123456", email: "juan@gmail.com",
      payment_option: "deposit", token: "abc",
      localidad: { slug: "tunuyan", nombre: "Tunuyán", extra: 1 },
      deporte: { slug: "padel", nombre: "Pádel" },
    });
    expect(out).toEqual({
      nombre: "Juan", celular: "2622 123456",
      localidad: { slug: "tunuyan", nombre: "Tunuyán" },
      deporte: { slug: "padel", nombre: "Pádel" },
    });
  });

  it("descarta slugs raros, textos vacíos o demasiado largos y tipos incorrectos", () => {
    expect(sanitizePlayerMemory({
      nombre: "", celular: 2622, localidad: { slug: "../x", nombre: "X" }, deporte: { slug: "padel" },
    })).toEqual({});
    expect(sanitizePlayerMemory({ nombre: "a".repeat(81) })).toEqual({});
    expect(sanitizePlayerMemory(null)).toEqual({});
    expect(sanitizePlayerMemory("texto")).toEqual({});
  });

  it("JSON roto o vacío no rompe nada", () => {
    expect(parsePlayerMemory(null)).toEqual({});
    expect(parsePlayerMemory("{no es json")).toEqual({});
    expect(parsePlayerMemory('{"nombre":"Ana"}')).toEqual({ nombre: "Ana" });
  });
});
