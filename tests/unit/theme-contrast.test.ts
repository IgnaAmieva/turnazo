/**
 * Contraste AA (4.5:1, texto normal) de la paleta en los dos modos.
 * Lee los colores de src/app/globals.css: si alguien cambia uno, este test
 * dice qué par dejó de leerse.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(import.meta.dirname, "../../src/app/globals.css"), "utf8");

function block(selectorStart: string): Record<string, string> {
  const i = css.indexOf(selectorStart);
  if (i < 0) throw new Error("No está el bloque " + selectorStart);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
}

const light = block(':root,\n[data-theme="light"]'.replace(/\n/g, css.includes("\r\n") ? "\r\n" : "\n"));
const dark = block('[data-theme="dark"] {');
const darkNoJs = block(':root:not([data-theme="light"]) {');

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** [texto, fondo] que aparecen en pantalla. */
const PAIRS: [string, string][] = [
  ["ink", "bg"], ["ink", "surface"], ["ink", "surface-2"],
  ["ink-muted", "bg"], ["ink-muted", "surface"], ["ink-muted", "surface-2"],
  ["brand", "bg"], ["brand", "surface"],
  ["on-primary", "primary"],
  ["on-accent", "accent"],
  ["danger", "surface"], ["danger", "danger-soft"], ["danger", "bg"],
  ["warning", "surface"], ["warning", "warning-soft"], ["warning", "bg"],
];

describe.each([["claro", light], ["oscuro", dark]] as const)("modo %s", (_name, palette) => {
  it.each(PAIRS)("%s sobre %s pasa AA (4.5:1)", (fg, bg) => {
    expect(palette[fg], fg).toBeDefined();
    expect(palette[bg], bg).toBeDefined();
    expect(contrast(palette[fg], palette[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("reglas de la paleta", () => {
  it("los dos modos definen los mismos colores", () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it("el bloque sin JavaScript es idéntico al oscuro", () => {
    expect(darkNoJs).toEqual(dark);
  });

  it("el lima no se usa como texto: ningún color de texto es lima y sobre blanco no se lee", () => {
    const textTokens = ["ink", "ink-muted", "brand", "on-primary", "on-accent", "danger", "warning"];
    for (const p of [light, dark]) {
      for (const t of textTokens) expect(p[t].toUpperCase()).not.toBe("#D4F34A");
    }
    expect(contrast("#D4F34A", "#FFFFFF")).toBeLessThan(4.5);
  });

  it("en oscuro el botón principal es lima (el verde oscuro es el fondo)", () => {
    expect(dark.primary.toUpperCase()).toBe("#D4F34A");
    expect(dark.bg.toUpperCase()).toBe("#0B3D2E");
    expect(light.primary.toUpperCase()).toBe("#0B3D2E");
  });
});
