'use client';

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
export function NotMeButton({ className = '', onForget }: { className?: string; onForget?: () => void }) {
  return (
    <button
      type="button"
      onClick={() => { forgetPlayer(); onForget?.(); }}
      data-testid="no-soy-yo"
      className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface px-4
        text-sm font-extrabold text-ink hover:bg-surface-2 ${className}`}
    >
      No soy yo
    </button>
  );
}

/** Inicio (V2a): "Hola, Juan" y "No soy yo" dentro de la portada, si hay datos recordados. */
export function CoverGreeting() {
  const mem = usePlayerMemory();
  if (!mem?.nombre && !mem?.localidad) return null;
  return (
    <div className="mb-1 flex items-center justify-between gap-3" data-testid="hola">
      <p className="text-sm">{mem.nombre ? `Hola, ${mem.nombre.split(/\s+/)[0]}` : ''}</p>
      <button
        type="button"
        onClick={() => forgetPlayer()}
        data-testid="no-soy-yo"
        className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-extrabold underline underline-offset-4 hover:opacity-80"
      >
        No soy yo
      </button>
    </div>
  );
}

