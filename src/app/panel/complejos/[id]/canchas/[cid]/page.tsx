import { notFound } from "next/navigation";
import Link from "next/link";
import { getOwnerVenue, getCourt, getVenueCourtsWithSchedules } from "@/lib/supabase/panel-queries";
import { getSports } from "@/lib/supabase/queries";
import { updateCourtAction, saveCourtHoursAction, saveCourtPricesAction } from "@/app/actions/panel";
import { CourtForm } from "@/components/panel/court-form";
import { CourtHoursEditor } from "@/components/panel/court-hours-editor";
import { CourtPricesEditor } from "@/components/panel/court-prices-editor";
import { unpricedRanges } from "@/lib/price-coverage";

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

  // Horarios abiertos sin precio, agrupados por tramo: "22:00 a 00:00 · dom, lun, …"
  const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const byRange = new Map<string, { from: string; to: string; days: number[] }>();
  for (const u of unpricedRanges(court.hours, court.prices, court.slot_minutes)) {
    const k = `${u.from}-${u.to}`;
    const cur = byRange.get(k) ?? { from: u.from, to: u.to, days: [] };
    cur.days.push(u.weekday);
    byRange.set(k, cur);
  }
  const unpriced = [...byRange.values()].map((r) => ({
    from: r.from, to: r.to, days: r.days.length === 7 ? "todos los días" : r.days.map((d) => DAYS[d]).join(", "),
  }));

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/panel/complejos" className="text-sm text-ink-muted hover:text-ink">← Complejos</Link>
        <span className="text-ink-muted">/</span>
        <Link href={`/panel/complejos/${id}/canchas`} className="text-sm text-ink-muted hover:text-ink">{venue.name}</Link>
        <span className="text-ink-muted">/</span>
        <h1 className="text-xl font-semibold text-ink truncate">{court.name}</h1>
      </div>

      <div className="space-y-6">
        {/* Información básica */}
        <section className="bg-surface rounded-2xl border border-line p-6">
          <h2 className="text-base font-semibold text-ink mb-4">Información básica</h2>
          <CourtForm
            action={boundUpdateCourt}
            sports={sports}
            court={court}
            submitLabel="Guardar info"
          />
        </section>

        {/* Horarios */}
        <section className="bg-surface rounded-2xl border border-line p-6">
          <h2 className="text-base font-semibold text-ink mb-1">Horarios de apertura</h2>
          <p className="text-sm text-ink-muted mb-4">
            Cada tramo define un bloque de disponibilidad. Los horarios que cruzan la medianoche también son soportados (ej: 23:00 → 01:00).
          </p>
          <CourtHoursEditor
            action={boundSaveHours}
            initialHours={court.hours}
            otherCourts={otherCourts}
          />
        </section>

        {/* Precios */}
        <section className="bg-surface rounded-2xl border border-line p-6">
          <h2 className="text-base font-semibold text-ink mb-1">Precios por franja</h2>
          <p className="text-sm text-ink-muted mb-4">
            Cada fila define el precio de una franja horaria de un día de la semana.
          </p>
          {unpriced.length > 0 && (
            <div role="status" data-testid="sin-precio"
              className="mb-4 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-ink">
              <p className="font-semibold">Hay turnos sin precio: los jugadores no los pueden reservar.</p>
              <ul className="mt-1 list-disc pl-5">
                {unpriced.map((u) => (
                  <li key={`${u.from}-${u.to}`}>{u.from} a {u.to} · {u.days}</li>
                ))}
              </ul>
              <p className="mt-1 text-ink-muted">Agregá una franja que cubra esos horarios.</p>
            </div>
          )}
          <CourtPricesEditor
            action={boundSavePrices}
            initialPrices={court.prices}
            otherCourts={otherCourts}
            courtHours={court.hours}
            slotMinutes={court.slot_minutes}
          />
        </section>
      </div>
    </div>
  );
}
