'use client';

import { useRouter } from 'next/navigation';

interface Props {
  date: string;
  basePath: string;
}

function todayInMendoza(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Mendoza',
  }).format(new Date());
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(dt);
}

function formatLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utcDate = new Date(Date.UTC(y, m - 1, d, 15, 0, 0));
  const label = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Mendoza',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(utcDate);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function DateNavigator({ date, basePath }: Props) {
  const router = useRouter();
  const today = todayInMendoza();
  const isPast = date <= today;

  function navigate(newDate: string) {
    router.push(`${basePath}?fecha=${newDate}`);
  }

  return (
    <div className="flex items-center justify-center gap-4 py-3">
      <button
        onClick={() => navigate(addDays(date, -1))}
        disabled={isPast}
        className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
          disabled:opacity-30 disabled:cursor-not-allowed
          hover:bg-gray-100 active:bg-gray-200"
        aria-label="Ir al dia anterior"
      >
        Ayer
      </button>

      <span className="font-bold text-gray-900 min-w-[200px] text-center">
        {formatLabel(date)}
      </span>

      <button
        onClick={() => navigate(addDays(date, 1))}
        className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
          hover:bg-gray-100 active:bg-gray-200"
        aria-label="Ir al dia siguiente"
      >
        Manana
      </button>
    </div>
  );
}
