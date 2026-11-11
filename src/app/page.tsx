import { getLocalities } from "@/lib/supabase/queries";
import { APP_NAME } from "@/lib/constants";
import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: "¿Dónde querés jugar?" };

export default async function HomePage() {
  const localities = await getLocalities();

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">{APP_NAME}</h1>
      <p className="text-gray-500 mb-8">¿En qué localidad querés reservar?</p>

      <ul className="grid grid-cols-2 gap-3">
        {localities.map((loc) => (
          <li key={loc.id}>
            <Link
              href={`/${loc.slug}`}
              className="block rounded-2xl border border-gray-200 bg-white p-6 text-center
                shadow-sm hover:border-green-400 hover:shadow-md transition-all"
            >
              <span className="text-lg font-semibold text-gray-800">{loc.name}</span>
            </Link>
          </li>
        ))}
      </ul>

      {localities.length === 0 && (
        <p className="text-center text-gray-400 py-16">
          No hay localidades disponibles todavía.
        </p>
      )}
    </div>
  );
}
