/**
 * Verificación de la firma x-signature de los webhooks de Mercado Pago,
 * según la doc oficial: manifiesto "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
 * firmado con HMAC-SHA256 (hex) y comparado con v1.
 */
import { describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import { buildMpManifest, signMpManifest, verifyMpSignature } from "@/lib/mp/webhook-signature";

const SECRET = "clave-secreta-de-prueba";
const NOW = 1_800_000_000_000;

function sign(parts: { dataId?: string; requestId?: string; ts: string }, secret = SECRET) {
  return `ts=${parts.ts},v1=${signMpManifest(buildMpManifest(parts), secret)}`;
}

describe("buildMpManifest", () => {
  it("arma el manifiesto con data.id en minúsculas, request-id y ts", () => {
    expect(buildMpManifest({ dataId: "ORD01ABC", requestId: "req-1", ts: "123" }))
      .toBe("id:ord01abc;request-id:req-1;ts:123;");
  });

  it("omite las partes ausentes", () => {
    expect(buildMpManifest({ requestId: "req-1", ts: "123" })).toBe("request-id:req-1;ts:123;");
    expect(buildMpManifest({ dataId: "abc", ts: "123" })).toBe("id:abc;ts:123;");
    expect(buildMpManifest({ ts: "123" })).toBe("ts:123;");
  });

  it("firma con HMAC-SHA256 en hexadecimal", () => {
    const manifest = "id:abc;request-id:r;ts:1;";
    expect(signMpManifest(manifest, SECRET))
      .toBe(createHmac("sha256", SECRET).update(manifest).digest("hex"));
  });
});

describe("verifyMpSignature", () => {
  const ts = String(NOW);

  it("acepta una firma válida", () => {
    const res = verifyMpSignature({
      xSignature: sign({ dataId: "ORD01ABC", requestId: "req-1", ts }),
      xRequestId: "req-1",
      dataId:     "ORD01ABC",
      secret:     SECRET,
      nowMs:      NOW,
    });
    expect(res).toEqual({ ok: true, ts: NOW });
  });

  it("acepta v1 en mayúsculas (hex case-insensitive)", () => {
    const sig = sign({ dataId: "x", requestId: "r", ts });
    const upper = sig.replace(/v1=(.*)$/, (_, h: string) => `v1=${h.toUpperCase()}`);
    expect(verifyMpSignature({ xSignature: upper, xRequestId: "r", dataId: "x", secret: SECRET, nowMs: NOW }).ok).toBe(true);
  });

  it("rechaza con otra clave secreta", () => {
    const res = verifyMpSignature({
      xSignature: sign({ dataId: "ORD01ABC", requestId: "req-1", ts }, "otra-clave"),
      xRequestId: "req-1",
      dataId:     "ORD01ABC",
      secret:     SECRET,
      nowMs:      NOW,
    });
    expect(res).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rechaza si cambió data.id o x-request-id (manifiesto distinto)", () => {
    const sig = sign({ dataId: "ORD01ABC", requestId: "req-1", ts });
    expect(verifyMpSignature({ xSignature: sig, xRequestId: "req-1", dataId: "ORD99", secret: SECRET, nowMs: NOW }))
      .toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyMpSignature({ xSignature: sig, xRequestId: "req-2", dataId: "ORD01ABC", secret: SECRET, nowMs: NOW }))
      .toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rechaza una firma manipulada aunque tenga el mismo largo", () => {
    const sig = sign({ dataId: "a", requestId: "r", ts });
    const last = sig.slice(-1);
    const tampered = sig.slice(0, -1) + (last === "0" ? "1" : "0");
    expect(verifyMpSignature({ xSignature: tampered, xRequestId: "r", dataId: "a", secret: SECRET, nowMs: NOW }))
      .toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rechaza header ausente o malformado", () => {
    expect(verifyMpSignature({ xSignature: null, xRequestId: "r", dataId: "a", secret: SECRET, nowMs: NOW }))
      .toEqual({ ok: false, reason: "missing_header" });
    expect(verifyMpSignature({ xSignature: "", xRequestId: "r", dataId: "a", secret: SECRET, nowMs: NOW }))
      .toEqual({ ok: false, reason: "missing_header" });
    expect(verifyMpSignature({ xSignature: "v1=abc", xRequestId: "r", dataId: "a", secret: SECRET, nowMs: NOW }))
      .toEqual({ ok: false, reason: "malformed_header" });
    expect(verifyMpSignature({ xSignature: `ts=${ts}`, xRequestId: "r", dataId: "a", secret: SECRET, nowMs: NOW }))
      .toEqual({ ok: false, reason: "malformed_header" });
    expect(verifyMpSignature({ xSignature: `ts=abc,v1=zz`, xRequestId: "r", dataId: "a", secret: SECRET, nowMs: NOW }))
      .toEqual({ ok: false, reason: "malformed_header" });
  });

  it("rechaza timestamps viejos o futuros fuera de la tolerancia (5 min)", () => {
    const old = String(NOW - 6 * 60 * 1000);
    expect(verifyMpSignature({
      xSignature: sign({ dataId: "a", requestId: "r", ts: old }),
      xRequestId: "r", dataId: "a", secret: SECRET, nowMs: NOW,
    })).toEqual({ ok: false, reason: "stale_timestamp" });

    const future = String(NOW + 6 * 60 * 1000);
    expect(verifyMpSignature({
      xSignature: sign({ dataId: "a", requestId: "r", ts: future }),
      xRequestId: "r", dataId: "a", secret: SECRET, nowMs: NOW,
    })).toEqual({ ok: false, reason: "stale_timestamp" });

    // Dentro de la tolerancia: ok
    const recent = String(NOW - 4 * 60 * 1000);
    expect(verifyMpSignature({
      xSignature: sign({ dataId: "a", requestId: "r", ts: recent }),
      xRequestId: "r", dataId: "a", secret: SECRET, nowMs: NOW,
    }).ok).toBe(true);
  });

  it("acepta ts en segundos, el formato real de MP, con la misma tolerancia de 5 min", () => {
    // Aviso real del 2026-11-18: x-request-id de Vercel 1795030839785 ms → ts=1795030839 s.
    const nowMs = 1_795_030_839_785;
    const tsSec = "1795030839";
    const xSignature = sign({ dataId: "ORD01M7R2S6NDBQ5NRBKAT6YHZ0FE", requestId: "req-real", ts: tsSec });
    const base = { xSignature, xRequestId: "req-real", dataId: "ORD01M7R2S6NDBQ5NRBKAT6YHZ0FE", secret: SECRET };

    expect(verifyMpSignature({ ...base, nowMs })).toEqual({ ok: true, ts: 1_795_030_839_000 });
    // 4 min después: dentro de la tolerancia
    expect(verifyMpSignature({ ...base, nowMs: nowMs + 4 * 60 * 1000 }).ok).toBe(true);
    // 6 min antes o después: fuera
    expect(verifyMpSignature({ ...base, nowMs: nowMs + 6 * 60 * 1000 })).toEqual({ ok: false, reason: "stale_timestamp" });
    expect(verifyMpSignature({ ...base, nowMs: nowMs - 6 * 60 * 1000 })).toEqual({ ok: false, reason: "stale_timestamp" });
    // El ejemplo de la documentación oficial (enero de 2024), firmado y verificado en su momento
    const docTs = "1704908010";
    expect(verifyMpSignature({
      xSignature: sign({ dataId: "a", requestId: "r", ts: docTs }),
      xRequestId: "r", dataId: "a", secret: SECRET, nowMs: 1_704_908_010_000 + 30_000,
    }).ok).toBe(true);
  });

  it("una firma en segundos con el secreto equivocado sigue rechazada", () => {
    const tsSec = String(Math.floor(NOW / 1000));
    expect(verifyMpSignature({
      xSignature: sign({ dataId: "a", requestId: "r", ts: tsSec }, "otra-clave"),
      xRequestId: "r", dataId: "a", secret: SECRET, nowMs: NOW,
    })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("verifica igual cuando falta x-request-id (manifiesto sin esa parte)", () => {
    const res = verifyMpSignature({
      xSignature: sign({ dataId: "ORD1", ts }),
      xRequestId: null,
      dataId:     "ORD1",
      secret:     SECRET,
      nowMs:      NOW,
    });
    expect(res.ok).toBe(true);
  });

  it("la firma de MP sobre data.id en minúsculas valida aunque la query lo traiga en mayúsculas", () => {
    // MP firma "id:ord01abc;" (minúsculas); la query trae ORD01ABC
    const manifest = "id:ord01abc;request-id:r;ts:" + ts + ";";
    const xSignature = `ts=${ts},v1=${signMpManifest(manifest, SECRET)}`;
    expect(verifyMpSignature({ xSignature, xRequestId: "r", dataId: "ORD01ABC", secret: SECRET, nowMs: NOW }).ok).toBe(true);
  });
});
