import { notFound } from "next/navigation";
import { getBlockedPhones, getOwnerVenue } from "@/lib/supabase/panel-queries";
import { UnblockButton } from "./unblock-button";
import Link from "next/link";

export default async function BlockedPhonesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [venue, phones] = await Promise.all([
    getOwnerVenue(id),
    getBlockedPhones(id),
  ]);

  if (!venue) notFound();

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/panel/complejos" className="text-sm text-gray-500 hover:text-gray-700">
          ← Complejos
        </Link>
        <span className="text-gray-300">/</span>
        <Link
          href={`/panel/complejos/${id}`}
          className="text-sm text-gray-500 hover:text-gray-700 truncate"
        >
          {venue.name}
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-xl font-semibold text-gray-900">Teléfonos bloqueados</h1>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200">
        {phones.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            No hay teléfonos bloqueados en este complejo.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {phones.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between px-6 py-4">
                <div>
                  <p className="text-sm font-medium text-gray-900 font-mono">{entry.phone}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Bloqueado el{" "}
                    {new Date(entry.created_at).toLocaleDateString("es-AR", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <UnblockButton venueId={id} phone={entry.phone} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
