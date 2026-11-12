import { describe, expect, it } from "vitest";
import { buildWhatsAppUrl, normalizeArgentinePhone } from "@/lib/phone";

// ---------------------------------------------------------------------------
// normalizeArgentinePhone
// ---------------------------------------------------------------------------

describe("normalizeArgentinePhone", () => {
  const EXPECTED = "5492622465311";

  it("10 digits (bare local number)", () => {
    expect(normalizeArgentinePhone("2622465311")).toBe(EXPECTED);
  });

  it("11 digits with leading 0 (trunk prefix)", () => {
    expect(normalizeArgentinePhone("02622465311")).toBe(EXPECTED);
  });

  it("old mobile format with 15 and spaces", () => {
    expect(normalizeArgentinePhone("02622 15 465311")).toBe(EXPECTED);
  });

  it("international format with country code and mobile 9", () => {
    expect(normalizeArgentinePhone("+54 9 2622 465311")).toBe(EXPECTED);
  });

  it("12 digits starting with 54 (no mobile 9)", () => {
    expect(normalizeArgentinePhone("542622465311")).toBe(EXPECTED);
  });
});

// ---------------------------------------------------------------------------
// buildWhatsAppUrl
// ---------------------------------------------------------------------------

describe("buildWhatsAppUrl", () => {
  it("returns base wa.me URL when no template is provided", () => {
    expect(buildWhatsAppUrl("2622465311")).toBe(
      "https://wa.me/5492622465311",
    );
  });

  it("appends encoded text when template and vars are provided", () => {
    const url = buildWhatsAppUrl(
      "2622465311",
      "Hola {nombre}, tu turno en {cancha}",
      { nombre: "Ana", cancha: "Cancha 1" },
    );
    // The plain message is: "Hola Ana, tu turno en Cancha 1"
    expect(url).toContain("https://wa.me/5492622465311");
    expect(url).toContain("text=");
    // encodeURIComponent produces %2C for comma, %20 or + for space; either is valid
    const textParam = new URL(url).searchParams.get("text");
    expect(textParam).toBe("Hola Ana, tu turno en Cancha 1");
  });
});
