'use client';

import { useActionState, useState } from 'react';
import { type BookingActionState } from '@/app/actions/booking';

export type PaymentOption = {
  value: 'deposit' | 'full' | 'venue';
  label: string;
  detail: string;
  /** Monto orientativo (el real lo calcula la base); null si no hay precio */
  amount: number | null;
};

type Props = {
  action: (prevState: BookingActionState, formData: FormData) => Promise<BookingActionState>;
  options: PaymentOption[];
};

const initialState: BookingActionState = {};

export default function BookingForm({ action, options }: Props) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [selected, setSelected] = useState<PaymentOption['value']>(options[0]?.value ?? 'venue');

  const paysOnline = selected !== 'venue';

  return (
    <form action={formAction} className="space-y-5">
      {/* Error general */}
      {state.error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
          {state.error}
        </div>
      )}

      {/* Nombre */}
      <div>
        <label
          htmlFor="customer_name"
          className="block text-sm font-medium text-gray-700 mb-1.5"
        >
          Tu nombre
        </label>
        <input
          id="customer_name"
          name="customer_name"
          type="text"
          placeholder="Ej: Juan García"
          autoComplete="name"
          className="w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm
            text-gray-900 placeholder-gray-400 shadow-sm
            focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100
            disabled:opacity-50"
          disabled={isPending}
        />
        {state.fieldErrors?.customer_name && (
          <p className="mt-1.5 text-xs text-red-600">
            {state.fieldErrors.customer_name[0]}
          </p>
        )}
      </div>

      {/* Teléfono */}
      <div>
        <label
          htmlFor="customer_phone"
          className="block text-sm font-medium text-gray-700 mb-1.5"
        >
          Tu teléfono
        </label>
        <input
          id="customer_phone"
          name="customer_phone"
          type="tel"
          placeholder="Ej: 2622 123456"
          autoComplete="tel"
          className="w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm
            text-gray-900 placeholder-gray-400 shadow-sm
            focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100
            disabled:opacity-50"
          disabled={isPending}
        />
        {state.fieldErrors?.customer_phone && (
          <p className="mt-1.5 text-xs text-red-600">
            {state.fieldErrors.customer_phone[0]}
          </p>
        )}
      </div>

      {/* Forma de pago */}
      <fieldset>
        <legend className="block text-sm font-medium text-gray-700 mb-1.5">
          Forma de pago
        </legend>
        <div className="space-y-2">
          {options.map((opt) => {
            const checked = selected === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex items-start gap-3 rounded-2xl border px-4 py-3 cursor-pointer
                  ${checked ? 'border-green-500 bg-green-50' : 'border-gray-300 bg-white'}
                  ${isPending ? 'opacity-50' : ''}`}
              >
                <input
                  type="radio"
                  name="payment_option"
                  value={opt.value}
                  checked={checked}
                  onChange={() => setSelected(opt.value)}
                  disabled={isPending}
                  className="mt-1 accent-green-600"
                />
                <span className="flex-1">
                  <span className="flex justify-between gap-2 text-sm font-medium text-gray-900">
                    <span>{opt.label}</span>
                    {opt.amount !== null && (
                      <span>${opt.amount.toLocaleString('es-AR')}</span>
                    )}
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">{opt.detail}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Botón */}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-2xl bg-green-600 py-3.5 text-sm font-semibold text-white
          shadow-sm hover:bg-green-700 active:bg-green-800 transition-colors
          disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isPending
          ? (paysOnline ? 'Preparando el pago…' : 'Reservando…')
          : (paysOnline ? 'Ir a pagar con Mercado Pago' : 'Confirmar reserva')}
      </button>

      <p className="text-xs text-gray-400 text-center">
        {paysOnline
          ? 'Tenés 10 minutos para completar el pago. Si no se paga, el turno se libera solo.'
          : 'Al confirmar aceptás las condiciones del complejo.'}
      </p>
    </form>
  );
}
