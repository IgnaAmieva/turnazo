"use client";

import { useActionState, useState } from "react";
import type { PanelActionState } from "@/app/actions/panel";
import { initials, LOGO_MAX_BYTES, venueLogoUrl } from "@/lib/venue-logo";

type Action = (state: PanelActionState, formData: FormData) => Promise<PanelActionState>;

/**
 * Logo del club: se ve en la portada del complejo y en las historias. Sin
 * logo, las iniciales. El tamaño se avisa antes de mandar (el servidor lo
 * vuelve a validar, junto con el tipo real del archivo).
 */
export function VenueLogoSection({ name, logoPath, upload, remove }: {
  name: string; logoPath: string | null; upload: Action; remove: Action;
}) {
  const [upState, upAction, uploading] = useActionState(upload, null);
  const [rmState, rmAction, removing] = useActionState(remove, null);
  const [tooBig, setTooBig] = useState(false);
  const url = venueLogoUrl(logoPath);
  const error = tooBig ? "El logo puede pesar hasta 512 KB." : upState?.fieldErrors?.logo?.[0] ?? upState?.error ?? rmState?.error;

  return (
    <div className="bg-surface rounded-2xl border border-line p-6" data-testid="seccion-logo">
      <h2 className="text-lg font-semibold text-ink mb-1">Logo del club</h2>
      <p className="text-sm text-ink-muted mb-4">
        Se ve en la página del complejo y en las historias. PNG, JPG o WebP, hasta 512 KB.
      </p>

      <div className="flex flex-wrap items-center gap-4">
        {url ? (
          <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element -- archivo chico del bucket público */}
            <img src={url} alt={`Logo de ${name}`} className="h-[82%] w-[82%] object-contain" data-testid="logo-actual" />
          </span>
        ) : (
          <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-accent text-3xl font-extrabold text-on-accent" data-testid="logo-iniciales">
            {initials(name)}
          </span>
        )}

        <form action={upAction} className="flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="logo">Archivo del logo</label>
          <input
            id="logo" name="logo" type="file" required
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setTooBig((e.currentTarget.files?.[0]?.size ?? 0) > LOGO_MAX_BYTES)}
            className="min-h-11 max-w-full text-sm text-ink file:mr-3 file:min-h-11 file:rounded-xl file:border file:border-line file:bg-surface-2 file:px-4 file:text-sm file:font-medium file:text-ink"
          />
          <button
            type="submit"
            disabled={uploading || tooBig}
            className="min-h-11 rounded-xl bg-primary px-5 text-sm font-medium text-on-primary shadow-sm hover:opacity-90 disabled:opacity-60"
          >
            {uploading ? "Subiendo…" : url ? "Cambiar logo" : "Subir logo"}
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
