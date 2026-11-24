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
import { useRouter } from 'next/navigation';
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

type SheetCtx = {
  selected: SheetSlot | null;
  select: (slot: SheetSlot) => void;
  open: (slot: SheetSlot) => void;
};
const SheetContext = createContext<SheetCtx | null>(null);

const sameSlot = (a: SheetSlot | null, b: SheetSlot) => a !== null && a.courtId === b.courtId && a.start === b.start;

/**
 * V2c: tocar un turno lo ELIGE (queda en lima) y la barra fija de abajo
 * ("Hoy 19:00 · Cancha 1 · $10.000" + "Reservar") abre la hoja de M2.
 */
export function BookingSheetProvider({ venue, initialSlot = null, children }: {
  venue: SheetVenue;
  /** Turno elegido desde el inicio o la lista (?cancha=&inicio=): la hoja arranca abierta. */
  initialSlot?: SheetSlot | null;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<SheetSlot | null>(initialSlot);
  const [openSlot, setOpenSlot] = useState<SheetSlot | null>(initialSlot);
  // El turno elegido no queda en la URL: al recargar o volver no se reabre la hoja
  useEffect(() => {
    if (!initialSlot) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('cancha');
    url.searchParams.delete('inicio');
    window.history.replaceState(window.history.state, '', url.toString());
  }, [initialSlot]);
  return (
    <SheetContext.Provider value={{ selected, select: setSelected, open: (s) => { setSelected(s); setOpenSlot(s); } }}>
      {children}
      {selected && <ReserveBar slot={selected} onReserve={() => setOpenSlot(selected)} />}
      {openSlot && <BookingSheet key={`${openSlot.courtId}-${openSlot.start}`} venue={venue} slot={openSlot}
        onClose={() => setOpenSlot(null)} onSlotGone={() => { setOpenSlot(null); setSelected(null); }} />}
    </SheetContext.Provider>
  );
}

/**
 * Link a /reservar. Con JavaScript, tocarlo elige el turno (lima con borde
 * primary) en vez de navegar; sin JavaScript (o con Ctrl/Cmd) sigue siendo el link.
 */
export function SlotLink({ href, slot, className, selectedClassName, children }: {
  href: string; slot: SheetSlot; className: string; selectedClassName: string; children: ReactNode;
}) {
  const ctx = useContext(SheetContext);
  const isSelected = Boolean(ctx && sameSlot(ctx.selected, slot));
  return (
    <Link
      href={href}
      data-testid="slot-free"
      data-selected={isSelected ? 'true' : undefined}
      aria-pressed={ctx ? isSelected : undefined}
      className={`${className} ${isSelected ? selectedClassName : ''}`}
      onClick={(e) => {
        if (!ctx || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        ctx.select(slot);
      }}
    >
      {children}
    </Link>
  );
}

function shortDay(date: string) {
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Mendoza' }).format(d);
  const today = fmt(new Date());
  const tomorrow = fmt(new Date(Date.now() + 24 * 3600 * 1000));
  if (date === today) return 'Hoy';
  if (date === tomorrow) return 'Mañana';
  const [y, m, d] = date.split('-').map(Number);
  const label = new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', weekday: 'short', day: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d, 12))).replace('.', '').replace(',', '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Barra fija abajo con el turno elegido y "Reservar". */
function ReserveBar({ slot, onReserve }: { slot: SheetSlot; onReserve: () => void }) {
  return (
    <div data-testid="barra-reservar"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur
        px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
      <div className="mx-auto flex max-w-lg items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-ink-muted">
            {shortDay(slot.date)} {slot.timeLabel.split(' – ')[0]} · {slot.courtName}
          </p>
          {slot.price !== null && (
            <p className="text-xl font-extrabold text-ink">${slot.price.toLocaleString('es-AR')}</p>
          )}
        </div>
        <button type="button" onClick={onReserve}
          className="min-h-12 shrink-0 rounded-2xl bg-primary px-8 text-base font-extrabold text-on-primary shadow-sm hover:opacity-90">
          Reservar
        </button>
      </div>
    </div>
  );
}

function formatDay(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  const label = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Mendoza', weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(Date.UTC(y, m - 1, d, 15)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function BookingSheet({ venue, slot, onClose, onSlotGone }: {
  venue: SheetVenue; slot: SheetSlot; onClose: () => void;
  /** El turno ya no se puede reservar: además de cerrar, se deja de tenerlo elegido. */
  onSlotGone: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
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
            <BookingForm
              action={action}
              options={options}
              variant="sheet"
              onOtherTimes={() => { onSlotGone(); router.refresh(); }}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
