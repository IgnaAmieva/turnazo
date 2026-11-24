import { notFound } from "next/navigation";
import Link from "next/link";
import { getOwnerVenue } from "@/lib/supabase/panel-queries";
import { getSports } from "@/lib/supabase/queries";
import { createCourtAction } from "@/app/actions/panel";
import { CourtForm } from "@/components/panel/court-form";

export default async function NuevaCanchaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [venue, sports] = await Promise.all([
    getOwnerVenue(id),
    getSports(),
  ]);

  if (!venue) notFound();

  const boundAction = createCourtAction.bind(null, id);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/panel/complejos" className="text-sm text-ink-muted hover:text-ink">← Complejos</Link>
        <span className="text-ink-muted">/</span>
        <Link href={`/panel/complejos/${id}/canchas`} className="text-sm text-ink-muted hover:text-ink">{venue.name}</Link>
        <span className="text-ink-muted">/</span>
        <h1 className="text-xl font-semibold text-ink">Nueva cancha</h1>
      </div>

      <div className="bg-surface rounded-2xl border border-line p-6 max-w-lg">
        <CourtForm action={boundAction} sports={sports} submitLabel="Crear cancha" />
      </div>
    </div>
  );
}
