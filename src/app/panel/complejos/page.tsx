import Link from "next/link";
import { getOwnerVenues } from "@/lib/supabase/panel-queries";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  pending:   { label: "Pendiente",  className: "bg-warning-soft text-warning ring-warning/40" },
  approved:  { label: "Aprobado",   className: "bg-accent  text-on-accent  ring-transparent"  },
  suspended: { label: "Suspendido", className: "bg-danger-soft    text-danger    ring-danger/40"    },
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
            const st = STATUS_LABEL[v.status] ?? STATUS_LABEL.pending;
            return (
              <div key={v.id} className="bg-surface rounded-2xl border border-line px-5 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-ink truncate">{v.name}</p>
                  <p className="text-sm text-ink-muted truncate">{v.address} · {v.locality_name}</p>
                </div>
                <span className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${st.className}`}>
                  {st.label}
                </span>
                <div className="shrink-0 flex gap-2">
                  <Link
                    href={`/panel/complejos/${v.id}/canchas`}
                    className="text-sm text-ink-muted hover:text-ink border border-line rounded-lg px-3 py-1.5"
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
