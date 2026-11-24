'use client';

import { useActionState, useState } from 'react';
import { type BookingActionState } from '@/app/actions/booking';
import { rememberPlayer, usePlayerMemory } from '@/lib/player-memory';
import { NotMeButton } from '@/components/player-memory-ui';
import type { PaymentOption } from '@/lib/payment-options';

export type { PaymentOption };

type Props = {
  action: (prevState: BookingActionState, formData: FormData) => Promise<BookingActionState>;
  options: PaymentOption[];
  /** "sheet": dentro de la hoja del complejo (el pie fijo usa el fondo de la hoja). */
  variant?: 'page' | 'sheet';
};

const initialState: BookingActionState = {};

export default function BookingForm({ action, options, variant = 'page' }: Props) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [selected, setSelected] = useState<PaymentOption['value']>(options[0]?.value ?? 'venue');

  const paysOnline = selected !== 'venue';

  // Nombre y celular recordados en este dispositivo (nunca el email ni el pago)
  const mem = usePlayerMemory();
  const savedName  = mem?.nombre ?? '';
  const savedPhone = mem?.celular ?? '';

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    const nombre  = String(fd.get('customer_name') ?? '').trim();
    const celular = String(fd.get('customer_phone') ?? '').trim();
    if (nombre && celular) rememberPlayer({ nombre, celular });
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} className="space-y-5">
      {/* Datos recordados */}
      {(savedName || savedPhone) && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-2" data-testid="datos-recordados">
          <p className="text-sm text-ink min-w-0">
            Reservás como <strong className="font-extrabold">{savedName || savedPhone}</strong>
          </p>
          <NotMeButton />
        </div>
      )}

      {/* Nombre */}
      <div>
        <label
          htmlFor="customer_name"
          className="block text-sm font-medium text-ink mb-1.5"
        >
          Tu nombre
        </label>
        <input
          id="customer_name"
          name="customer_name"
          type="text"
          placeholder="Ej: Juan García"
          autoComplete="name"
          key={`n-${savedName}`}
          defaultValue={savedName}
          className="w-full min-h-11 rounded-2xl border border-line bg-surface px-4 py-3 text-sm
            text-ink placeholder-ink-muted shadow-sm
            focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25
            disabled:opacity-50"
          disabled={isPending}
        />
        {state.fieldErrors?.customer_name && (
          <p className="mt-1.5 text-xs text-danger">
            {state.fieldErrors.customer_name[0]}
          </p>
        )}
      </div>

      {/* Teléfono */}
      <div>
        <label
          htmlFor="customer_phone"
          className="block text-sm font-medium text-ink mb-1.5"
        >
          Tu teléfono
        </label>
        <input
          id="customer_phone"
          name="customer_phone"
          type="tel"
          placeholder="Ej: 2622 123456"
          autoComplete="tel"
          key={`t-${savedPhone}`}
          defaultValue={savedPhone}
          className="w-full min-h-11 rounded-2xl border border-line bg-surface px-4 py-3 text-sm
            text-ink placeholder-ink-muted shadow-sm
            focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25
            disabled:opacity-50"
          disabled={isPending}
        />
        {state.fieldErrors?.customer_phone && (
          <p className="mt-1.5 text-xs text-danger">
            {state.fieldErrors.customer_phone[0]}
          </p>
        )}
      </div>

      {/* Email: Mercado Pago lo exige para el checkout (payer.email) */}
      {paysOnline && (
        <div>
          <label
            htmlFor="customer_email"
            className="block text-sm font-medium text-ink mb-1.5"
          >
            Tu email
          </label>
          <input
            id="customer_email"
            name="customer_email"
            type="email"
            inputMode="email"
            placeholder="Ej: juan@gmail.com"
            autoComplete="email"
            required
            className="w-full rounded-2xl border border-line bg-surface px-4 py-3 text-sm
              text-ink placeholder-ink-muted shadow-sm
              focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25
              disabled:opacity-50"
            disabled={isPending}
          />
          <p className="mt-1.5 text-xs text-ink-muted">
            Mercado Pago te manda ahí el comprobante del pago.
          </p>
          {state.fieldErrors?.customer_email && (
            <p className="mt-1.5 text-xs text-danger">
              {state.fieldErrors.customer_email[0]}
            </p>
          )}
        </div>
      )}

      {/* Forma de pago */}
      <fieldset>
        <legend className="block text-sm font-medium text-ink mb-1.5">
          Forma de pago
        </legend>
        <div className="space-y-2">
          {options.map((opt) => {
            const checked = selected === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex items-start gap-3 rounded-2xl border px-4 py-3 cursor-pointer
                  ${checked ? 'border-primary bg-surface-2 ring-1 ring-primary' : 'border-line bg-surface'}
                  ${isPending ? 'opacity-50' : ''}`}
              >
                <input
                  type="radio"
                  name="payment_option"
                  value={opt.value}
                  checked={checked}
                  onChange={() => setSelected(opt.value)}
                  disabled={isPending}
                  className="mt-1 accent-primary"
                />
                <span className="flex-1">
                  <span className="flex justify-between gap-2 text-sm font-medium text-ink">
                    <span>{opt.label}</span>
                    {opt.amount !== null && (
                      <span>${opt.amount.toLocaleString('es-AR')}</span>
                    )}
                  </span>
                  <span className="block text-xs text-ink-muted mt-0.5">{opt.detail}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Pie fijo abajo: el error queda pegado al botón */}
      <div
        data-testid="reserva-pie"
        className={`sticky bottom-0 z-10 -mx-4 space-y-2 border-t border-line px-4 pt-3
          pb-[calc(0.75rem+env(safe-area-inset-bottom))] ${variant === 'sheet' ? 'bg-surface' : 'bg-bg'}`}
      >
        {state.error && (
          <div role="alert" data-testid="reserva-error"
            className="rounded-xl bg-danger-soft border border-danger/40 px-4 py-3 text-danger text-sm">
            {state.error}
          </div>
        )}

        {/* Lugar reservado para el captcha (Turnstile, rama s2-captcha): se integra al mergear S2. */}
        <div data-captcha-slot="" />

        <button
          type="submit"
          disabled={isPending}
          className="w-full min-h-11 rounded-2xl bg-primary py-3.5 text-sm font-extrabold text-on-primary
            shadow-sm hover:opacity-90 active:opacity-80 transition-colors
            disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isPending
            ? (paysOnline ? 'Preparando el pago…' : 'Reservando…')
            : (paysOnline ? 'Ir a pagar con Mercado Pago' : 'Confirmar reserva')}
        </button>

        <p className="text-xs text-ink-muted text-center">
          {paysOnline
            ? 'Tenés 10 minutos para completar el pago. Si no se paga, el turno se libera solo.'
            : 'Al confirmar aceptás las condiciones del complejo.'}
        </p>
      </div>
    </form>
  );
}
