import { getLocalityBySlug, getSports } from "@/lib/supabase/queries";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";


type Props = { params: Promise<{ locality: string }> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locality: slug } = await params;
  const locality = await getLocalityBySlug(slug);
  if (!locality) return { title: "Localidad no encontrada" };
  return { title: `${locality.name} — ¿Qué deporte?` };
}

const SPORT_ICON: Record<string, string> = {
  padel: "🎾",
  futbol: "⚽",
  tenis: "🎾",
};

export default async function LocalityPage({ params }: Props) {
  const { locality: slug } = await params;
  const [locality, sports] = await Promise.all([
    getLocalityBySlug(slug),
    getSports(),
  ]);

  if (!locality) notFound();

  return (
    <div className="max-w-lg mx-auto">
      <nav className="text-sm text-gray-400 mb-6">
        <Link href="/" className="hover:text-green-600">Inicio</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-700">{locality.name}</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">{locality.name}</h1>
      <p className="text-gray-500 mb-8">¿Qué deporte querés jugar?</p>

      <ul className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {sports.map((sport) => (
          <li key={sport.id}>
            <Link
              href={`/${locality.slug}/${sport.slug}`}
              className="block rounded-2xl border border-gray-200 bg-white p-6 text-center
                shadow-sm hover:border-green-400 hover:shadow-md transition-all"
            >
              <div className="text-4xl mb-2">{SPORT_ICON[sport.slug] ?? "🏅"}</div>
              <span className="text-lg font-semibold text-gray-800">{sport.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
