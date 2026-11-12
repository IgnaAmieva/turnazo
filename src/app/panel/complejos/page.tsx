import Link from "next/link";
import { getOwnerVenues } from "@/lib/supabase/panel-queries";

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  pending:   { label: "Pendiente",  className: "bg-yellow-50 text-yellow-700 ring-yellow-200" },
  approved:  { label: "Aprobado",   className: "bg-green-50  text-green-700  ring-green-200"  },
  suspended: { label: "Suspendido", className: "bg-red-50    text-red-700    ring-red-200"    },
};

export default async function ComplejosPage() {
  const venues = await getOwnerVenues();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Mis complejos</h1>
        <Link
          href="/panel/complejos/nuevo"
          className="rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
        >
          + Nuevo complejo
        </Link>
      </div>

      {venues.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center">
          <p className="text-gray-500 text-sm mb-4">Todavía no tenés complejos registrados.</p>
          <Link
            href="/panel/complejos/nuevo"
            className="rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            Crear el primero
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {venues.map((v) => {
            const st = STATUS_LABEL[v.status] ?? STATUS_LABEL.pending;
            return (
              <div key={v.id} className="bg-white rounded-2xl border border-gray-200 px-5 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{v.name}</p>
                  <p className="text-sm text-gray-500 truncate">{v.address} · {v.locality_name}</p>
                </div>
                <span className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${st.className}`}>
                  {st.label}
                </span>
                <div className="shrink-0 flex gap-2">
                  <Link
                    href={`/panel/complejos/${v.id}/canchas`}
                    className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5"
                  >
                    Canchas
                  </Link>
                  <Link
                    href={`/panel/complejos/${v.id}`}
                    className="text-sm text-green-700 hover:text-green-900 border border-green-200 rounded-lg px-3 py-1.5"
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
