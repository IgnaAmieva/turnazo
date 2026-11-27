/**
 * Fútbol (027): "Tipo de cancha" para filtrar los complejos (Todos · Fútbol 5 ·
 * 6 · 7 · 9 · 11 · Futsal). Un desplegable con "Todos" por defecto; sin
 * JavaScript funciona igual (formulario GET).
 */
import { FORMATS, type CourtFormat } from '@/lib/court-format';
import { FilterSelect } from '@/components/filter-select';

export function FormatSelect({ basePath, params, current }: {
  basePath: string;
  /** Lo que se conserva al cambiar de tipo (localidad, deporte, día, hora) */
  params: Record<string, string>;
  current: CourtFormat | null;
}) {
  return (
    <FilterSelect
      id="formato"
      name="formato"
      label="Tipo de cancha"
      allLabel="Todos"
      options={FORMATS.map((f) => ({ value: f.value, label: f.label }))}
      value={current}
      basePath={basePath}
      baseParams={params}
      testId="formato"
    />
  );
}
