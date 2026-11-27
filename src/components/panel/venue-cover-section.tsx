"use client";

import { startTransition, useActionState, useState } from "react";
import type { PanelActionState } from "@/app/actions/panel";
import { LOGO_SEND_MAX_BYTES, LOGO_UPLOAD_MAX_BYTES, venueLogoUrl } from "@/lib/venue-logo";
import { useSavedNotice } from "@/components/panel/saved-toast";
import { fitForUpload } from "@/components/panel/venue-logo-section";

type Action = (state: PanelActionState, formData: FormData) => Promise<PanelActionState>;

const TOO_BIG = "La foto puede pesar hasta 10 MB.";
const CANT_PREPARE = "No pudimos preparar esta foto. Probá con una más liviana o en JPG.";

/**
 * Foto de portada (029): ocupa la portada de la página del complejo, con un
 * degradado oscuro abajo para que el nombre se lea. Sin foto, la portada verde
 * con las líneas de la cancha. Hasta 10 MB: el servidor la achica a 1600 px y
 * menos de 500 KB sin cambiarle el formato.
 */
export function VenueCoverSection({ name, coverPath, upload, remove }: {
  name: string; coverPath: string | null; upload: Action; remove: Action;
}) {
  const [upState, upAction, uploading] = useActionState(upload, null);
  const [rmState, rmAction, removing] = useActionState(remove, null);
  useSavedNotice(uploading, upState, "Foto guardada");
  useSavedNotice(removing, rmState, "Foto quitada");
  const [tooBig, setTooBig] = useState(false);
  const [prepareError, setPrepareError] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const url = venueLogoUrl(coverPath);
  const error = tooBig ? TOO_BIG : prepareError ? CANT_PREPARE
    : upState?.fieldErrors?.cover?.[0] ?? upState?.error ?? rmState?.error;
  const busy = uploading || preparing;

  async function send(formData: FormData) {
    const file = formData.get("cover");
    if (file instanceof File && file.size > LOGO_SEND_MAX_BYTES) {
      setPreparing(true);
      const fitted = await fitForUpload(file);
      setPreparing(false);
      if (!fitted) { setPrepareError(true); return; }
      formData.set("cover", fitted);
    }
    startTransition(() => upAction(formData));
  }

  return (
    <div className="bg-surface rounded-2xl border border-line p-6" data-testid="seccion-portada">
      <h2 className="text-lg font-semibold text-ink mb-1">Foto de portada</h2>
      <p className="text-sm text-ink-muted mb-4">
        Va arriba de todo en la página del complejo. Mejor una foto horizontal de las canchas. PNG, JPG o WebP, hasta 10 MB: la achicamos nosotros.
      </p>

      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- archivo del bucket público, ya achicado
        <img src={url} alt={`Foto de portada de ${name}`} className="mb-4 aspect-[2/1] w-full max-w-md rounded-xl object-cover" data-testid="portada-actual" />
      ) : (
        <p className="mb-4 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-muted" data-testid="portada-vacia">
          Sin foto: se ve la portada verde con las líneas de la cancha.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <form action={send} className="flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="cover">Archivo de la foto de portada</label>
          <input
            id="cover" name="cover" type="file" required
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
            {busy ? "Subiendo…" : url ? "Cambiar foto" : "Subir foto"}
          </button>
        </form>

        {url && (
          <form action={rmAction}>
            <button
              type="submit"
              disabled={removing}
              className="min-h-11 rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-primary disabled:opacity-60"
            >
              {removing ? "Quitando…" : "Quitar foto"}
            </button>
          </form>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-soft border border-danger/40 px-4 py-3 text-sm text-danger" data-testid="portada-error">
          {error}
        </p>
      )}
    </div>
  );
}
