'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/app/actions/auth';
import PushSubscribeButton from '@/components/panel/push-subscribe-button';

const NAV_ITEMS = [
  { href: '/panel/agenda',    label: 'Agenda' },
  { href: '/panel/complejos', label: 'Complejos' },
];

export default function PanelNav({ email }: { email: string }) {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 bg-white border-r border-gray-200 flex flex-col h-screen sticky top-0">
      <div className="px-5 py-4 border-b border-gray-100">
        <span className="font-bold text-green-700 text-base">Turnazo</span>
        <span className="ml-1.5 text-xs text-gray-400">panel</span>
      </div>

      <nav className="flex-1 px-3 py-3 space-y-0.5">
        {NAV_ITEMS.map(({ href, label }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-green-50 text-green-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-gray-100">
        <p className="text-xs text-gray-400 truncate mb-2">{email}</p>
        <PushSubscribeButton />
        <form action={logoutAction} className="mt-2">
          <button type="submit"
            className="w-full text-left text-sm text-gray-500 hover:text-red-600 transition-colors px-1">
            Cerrar sesión
          </button>
        </form>
      </div>
    </aside>
  );
}
