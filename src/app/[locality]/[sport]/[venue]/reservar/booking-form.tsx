'use client';

import { useActionState } from 'react';
import { createBookingAction, type BookingActionState } from '@/app/actions/booking';

type Props = {
  courtId: string;
  venueId: string;
  start: string;
  end: string;
};

const initialState: BookingActionState = {};

export default function BookingForm({ courtId, venueId, start, end }: Props) {
  const [state, formAction, isPending] = useActionState(createBookingAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      {/* Campos ocultos */}
      <input type="hidden" name="court_id" value={courtId} />
      <input type="hidden" name="venue_id" value={venueId} />
      <input type="hidden" name="start"    value={start} />
      <input type="hidden" name="end"      value={end} />

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

      {/* Botón */}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-2xl bg-green-600 py-3.5 text-sm font-semibold text-white
          shadow-sm hover:bg-green-700 active:bg-green-800 transition-colors
          disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isPending ? 'Reservando…' : 'Confirmar reserva'}
      </button>

      <p className="text-xs text-gray-400 text-center">
        Al confirmar aceptás las condiciones del complejo.
      </p>
    </form>
  );
}
