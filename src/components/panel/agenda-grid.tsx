'use client';

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { AgendaBooking, AgendaCourt } from "@/lib/supabase/panel-queries";
import type { PanelActionState } from "@/app/actions/panel";
import { buildWhatsAppUrl } from "@/lib/phone";

export type { AgendaBooking, AgendaCourt };

// ---------------------------------------------------------------------------
// Grid geometry helpers
// ---------------------------------------------------------------------------

/** Parse "HH:MM:SS" → minutes-from-midnight */
function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

/**
 * Calculate the display range (startHour, totalHours) from court hours
 * for a given weekday.  Handles midnight-crossing hours.
 */
function calcGridRange(courts: AgendaCourt[], weekday: number) {
  let minMin = Infinity;
  let maxMin = -Infinity;

  for (const court of courts) {
    for (const h of court.hours) {
      if (h.weekday !== weekday) continue;
      const open  = timeToMin(h.open_time);
      let   close = timeToMin(h.close_time);
      if (close <= open) close += 24 * 60; // midnight-crossing
      minMin = Math.min(minMin, open);
      maxMin = Math.max(maxMin, close);
    }
  }

  if (minMin === Infinity) return { startMin: 8 * 60, totalMin: 14 * 60 }; // fallback 08:00-22:00

  // Pad a bit so the first/last tick labels aren't cropped
  const startMin = Math.max(0, Math.floor(minMin / 60) * 60);
  const endMin   = Math.ceil(maxMin / 60) * 60;
  return { startMin, totalMin: endMin - startMin };
}

const PX_PER_MIN = 80 / 60; // 80 px per hour

function toGridPx(isoUtc: string, dateMendoza: string, startMin: number): number {
  const [y, mo, d] = dateMendoza.split("-").map(Number);
  // Grid startMin is in Mendoza time; convert to UTC: add 3h
  const gridStartMs = Date.UTC(y, mo - 1, d, Math.floor(startMin / 60) + 3, startMin % 60, 0);
  return Math.round(((new Date(isoUtc).getTime() - gridStartMs) / 60000) * PX_PER_MIN);
}

function fmtTime(isoUtc: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Mendoza",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(isoUtc));
}

// ---------------------------------------------------------------------------
// Status / payment styling
// ---------------------------------------------------------------------------

/** Confirmados: lima si ya pagó (total o seña); tarjeta neutra si no pagó nada. */
const PAID_STYLE   = "bg-accent border-transparent text-on-accent";
const UNPAID_STYLE = "bg-surface border-line text-ink";
const BOOKING_STYLE: Record<string, string> = {
  hold:      "bg-warning-soft border-warning/40 text-warning",
  completed: "bg-surface-2 border-line text-ink",
  no_show:   "bg-surface-2 border-line text-ink-muted",
  cancelled: "bg-surface-2 border-line text-ink-muted opacity-60",
};
const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmado",
  hold:      "Pendiente",
  completed: "Completado",
  no_show:   "Ausente",
  cancelled: "Cancelado",
};
const BLOCK_STYLE = "bg-surface-2 border-dashed border-ink-muted text-ink";

function bookingStyle(b: AgendaBooking): string {
  if (b.booking_kind === "block") return BLOCK_STYLE;
  if (b.status === "confirmed") {
    return b.payment_status === "paid" || b.payment_status === "deposit_paid" ? PAID_STYLE : UNPAID_STYLE;
  }
  return BOOKING_STYLE[b.status] ?? "bg-surface-2 border-line text-ink";
}

// Íconos de línea (estilo lucide, SVG inline: sin dependencias nuevas)
const ICON_PATHS = {
  whatsapp: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
  paid:     <><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>,
  noShow:   <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="m17 8 5 5" /><path d="m22 8-5 5" /></>,
  trash:    <><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></>,
  ban:      <><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></>,
  close:    <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  plus:     <><path d="M5 12h14" /><path d="M12 5v14" /></>,
  lock:     <><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
} as const;

function Icon({ name, size = 18 }: { name: keyof typeof ICON_PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {ICON_PATHS[name]}
    </svg>
  );
}

// Cancha elegida en el celular (pestañas), recordada por complejo en este dispositivo
const COURT_EVENT = "turnazo-agenda-cancha";
function subscribeCourt(cb: () => void) {
  window.addEventListener(COURT_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(COURT_EVENT, cb); window.removeEventListener("storage", cb); };
}
function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** Botones de la barra de fecha (44 px). */
const NAV_BTN = "inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-surface px-4 text-sm text-ink hover:bg-surface-2";
/** Botones de la hoja de acciones (44 px, ancho completo). */
const ACTION_BTN = "flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-extrabold transition-opacity hover:opacity-90 disabled:opacity-50";

function PaymentBadge({ status, total, paid }: { status: string; total: number; paid: number }) {
  if (status === "paid") {
    return <span data-testid="badge-pago" className="rounded px-1.5 py-0.5 bg-surface text-ink border border-line text-[11px]">Pagado</span>;
  }
  if (status === "deposit_paid") {
    const remaining = total - paid;
    return (
      <span data-testid="badge-pago" className="rounded px-1.5 py-0.5 bg-surface text-ink border border-line text-[11px]">
        Señado · falta ${remaining.toLocaleString("es-AR")}
      </span>
    );
  }
  // unpaid
  return (
    <span data-testid="badge-pago" className="rounded px-1.5 py-0.5 bg-warning-soft text-warning border border-warning/40 text-[11px]">
      Sin pagar ${total.toLocaleString("es-AR")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type PanelAction = (prev: PanelActionState, fd: FormData) => Promise<PanelActionState>;

type Props = {
  venueId:          string;
  venueName:        string;
  whatsappTemplate: string | null;
  date:             string;
  todayMendoza:     string;
  courts:           AgendaCourt[];
  bookings:         AgendaBooking[];
  onCancel:         PanelAction;
  onMarkPaid:       PanelAction;
  onMarkNoShow:     PanelAction;
  onBlockPhone:     PanelAction;
  onCreateBlock:    PanelAction;
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AgendaGrid({
  venueId, whatsappTemplate, date, todayMendoza, courts, bookings,
  onCancel, onMarkPaid, onMarkNoShow, onBlockPhone, onCreateBlock,
}: Props) {
  const router = useRouter();

  // Sport filter
  const sports = Array.from(
    new Map(courts.map((c) => [c.sport_id, c.sport_name])).entries()
  ).map(([id, name]) => ({ id, name }));
  const [sportFilter, setSportFilter] = useState<string | null>(null);
  const visibleCourts = sportFilter ? courts.filter((c) => c.sport_id === sportFilter) : courts;

  // Celular (< 640 px): una cancha a la vez, con pestañas; la elegida queda recordada.
  const courtKey = `turnazo-agenda-cancha:${venueId}`;
  const storedCourt = useSyncExternalStore(subscribeCourt, () => readStored(courtKey), () => null);
  const activeCourtId = visibleCourts.some((c) => c.id === storedCourt) ? storedCourt : visibleCourts[0]?.id;
  function pickCourt(id: string) {
    try { localStorage.setItem(courtKey, id); } catch { /* sin almacenamiento: no se recuerda */ }
    window.dispatchEvent(new Event(COURT_EVENT));
  }

  // Date navigation
  function changeDate(offset: number) {
    const d = new Date(date + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + offset);
    router.push(`?fecha=${d.toISOString().slice(0, 10)}`);
  }

  const dateLabel = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Mendoza",
    weekday: "long", day: "numeric", month: "long",
  }).format(new Date(date + "T12:00:00Z"));

  const isPastDate = date < todayMendoza;

  // Weekday (0=Sun … 6=Sat) in Mendoza
  const weekday = new Date(date + "T12:00:00Z").getUTCDay();

  // Calculate grid range from court hours
  const { startMin, totalMin } = calcGridRange(visibleCourts, weekday);
  const gridHeightPx = Math.round(totalMin * PX_PER_MIN);

  // Tick marks every 30 minutes
  const ticks: { label: string; topPx: number; isHour: boolean }[] = [];
  for (let m = 0; m <= totalMin; m += 30) {
    const absMin = startMin + m;
    const h = Math.floor(absMin / 60) % 24;
    const mm = absMin % 60;
    ticks.push({
      label:  `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
      topPx:  Math.round(m * PX_PER_MIN),
      isHour: mm === 0,
    });
  }

  if (courts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line p-10 text-center text-ink-muted">
        No hay canchas activas.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Top bar: fecha + filtro de deporte */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => changeDate(-1)} className={NAV_BTN}>
          <span aria-hidden="true">←</span> Anterior
        </button>
        <button onClick={() => changeDate(1)} className={NAV_BTN}>
          Siguiente <span aria-hidden="true">→</span>
        </button>
        {date !== todayMendoza && (
          <button onClick={() => router.push(`?fecha=${todayMendoza}`)} className={NAV_BTN}>
            Hoy
          </button>
        )}
        <label className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-3 text-sm text-ink">
          <span className="sr-only">Elegir fecha</span>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && router.push(`?fecha=${e.target.value}`)}
            className="bg-transparent text-ink outline-none"
          />
        </label>
        <span className="w-full font-extrabold text-ink sm:w-auto">
          {dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)}
        </span>

        {sports.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <button
              onClick={() => setSportFilter(null)}
              className={`min-h-11 rounded-full px-4 text-sm border transition-colors ${
                sportFilter === null ? "bg-primary text-on-primary border-transparent font-extrabold" : "border-line text-ink hover:bg-surface-2"
              }`}
            >
              Todos
            </button>
            {sports.map((s) => (
              <button
                key={s.id}
                onClick={() => setSportFilter(sportFilter === s.id ? null : s.id)}
                className={`min-h-11 rounded-full px-4 text-sm border transition-colors ${
                  sportFilter === s.id ? "bg-primary text-on-primary border-transparent font-extrabold" : "border-line text-ink hover:bg-surface-2"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pestañas por cancha: solo en el celular */}
      {visibleCourts.length > 1 && (
        <div role="tablist" aria-label="Canchas" className="flex gap-2 overflow-x-auto sm:hidden">
          {visibleCourts.map((c) => {
            const selected = c.id === activeCourtId;
            return (
              <button
                key={c.id}
                role="tab"
                aria-selected={selected}
                onClick={() => pickCourt(c.id)}
                className={`min-h-11 shrink-0 rounded-full border px-4 text-sm transition-colors ${
                  selected ? "bg-primary text-on-primary border-transparent font-extrabold" : "bg-surface border-line text-ink hover:bg-surface-2"
                }`}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Grid */}
      <div className="overflow-auto rounded-xl border border-line bg-surface" style={{ maxHeight: "75vh" }}>
        <div className="flex">
          {/* Time axis (sticky left) */}
          <div className="sticky left-0 z-20 bg-surface border-r border-line shrink-0 w-14">
            <div className="h-11 border-b border-line" />
            <div className="relative" style={{ height: gridHeightPx }}>
              {ticks.filter((t) => t.isHour).map((t) => (
                <span
                  key={t.label}
                  className="absolute right-1.5 text-xs text-ink-muted"
                  style={{ top: t.topPx - 6 }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          {/* Court columns */}
          {visibleCourts.map((court) => (
            <CourtColumn
              key={court.id}
              court={court}
              hiddenOnMobile={court.id !== activeCourtId}
              date={date}
              venueId={venueId}
              whatsappTemplate={whatsappTemplate}
              bookings={bookings.filter((b) => b.court_id === court.id)}
              ticks={ticks}
              gridHeightPx={gridHeightPx}
              startMin={startMin}
              isPastDate={isPastDate}
              onCancel={onCancel}
              onMarkPaid={onMarkPaid}
              onMarkNoShow={onMarkNoShow}
              onBlockPhone={onBlockPhone}
              onCreateBlock={onCreateBlock}
              onRefresh={() => router.refresh()}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Court column
// ---------------------------------------------------------------------------

function CourtColumn({
  court, hiddenOnMobile, date, venueId, whatsappTemplate, bookings, ticks, gridHeightPx, startMin,
  isPastDate, onCancel, onMarkPaid, onMarkNoShow, onBlockPhone, onCreateBlock, onRefresh,
}: {
  court: AgendaCourt;
  hiddenOnMobile: boolean;
  date: string;
  venueId: string;
  whatsappTemplate: string | null;
  bookings: AgendaBooking[];
  ticks: { label: string; topPx: number; isHour: boolean }[];
  gridHeightPx: number;
  startMin: number;
  isPastDate: boolean;
  onCancel: PanelAction;
  onMarkPaid: PanelAction;
  onMarkNoShow: PanelAction;
  onBlockPhone: PanelAction;
  onCreateBlock: PanelAction;
  onRefresh: () => void;
}) {
  const [showBlockForm, setShowBlockForm] = useState(false);

  return (
    <div
      data-testid="court-column"
      className={`${hiddenOnMobile ? "hidden sm:block" : ""} min-w-0 flex-1 border-r border-line last:border-r-0
        sm:w-[240px] sm:min-w-[220px] sm:flex-none sm:shrink-0`}
    >
      {/* Header */}
      <div className="h-11 border-b border-line flex items-center justify-between pl-2.5 bg-surface-2 sticky top-0 z-10">
        <span className="text-sm font-extrabold text-ink truncate">{court.name}</span>
        {!isPastDate && (
          <button
            onClick={() => setShowBlockForm((v) => !v)}
            title="Agregar bloqueo"
            aria-label={showBlockForm ? "Cerrar bloqueo" : "Agregar bloqueo"}
            className="flex h-11 w-11 shrink-0 items-center justify-center text-ink-muted hover:text-ink"
          >
            <Icon name={showBlockForm ? "close" : "plus"} />
          </button>
        )}
      </div>

      {showBlockForm && (
        <BlockForm
          court={court}
          venueId={venueId}
          date={date}
          action={onCreateBlock}
          onDone={() => { setShowBlockForm(false); onRefresh(); }}
        />
      )}

      {/* Time grid */}
      <div className="relative" style={{ height: gridHeightPx }}>
        {ticks.map((t, i) => (
          <div
            key={i}
            className={`absolute left-0 right-0 ${t.isHour ? "border-t border-line" : "border-t border-line/50"}`}
            style={{ top: t.topPx }}
          />
        ))}

        {bookings.map((b) => (
          <BookingCard
            key={b.id}
            booking={b}
            date={date}
            venueId={venueId}
            courtName={court.name}
            whatsappTemplate={whatsappTemplate}
            startMin={startMin}
            onCancel={onCancel}
            onMarkPaid={onMarkPaid}
            onMarkNoShow={onMarkNoShow}
            onBlockPhone={onBlockPhone}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Booking card
// ---------------------------------------------------------------------------

function BookingCard({
  booking, date, venueId, courtName, whatsappTemplate, startMin,
  onCancel, onMarkPaid, onMarkNoShow, onBlockPhone, onRefresh,
}: {
  booking: AgendaBooking;
  date: string;
  venueId: string;
  courtName: string;
  whatsappTemplate: string | null;
  startMin: number;
  onCancel: PanelAction;
  onMarkPaid: PanelAction;
  onMarkNoShow: PanelAction;
  onBlockPhone: PanelAction;
  onRefresh: () => void;
}) {
  const topPx      = toGridPx(booking.start, date, startMin);
  const durationMs = new Date(booking.end).getTime() - new Date(booking.start).getTime();
  const heightPx   = Math.max(Math.round((durationMs / 60000) * PX_PER_MIN), 20);

  const isBlock     = booking.booking_kind === "block";
  const isCancelled = booking.status === "cancelled";
  const style       = bookingStyle(booking);

  const [expanded, setExpanded] = useState(false);
  const [pending,  setPending]  = useState(false);
  const [err,      setErr]      = useState<string | null>(null);
  // Cancelar y bloquear siempre piden confirmar (con pago online avisa la devolución).
  const [confirm, setConfirm] = useState<null | "cancel" | "block">(null);
  const refundOnCancel = booking.online_paid > 0;

  async function runAction(action: PanelAction, extra: Record<string, string> = {}) {
    setPending(true);
    setErr(null);
    const fd = new FormData();
    fd.append("booking_id",  booking.id);
    fd.append("venue_id",    venueId);
    fd.append("date",        date);
    fd.append("price_total", String(booking.price_total));
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    const result = await action(null, fd);
    setPending(false);
    if (result?.error) {
      setErr(result.error);
    } else {
      setExpanded(false);
      onRefresh();
    }
  }

  // Build WhatsApp URL with optional template
  const waUrl = booking.customer_phone
    ? buildWhatsAppUrl(booking.customer_phone, whatsappTemplate, {
        nombre: booking.customer_name ?? "",
        cancha: courtName,
        dia:    new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Mendoza", weekday: "long", day: "numeric", month: "long" }).format(new Date(date + "T12:00:00Z")),
        hora:   `${fmtTime(booking.start)}–${fmtTime(booking.end)}`,
        total:  `$${booking.price_total.toLocaleString("es-AR")}`,
      })
    : null;

  const isCompact = heightPx < 48;
  const canAct    = !isBlock && !isCancelled;
  function openSheet() { setConfirm(null); setErr(null); setExpanded(true); }
  const timeLabel = `${fmtTime(booking.start)}–${fmtTime(booking.end)}`;

  // Escape cierra la hoja de acciones
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  return (
    <div
      data-testid="booking-card"
      data-pago={isBlock ? undefined : booking.payment_status}
      className={`absolute left-1 right-1 rounded-md border overflow-hidden ${style} ${pending ? "opacity-50" : ""}`}
      style={{ top: topPx, height: heightPx, zIndex: 1 }}
    >
      {/* Tarjeta en la grilla: tocarla abre las acciones */}
      <div
        className={`h-full px-2 py-1 select-none ${canAct ? "cursor-pointer" : ""}`}
        onClick={() => canAct && openSheet()}
        role={canAct ? "button" : undefined}
        tabIndex={canAct ? 0 : undefined}
        onKeyDown={(e) => { if (canAct && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openSheet(); } }}
        title={canAct ? "Tocá para ver las acciones" : undefined}
      >
        <div className="text-xs font-extrabold truncate leading-tight">
          {isBlock
            ? <span className="inline-flex items-center gap-1"><Icon name="lock" size={12} />{booking.customer_name ?? "Bloqueo"}</span>
            : (booking.customer_name ?? "Sin nombre")}
        </div>
        {!isCompact && (
          <div className="text-[11px] leading-tight">{timeLabel}</div>
        )}
        {!isCompact && !isBlock && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <span className="text-[11px]">{STATUS_LABEL[booking.status] ?? booking.status}</span>
            {!isCancelled && (
              <PaymentBadge status={booking.payment_status} total={booking.price_total} paid={booking.amount_paid} />
            )}
          </div>
        )}
      </div>

      {/* Hoja de acciones: abajo en el celular, centrada en pantallas grandes */}
      {expanded && canAct && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={`Turno de ${booking.customer_name ?? "Sin nombre"}`}
        >
          <div aria-hidden="true" className="absolute inset-0 bg-black/50" onClick={() => setExpanded(false)} />
          <div className="relative w-full max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-surface p-4 text-ink shadow-xl
            pb-[calc(1rem+env(safe-area-inset-bottom))] sm:max-w-sm sm:rounded-2xl">
            <p className="text-lg font-extrabold leading-tight">{booking.customer_name ?? "Sin nombre"}</p>
            <p className="mt-0.5 text-sm text-ink-muted">
              {courtName} · {timeLabel} · {STATUS_LABEL[booking.status] ?? booking.status}
            </p>
            <div className="mt-2">
              <PaymentBadge status={booking.payment_status} total={booking.price_total} paid={booking.amount_paid} />
            </div>

            {err && <p className="mt-3 rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm text-danger">{err}</p>}

            <div className="mt-4 flex flex-col gap-2">
              {waUrl && (
                <a href={waUrl} target="_blank" rel="noopener noreferrer" className={`${ACTION_BTN} bg-primary text-on-primary`}>
                  <Icon name="whatsapp" /> WhatsApp
                </a>
              )}
              {booking.payment_status !== "paid" && booking.status === "confirmed" && (
                <button onClick={() => runAction(onMarkPaid)} disabled={pending}
                  className={`${ACTION_BTN} border border-line bg-surface-2 text-ink`}>
                  <Icon name="paid" /> Marcar pagado
                </button>
              )}
              {booking.status === "confirmed" && (
                <button onClick={() => runAction(onMarkNoShow)} disabled={pending}
                  className={`${ACTION_BTN} border border-warning/40 bg-warning-soft text-warning`}>
                  <Icon name="noShow" /> Marcar ausente
                </button>
              )}
              {booking.status === "confirmed" && confirm === null && (
                <button onClick={() => setConfirm("cancel")} disabled={pending}
                  className={`${ACTION_BTN} border-2 border-danger bg-surface text-danger`}>
                  <Icon name="trash" /> Cancelar turno
                </button>
              )}
              {booking.status === "confirmed" && confirm === "cancel" && (
                <div className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning-soft p-3">
                  <p className="text-sm text-warning leading-snug">
                    {refundOnCancel
                      ? <>Se le devolverán <strong>${booking.online_paid.toLocaleString("es-AR")}</strong> al jugador por Mercado Pago.</>
                      : <>¿Cancelar el turno de <strong>{booking.customer_name ?? "este jugador"}</strong>? El horario queda libre.</>}
                  </p>
                  <button onClick={() => runAction(onCancel)} disabled={pending}
                    className={`${ACTION_BTN} border-2 border-danger bg-surface text-danger`}>
                    Confirmar cancelación
                  </button>
                  <button onClick={() => setConfirm(null)} disabled={pending}
                    className={`${ACTION_BTN} border border-line bg-surface text-ink`}>
                    Volver
                  </button>
                </div>
              )}
              {booking.customer_phone && confirm === null && (
                <button onClick={() => setConfirm("block")} disabled={pending}
                  className={`${ACTION_BTN} border border-danger/40 bg-surface text-danger`}>
                  <Icon name="ban" /> Bloquear teléfono
                </button>
              )}
              {booking.customer_phone && confirm === "block" && (
                <div className="flex flex-col gap-2 rounded-xl border border-warning/40 bg-warning-soft p-3">
                  <p className="text-sm text-warning leading-snug">
                    ¿Bloquear el <strong>{booking.customer_phone}</strong>? No va a poder reservar más en este complejo.
                  </p>
                  <button onClick={() => runAction(onBlockPhone, { phone: booking.customer_phone! })} disabled={pending}
                    className={`${ACTION_BTN} border-2 border-danger bg-surface text-danger`}>
                    Confirmar bloqueo
                  </button>
                  <button onClick={() => setConfirm(null)} disabled={pending}
                    className={`${ACTION_BTN} border border-line bg-surface text-ink`}>
                    Volver
                  </button>
                </div>
              )}
              <button onClick={() => setExpanded(false)} className={`${ACTION_BTN} text-ink-muted`}>
                <Icon name="close" /> Cerrar
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual block form
// ---------------------------------------------------------------------------

function BlockForm({
  court, venueId, date, action, onDone,
}: {
  court: AgendaCourt;
  venueId: string;
  date: string;
  action: PanelAction;
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [err,     setErr]     = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setErr(null);
    const result = await action(null, new FormData(e.currentTarget));
    setPending(false);
    if (result?.error) setErr(result.error);
    else onDone();
  }

  const input = "min-h-11 rounded-lg border border-line bg-surface px-2 text-sm text-ink";

  return (
    <form
      onSubmit={handleSubmit}
      className="border-b border-line bg-surface-2 p-2 flex flex-col gap-2"
    >
      <input type="hidden" name="venue_id" value={venueId}  />
      <input type="hidden" name="court_id" value={court.id} />
      <input type="hidden" name="date"     value={date}     />

      <p className="text-sm font-extrabold text-ink">Nuevo bloqueo</p>

      <label className="flex flex-col gap-0.5">
        <span className="text-xs text-ink-muted">Inicio</span>
        <input type="datetime-local" name="start" defaultValue={`${date}T08:00`} className={input} required />
      </label>

      <label className="flex flex-col gap-0.5">
        <span className="text-xs text-ink-muted">Fin</span>
        <input type="datetime-local" name="end" defaultValue={`${date}T10:00`} className={input} required />
      </label>

      <label className="flex flex-col gap-0.5">
        <span className="text-xs text-ink-muted">Nota (opcional)</span>
        <input type="text" name="note" placeholder="Mantenimiento…" className={`${input} placeholder-ink-muted`} />
      </label>

      {err && <p className="text-danger text-xs">{err}</p>}

      <button type="submit" disabled={pending}
        className="min-h-11 rounded-xl bg-primary text-on-primary text-sm font-extrabold hover:opacity-90 disabled:opacity-50">
        {pending ? "Guardando…" : "Guardar bloqueo"}
      </button>
    </form>
  );
}
