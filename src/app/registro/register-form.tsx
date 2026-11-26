'use client';

import { useActionState, useRef } from 'react';
import { registerAction, type AuthActionState } from '@/app/actions/auth';
import { TurnstileSlot, useTurnstile } from '@/components/turnstile';

const INPUT = `w-full min-h-11 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink
  placeholder-ink-muted shadow-sm focus:border-primary focus:outline-none focus:ring-2
  focus:ring-primary/25 disabled:opacity-50`;

export default function RegisterForm() {
  const [state, formAction, isPending] = useActionState<AuthActionState, FormData>(registerAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  // Captcha (S2): el servidor lo verifica antes de crear la cuenta
  const captcha = useTurnstile(formRef, state, 'registro');
  const busy = isPending || captcha.waiting;

  if (state.message) {
    return (
      <div className="rounded-xl bg-surface-2 border border-line p-4 text-brand text-sm">
        {state.message}
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={(e) => { captcha.guardSubmit(e); }} className="space-y-4">
      {state.error && (
        <div role="alert" data-testid="registro-error" className="rounded-xl bg-danger-soft border border-danger/40 p-3 text-danger text-sm">
          {state.error}
        </div>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-ink mb-1.5">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required disabled={isPending} className={INPUT} />
        {state.fieldErrors?.email && <p className="mt-1 text-xs text-danger">{state.fieldErrors.email[0]}</p>}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-ink mb-1.5">Contraseña</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required disabled={isPending} className={INPUT} />
        {state.fieldErrors?.password && <p className="mt-1 text-xs text-danger">{state.fieldErrors.password[0]}</p>}
      </div>

      <div>
        <label htmlFor="confirm" className="block text-sm font-medium text-ink mb-1.5">Repetir contraseña</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required disabled={isPending} className={INPUT} />
        {state.fieldErrors?.confirm && <p className="mt-1 text-xs text-danger">{state.fieldErrors.confirm[0]}</p>}
      </div>

      <TurnstileSlot boxRef={captcha.boxRef} status={captcha.status} retry={captcha.retry} />

      <button type="submit" disabled={busy}
        className="w-full min-h-11 rounded-xl bg-primary py-2.5 text-sm font-semibold text-on-primary shadow-sm
          hover:opacity-90 active:opacity-90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-1">
        {isPending ? 'Creando cuenta…' : captcha.waiting ? 'Verificando…' : 'Crear cuenta'}
      </button>
    </form>
  );
}
