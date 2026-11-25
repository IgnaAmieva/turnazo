'use client';

import { useRouter } from 'next/navigation';
import { HORAS } from '@/lib/franjas';

/** "Otra hora": elegir una hora exacta navega con ?hora= (sin JavaScript, el formulario GET hace lo mismo). */
export function HourSelect({ basePath, baseParams, value }: {
  basePath: string; baseParams: Record<string, string>; value: number | null;
}) {
  const router = useRouter();
  const selected = value !== null;
  return (
    <form action={basePath} method="get" className="contents">
      {Object.entries(baseParams).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="sr-only" htmlFor="hora-exacta">Una hora exacta</label>
      <select
        id="hora-exacta"
        name="hora"
        data-testid="hora-exacta"
        value={value ?? ''}
        onChange={(e) => {
          const qs = new URLSearchParams({ ...baseParams, ...(e.target.value ? { hora: e.target.value } : {}) });
          router.push(`${basePath}?${qs.toString()}`, { scroll: false });
        }}
        className={`min-h-11 rounded-full border px-4 text-sm font-extrabold
          ${selected ? 'border-primary bg-primary text-on-primary' : 'border-line bg-surface text-ink'}`}
      >
        <option value="">Otra hora…</option>
        {HORAS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
      </select>
      <noscript><button type="submit" className="min-h-11 rounded-full border border-line px-4 text-sm">Ver</button></noscript>
    </form>
  );
}
