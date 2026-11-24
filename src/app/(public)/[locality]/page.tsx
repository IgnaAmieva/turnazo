import { notFound, redirect } from "next/navigation";
import { getLocalityBySlug } from "@/lib/supabase/queries";

type Props = { params: Promise<{ locality: string }> };

export const dynamic = 'force-dynamic';

/**
 * V2a: el deporte se elige en el inicio, junto con la localidad.
 * /[localidad] sigue funcionando: abre el inicio con esa localidad elegida.
 */
export default async function LocalityPage({ params }: Props) {
  const { locality: slug } = await params;
  const locality = await getLocalityBySlug(slug);
  if (!locality) notFound();
  redirect(`/?localidad=${locality.slug}#elegir`);
}
