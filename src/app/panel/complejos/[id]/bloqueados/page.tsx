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
        <Link href="/panel/complejos" className="text-sm text-ink-muted hover:text-ink">
          ← Complejos
        </Link>
        <span className="text-ink-muted">/</span>
        <Link
          href={`/panel/complejos/${id}`}
          className="text-sm text-ink-muted hover:text-ink truncate"
        >
          {venue.name}
        </Link>
        <span className="text-ink-muted">/</span>
        <h1 className="text-xl font-semibold text-ink">Teléfonos bloqueados</h1>
      </div>

      <div className="bg-surface rounded-2xl border border-line">
        {phones.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-ink-muted">
            No hay teléfonos bloqueados en este complejo.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {phones.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between px-6 py-4">
                <div>
                  <p className="text-sm font-medium text-ink font-mono">{entry.phone}</p>
                  <p className="text-xs text-ink-muted mt-0.5">
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
