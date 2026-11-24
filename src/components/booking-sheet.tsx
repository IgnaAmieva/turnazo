'use client';

/**
 * Reserva en la misma página del complejo: tocar un turno abre una hoja con
 * los datos recordados y "Confirmar". Usa el mismo formulario y las mismas
 * server actions que /reservar (createBookingAction / startPaymentAction):
 * pagar en el lugar lleva a /turnos/…, pagar online a Mercado Pago, igual que hoy.
 *
 * Sin JavaScript (o con Ctrl/Cmd + clic) el turno sigue siendo un link normal
 * a /reservar.
 */

import Link from 'next/link';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import BookingForm from '@/app/(public)/[locality]/[sport]/[venue]/reservar/booking-form';
import { createBookingAction, type BookingActionState } from '@/app/actions/booking';
import { startPaymentAction } from '@/app/actions/payment';
import { buildPaymentOptions, type VenuePaymentConfig } from '@/lib/payment-options';

export type SheetSlot = {
  courtId: string;
  courtName: string;
  start: string;      // ISO UTC
  end: string;        // ISO UTC
  date: string;       // YYYY-MM-DD (Mendoza)
  timeLabel: string;  // "17:00 – 18:30"
  price: number | null;
};

export type SheetVenue = VenuePaymentConfig & { id: string; name: string; address: string };

const OpenSheet = createContext<((slot: SheetSlot) => void) | null>(null);

export function BookingSheetProvider({ venue, children }: { venue: SheetVenue; children: ReactNode }) {
  const [slot, setSlot] = useState<SheetSlot | null>(null);
  return (
    <OpenSheet.Provider value={setSlot}>
      {children}
      {slot && <BookingSheet key={`${slot.courtId}-${slot.start}`} venue={venue} slot={slot} onClose={() => setSlot(null)} />}
    </OpenSheet.Provider>
  );
}

/** Link a /reservar que, con JavaScript, abre la hoja en vez de navegar. */
export function SlotLink({ href, slot, className, children }: {
  href: string; slot: SheetSlot; className: string; children: ReactNode;
}) {
  const open = useContext(OpenSheet);
  return (
    <Link
      href={href}
      data-testid="slot-free"
      className={className}
      onClick={(e) => {
        if (!open || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        open(slot);
      }}
    >
      {children}
    </Link>
  );
}

function formatDay(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  const label = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Mendoza', weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(Date.UTC(y, m - 1, d, 15)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function BookingSheet({ venue, slot, onClose }: { venue: SheetVenue; slot: SheetSlot; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const options = buildPaymentOptions(venue, slot.price);
  const bound = { court_id: slot.courtId, venue_id: venue.id, start: slot.start, end: slot.end };

  // Mismo reparto que /reservar: online → startPaymentAction; en el lugar → createBookingAction.
  async function action(prev: BookingActionState, formData: FormData): Promise<BookingActionState> {
    const option = formData.get('payment_option');
    if (option === 'deposit' || option === 'full') {
      return startPaymentAction({ ...bound, payment_type: option }, prev, formData);
    }
    return createBookingAction(bound, prev, formData);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog" aria-modal="true" aria-labelledby="hoja-reserva-titulo">
      <div aria-hidden="true" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        data-testid="hoja-reserva"
        className="relative flex w-full max-h-[92dvh] flex-col rounded-t-2xl bg-surface text-ink shadow-xl outline-none
          sm:max-w-md sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 pt-4 pb-3">
          <div className="min-w-0">
            <p id="hoja-reserva-titulo" className="text-lg font-extrabold leading-tight">
              {slot.timeLabel} · {slot.courtName}
            </p>
            <p className="mt-0.5 text-sm text-ink-muted">
              {formatDay(slot.date)} · {venue.name}
              {slot.price !== null && <> · ${slot.price.toLocaleString('es-AR')}</>}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2 hover:text-ink">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-4 pt-4">
          {options.length === 0 ? (
            <p className="pb-4 text-sm text-ink">Este complejo no tiene habilitada ninguna forma de pago por ahora.</p>
          ) : (
            <BookingForm action={action} options={options} variant="sheet" />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
