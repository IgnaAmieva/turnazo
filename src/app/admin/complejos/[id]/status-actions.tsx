'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { setVenueStatusAction, type AdminActionState } from '@/app/actions/admin';
import { ADMIN_ACTION, VENUE_STATUS, actionsFor, isVenueStatus, type AdminAction } from '@/lib/venue-status';

/**
 * Aprobar / Rechazar / Suspender / Reactivar, cada una con una hoja de
 * confirmación (Rechazar pide el motivo). Después de aprobar o rechazar:
 * aviso de que el dueño recibe el push y el botón de WhatsApp con el mensaje armado.
 */
export function VenueStatusActions({ venueId, venueName, status }: { venueId: string; venueName: string; status: string }) {
  const [state, formAction, pending] = useActionState<AdminActionState, FormData>(setVenueStatusAction, {});
  const [confirming, setConfirming] = useState<AdminAction | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const actions = actionsFor(status);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (confirming && !d.open) d.showModal();
    if (!confirming && d.open) d.close();
  }, [confirming]);

  // Guardado: cerrar la hoja (el estado nuevo llega con la página revalidada)
  const [handled, setHandled] = useState<AdminActionState | null>(null);
  if (state.ok && handled !== state) {
    setHandled(state);
    setConfirming(null);
  }

  const cfg = confirming ? ADMIN_ACTION[confirming] : null;
  const done = state.ok && state.action ? ADMIN_ACTION[state.action] : null;
  const newLabel = state.newStatus && isVenueStatus(state.newStatus) ? VENUE_STATUS[state.newStatus].label : null;

  return (
    <section className="mt-4" aria-label="Acciones">
      {state.ok && done && (
        <div role="status" data-testid="accion-hecha" className="mb-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-ink">
          <p className="font-extrabold">Listo: {newLabel ? `quedó ${newLabel.toLowerCase()}` : 'guardado'}.</p>
          {(state.action === 'approve' || state.action === 'reject') && (
            <>
              <p className="mt-1">Al dueño le llega un aviso al celular si activó las notificaciones. También podés escribirle:</p>
              {state.whatsappUrl && (
                <a href={state.whatsappUrl} target="_blank" rel="noopener noreferrer" data-testid="whatsapp-dueno"
                  className="mt-2 inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-extrabold text-on-primary hover:opacity-90">
                  Avisarle por WhatsApp
                </a>
              )}
            </>
          )}
        </div>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button key={a} type="button" onClick={() => setConfirming(a)} data-testid={`accion-${a}`}
              className={`inline-flex min-h-11 items-center rounded-full px-5 text-sm font-extrabold
                ${ADMIN_ACTION[a].danger
                  ? 'border border-danger/60 bg-surface text-danger hover:bg-danger-soft'
                  : 'bg-primary text-on-primary hover:opacity-90'}`}>
              {ADMIN_ACTION[a].label}
            </button>
          ))}
        </div>
      )}

      <dialog ref={dialogRef} onClose={() => setConfirming(null)} data-testid="confirmar"
        aria-labelledby="confirmar-titulo"
        className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-3xl border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-black/50">
        {cfg && confirming && (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="venue_id" value={venueId} />
            <input type="hidden" name="action" value={confirming} />
            <h2 id="confirmar-titulo" className="text-lg font-extrabold">{cfg.label} {venueName}</h2>
            <p className="text-sm">
              {confirming === 'approve' && 'Va a aparecer en la web y los jugadores van a poder reservar. Al dueño le avisamos.'}
              {confirming === 'reject' && 'No va a aparecer en la web. Al dueño le avisamos con el motivo.'}
              {confirming === 'suspend' && 'Deja de aparecer en la web y nadie puede reservar. Las reservas hechas no se cancelan.'}
              {confirming === 'reactivate' && 'Vuelve a aparecer en la web y se puede reservar de nuevo.'}
            </p>
            {cfg.reason !== 'none' && (
              <div>
                <label htmlFor="reason" className="mb-1.5 block text-sm font-medium">
                  Motivo{cfg.reason === 'optional' ? ' (opcional)' : ''}
                </label>
                <textarea id="reason" name="reason" rows={3} maxLength={500} required={cfg.reason === 'required'} minLength={cfg.reason === 'required' ? 5 : undefined}
                  placeholder={confirming === 'reject' ? 'Ej: el pin del mapa no coincide con la dirección' : ''}
                  className="w-full rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink placeholder-ink-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25" />
              </div>
            )}
            {state.error && <p role="alert" data-testid="accion-error" className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">{state.error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setConfirming(null)}
                className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-5 text-sm font-extrabold text-ink hover:bg-surface-2">
                Cancelar
              </button>
              <button type="submit" disabled={pending} data-testid="confirmar-si"
                className={`inline-flex min-h-11 items-center rounded-full px-5 text-sm font-extrabold disabled:opacity-60
                  ${cfg.danger ? 'bg-danger text-bg hover:opacity-90' : 'bg-primary text-on-primary hover:opacity-90'}`}>
                {pending ? 'Guardando…' : cfg.confirm}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </section>
  );
}
