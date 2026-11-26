'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import { type BookingActionState } from '@/app/actions/booking';
import { rememberPlayer, usePlayerMemory } from '@/lib/player-memory';
import { NotMeButton } from '@/components/player-memory-ui';
import { bookingError, bookingErrorFromMessage } from '@/lib/booking-errors';
import { formatArgentinePhone } from '@/lib/phone';
import type { PaymentOption } from '@/lib/payment-options';
import { TurnstileSlot, useTurnstile } from '@/components/turnstile';

export type { PaymentOption };

type Props = {
  action: (prevState: BookingActionState, formData: FormData) => Promise<BookingActionState>;
  options: PaymentOption[];
  /** "sheet": dentro de la hoja del complejo (el pie fijo usa el fondo de la hoja). */
  variant?: 'page' | 'sheet';
  /** "Ver otros horarios" cuando el turno ya no se puede reservar: en la hoja, cierra y recarga. */
  onOtherTimes?: () => void;
  /** …y en /reservar, vuelve al complejo en la misma fecha. */
  otherTimesHref?: string;
  /** "Cerrar" cuando la reserva no se puede hacer (límite, teléfono bloqueado): en la hoja, la cierra. */
  onClose?: () => void;
};

const initialState: BookingActionState = {};

const INPUT = `w-full min-h-11 rounded-2xl border bg-surface px-4 py-3 text-sm text-ink placeholder-ink-muted shadow-sm
  focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-50`;
const BTN_PRIMARY = `w-full min-h-11 rounded-2xl bg-primary py-3.5 text-sm font-extrabold text-on-primary shadow-sm
  hover:opacity-90 active:opacity-80 transition-colors disabled:opacity-60 disabled:cursor-not-allowed`;
const BTN_SECONDARY = `w-full min-h-11 rounded-2xl border border-line bg-surface py-3 text-sm font-extrabold text-ink
  hover:bg-surface-2 disabled:opacity-60`;

export default function BookingForm({ action, options, variant = 'page', onOtherTimes, otherTimesHref, onClose }: Props) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [selected, setSelected] = useState<PaymentOption['value']>(options[0]?.value ?? 'venue');
  const formRef = useRef<HTMLFormElement>(null);
  const submitAfterSwitch = useRef(false);

  const paysOnline = selected !== 'venue';

  // Nombre y celular recordados en este dispositivo (nunca el email ni el pago)
  const mem = usePlayerMemory();
  const savedName  = mem?.nombre ?? '';
  const savedPhone = mem?.celular ?? '';
  const remembered = Boolean(savedName && savedPhone);
  // "Cambiar" abre los campos para el intento actual: cuando la reserva vuelve
  // con un error general (no de un campo), se ve de nuevo la línea recordada.
  const [editingFor, setEditingFor] = useState<BookingActionState | null>(null);
  const editing = editingFor === state;
  // Controlados: lo escrito no se borra cuando la reserva vuelve con un error.
  // null = todavía no tocó el campo → se muestra lo recordado.
  const [nameInput, setNameInput]   = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState<string | null>(null);
  /** "No soy yo": además de lo recordado, vacía lo escrito en este formulario. */
  function forgetTyped() {
    setNameInput(null);
    setPhoneInput(null);
    setEditingFor(null);
  }

  // Error devuelto por la reserva → mensaje + qué puede hacer el jugador (lib/booking-errors.ts)
  const err = state.error ? bookingErrorFromMessage(state.error) : null;
  const kind = err?.action.kind;
  // La validación del servidor (zod) trae textos genéricos en inglés: se muestran los del catálogo.
  const fieldErr = (field: 'customer_name' | 'customer_phone') =>
    state.fieldErrors?.[field]?.length
      ? bookingError(field === 'customer_name' ? 'invalid_name' : 'invalid_phone').message
      : (err?.action.kind === 'field' && err.action.field === field ? err.message : undefined);
  const nameError  = fieldErr('customer_name');
  const phoneError = fieldErr('customer_phone');
  const showFields = !remembered || editing || Boolean(nameError || phoneError);
  const canPayAtVenue = options.some((o) => o.value === 'venue') && selected !== 'venue';

  // Llevar el foco al campo que hay que corregir
  useEffect(() => {
    const field = nameError ? 'customer_name' : phoneError ? 'customer_phone' : null;
    if (field) document.getElementById(field)?.focus();
  }, [state, nameError, phoneError]);

  // "Pagar en el lugar" después de un error de Mercado Pago: cambia la opción y envía
  useEffect(() => {
    if (!submitAfterSwitch.current) return;
    submitAfterSwitch.current = false;
    formRef.current?.requestSubmit();
  }, [selected]);

  // Captcha (S2): token nuevo después de cada respuesta del servidor
  const captcha = useTurnstile(formRef, state, 'reserva');

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    // Sin token todavía: espera y envía solo apenas llega
    if (!captcha.guardSubmit(e)) return;
    const fd = new FormData(e.currentTarget);
    const nombre  = String(fd.get('customer_name') ?? '').trim();
    const celular = String(fd.get('customer_phone') ?? '').trim();
    // Solo se recuerda algo con forma válida (un celular mal escrito no queda guardado)
    if (nombre.length >= 2 && celular.replace(/\D/g, '').length >= 8) {
      rememberPlayer({ nombre, celular: formatArgentinePhone(celular) });
    }
    // Mientras se envía, los campos que estaban a la vista no se cierran
    if (showFields) setEditingFor(state);
  }

  const confirmLabel = isPending
    ? (paysOnline ? 'Preparando el pago…' : 'Reservando…')
    : captcha.waiting ? 'Verificando…'
    : (paysOnline ? 'Ir a pagar con Mercado Pago' : 'Confirmar reserva');
  const busy = isPending || captcha.waiting;

  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="space-y-5">
      {/* Datos recordados: una línea con "Cambiar" y "No soy yo" */}
      {remembered && !showFields && (
        <div className="rounded-2xl border border-line bg-surface-2 px-4 py-2" data-testid="datos-recordados">
          <p className="py-1.5 text-sm text-ink">
            <strong className="font-extrabold">{savedName}</strong> · {formatArgentinePhone(savedPhone)}
          </p>
          <div className="flex flex-wrap gap-2 pb-1">
            <button type="button" onClick={() => setEditingFor(state)}
              className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm font-extrabold text-ink hover:bg-surface-2">
              Cambiar
            </button>
            <NotMeButton onForget={forgetTyped} />
          </div>
        </div>
      )}

      {showFields ? (
        // Con datos recordados, los campos abiertos van en la misma tarjeta, con "No soy yo" abajo
        <div className={remembered ? 'space-y-5 rounded-2xl border border-line bg-surface-2 p-4' : 'space-y-5'}
          data-testid={remembered ? 'datos-editando' : undefined}>
          {/* Nombre */}
          <div>
            <label htmlFor="customer_name" className="block text-sm font-medium text-ink mb-1.5">
              Tu nombre
            </label>
            <input
              id="customer_name"
              name="customer_name"
              type="text"
              placeholder="Ej: Juan García"
              autoComplete="name"
              value={nameInput ?? savedName}
              onChange={(e) => setNameInput(e.target.value)}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'customer_name-error' : undefined}
              className={`${INPUT} ${nameError ? 'border-danger' : 'border-line'}`}
              disabled={isPending}
            />
            {nameError && (
              <p id="customer_name-error" data-testid="error-customer_name" className="mt-1.5 text-sm text-danger">{nameError}</p>
            )}
          </div>

          {/* Teléfono */}
          <div>
            <label htmlFor="customer_phone" className="block text-sm font-medium text-ink mb-1.5">
              Tu teléfono
            </label>
            <input
              id="customer_phone"
              name="customer_phone"
              type="tel"
              placeholder="Ej: 2622 123456"
              autoComplete="tel"
              value={phoneInput ?? formatArgentinePhone(savedPhone)}
              onChange={(e) => setPhoneInput(e.target.value)}
              onBlur={(e) => setPhoneInput(formatArgentinePhone(e.target.value))}
              aria-invalid={phoneError ? true : undefined}
              aria-describedby={phoneError ? 'customer_phone-error' : undefined}
              className={`${INPUT} ${phoneError ? 'border-danger' : 'border-line'}`}
              disabled={isPending}
            />
            {phoneError && (
              <p id="customer_phone-error" data-testid="error-customer_phone" className="mt-1.5 text-sm text-danger">{phoneError}</p>
            )}
          </div>

          {remembered && <NotMeButton onForget={forgetTyped} />}
        </div>
      ) : (
        <>
          <input type="hidden" name="customer_name" value={savedName} />
          <input type="hidden" name="customer_phone" value={savedPhone} />
        </>
      )}

      {/* Email: Mercado Pago lo exige para el checkout (payer.email) */}
      {paysOnline && (
        <div>
          <label htmlFor="customer_email" className="block text-sm font-medium text-ink mb-1.5">
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
            className={`${INPUT} ${state.fieldErrors?.customer_email ? 'border-danger' : 'border-line'}`}
            disabled={isPending}
          />
          <p className="mt-1.5 text-xs text-ink-muted">
            Mercado Pago te manda ahí el comprobante del pago.
          </p>
          {state.fieldErrors?.customer_email && (
            <p className="mt-1.5 text-sm text-danger">{state.fieldErrors.customer_email[0]}</p>
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

      {/* Pie fijo abajo: el error queda pegado al botón, y el botón depende del error */}
      <div
        data-testid="reserva-pie"
        className={`sticky bottom-0 z-10 -mx-4 space-y-2 border-t border-line px-4 pt-3
          pb-[calc(0.75rem+env(safe-area-inset-bottom))] ${variant === 'sheet' ? 'bg-surface' : 'bg-bg'}`}
      >
        {err && kind !== 'field' && (
          <div role="alert" data-testid="reserva-error" data-error-code={err.code}
            className="rounded-xl bg-danger-soft border border-danger/40 px-4 py-3 text-danger text-sm">
            {err.message}
          </div>
        )}

        {/* Captcha (Turnstile, modo Managed): si Cloudflare no duda, no se ve nada */}
        <TurnstileSlot boxRef={captcha.boxRef} status={captcha.status} retry={captcha.retry} />

        {kind === 'other_times' ? (
          onOtherTimes ? (
            <button type="button" onClick={onOtherTimes} className={BTN_PRIMARY}>Ver otros horarios</button>
          ) : (
            <Link href={otherTimesHref ?? '/'} className={`${BTN_PRIMARY} inline-flex items-center justify-center`}>
              Ver otros horarios
            </Link>
          )
        ) : kind === 'none' ? (
          // Sin reintento: la salida va donde estaba Confirmar
          onClose ? (
            <button type="button" onClick={onClose} data-testid="reserva-cerrar" className={BTN_SECONDARY}>Cerrar</button>
          ) : (
            <Link href={otherTimesHref ?? '/'} data-testid="reserva-cerrar"
              className={`${BTN_SECONDARY} inline-flex items-center justify-center`}>
              Cerrar
            </Link>
          )
        ) : kind === 'pay_at_venue_or_retry' && canPayAtVenue ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => { submitAfterSwitch.current = true; setSelected('venue'); }}
              className={BTN_PRIMARY}
            >
              Pagar en el lugar
            </button>
            <button type="submit" disabled={busy} className={BTN_SECONDARY}>
              Reintentar el pago
            </button>
          </>
        ) : (
          <button type="submit" disabled={busy} className={BTN_PRIMARY}>
            {kind === 'pay_at_venue_or_retry' ? (busy ? confirmLabel : 'Reintentar el pago') : confirmLabel}
          </button>
        )}

        {kind !== 'none' && kind !== 'other_times' && (
          <p className="text-xs text-ink-muted text-center">
            {paysOnline
              ? 'Tenés 10 minutos para completar el pago. Si no se paga, el turno se libera solo.'
              : 'Al confirmar aceptás las condiciones del complejo.'}
          </p>
        )}
      </div>
    </form>
  );
}
