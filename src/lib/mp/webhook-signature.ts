/**
 * Verificación de la firma de los webhooks de Mercado Pago.
 *
 * Documentación oficial (2026-11-15; formato de ts revisado el 2026-11-18):
 *   - Header `x-signature`: "ts=<epoch>,v1=<hmac hex>". El ejemplo oficial es
 *     "ts=1704908010,v1=…" (10 dígitos = segundos), y los avisos reales que
 *     llegaron a producción el 2026-11-18 también traían segundos.
 *   - Manifiesto: "id:[data.id];request-id:[x-request-id];ts:[ts];"
 *     · data.id (query string) en minúsculas si es alfanumérico.
 *     · Las partes ausentes (data.id, x-request-id) se omiten del manifiesto.
 *   - HMAC-SHA256 del manifiesto con la clave secreta de la app, en hexadecimal,
 *     comparado con v1.
 *   - ts es el timestamp de la notificación. Se acepta en segundos (ts < 1e12,
 *     el formato real) o en milisegundos, y se compara contra el reloj con una
 *     tolerancia de 5 minutos. En el manifiesto va siempre tal como llegó.
 */
import { createHmac, timingSafeEqual } from "crypto";

export const DEFAULT_TS_TOLERANCE_MS = 5 * 60 * 1000;

export type SignatureCheck =
  | { ok: true; ts: number }
  | { ok: false; reason: "missing_header" | "malformed_header" | "stale_timestamp" | "bad_signature" };

export function buildMpManifest(parts: { dataId?: string | null; requestId?: string | null; ts: string }): string {
  let manifest = "";
  if (parts.dataId) manifest += `id:${parts.dataId.toLowerCase()};`;
  if (parts.requestId) manifest += `request-id:${parts.requestId};`;
  manifest += `ts:${parts.ts};`;
  return manifest;
}

export function signMpManifest(manifest: string, secret: string): string {
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

export function verifyMpSignature(input: {
  xSignature: string | null | undefined;
  xRequestId: string | null | undefined;
  dataId: string | null | undefined;
  secret: string;
  nowMs?: number;
  toleranceMs?: number;
}): SignatureCheck {
  const { xSignature, xRequestId, dataId, secret } = input;
  if (!xSignature) return { ok: false, reason: "missing_header" };

  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of xSignature.split(",")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === "ts") ts = value;
    else if (key === "v1") v1 = value;
  }
  if (!ts || !v1 || !/^\d+$/.test(ts) || !/^[0-9a-fA-F]+$/.test(v1)) {
    return { ok: false, reason: "malformed_header" };
  }

  const tsRaw = Number(ts);
  // Menos de 1e12 = segundos (1e12 ms es septiembre de 2001).
  const tsMs = tsRaw < 1e12 ? tsRaw * 1000 : tsRaw;
  const now = input.nowMs ?? Date.now();
  const tolerance = input.toleranceMs ?? DEFAULT_TS_TOLERANCE_MS;
  if (!Number.isFinite(tsMs) || Math.abs(now - tsMs) > tolerance) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = signMpManifest(buildMpManifest({ dataId, requestId: xRequestId, ts }), secret);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1.toLowerCase(), "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  return { ok: true, ts: tsMs };
}
