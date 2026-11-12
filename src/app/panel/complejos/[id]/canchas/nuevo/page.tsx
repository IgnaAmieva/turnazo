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
        <Link href="/panel/complejos" className="text-sm text-gray-500 hover:text-gray-700">← Complejos</Link>
        <span className="text-gray-300">/</span>
        <Link href={`/panel/complejos/${id}/canchas`} className="text-sm text-gray-500 hover:text-gray-700">{venue.name}</Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-semibold text-gray-900">Nueva cancha</h1>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 max-w-lg">
        <CourtForm action={boundAction} sports={sports} submitLabel="Crear cancha" />
      </div>
    </div>
  );
}
