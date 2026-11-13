import { notFound } from "next/navigation";
import { getOwnerVenue } from "@/lib/supabase/panel-queries";
import { getLocalities } from "@/lib/supabase/queries";
import { updateVenueAction } from "@/app/actions/panel";
import { VenueForm } from "@/components/panel/venue-form";
import Link from "next/link";

export default async function EditarComplejoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [venue, localities] = await Promise.all([
    getOwnerVenue(id),
    getLocalities(),
  ]);

  if (!venue) notFound();

  const boundAction = updateVenueAction.bind(null, id);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/panel/complejos" className="text-sm text-gray-500 hover:text-gray-700">
          ← Complejos
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-semibold text-gray-900 truncate">{venue.name}</h1>
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href={`/panel/complejos/${id}/canchas`}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:border-green-400 hover:text-green-700 transition-colors"
        >
          Canchas
        </Link>
        <Link
          href={`/panel/complejos/${id}/agenda`}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:border-green-400 hover:text-green-700 transition-colors"
        >
          Agenda
        </Link>
        <Link
          href={`/panel/complejos/${id}/bloqueados`}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:border-green-400 hover:text-green-700 transition-colors"
        >
          Teléfonos bloqueados
        </Link>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <VenueForm
          action={boundAction}
          localities={localities}
          venue={venue}
          submitLabel="Guardar cambios"
        />
      </div>
    </div>
  );
}
