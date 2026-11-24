'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/app/actions/auth';
import PushSubscribeButton from '@/components/panel/push-subscribe-button';
import ThemeToggle from '@/components/theme-toggle';

const NAV_ITEMS = [
  { href: '/panel/agenda',    label: 'Agenda' },
  { href: '/panel/complejos', label: 'Complejos' },
];

/**
 * Escritorio: barra lateral fija. Celular: barra arriba con "Menú", que abre
 * el mismo contenido como un panel desplegable (la agenda usa todo el ancho).
 */
export default function PanelNav({ email }: { email: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Celular */}
      <header className="md:hidden sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b border-line bg-surface px-4">
        <Link href="/panel/agenda" className="flex min-h-11 items-center gap-1.5" onClick={() => setOpen(false)}>
          <span className="text-lg font-extrabold text-brand">Turnazo</span>
          <span className="text-xs text-ink-muted">panel</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="panel-menu"
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm text-ink
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span aria-hidden="true" className="text-lg leading-none">{open ? '✕' : '☰'}</span>
          {open ? 'Cerrar menú' : 'Menú'}
        </button>
      </header>
      {open && (
        <div aria-hidden="true" className="md:hidden fixed inset-0 top-14 z-30 bg-black/50" onClick={() => setOpen(false)} />
      )}

      <aside
        id="panel-menu"
        className={`${open ? 'flex' : 'hidden'} md:flex flex-col fixed md:sticky inset-x-0 top-14 md:top-0 z-40
          w-full md:w-56 md:h-screen shrink-0 bg-surface border-b md:border-b-0 md:border-r border-line
          max-h-[calc(100dvh-3.5rem)] md:max-h-none overflow-y-auto`}
      >
        <div className="hidden md:block px-5 py-4 border-b border-line">
          <span className="font-extrabold text-brand text-base">Turnazo</span>
          <span className="ml-1.5 text-xs text-ink-muted">panel</span>
        </div>

        <nav className="flex-1 px-3 py-3 space-y-1">
          {NAV_ITEMS.map(({ href, label }) => {
            // La agenda de un complejo vive en /panel/complejos/[id]/agenda
            const inAgenda = pathname.startsWith('/panel/agenda') || /\/agenda(\/|$)/.test(pathname);
            const active = href === '/panel/agenda' ? inAgenda : pathname.startsWith(href) && !inAgenda;
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-11 items-center rounded-xl px-3 text-sm transition-colors ${
                  active
                    ? 'bg-primary text-on-primary font-extrabold'
                    : 'text-ink hover:bg-surface-2'
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-4 border-t border-line space-y-3">
          <p className="text-xs text-ink-muted truncate">{email}</p>
          <ThemeToggle />
          <PushSubscribeButton />
          <form action={logoutAction}>
            <button type="submit"
              className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm text-ink-muted hover:bg-surface-2 hover:text-danger transition-colors">
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
