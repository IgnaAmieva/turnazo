'use client';

import { useSyncExternalStore } from 'react';
import type { ThemeMode } from '@/lib/theme';

const NEXT: Record<ThemeMode, ThemeMode> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<ThemeMode, string> = { system: 'Automático', light: 'Claro', dark: 'Oscuro' };

function subscribe(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-mode'] });
  return () => obs.disconnect();
}

function readMode(): ThemeMode {
  const m = document.documentElement.getAttribute('data-theme-mode');
  return m === 'light' || m === 'dark' ? m : 'system';
}

/** Cicla Automático → Claro → Oscuro. La elección queda guardada en el dispositivo. */
export default function ThemeToggle() {
  // En el servidor no se sabe el modo: se muestra recién en el navegador.
  const mode = useSyncExternalStore(subscribe, readMode, () => null);

  return (
    <button
      type="button"
      onClick={() => mode && window.__setThemeMode?.(NEXT[mode])}
      aria-label={mode ? `Tema: ${LABEL[mode]}. Tocá para cambiar.` : 'Cambiar tema'}
      data-testid="theme-toggle"
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full
        border border-line px-3 text-sm text-ink-muted hover:text-ink
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <ThemeIcon mode={mode} />
      <span>{mode ? LABEL[mode] : ' '}</span>
    </button>
  );
}

function ThemeIcon({ mode }: { mode: ThemeMode | null }) {
  const common = {
    width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
  };
  if (mode === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (mode === 'dark') {
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  }
  // Automático (sigue al celular): medio círculo
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
  );
}
