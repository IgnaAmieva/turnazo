import Link from "next/link";
import { getOwnerVenues } from "@/lib/supabase/panel-queries";
import { venueStatus } from "@/lib/venue-status";

/** Qué significa cada estado para el dueño (el motivo lo escribe el superadmin). */
const STATUS_HELP: Record<string, string> = {
  pending:   "Lo estamos revisando. Cuando lo aprobemos te avisamos y aparece en la web.",
  rejected:  "No lo pudimos aprobar. Corregí lo que dice el motivo y escribinos.",
  suspended: "Está suspendido: no aparece en la web y no se puede reservar.",
};

export default async function ComplejosPage() {
  const venues = await getOwnerVenues();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-ink">Mis complejos</h1>
        <Link
          href="/panel/complejos/nuevo"
          className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90 transition-colors"
        >
          + Nuevo complejo
        </Link>
      </div>

      {venues.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-10 text-center">
          <p className="text-ink-muted text-sm mb-4">Todavía no tenés complejos registrados.</p>
          <Link
            href="/panel/complejos/nuevo"
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90"
          >
            Crear el primero
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {venues.map((v) => {
            const st = venueStatus(v.status);
            const help = STATUS_HELP[v.status];
            return (
              // Celular: nombre y estado arriba, el texto a lo ancho y los botones abajo
              <div key={v.id} data-testid="mi-complejo" className="bg-surface rounded-2xl border border-line px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium text-ink truncate">{v.name}</p>
                    <span data-testid="estado" className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${st.className}`}>
                      {st.label}
                    </span>
                  </div>
                  <p className="text-sm text-ink-muted truncate">{v.address} · {v.locality_name}</p>
                  {help && <p className="mt-1 text-sm text-ink">{help}</p>}
                  {v.status_reason && (v.status === "rejected" || v.status === "suspended") && (
                    <p className="mt-1 text-sm text-ink" data-testid="motivo">Motivo: {v.status_reason}</p>
                  )}
                </div>
                <div className="shrink-0 flex gap-2">
                  <Link
                    href={`/panel/complejos/${v.id}/canchas`}
                    className="text-sm text-ink hover:text-ink border border-line rounded-lg px-3 min-h-11 inline-flex items-center"
                  >
                    Canchas
                  </Link>
                  <Link
                    href={`/panel/complejos/${v.id}`}
                    className="text-sm text-brand hover:text-ink border border-line rounded-lg px-3 min-h-11 inline-flex items-center"
                  >
                    Editar
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
