'use client';

import { useActionState } from 'react';
import { registerAction, type AuthActionState } from '@/app/actions/auth';

export default function RegisterForm() {
  const [state, formAction, isPending] = useActionState<AuthActionState, FormData>(registerAction, {});

  if (state.message) {
    return (
      <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-blue-800 text-sm">
        {state.message}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-700 text-sm">
          {state.error}
        </div>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required disabled={isPending}
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900
            placeholder-gray-400 shadow-sm focus:border-green-500 focus:outline-none focus:ring-2
            focus:ring-green-100 disabled:opacity-50" />
        {state.fieldErrors?.email && <p className="mt-1 text-xs text-red-600">{state.fieldErrors.email[0]}</p>}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">Contraseña</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required disabled={isPending}
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900
            placeholder-gray-400 shadow-sm focus:border-green-500 focus:outline-none focus:ring-2
            focus:ring-green-100 disabled:opacity-50" />
        {state.fieldErrors?.password && <p className="mt-1 text-xs text-red-600">{state.fieldErrors.password[0]}</p>}
      </div>

      <div>
        <label htmlFor="confirm" className="block text-sm font-medium text-gray-700 mb-1.5">Repetir contraseña</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required disabled={isPending}
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900
            placeholder-gray-400 shadow-sm focus:border-green-500 focus:outline-none focus:ring-2
            focus:ring-green-100 disabled:opacity-50" />
        {state.fieldErrors?.confirm && <p className="mt-1 text-xs text-red-600">{state.fieldErrors.confirm[0]}</p>}
      </div>

      <button type="submit" disabled={isPending}
        className="w-full rounded-xl bg-green-600 py-2.5 text-sm font-semibold text-white shadow-sm
          hover:bg-green-700 active:bg-green-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-1">
        {isPending ? 'Creando cuenta…' : 'Crear cuenta'}
      </button>
    </form>
  );
}
