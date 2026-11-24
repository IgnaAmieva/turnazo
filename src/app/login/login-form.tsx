'use client';

import { useActionState } from 'react';
import { loginAction, type AuthActionState } from '@/app/actions/auth';

export default function LoginForm() {
  const [state, formAction, isPending] = useActionState<AuthActionState, FormData>(loginAction, {});

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <div className="rounded-xl bg-danger-soft border border-danger/40 p-3 text-danger text-sm">
          {state.error}
        </div>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-ink mb-1.5">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required disabled={isPending}
          className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink
            placeholder-ink-muted shadow-sm focus:border-primary focus:outline-none focus:ring-2
            focus:ring-primary/25 disabled:opacity-50" />
        {state.fieldErrors?.email && <p className="mt-1 text-xs text-danger">{state.fieldErrors.email[0]}</p>}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-ink mb-1.5">Contraseña</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required disabled={isPending}
          className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink
            placeholder-ink-muted shadow-sm focus:border-primary focus:outline-none focus:ring-2
            focus:ring-primary/25 disabled:opacity-50" />
        {state.fieldErrors?.password && <p className="mt-1 text-xs text-danger">{state.fieldErrors.password[0]}</p>}
      </div>

      <button type="submit" disabled={isPending}
        className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-on-primary shadow-sm
          hover:opacity-90 active:opacity-90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-1">
        {isPending ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
