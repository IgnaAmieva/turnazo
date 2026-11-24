import { createVenueAction } from "@/app/actions/panel";
import { VenueForm } from "@/components/panel/venue-form";
import { getLocalities } from "@/lib/supabase/queries";
import Link from "next/link";

export default async function NuevoComplejoPage() {
  const localities = await getLocalities();

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/panel/complejos" className="text-sm text-ink-muted hover:text-ink">
          ← Complejos
        </Link>
        <span className="text-ink-muted">/</span>
        <h1 className="text-xl font-semibold text-ink">Nuevo complejo</h1>
      </div>

      <div className="bg-surface rounded-2xl border border-line p-6">
        <VenueForm action={createVenueAction} localities={localities} submitLabel="Crear complejo" />
      </div>
    </div>
  );
}
