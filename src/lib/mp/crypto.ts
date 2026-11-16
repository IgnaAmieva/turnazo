/**
 * AES-256-GCM encryption/decryption for MP tokens.
 * Uses MP_TOKEN_ENCRYPTION_KEY (32 bytes hex = 64 hex chars).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function getKey(): Buffer {
  const hex = process.env.MP_TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("MP_TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt plaintext → "iv:ciphertext:tag" (all hex).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${enc.toString("hex")}:${tag.toString("hex")}`;
}

/**
 * Decrypt "iv:ciphertext:tag" (all hex) → plaintext.
 */
export function decrypt(packed: string): string {
  const key = getKey();
  const [ivHex, encHex, tagHex] = packed.split(":");
  if (!ivHex || !encHex || !tagHex) throw new Error("Invalid encrypted token format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(encHex, "hex", "utf8") + decipher.final("utf8");
}
