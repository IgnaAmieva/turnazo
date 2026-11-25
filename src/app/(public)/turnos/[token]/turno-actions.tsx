'use client';

import { useRef, useState } from 'react';

const BTN = `inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface
  px-4 py-3 text-sm font-extrabold text-ink shadow-sm hover:bg-surface-2`;

/** "Guardá este link": el link de Mi turno es la única forma de volver a ver o cancelar el turno. */
export function SaveLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Sin permiso de portapapeles: queda seleccionado para copiarlo a mano
      inputRef.current?.select();
    }
  }

  return (
    <section aria-labelledby="guarda-link" data-testid="guarda-link"
      className="mb-6 rounded-2xl border-2 border-primary bg-surface p-4 shadow-sm">
      <h2 id="guarda-link" className="text-base font-extrabold text-ink">Guardá este link</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Con este link ves o cancelás tu turno. No hace falta cuenta, así que no lo pierdas.
      </p>
      <label htmlFor="link-turno" className="sr-only">Link de tu turno</label>
      <input
        ref={inputRef}
        id="link-turno"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="mt-3 w-full min-h-11 truncate rounded-xl border border-line bg-surface-2 px-3 text-sm text-ink"
      />
      <button type="button" onClick={copy}
        className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-primary px-4 py-3
          text-sm font-extrabold text-on-primary shadow-sm hover:opacity-90">
        <span aria-live="polite">{copied ? 'Link copiado' : 'Copiar link'}</span>
      </button>
    </section>
  );
}

type ActionsProps = {
  whatsappHref: string;
  calendarHref: string;
  mapsHref: string;
};

/** Compartir por WhatsApp, agregar al calendario y cómo llegar. */
export function TurnoActions({ whatsappHref, calendarHref, mapsHref }: ActionsProps) {
  return (
    <div className="mb-6 grid gap-2 sm:grid-cols-3" data-testid="turno-acciones">
      <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={BTN}>
        <Icon d="M20.5 3.5A11 11 0 0 0 3.2 17.1L2 22l5-1.3a11 11 0 0 0 13.5-17.2ZM12 20a8 8 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 12 20Z" />
        Compartir por WhatsApp
      </a>
      <a href={calendarHref} download="turno.ics" className={BTN}>
        <Icon d="M7 2v3M17 2v3M3.5 9h17M5 4.5h14A1.5 1.5 0 0 1 20.5 6v13a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5Z" />
        Agregar al calendario
      </a>
      <a href={mapsHref} target="_blank" rel="noopener noreferrer" className={BTN}>
        <Icon d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
        Cómo llegar
      </a>
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
