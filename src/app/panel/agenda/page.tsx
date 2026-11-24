import { redirect } from "next/navigation";
import { getOwnerVenues } from "@/lib/supabase/panel-queries";
import Link from "next/link";

export default async function AgendaIndexPage() {
  const venues = await getOwnerVenues();

  if (venues.length === 0) {
    return (
      <div className="text-center py-12 text-ink-muted">
        No tenés complejos registrados.{" "}
        <Link href="/panel/complejos/nuevo" className="text-brand hover:underline">
          Crear uno
        </Link>
      </div>
    );
  }

  if (venues.length === 1) {
    redirect(`/panel/complejos/${venues[0].id}/agenda`);
  }

  // Multiple venues: show selector
  return (
    <div>
      <h1 className="text-xl font-semibold text-ink mb-6">Agenda — elegí un complejo</h1>
      <div className="space-y-3">
        {venues.map((v) => (
          <Link
            key={v.id}
            href={`/panel/complejos/${v.id}/agenda`}
            className="flex items-center justify-between rounded-xl border border-line bg-surface px-5 py-4 hover:border-primary transition-colors"
          >
            <div>
              <p className="font-medium text-ink">{v.name}</p>
              <p className="text-sm text-ink-muted">{v.locality_name}</p>
            </div>
            <span className="text-ink-muted text-sm">Ver agenda →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
