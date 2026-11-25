/**
 * Fútbol (027): chips de formato para filtrar los complejos
 * (Todos · 5 · 6 · 7 · 9 · 11 · Futsal). Son links: funcionan sin JavaScript.
 */
import Link from 'next/link';
import { FORMATS, type CourtFormat } from '@/lib/court-format';

export function FormatChips({ basePath, params, current }: {
  basePath: string;
  /** Lo que se conserva al cambiar de formato (localidad, deporte, franja/hora) */
  params: Record<string, string>;
  current: CourtFormat | null;
}) {
  const href = (f: CourtFormat | null) => {
    const qs = new URLSearchParams({ ...params, ...(f ? { formato: f } : {}) }).toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const chip = (selected: boolean) =>
    `inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-4 text-sm font-extrabold
     ${selected ? 'border-primary bg-primary text-on-primary' : 'border-line bg-surface text-ink hover:border-primary'}`;

  return (
    <nav aria-label="Formato" className="mt-4">
      <p className="mb-2 text-sm font-extrabold text-ink">Formato</p>
      <ul className="flex flex-wrap gap-2">
        <li>
          <Link href={href(null)} scroll={false} data-testid="formato" aria-current={current === null ? 'true' : undefined} className={chip(current === null)}>
            Todos
          </Link>
        </li>
        {FORMATS.map((f) => (
          <li key={f.value}>
            <Link
              href={href(f.value)}
              scroll={false}
              data-testid="formato"
              aria-label={f.label}
              aria-current={current === f.value ? 'true' : undefined}
              className={chip(current === f.value)}
            >
              {f.short}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
