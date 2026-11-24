import Link from 'next/link';
import { Fragment } from 'react';

type Crumb = { href: string; label: string };

/**
 * Escritorio: migas de pan. Celular (< 640 px): un solo "← Volver" de 44 px
 * que va al paso anterior lógico (no al historial del navegador).
 */
export default function Breadcrumbs({ items, current, back }: { items: Crumb[]; current: string; back: string }) {
  return (
    <div className="mb-6">
      <Link
        href={back}
        data-testid="volver"
        className="sm:hidden inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-4
          text-sm text-ink hover:bg-surface-2"
      >
        <span aria-hidden="true">←</span> Volver
      </Link>
      <nav aria-label="Ruta" className="hidden sm:flex flex-wrap items-center gap-1 text-sm text-ink-muted">
        {items.map((c) => (
          <Fragment key={c.href}>
            <Link href={c.href} className="inline-flex min-h-11 items-center px-1 hover:text-ink">{c.label}</Link>
            <span aria-hidden="true">/</span>
          </Fragment>
        ))}
        <span className="px-1 text-ink">{current}</span>
      </nav>
    </div>
  );
}
