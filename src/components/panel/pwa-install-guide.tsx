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
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm bg-white rounded-2xl shadow-xl border border-gray-200 p-4">
      <button
        onClick={dismiss}
        aria-label="Cerrar"
        className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-lg leading-none"
      >
        ×
      </button>
      <p className="font-semibold text-gray-900 text-sm mb-1">Instalá Turnazo en tu iPhone</p>
      <p className="text-xs text-gray-500 mb-3 leading-relaxed">
        Para recibir notificaciones de nuevos turnos, instalá la app desde Safari:
      </p>
      <ol className="text-xs text-gray-700 space-y-1.5 list-none">
        <li>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-base">1.</span>
            Tocá el botón <strong>Compartir</strong>{' '}
            <span className="inline-block bg-gray-100 rounded px-1.5 py-0.5 font-mono text-[10px]">□↑</span>
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
        className="mt-3 w-full rounded-xl bg-green-600 py-2 text-xs font-medium text-white hover:bg-green-700 transition-colors"
      >
        Entendido
      </button>
    </div>
  );
}
