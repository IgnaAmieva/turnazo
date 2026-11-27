'use client';

import { useRouter } from 'next/navigation';

export type FilterOption = { value: string; label: string };

/**
 * Desplegable de filtro de la lista (tipo de cancha, hora): elegir navega con
 * ese parámetro en la URL. Sin JavaScript, el formulario GET hace lo mismo.
 * La primera opción ("Todos", "Cualquier hora") no lleva parámetro.
 */
export function FilterSelect({ id, name, label, allLabel, options, value, basePath, baseParams, testId }: {
  id: string;
  name: string;
  label: string;
  allLabel: string;
  options: FilterOption[];
  value: string | null;
  basePath: string;
  /** Lo que se conserva al cambiar (localidad, deporte, día, el otro filtro) */
  baseParams: Record<string, string>;
  testId: string;
}) {
  const router = useRouter();
  const keep = Object.fromEntries(Object.entries(baseParams).filter(([k]) => k !== name));
  return (
    <form action={basePath} method="get" className="mt-4">
      {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label htmlFor={id} className="mb-2 block text-sm font-extrabold text-ink">{label}</label>
      <div className="flex gap-2">
        <select
          id={id}
          name={name}
          data-testid={testId}
          value={value ?? ''}
          onChange={(e) => {
            const qs = new URLSearchParams({ ...keep, ...(e.target.value ? { [name]: e.target.value } : {}) }).toString();
            router.push(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
          }}
          className={`min-h-11 w-full rounded-2xl border px-4 text-base font-extrabold text-ink bg-surface
            focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25
            ${value ? 'border-primary' : 'border-line'}`}
        >
          <option value="">{allLabel}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <noscript>
          <button type="submit" className="min-h-11 rounded-2xl border border-line px-4 text-sm font-extrabold text-ink">Ver</button>
        </noscript>
      </div>
    </form>
  );
}
