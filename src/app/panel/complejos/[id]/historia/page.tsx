import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getStoryData, STORY_DAYS, dayLabel } from '@/lib/stories';
import { todayInMendoza } from '@/lib/slots';
import { nextDate } from '@/lib/free-slots';
import { StoryPicker } from './story-picker';

export const dynamic = 'force-dynamic';

/** "Compartir turnos libres": el dueño elige día, deporte y estilo, y descarga o comparte la historia. */
export default async function HistoriaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getStoryData(id, {});
  if (!data) notFound();

  const today = todayInMendoza();
  const days: { value: string; label: string }[] = [];
  for (let d = today, i = 0; i < STORY_DAYS; i++, d = nextDate(d)) days.push({ value: d, label: dayLabel(d, today) });

  return (
    <div className="max-w-2xl">
      <Link href={`/panel/complejos/${id}/agenda`} className="inline-flex min-h-11 items-center text-sm text-ink-muted hover:text-ink">
        ← Agenda
      </Link>
      <h1 className="text-xl font-extrabold text-ink">Compartir turnos libres</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Una historia para WhatsApp o Instagram con hasta 6 turnos libres de {data.venueName}.
      </p>
      <StoryPicker venueId={id} days={days} sports={data.sports} />
    </div>
  );
}
