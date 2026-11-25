'use client';

import { useState, useEffect } from 'react';

const DISMISS_KEY = 'turnazo_pwa_guide_dismissed';

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) && /WebKit/.test(ua) && !/CriOS|FxiOS|OPiOS|mercury/.test(ua);
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export default function PwaInstallGuide() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isIosSafari() && !isStandalone()) {
      const dismissed = localStorage.getItem(DISMISS_KEY);
      if (!dismissed) setVisible(true);
    }
  }, []);

  if (!visible) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm bg-surface rounded-2xl shadow-xl border border-line p-4">
      <button
        onClick={dismiss}
        aria-label="Cerrar"
        className="absolute top-3 right-3 text-ink-muted hover:text-ink text-lg leading-none"
      >
        ×
      </button>
      <p className="font-semibold text-ink text-sm mb-1">Instalá Turnazo en tu iPhone</p>
      <p className="text-xs text-ink-muted mb-3 leading-relaxed">
        Para recibir notificaciones de nuevos turnos, instalá la app desde Safari:
      </p>
      <ol className="text-xs text-ink space-y-1.5 list-none">
        <li>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-base">1.</span>
            Tocá el botón <strong>Compartir</strong>{' '}
            <span className="inline-block bg-surface-2 rounded px-1.5 py-0.5 font-mono text-[10px]">□↑</span>
            {' '}en la barra de Safari.
          </span>
        </li>
        <li>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-base">2.</span>
            Elegí <strong>&ldquo;Agregar a pantalla de inicio&rdquo;</strong>.
          </span>
        </li>
        <li>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-base">3.</span>
            Abrí Turnazo desde el ícono que aparece en tu pantalla.
          </span>
        </li>
      </ol>
      <button
        onClick={dismiss}
        className="mt-3 w-full rounded-xl bg-primary py-2 text-xs font-medium text-on-primary hover:opacity-90 transition-colors"
      >
        Entendido
      </button>
    </div>
  );
}
