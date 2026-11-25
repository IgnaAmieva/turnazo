"use client";

import { startTransition, useActionState, useState } from "react";
import type { PanelActionState } from "@/app/actions/panel";
import { initials, LOGO_SEND_MAX_BYTES, LOGO_UPLOAD_MAX_BYTES, venueLogoUrl } from "@/lib/venue-logo";
import { useSavedNotice } from "@/components/panel/saved-toast";

type Action = (state: PanelActionState, formData: FormData) => Promise<PanelActionState>;

const TOO_BIG = "El logo puede pesar hasta 10 MB.";
const CANT_PREPARE = "No pudimos preparar esta imagen. Probá con una más liviana o en JPG.";

/**
 * Vercel no deja pasar pedidos de más de 4,5 MB. Si el archivo pesa más de
 * 4 MB, se baja acá a 2048 px (y si hace falta a 1024) en el MISMO formato; el
 * achicado de verdad (1024 px, < 512 KB) lo hace el servidor. null si el
 * navegador no puede (por ejemplo, no sabe guardar WebP).
 */
async function fitForUpload(file: File): Promise<File | null> {
  if (file.size <= LOGO_SEND_MAX_BYTES) return file;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return null;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    for (const side of [2048, 1024]) {
      const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, file.type, 0.92));
      if (!blob || blob.type !== file.type) return null;
      if (blob.size <= LOGO_SEND_MAX_BYTES) return new File([blob], file.name, { type: file.type });
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Logo del club: se ve en la portada del complejo y en las historias, entero
 * y como se subió. Sin logo, las iniciales. Hasta 10 MB: el servidor lo achica
 * a 1024 px y menos de 512 KB sin cambiarle el formato.
 */
export function VenueLogoSection({ name, logoPath, upload, remove }: {
  name: string; logoPath: string | null; upload: Action; remove: Action;
}) {
  const [upState, upAction, uploading] = useActionState(upload, null);
  const [rmState, rmAction, removing] = useActionState(remove, null);
  useSavedNotice(uploading, upState, "Logo guardado");
  useSavedNotice(removing, rmState, "Logo quitado");
  const [tooBig, setTooBig] = useState(false);
  const [prepareError, setPrepareError] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const url = venueLogoUrl(logoPath);
  const error = tooBig ? TOO_BIG : prepareError ? CANT_PREPARE
    : upState?.fieldErrors?.logo?.[0] ?? upState?.error ?? rmState?.error;
  const busy = uploading || preparing;

  async function send(formData: FormData) {
    const file = formData.get("logo");
    if (file instanceof File && file.size > LOGO_SEND_MAX_BYTES) {
      setPreparing(true);
      const fitted = await fitForUpload(file);
      setPreparing(false);
      if (!fitted) { setPrepareError(true); return; }
      formData.set("logo", fitted);
    }
    startTransition(() => upAction(formData));
  }

  return (
    <div className="bg-surface rounded-2xl border border-line p-6" data-testid="seccion-logo">
      <h2 className="text-lg font-semibold text-ink mb-1">Logo del club</h2>
      <p className="text-sm text-ink-muted mb-4">
        Se ve en la página del complejo y en las historias. PNG, JPG o WebP, hasta 10 MB: lo achicamos nosotros.
      </p>

      <div className="flex flex-wrap items-center gap-4">
        {url ? (
          // Entero y como se subió: sin recorte ni fondo (respeta la transparencia)
          // eslint-disable-next-line @next/next/no-img-element -- archivo chico del bucket público
          <img src={url} alt={`Logo de ${name}`} className="h-20 w-20 shrink-0 object-contain" data-testid="logo-actual" />
        ) : (
          <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-accent text-3xl font-extrabold text-on-accent" data-testid="logo-iniciales">
            {initials(name)}
          </span>
        )}

        <form action={send} className="flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="logo">Archivo del logo</label>
          <input
            id="logo" name="logo" type="file" required
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              setPrepareError(false);
              setTooBig((e.currentTarget.files?.[0]?.size ?? 0) > LOGO_UPLOAD_MAX_BYTES);
            }}
            className="min-h-11 max-w-full text-sm text-ink file:mr-3 file:min-h-11 file:rounded-xl file:border file:border-line file:bg-surface-2 file:px-4 file:text-sm file:font-medium file:text-ink"
          />
          <button
            type="submit"
            disabled={busy || tooBig}
            className="min-h-11 rounded-xl bg-primary px-5 text-sm font-medium text-on-primary shadow-sm hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Subiendo…" : url ? "Cambiar logo" : "Subir logo"}
          </button>
        </form>

        {url && (
          <form action={rmAction}>
            <button
              type="submit"
              disabled={removing}
              className="min-h-11 rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-primary disabled:opacity-60"
            >
              {removing ? "Quitando…" : "Quitar logo"}
            </button>
          </form>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft border border-danger/40 px-4 py-3 text-sm text-danger" data-testid="logo-error">
          {error}
        </p>
      )}
    </div>
  );
}
