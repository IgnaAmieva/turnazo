import { describe, expect, it } from "vitest";
import { formatArgentinePhone } from "@/lib/phone";

describe("formatArgentinePhone — característica + espacio + número", () => {
  it.each([
    ["2622123456", "2622 123456"],
    ["2622 123456", "2622 123456"],
    ["02622 15 123456", "2622 123456"],
    ["+54 9 2622 12-3456", "2622 123456"],
    ["5492622123456", "2622 123456"],
    ["2614123456", "261 4123456"],
    ["0261 15 4123456", "261 4123456"],
    ["2604123456", "260 4123456"],
    ["1151234567", "11 51234567"],
    ["3514123456", "351 4123456"],
  ])("%s → %s", (raw, expected) => {
    expect(formatArgentinePhone(raw)).toBe(expected);
  });

  it("si no son 10 dígitos, lo deja como lo escribió", () => {
    expect(formatArgentinePhone("12")).toBe("12");
    expect(formatArgentinePhone(" 2622 12 ")).toBe("2622 12");
  });
});
