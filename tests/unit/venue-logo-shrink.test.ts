/**
 * Logo del club: el servidor lo achica a 1024 px como máximo y menos de 512 KB
 * SIN cambiar el formato (PNG con su transparencia, JPEG, WebP).
 */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { shrinkLogo } from "@/lib/venue-logo-shrink";
import { detectLogoType, LOGO_MAX_BYTES } from "@/lib/venue-logo";

/** Ruido (no se comprime bien): obliga a bajar calidad o tamaño. */
const noise = (width: number, height: number, channels: 3 | 4) =>
  sharp(randomBytes(width * height * channels), { raw: { width, height, channels } });

/** PNG con fondo transparente y un cuadrado lleno en el medio. */
const transparentPng = (side: number) =>
  sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{
      input: { create: { width: side / 2, height: side / 2, channels: 4, background: { r: 11, g: 79, b: 60, alpha: 1 } } },
      left: side / 4, top: side / 4,
    }])
    .png().toBuffer();

async function shrink(input: Buffer) {
  const type = detectLogoType(input)!;
  const out = await shrinkLogo(input, type);
  expect(out).not.toBeNull();
  return { out: out!, type, meta: await sharp(out!).metadata() };
}

describe("shrinkLogo", () => {
  it("PNG grande con transparencia: sigue PNG, con alfa, 1024 px de lado como máximo y < 512 KB", async () => {
    const input = await noise(2400, 1200, 4).png().toBuffer();
    expect(input.length).toBeGreaterThan(LOGO_MAX_BYTES);
    const { out, meta } = await shrink(input);
    expect(detectLogoType(out)?.ext).toBe("png");
    expect(meta.hasAlpha).toBe(true);
    expect(out.length).toBeLessThanOrEqual(LOGO_MAX_BYTES);
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1024);
    // Sin recortar: se mantiene la proporción 2:1
    expect(meta.width! / meta.height!).toBeCloseTo(2, 1);
  }, 60_000);

  it("PNG chico: no se agranda y lo transparente sigue transparente", async () => {
    const input = await transparentPng(300);
    const { out, meta } = await shrink(input);
    expect([meta.width, meta.height]).toEqual([300, 300]);
    const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
    expect(alphaAt(5, 5)).toBe(0);        // esquina: transparente
    expect(alphaAt(150, 150)).toBe(255);  // centro: el logo
  });

  it("JPEG pesado: sigue JPEG, 1024 px como máximo y < 512 KB", async () => {
    const input = await noise(3000, 2000, 3).jpeg({ quality: 95 }).toBuffer();
    const { out, meta } = await shrink(input);
    expect(detectLogoType(out)?.ext).toBe("jpg");
    expect(out.length).toBeLessThanOrEqual(LOGO_MAX_BYTES);
    expect([meta.width, meta.height]).toEqual([1024, 683]);
  }, 60_000);

  it("WebP con transparencia: sigue WebP, con alfa y < 512 KB", async () => {
    const input = await noise(1600, 1600, 4).webp({ quality: 100 }).toBuffer();
    const { out, meta } = await shrink(input);
    expect(detectLogoType(out)?.ext).toBe("webp");
    expect(meta.hasAlpha).toBe(true);
    expect(out.length).toBeLessThanOrEqual(LOGO_MAX_BYTES);
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1024);
  }, 60_000);

  it("aplica la orientación de la foto del celular (EXIF) y no guarda los metadatos", async () => {
    const input = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#0b4f3c" } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const { meta } = await shrink(input);
    expect([meta.width, meta.height]).toEqual([100, 200]);
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
  });

  it("los primeros bytes de PNG pero el resto basura: null", async () => {
    const fake = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), randomBytes(2000)]);
    expect(await shrinkLogo(fake, detectLogoType(fake)!)).toBeNull();
  });
});
