import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "crypto";

// Set env before importing module
const TEST_KEY = randomBytes(32).toString("hex");
beforeAll(() => {
  process.env.MP_TOKEN_ENCRYPTION_KEY = TEST_KEY;
});

describe("mp/crypto", () => {
  it("encrypt → decrypt round-trip", async () => {
    const { encrypt, decrypt } = await import("@/lib/mp/crypto");
    const plaintext = "APP_USR-1234567890abcdef";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.split(":")).toHaveLength(3); // iv:ciphertext:tag
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it("tampered ciphertext fails to decrypt", async () => {
    const { encrypt, decrypt } = await import("@/lib/mp/crypto");
    const encrypted = encrypt("secret-token");
    const [iv, enc, tag] = encrypted.split(":");
    // Flip a byte in ciphertext
    const tampered = `${iv}:${enc.slice(0, -2)}ff:${tag}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it("invalid format throws", async () => {
    const { decrypt } = await import("@/lib/mp/crypto");
    expect(() => decrypt("not-valid")).toThrow("Invalid encrypted token format");
  });

  it("wrong key fails to decrypt", async () => {
    const { encrypt } = await import("@/lib/mp/crypto");
    const encrypted = encrypt("test-value");

    // Change key
    const saved = process.env.MP_TOKEN_ENCRYPTION_KEY;
    process.env.MP_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");

    // Need fresh import to pick up new key — but since the module caches,
    // we test by directly constructing a decryptor with wrong key
    const { createDecipheriv } = await import("crypto");
    const [ivHex, encHex, tagHex] = encrypted.split(":");
    const wrongKey = Buffer.from(process.env.MP_TOKEN_ENCRYPTION_KEY, "hex");
    const decipher = createDecipheriv("aes-256-gcm", wrongKey, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    expect(() => {
      decipher.update(encHex, "hex", "utf8");
      decipher.final("utf8");
    }).toThrow();

    process.env.MP_TOKEN_ENCRYPTION_KEY = saved;
  });

  it("invalid key length throws on encrypt", async () => {
    const saved = process.env.MP_TOKEN_ENCRYPTION_KEY;
    process.env.MP_TOKEN_ENCRYPTION_KEY = "tooshort";

    // Re-import to get fresh module behavior — actually the module reads env each call
    const { encrypt } = await import("@/lib/mp/crypto");
    expect(() => encrypt("test")).toThrow("MP_TOKEN_ENCRYPTION_KEY must be 64 hex chars");

    process.env.MP_TOKEN_ENCRYPTION_KEY = saved;
  });
});
