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
        <Link href="/panel/complejos" className="text-sm text-ink-muted hover:text-ink">← Complejos</Link>
        <span className="text-ink-muted">/</span>
        <Link href={`/panel/complejos/${id}`} className="text-sm text-ink-muted hover:text-ink">{venue.name}</Link>
        <span className="text-ink-muted">/</span>
        <h1 className="text-xl font-semibold text-ink">Canchas</h1>
      </div>

      <div className="flex justify-end mb-4">
        <Link
          href={`/panel/complejos/${id}/canchas/nuevo`}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90 transition-colors"
        >
          + Nueva cancha
        </Link>
      </div>

      {courts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-10 text-center">
          <p className="text-ink-muted text-sm">Este complejo no tiene canchas todavía.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {courts.map((c) => (
            <div key={c.id} className="bg-surface rounded-2xl border border-line px-5 py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-ink">{c.name}</p>
                <p className="text-sm text-ink-muted">{c.sport_name} · {c.slot_minutes} min</p>
              </div>
              {!c.active && (
                <span className="shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset bg-surface-2 text-ink-muted ring-line">
                  Inactiva
                </span>
              )}
              <Link
                href={`/panel/complejos/${id}/canchas/${c.id}`}
                className="shrink-0 text-sm text-brand hover:text-ink border border-line rounded-lg px-3 min-h-11 inline-flex items-center"
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
