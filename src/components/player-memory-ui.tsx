'use client';

import { useRouter } from 'next/navigation';
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

/**
 * Inicio (V2a): sin localidad/deporte en la URL, abre la búsqueda recordada
 * (si la hay y es distinta de la que se está mostrando).
 */
export function OpenRememberedSearch({ shown }: { shown: { localidad: string; deporte: string | null } }) {
  const mem = usePlayerMemory();
  const router = useRouter();
  const target = mem?.localidad && mem.deporte ? { l: mem.localidad.slug, d: mem.deporte.slug } : null;
  useEffect(() => {
    if (!target) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('localidad') || params.has('deporte')) return;
    if (target.l === shown.localidad && target.d === shown.deporte) return;
    router.replace(`/?localidad=${encodeURIComponent(target.l)}&deporte=${encodeURIComponent(target.d)}`, { scroll: false });
  }, [target?.l, target?.d, shown.localidad, shown.deporte, router]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
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

