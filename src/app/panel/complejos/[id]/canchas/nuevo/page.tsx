import { notFound } from "next/navigation";
import Link from "next/link";
import { getOwnerVenue } from "@/lib/supabase/panel-queries";
import { getSports } from "@/lib/supabase/queries";
import { createCourtAction } from "@/app/actions/panel";
import { CourtForm } from "@/components/panel/court-form";
import { CourtSteps } from "@/components/panel/court-steps";

/** Paso 1 de 3: datos de la cancha. Al guardar, sigue a los precios. */
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
    <div className="max-w-lg">
      <Link href={`/panel/complejos/${id}/canchas`} className="mb-3 inline-flex min-h-11 items-center text-sm text-ink-muted hover:text-ink">
        ← {venue.name}
      </Link>
      <CourtSteps step={1} title="Nueva cancha" />
      <div className="bg-surface rounded-2xl border border-line p-5">
        <CourtForm action={boundAction} sports={sports} submitLabel="Siguiente: precios →" />
      </div>
    </div>
  );
}
