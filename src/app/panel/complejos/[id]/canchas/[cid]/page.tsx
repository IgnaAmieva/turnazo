import { notFound } from "next/navigation";
import Link from "next/link";
import { getOwnerVenue, getCourt, getVenueCourtsWithSchedules } from "@/lib/supabase/panel-queries";
import { getSports } from "@/lib/supabase/queries";
import { updateCourtAction, saveCourtHoursAction, saveCourtPricesAction } from "@/app/actions/panel";
import { CourtForm } from "@/components/panel/court-form";
import { CourtHoursEditor } from "@/components/panel/court-hours-editor";
import { CourtPricesEditor } from "@/components/panel/court-prices-editor";
import { CourtLoadedBanner, CourtSteps } from "@/components/panel/court-steps";
import { unpricedRanges } from "@/lib/price-coverage";

type Unpriced = { from: string; to: string; days: string }[];

/** Horarios abiertos sin precio, avisados ahí mismo (los jugadores no los pueden reservar). */
function UnpricedWarning({ unpriced }: { unpriced: Unpriced }) {
  if (unpriced.length === 0) return null;
  return (
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
  );
}

/**
 * Cancha del panel. Con ?paso=precios / ?paso=listo es la carga por pasos
 * (2 Precios, 3 Listo; el 1 es /canchas/nuevo); sin paso, la edición.
 */
export default async function EditarCanchaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; cid: string }>;
  searchParams: Promise<{ paso?: string }>;
}) {
  const { id, cid } = await params;
  const { paso } = await searchParams;
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
  const unpriced: Unpriced = [...byRange.values()].map((r) => ({
    from: r.from, to: r.to, days: r.days.length === 7 ? "todos los días" : r.days.map((d) => DAYS[d]).join(", "),
  }));
  const base = `/panel/complejos/${id}/canchas/${cid}`;

  const pricesSection = (
    <section className="bg-surface rounded-2xl border border-line p-5">
      <h2 className="text-base font-semibold text-ink mb-1">Precios por franja</h2>
      <p className="text-sm text-ink-muted mb-4">
        Cada fila define el precio de una franja horaria de un día de la semana.
      </p>
      <UnpricedWarning unpriced={unpriced} />
      <CourtPricesEditor
        action={boundSavePrices}
        initialPrices={court.prices}
        otherCourts={otherCourts}
        courtHours={court.hours}
        slotMinutes={court.slot_minutes}
      />
    </section>
  );
  const hoursSection = (
    <section className="bg-surface rounded-2xl border border-line p-5">
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
  );

  // Paso 2 de 3: precios (y el horario, que define qué hay que cubrir)
  if (paso === "precios") {
    return (
      <div className="max-w-2xl pb-28">
        <CourtSteps step={2} title={court.name} />
        <CourtLoadedBanner
          title={`${court.name} cargada`}
          detail={!court.active ? "Está oculta para los jugadores." : unpriced.length > 0 ? "Ya aparece en la app. Te faltan los precios." : "Ya aparece en la app."}
        />
        <div className="space-y-6">
          {pricesSection}
          {hoursSection}
        </div>
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur md:left-56">
          <div className="mx-auto max-w-2xl">
            <Link href={`${base}?paso=listo`}
              className="flex min-h-12 items-center justify-center rounded-2xl bg-primary px-5 text-base font-extrabold text-on-primary shadow-sm hover:opacity-90">
              Siguiente: listo →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Paso 3 de 3: listo (o qué falta)
  if (paso === "listo") {
    const link = "flex min-h-12 items-center justify-center rounded-2xl px-5 text-base font-extrabold";
    return (
      <div className="max-w-lg">
        <CourtSteps step={3} title={court.name} />
        {unpriced.length === 0 ? (
          <CourtLoadedBanner title={`${court.name} lista`} detail={court.active ? "Ya se puede reservar." : "Está oculta para los jugadores."} />
        ) : (
          <>
            <UnpricedWarning unpriced={unpriced} />
            <Link href={`${base}?paso=precios`} className={`${link} mb-3 bg-primary text-on-primary`}>Cargar los precios que faltan</Link>
          </>
        )}
        <div className="flex flex-col gap-3">
          <Link href={`/panel/complejos/${id}/agenda`} className={`${link} ${unpriced.length === 0 ? "bg-primary text-on-primary" : "border border-line bg-surface text-ink"}`}>
            Ver la agenda
          </Link>
          <Link href={`/panel/complejos/${id}/canchas/nuevo`} className={`${link} border border-line bg-surface text-ink`}>
            Cargar otra cancha
          </Link>
          <Link href={`/panel/complejos/${id}/canchas`} className={`${link} text-ink-muted`}>
            Volver a las canchas
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Link href="/panel/complejos" className="inline-flex min-h-11 items-center text-sm text-ink-muted hover:text-ink">← Complejos</Link>
        <span className="text-ink-muted">/</span>
        <Link href={`/panel/complejos/${id}/canchas`} className="inline-flex min-h-11 items-center text-sm text-ink-muted hover:text-ink">{venue.name}</Link>
        <span className="text-ink-muted">/</span>
        <h1 className="text-xl font-semibold text-ink truncate">{court.name}</h1>
      </div>

      <div className="space-y-6">
        {/* Información básica */}
        <section className="bg-surface rounded-2xl border border-line p-5">
          <h2 className="text-base font-semibold text-ink mb-4">Información básica</h2>
          <CourtForm
            action={boundUpdateCourt}
            sports={sports}
            court={court}
            submitLabel="Guardar info"
          />
        </section>

        {hoursSection}
        {pricesSection}
      </div>
    </div>
  );
}
