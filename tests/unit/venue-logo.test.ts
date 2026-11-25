import { describe, expect, it } from "vitest";
import { detectLogoType, venueLogoUrl } from "@/lib/venue-logo";

const bytes = (...b: (number | string)[]) =>
  Uint8Array.from(b.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));

describe("logo del club: tipo real por los primeros bytes", () => {
  it("reconoce PNG, JPEG y WebP", () => {
    expect(detectLogoType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toEqual({ mime: "image/png", ext: "png" });
    expect(detectLogoType(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({ mime: "image/jpeg", ext: "jpg" });
    expect(detectLogoType(bytes("RIFF", 1, 2, 3, 4, "WEBPVP8 "))).toEqual({ mime: "image/webp", ext: "webp" });
  });

  it("rechaza lo demás aunque se llame .png: texto, SVG, GIF, PDF, RIFF que no es WebP, vacío", () => {
    expect(detectLogoType(bytes("hola, no soy una imagen"))).toBeNull();
    expect(detectLogoType(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectLogoType(bytes("GIF89a", 0, 0))).toBeNull();
    expect(detectLogoType(bytes("%PDF-1.7"))).toBeNull();
    expect(detectLogoType(bytes("RIFF", 1, 2, 3, 4, "WAVEfmt "))).toBeNull();
    expect(detectLogoType(bytes(0x89, "PNG"))).toBeNull();
    expect(detectLogoType(new Uint8Array())).toBeNull();
  });

  it("URL pública del bucket, o null sin logo", () => {
    expect(venueLogoUrl(null)).toBeNull();
    expect(venueLogoUrl("")).toBeNull();
    expect(venueLogoUrl("abc/logo-1.png")).toBe(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/venue-logos/abc/logo-1.png`);
  });
});
