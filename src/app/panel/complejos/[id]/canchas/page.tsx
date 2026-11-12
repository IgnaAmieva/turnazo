import { notFound } from "next/navigation";
import Link from "next/link";
import { getOwnerVenue, getVenueCourts } from "@/lib/supabase/panel-queries";

export default async function CanchasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [venue, courts] = await Promise.all([
    getOwnerVenue(id),
    getVenueCourts(id),
  ]);

  if (!venue) notFound();

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/panel/complejos" className="text-sm text-gray-500 hover:text-gray-700">← Complejos</Link>
        <span className="text-gray-300">/</span>
        <Link href={`/panel/complejos/${id}`} className="text-sm text-gray-500 hover:text-gray-700">{venue.name}</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-semibold text-gray-900">Canchas</h1>
      </div>

      <div className="flex justify-end mb-4">
        <Link
          href={`/panel/complejos/${id}/canchas/nuevo`}
          className="rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
        >
          + Nueva cancha
        </Link>
      </div>

      {courts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center">
          <p className="text-gray-500 text-sm">Este complejo no tiene canchas todavía.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {courts.map((c) => (
            <div key={c.id} className="bg-white rounded-2xl border border-gray-200 px-5 py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900">{c.name}</p>
                <p className="text-sm text-gray-500">{c.sport_name} · {c.slot_minutes} min</p>
              </div>
              {!c.active && (
                <span className="shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset bg-gray-50 text-gray-600 ring-gray-200">
                  Inactiva
                </span>
              )}
              <Link
                href={`/panel/complejos/${id}/canchas/${c.id}`}
                className="shrink-0 text-sm text-green-700 hover:text-green-900 border border-green-200 rounded-lg px-3 py-1.5"
              >
                Configurar
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
