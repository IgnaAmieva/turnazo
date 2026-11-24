'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { forgetPlayer, rememberPlayer, usePlayerMemory } from '@/lib/player-memory';

/** Guarda la localidad y el deporte que el jugador está mirando (sin UI). */
export function RememberSearch({
  localidad, deporte,
}: { localidad: { slug: string; nombre: string }; deporte: { slug: string; nombre: string } }) {
  useEffect(() => {
    rememberPlayer({ localidad, deporte });
  }, [localidad.slug, localidad.nombre, deporte.slug, deporte.nombre]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Botón "No soy yo": borra nombre, celular, localidad y deporte recordados. */
export function NotMeButton({ className = '' }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={forgetPlayer}
      data-testid="no-soy-yo"
      className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface px-4
        text-sm font-extrabold text-ink hover:bg-surface-2 ${className}`}
    >
      No soy yo
    </button>
  );
}

/** Inicio: "Seguir en Tunuyán · Pádel" si hay una búsqueda recordada. */
export function ContinueSearch() {
  const mem = usePlayerMemory();
  if (!mem?.localidad || !mem.deporte) return null;
  const { localidad, deporte } = mem;
  return (
    <div className="mb-6 rounded-2xl border border-line bg-surface p-4 shadow-sm" data-testid="seguir-en">
      {mem.nombre && <p className="text-sm text-ink-muted mb-2">Hola, {mem.nombre.split(/\s+/)[0]}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/${localidad.slug}/${deporte.slug}`}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-2xl bg-primary px-4 text-center
            text-sm font-extrabold text-on-primary hover:opacity-90"
        >
          Seguir en {localidad.nombre} · {deporte.nombre}
        </Link>
        <NotMeButton />
      </div>
    </div>
  );
}
