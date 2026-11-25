'use client';

import { useEffect, useState } from 'react';

/**
 * Aviso "Guardado" del panel: cualquier formulario llama a showSaved() cuando
 * algo se guardó bien, y este cartel (uno solo, en el layout del panel) lo
 * muestra 3 segundos arriba de todo. role="status": los lectores de pantalla
 * lo leen sin mover el foco.
 */
const EVENT = 'turnazo-guardado';

export function showSaved(message = 'Guardado') {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: message }));
}

export default function SavedToast() {
  const [msg, setMsg] = useState<{ text: string; n: number } | null>(null);

  useEffect(() => {
    const on = (e: Event) => setMsg((m) => ({ text: (e as CustomEvent<string>).detail, n: (m?.n ?? 0) + 1 }));
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(4rem+env(safe-area-inset-top,0px))] z-[60] flex justify-center px-4 md:top-6"
    >
      {msg && (
        <p
          key={msg.n}
          data-testid="guardado"
          className="flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-extrabold text-on-primary shadow-lg"
        >
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          {msg.text}
        </p>
      )}
    </div>
  );
}
