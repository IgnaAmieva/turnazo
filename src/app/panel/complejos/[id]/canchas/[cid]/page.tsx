import { notFound } from "next/navigation";
import Link from "next/link";
import { getOwnerVenue, getCourt, getVenueCourtsWithSchedules } from "@/lib/supabase/panel-queries";
import { getSports } from "@/lib/supabase/queries";
import { updateCourtAction, saveCourtHoursAction, saveCourtPricesAction } from "@/app/actions/panel";
import { CourtForm } from "@/components/panel/court-form";
import { CourtHoursEditor } from "@/components/panel/court-hours-editor";
import { CourtPricesEditor } from "@/components/panel/court-prices-editor";

export default async function EditarCanchaPage({
  params,
}: {
  params: Promise<{ id: string; cid: string }>;
}) {
  const { id, cid } = await params;
  const [venue, court, sports, otherCourts] = await Promise.all([
    getOwnerVenue(id),
    getCourt(cid),
    getSports(),
    getVenueCourtsWithSchedules(id, cid),
  ]);

  if (!venue || !court || court.venue_id !== id) notFound();

  const boundUpdateCourt = updateCourtAction.bind(null, id, cid);
  const boundSaveHours   = saveCourtHoursAction.bind(null, id, cid);
  const boundSavePrices  = saveCourtPricesAction.bind(null, id, cid);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/panel/complejos" className="text-sm text-gray-500 hover:text-gray-700">← Complejos</Link>
        <span className="text-gray-300">/</span>
        <Link href={`/panel/complejos/${id}/canchas`} className="text-sm text-gray-500 hover:text-gray-700">{venue.name}</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-semibold text-gray-900 truncate">{court.name}</h1>
      </div>

      <div className="space-y-6">
        {/* Información básica */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Información básica</h2>
          <CourtForm
            action={boundUpdateCourt}
            sports={sports}
            court={court}
            submitLabel="Guardar info"
          />
        </section>

        {/* Horarios */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-1">Horarios de apertura</h2>
          <p className="text-sm text-gray-500 mb-4">
            Cada tramo define un bloque de disponibilidad. Los horarios que cruzan la medianoche también son soportados (ej: 23:00 → 01:00).
          </p>
          <CourtHoursEditor
            action={boundSaveHours}
            initialHours={court.hours}
            otherCourts={otherCourts}
          />
        </section>

        {/* Precios */}
        <section className="bg-white rounded-2xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-1">Precios por franja</h2>
          <p className="text-sm text-gray-500 mb-4">
            Cada fila define el precio de una franja horaria de un día de la semana.
          </p>
          <CourtPricesEditor
            action={boundSavePrices}
            initialPrices={court.prices}
            otherCourts={otherCourts}
          />
        </section>
      </div>
    </div>
  );
}
