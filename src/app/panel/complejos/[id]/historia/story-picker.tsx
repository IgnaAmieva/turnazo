'use client';

import { useState } from 'react';
import { STORY_STYLES, type StoryStyle, type StorySport } from '@/lib/stories-shared';

const FIELD = 'w-full min-h-11 rounded-xl border border-line bg-surface px-3 text-sm text-ink shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25';

export function StoryPicker({ venueId, days, sports }: {
  venueId: string;
  days: { value: string; label: string }[];
  sports: StorySport[];
}) {
  const [date, setDate] = useState(days[0].value);
  const [sport, setSport] = useState(sports[0].slug);
  const [style, setStyle] = useState<StoryStyle>('pizarra');
  const [sharing, setSharing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const src = (s: StoryStyle, download = false) =>
    `/panel/complejos/${venueId}/historia/imagen?${new URLSearchParams({
      fecha: date, deporte: sport, estilo: s, ...(download ? { descargar: '1' } : {}),
    }).toString()}`;
  const fileName = `turnos-${sport}-${date}-${style}.png`;

  async function share() {
    setNote(null);
    setSharing(true);
    try {
      const blob = await (await fetch(src(style))).blob();
      const file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        setNote('Este navegador no comparte imágenes: usá "Descargar" y subila desde la galería.');
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') setNote('No se pudo compartir. Probá con "Descargar".');
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="historia-dia" className="mb-1 block text-sm font-medium text-ink">Día</label>
          <select id="historia-dia" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD}>
            {days.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
        {sports.length > 1 && (
          <div>
            <label htmlFor="historia-deporte" className="mb-1 block text-sm font-medium text-ink">Deporte</label>
            <select id="historia-deporte" value={sport} onChange={(e) => setSport(e.target.value)} className={FIELD}>
              {sports.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
            </select>
          </div>
        )}
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Estilo</legend>
        <div className="grid grid-cols-3 gap-3">
          {STORY_STYLES.map((s) => {
            const selected = s.id === style;
            return (
              <label key={s.id} data-testid="estilo"
                className={`flex cursor-pointer flex-col gap-2 rounded-2xl border-2 p-2 ${selected ? 'border-primary' : 'border-transparent'}`}>
                <input type="radio" name="estilo" value={s.id} checked={selected} onChange={() => setStyle(s.id)} className="sr-only" />
                {/* Vista previa: la misma imagen que se descarga */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src(s.id)} alt={`Vista previa: ${s.label}`} width={1080} height={1920}
                  className="aspect-[9/16] w-full rounded-xl border border-line bg-surface-2 object-cover" />
                <span className={`flex min-h-11 items-center justify-center rounded-full text-sm font-extrabold
                  ${selected ? 'bg-primary text-on-primary' : 'bg-surface text-ink border border-line'}`}>
                  {s.label}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2 sm:flex-row">
        <a href={src(style, true)} download={fileName} data-testid="descargar-historia"
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-extrabold text-on-primary shadow-sm hover:opacity-90">
          Descargar
        </a>
        <button type="button" onClick={share} disabled={sharing}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-extrabold text-ink hover:bg-surface-2 disabled:opacity-60">
          {sharing ? 'Preparando…' : 'Compartir'}
        </button>
      </div>
      {note && <p role="status" className="text-sm text-ink-muted">{note}</p>}
    </div>
  );
}
