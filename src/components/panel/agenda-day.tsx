'use client';

/**
 * Agenda del dueño (rediseño, diseno/agenda-v2.png): en vez de la grilla de
 * horas, la lista del día en orden de hora.
 *
 * - Arriba: días (Hoy + 6) y un selector para cualquier otra fecha; resumen
 *   del día (turnos, $ a cobrar, libres) de todas las canchas.
 * - Pestañas por cancha (con la cantidad de turnos) y "Todas"; la elegida
 *   queda recordada en este dispositivo. En "Todas", en pantallas anchas, una
 *   columna por cancha lado a lado (las mismas tarjetas).
 * - Cada turno: hora y fin, nombre, celular, estado del pago (lima pagado o
 *   seña, ámbar sin pagar) y WhatsApp (44 px). Tocarlo abre la hoja con
 *   "Cobrado" y "WhatsApp" grandes arriba; cancelar y bloquear piden confirmar.
 * - Libres punteados con "+ Cargar turno". Línea "AHORA" si el día es hoy.
 * - Barra fija abajo: "+ Nuevo turno" y "Compartir libres".
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { AgendaBooking, AgendaCourt } from "@/lib/supabase/panel-queries";
import type { PanelActionState } from "@/app/actions/panel";
import { buildWhatsAppUrl, formatArgentinePhone } from "@/lib/phone";
import { showSaved } from "@/components/panel/saved-toast";
import { DEFAULT_WA_TEMPLATE } from "@/lib/wa-template";

export type FreeSlot = { courtId: string; start: string; end: string };
type PanelAction = (prev: PanelActionState, fd: FormData) => Promise<PanelActionState>;

const TZ = "America/Argentina/Mendoza";
const ALL = "todas";

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}
/** "YYYY-MM-DDTHH:MM" en hora de Mendoza (para los campos del bloqueo). */
function localInput(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 3 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}
function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dayChip(date: string, today: string) {
  const d = new Date(date + "T12:00:00Z");
  const wd = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short" }).format(d).replace(".", "");
  return { top: date === today ? "Hoy" : wd.charAt(0).toUpperCase() + wd.slice(1), day: String(d.getUTCDate()) };
}
const money = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

/** Lo que falta cobrar de un turno confirmado (0 si ya está pago). */
function due(b: AgendaBooking): number {
  if (b.payment_status === "paid") return 0;
  return Math.max(0, b.price_total - b.amount_paid);
}
const isBooking = (b: AgendaBooking) => b.booking_kind !== "block";
/** Turnos que cuentan en el día (no bloqueos ni cancelados). */
const counts = (b: AgendaBooking) => isBooking(b) && b.status !== "cancelled";

// Íconos de línea (SVG inline)
const ICONS = {
  whatsapp: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
  chevron:  <path d="m9 18 6-6-6-6" />,
  lock:     <><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  close:    <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  plus:     <><path d="M5 12h14" /><path d="M12 5v14" /></>,
  share:    <><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="m16 6-4-4-4 4" /><path d="M12 2v13" /></>,
  check:    <path d="M20 6 9 17l-5-5" />,
} as const;
function Icon({ name, size = 20 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {ICONS[name]}
    </svg>
  );
}

// Cancha elegida (pestaña), recordada por complejo en este dispositivo
const COURT_EVENT = "turnazo-agenda-cancha";
function subscribeCourt(cb: () => void) {
  window.addEventListener(COURT_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(COURT_EVENT, cb); window.removeEventListener("storage", cb); };
}
function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** Estado del pago: lima pagado o seña, ámbar sin pagar. */
function PaymentBadge({ b }: { b: AgendaBooking }) {
  const base = "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-extrabold";
  if (b.status === "hold") return <span data-testid="badge-pago" className={`${base} bg-surface-2 text-ink`}>Pagando online</span>;
  if (b.status === "completed") return <span data-testid="badge-pago" className={`${base} bg-surface-2 text-ink`}>Jugado</span>;
  if (b.status === "no_show") return <span data-testid="badge-pago" className={`${base} bg-surface-2 text-ink`}>No vino</span>;
  if (b.payment_status === "paid") return <span data-testid="badge-pago" className={`${base} bg-accent text-on-accent`}>Pagado</span>;
  if (b.payment_status === "deposit_paid") {
    return <span data-testid="badge-pago" className={`${base} bg-accent text-on-accent`}>Seña {money(b.amount_paid)}</span>;
  }
  return <span data-testid="badge-pago" className={`${base} bg-warning-soft text-warning`}>Sin pagar {money(due(b))}</span>;
}

function stripe(b: AgendaBooking): string {
  if (b.status !== "confirmed") return "border-l-line";
  return b.payment_status === "paid" || b.payment_status === "deposit_paid" ? "border-l-accent" : "border-l-warning";
}

// ---------------------------------------------------------------------------

type Props = {
  venueId: string;
  venueName: string;
  whatsappTemplate: string | null;
  date: string;
  today: string;
  nowIso: string;
  courts: AgendaCourt[];
  bookings: AgendaBooking[];
  free: FreeSlot[];
  onCancel: PanelAction;
  onMarkPaid: PanelAction;
  onMarkNoShow: PanelAction;
  onBlockPhone: PanelAction;
  onCreateBlock: PanelAction;
  onCreateBooking: PanelAction;
};

/** `at`: inicio en ms (las reservas llegan como "2026-11-25 15:30:00+00" y los libres en ISO: se comparan como hora, no como texto). */
type Item =
  | { kind: "booking"; at: number; b: AgendaBooking }
  | { kind: "free"; at: number; slot: FreeSlot };

export default function AgendaDay(props: Props) {
  const { venueId, venueName, date, today, nowIso, courts, bookings, free } = props;
  const router = useRouter();

  const courtKey = `turnazo-agenda-cancha:${venueId}`;
  const stored = useSyncExternalStore(subscribeCourt, () => readStored(courtKey), () => null);
  const tab = stored === ALL || courts.some((c) => c.id === stored) ? stored! : (courts[0]?.id ?? ALL);
  function pickTab(id: string) {
    try { localStorage.setItem(courtKey, id); } catch { /* sin almacenamiento: no se recuerda */ }
    window.dispatchEvent(new Event(COURT_EVENT));
  }

  const [opened, setOpened] = useState<AgendaBooking | null>(null);
  const [creating, setCreating] = useState<null | { slot?: FreeSlot }>(null);

  const courtName = (id: string) => courts.find((c) => c.id === id)?.name ?? "";
  const dayBookings = bookings.filter(counts);
  const totalDue = dayBookings.filter((b) => b.status === "confirmed").reduce((s, b) => s + due(b), 0);

  function itemsFor(courtIds: string[]): Item[] {
    const items: Item[] = [
      ...bookings.filter((b) => courtIds.includes(b.court_id) && b.status !== "cancelled")
        .map((b) => ({ kind: "booking" as const, at: Date.parse(b.start), b })),
      ...free.filter((s) => courtIds.includes(s.courtId)).map((slot) => ({ kind: "free" as const, at: Date.parse(slot.start), slot })),
    ];
    return items.sort((a, b) => a.at - b.at
      || courtName(a.kind === "booking" ? a.b.court_id : a.slot.courtId).localeCompare(courtName(b.kind === "booking" ? b.b.court_id : b.slot.courtId), "es"));
  }

  // Días: hoy + 6 (y el elegido, si es otro)
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  if (!days.includes(date)) days.unshift(date);
  const go = (d: string) => router.push(`?fecha=${d}`);

  const listProps = {
    date, today, nowIso, showCourt: false, courtName,
    whatsappTemplate: props.whatsappTemplate,
    onOpen: setOpened,
    onLoad: (slot: FreeSlot) => setCreating({ slot }),
  };

  if (courts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line p-10 text-center text-ink-muted">
        No hay canchas activas.
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-28">
      <header>
        <p className="text-sm text-ink-muted">Tu agenda</p>
        <h1 className="truncate text-2xl font-extrabold text-ink">{venueName}</h1>
      </header>

      {/* Días */}
      <div className="flex flex-col gap-2">
        <nav aria-label="Día" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
          <ul className="flex gap-2">
            {days.map((d) => {
              const { top, day } = dayChip(d, today);
              const selected = d === date;
              return (
                <li key={d}>
                  <Link
                    href={`?fecha=${d}`}
                    scroll={false}
                    aria-current={selected ? "date" : undefined}
                    data-testid="dia"
                    className={`flex h-16 w-14 flex-col items-center justify-center rounded-2xl border text-center
                      ${selected ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-ink hover:border-primary"}`}
                  >
                    <span className="text-xs">{top}</span>
                    <span className="text-xl font-extrabold leading-tight">{day}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <label className="flex min-h-11 w-fit items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm text-ink">
          <span>Otra fecha</span>
          <input
            type="date"
            aria-label="Elegir fecha"
            value={date}
            onChange={(e) => e.target.value && go(e.target.value)}
            className="bg-transparent text-ink outline-none"
          />
        </label>
      </div>

      {/* Resumen del día */}
      <section aria-label="Resumen del día" className="grid grid-cols-3 gap-2" data-testid="resumen">
        <div className="rounded-2xl bg-primary p-3 text-on-primary">
          <p className="text-2xl font-extrabold leading-tight" data-testid="resumen-turnos">{dayBookings.length}</p>
          <p className="text-sm">{date === today ? "turnos hoy" : dayBookings.length === 1 ? "turno" : "turnos"}</p>
        </div>
        <div className="rounded-2xl bg-warning-soft p-3 text-warning">
          <p className="text-2xl font-extrabold leading-tight" data-testid="resumen-cobrar">{money(totalDue)}</p>
          <p className="text-sm">a cobrar</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-3 text-ink">
          <p className="text-2xl font-extrabold leading-tight" data-testid="resumen-libres">{free.length}</p>
          <p className="text-sm">{free.length === 1 ? "libre" : "libres"}</p>
        </div>
      </section>

      {/* Pestañas por cancha + Todas */}
      <div role="tablist" aria-label="Canchas" className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
        {[...courts.map((c) => ({ id: c.id, label: `${c.name} · ${dayBookings.filter((b) => b.court_id === c.id).length}` })), { id: ALL, label: "Todas" }]
          .map((t) => {
            const selected = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => pickTab(t.id)}
                className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-extrabold transition-colors
                  ${selected ? "border-transparent bg-primary text-on-primary" : "border-line bg-surface text-ink hover:border-primary"}`}
              >
                {t.label}
              </button>
            );
          })}
      </div>

      {tab === ALL ? (
        <>
          {/* Celular: una sola lista con el nombre de la cancha */}
          <div className="lg:hidden">
            <DayList {...listProps} items={itemsFor(courts.map((c) => c.id))} showCourt />
          </div>
          {/* Pantallas anchas: una columna por cancha, lado a lado */}
          <div className="hidden gap-4 lg:grid" style={{ gridTemplateColumns: `repeat(${courts.length}, minmax(0, 1fr))` }}>
            {courts.map((c) => (
              <section key={c.id} data-testid="court-column" aria-label={c.name} className="min-w-0">
                <h2 className="mb-2 text-base font-extrabold text-ink">{c.name}</h2>
                <DayList {...listProps} items={itemsFor([c.id])} />
              </section>
            ))}
          </div>
        </>
      ) : (
        <section data-testid="court-column" aria-label={courtName(tab)}>
          <DayList {...listProps} items={itemsFor([tab])} />
        </section>
      )}

      {/* Barra fija abajo */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] backdrop-blur md:left-56">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setCreating({})}
            className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-base font-extrabold text-on-primary shadow-sm hover:opacity-90"
          >
            <Icon name="plus" /> Nuevo turno
          </button>
          <Link
            href={`/panel/complejos/${venueId}/historia`}
            data-testid="compartir-turnos"
            className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-base font-extrabold text-on-accent shadow-sm hover:opacity-90"
          >
            <Icon name="share" /> Compartir libres
          </Link>
        </div>
      </div>

      {opened && (
        <BookingSheet
          key={opened.id}
          booking={opened}
          courtName={courtName(opened.court_id)}
          {...props}
          onClose={() => setOpened(null)}
          onDone={(msg) => { setOpened(null); showSaved(msg); router.refresh(); }}
        />
      )}
      {creating && (
        <NewSheet
          {...props}
          initial={creating.slot}
          onClose={() => setCreating(null)}
          onDone={(msg) => { setCreating(null); showSaved(msg); router.refresh(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista del día
// ---------------------------------------------------------------------------

function DayList({ items, date, today, nowIso, showCourt, courtName, whatsappTemplate, onOpen, onLoad }: {
  items: Item[];
  date: string;
  today: string;
  nowIso: string;
  showCourt: boolean;
  courtName: (id: string) => string;
  whatsappTemplate: string | null;
  onOpen: (b: AgendaBooking) => void;
  onLoad: (slot: FreeSlot) => void;
}) {
  // Línea AHORA: antes del primer turno que todavía no empezó (solo hoy)
  const nowMs = Date.parse(nowIso);
  const nowAt = date === today ? items.findIndex((i) => i.at >= nowMs) : -2;
  const nowLine = (
    <li key="ahora" data-testid="ahora" className="flex items-center gap-2 py-1" aria-label={`Ahora, ${fmtTime(nowIso)}`}>
      <span className="text-xs font-extrabold text-danger">AHORA {fmtTime(nowIso)}</span>
      <span aria-hidden="true" className="h-0.5 flex-1 rounded bg-danger" />
    </li>
  );

  if (items.length === 0) {
    return (
      <ul className="flex flex-col gap-3">
        {date === today && nowLine}
        <li className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-ink-muted">
          {date < today ? "No hubo turnos este día." : "No hay turnos ni horarios libres este día."}
        </li>
      </ul>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {items.map((it, i) => (
        <FragmentWithNow key={it.kind === "booking" ? it.b.id : `${it.slot.courtId}-${it.at}`} showNow={i === nowAt} nowLine={nowLine}>
          {it.kind === "booking"
            ? <BookingRow b={it.b} court={showCourt ? courtName(it.b.court_id) : null} date={date} courtName={courtName(it.b.court_id)} whatsappTemplate={whatsappTemplate} onOpen={onOpen} />
            : <FreeRow slot={it.slot} court={showCourt ? courtName(it.slot.courtId) : null} onLoad={onLoad} />}
        </FragmentWithNow>
      ))}
      {nowAt === -1 && nowLine}
    </ul>
  );
}

function FragmentWithNow({ showNow, nowLine, children }: { showNow: boolean; nowLine: React.ReactNode; children: React.ReactNode }) {
  return <>{showNow && nowLine}{children}</>;
}

function TimeCol({ start, end }: { start: string; end: string }) {
  return (
    <div className="w-12 shrink-0 pt-3">
      <p className="text-base font-extrabold leading-tight text-ink">{fmtTime(start)}</p>
      <p className="text-xs text-ink-muted">{fmtTime(end)}</p>
    </div>
  );
}

function waLink(b: AgendaBooking, courtName: string, date: string, template: string | null): string | null {
  if (!b.customer_phone) return null;
  // Sin plantilla guardada, el mensaje armado por defecto (el mismo que trae el editor)
  return buildWhatsAppUrl(b.customer_phone, template?.trim() ? template : DEFAULT_WA_TEMPLATE, {
    nombre: b.customer_name ?? "",
    cancha: courtName,
    dia:    new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(date + "T12:00:00Z")),
    hora:   `${fmtTime(b.start)}–${fmtTime(b.end)}`,
    total:  money(b.price_total),
  });
}

function BookingRow({ b, court, date, courtName, whatsappTemplate, onOpen }: {
  b: AgendaBooking; court: string | null; date: string; courtName: string; whatsappTemplate: string | null;
  onOpen: (b: AgendaBooking) => void;
}) {
  if (!isBooking(b)) {
    return (
      <li className="flex gap-3">
        <TimeCol start={b.start} end={b.end} />
        <div data-testid="bloqueo" className="flex min-h-14 flex-1 items-center gap-2 rounded-2xl border-2 border-dashed border-line bg-surface-2 px-4 text-sm text-ink">
          <Icon name="lock" size={16} />
          <span className="min-w-0 truncate"><strong>Bloqueado</strong> · {b.customer_name ?? "Bloqueo"}{court ? ` · ${court}` : ""}</span>
        </div>
      </li>
    );
  }
  const name = b.customer_name ?? "Sin nombre";
  const wa = waLink(b, courtName, date, whatsappTemplate);
  return (
    <li className="flex gap-3">
      <TimeCol start={b.start} end={b.end} />
      <div
        data-testid="booking-card"
        data-pago={b.payment_status}
        data-estado={b.status}
        data-inicio={fmtTime(b.start)}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-line border-l-4 ${stripe(b)} bg-surface py-2 pr-2 pl-3 shadow-sm
          ${b.status === "no_show" || b.status === "completed" ? "opacity-80" : ""}`}
      >
        <button type="button" onClick={() => onOpen(b)} className="min-h-11 min-w-0 flex-1 text-left">
          <span className="block truncate text-base font-extrabold text-ink">{name}</span>
          <span className="block text-sm text-ink-muted">
            {b.customer_phone ? formatArgentinePhone(b.customer_phone) : "Sin celular"}{court ? ` · ${court}` : ""}
          </span>
          <span className="mt-1 block"><PaymentBadge b={b} /></span>
        </button>
        {wa && (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`WhatsApp a ${name}`}
            data-testid="whatsapp-turno"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink hover:bg-line"
          >
            <Icon name="whatsapp" />
          </a>
        )}
      </div>
    </li>
  );
}

function FreeRow({ slot, court, onLoad }: { slot: FreeSlot; court: string | null; onLoad: (slot: FreeSlot) => void }) {
  return (
    <li className="flex gap-3">
      <TimeCol start={slot.start} end={slot.end} />
      <button
        type="button"
        data-testid="turno-libre"
        data-inicio={fmtTime(slot.start)}
        onClick={() => onLoad(slot)}
        className="flex min-h-14 flex-1 items-center justify-between gap-2 rounded-2xl border-2 border-dashed border-line px-4 text-left hover:border-primary"
      >
        <span className="text-sm text-ink-muted">Libre{court ? ` · ${court}` : ""}</span>
        <span className="text-sm font-extrabold text-ink">+ Cargar turno</span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Hojas (abajo en el celular, centradas en pantallas grandes)
// ---------------------------------------------------------------------------

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={label}>
      <div aria-hidden="true" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-h-[90dvh] overflow-y-auto rounded-t-3xl bg-surface p-5 text-ink shadow-xl
        pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:max-w-md sm:rounded-3xl">
        <div aria-hidden="true" className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-line sm:hidden" />
        {children}
      </div>
    </div>,
    document.body,
  );
}

const ROW = "flex min-h-14 w-full items-center gap-3 rounded-2xl bg-surface-2 px-4 py-2 text-left hover:bg-line disabled:opacity-50";
const BIG = "flex min-h-14 items-center justify-center gap-2 rounded-2xl px-4 text-base font-extrabold hover:opacity-90 disabled:opacity-50";
const SMALL_BTN = "flex min-h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-extrabold disabled:opacity-50";

function BookingSheet({ booking: b, courtName, venueId, date, today, whatsappTemplate, onMarkPaid, onMarkNoShow, onCancel, onBlockPhone, onClose, onDone }: Props & {
  booking: AgendaBooking; courtName: string; onClose: () => void; onDone: (msg: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "cancel" | "block">(null);
  const name = b.customer_name ?? "Sin nombre";
  const wa = waLink(b, courtName, date, whatsappTemplate);
  const confirmed = b.status === "confirmed";
  const toCollect = confirmed && b.payment_status !== "paid" ? due(b) : 0;
  const { top, day } = dayChip(date, today);

  async function run(action: PanelAction, msg: string, extra: Record<string, string> = {}) {
    setPending(true);
    setErr(null);
    const fd = new FormData();
    fd.append("booking_id", b.id);
    fd.append("venue_id", venueId);
    fd.append("date", date);
    fd.append("price_total", String(b.price_total));
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    const res = await action(null, fd);
    setPending(false);
    if (res?.error) setErr(res.error);
    else onDone(msg);
  }

  return (
    <Sheet label={`Turno de ${name}`} onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {top === "Hoy" ? "Hoy" : `${top} ${day}`} · {fmtTime(b.start)} – {fmtTime(b.end)} · {courtName}
        </p>
        <PaymentBadge b={b} />
      </div>
      <h2 className="mt-1 text-2xl font-extrabold leading-tight">{name}</h2>
      <p className="text-sm text-ink-muted">{b.customer_phone ? formatArgentinePhone(b.customer_phone) : "Sin celular"}</p>

      {err && <p role="alert" className="mt-3 rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm text-danger">{err}</p>}

      <div className={`mt-4 grid gap-2 ${toCollect > 0 && wa ? "grid-cols-2" : "grid-cols-1"}`}>
        {toCollect > 0 && (
          <button type="button" onClick={() => run(onMarkPaid, "Cobrado")} disabled={pending} className={`${BIG} bg-accent text-on-accent`}>
            Cobrado {money(toCollect)}
          </button>
        )}
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" className={`${BIG} bg-surface-2 text-ink`}>
            <Icon name="whatsapp" /> WhatsApp
          </a>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {confirmed && confirm === null && (
          <button type="button" onClick={() => run(onMarkNoShow, "Guardado")} disabled={pending} className={ROW}>
            <span className="min-w-0 flex-1">
              <span className="block font-extrabold">Marcar que no vino</span>
              <span className="block text-sm text-ink-muted">Queda anotado en la agenda</span>
            </span>
            <Icon name="chevron" />
          </button>
        )}

        {confirmed && confirm === null && (
          <button type="button" onClick={() => setConfirm("cancel")} disabled={pending} className={ROW}>
            <span className="min-w-0 flex-1">
              <span className="block font-extrabold text-danger">Cancelar turno</span>
              <span className="block text-sm text-ink-muted">
                {b.online_paid > 0 ? `Se le devuelven ${money(b.online_paid)} por Mercado Pago` : "El horario queda libre"}
              </span>
            </span>
            <span className="text-danger"><Icon name="chevron" /></span>
          </button>
        )}
        {confirmed && confirm === "cancel" && (
          <div className="flex flex-col gap-2 rounded-2xl border border-warning/40 bg-warning-soft p-3">
            <p className="text-sm leading-snug text-warning">
              {b.online_paid > 0
                ? <>Se le devolverán <strong>{money(b.online_paid)}</strong> al jugador por Mercado Pago.</>
                : <>¿Cancelar el turno de <strong>{name}</strong>? El horario queda libre.</>}
            </p>
            <button type="button" onClick={() => run(onCancel, "Turno cancelado")} disabled={pending} className={`${SMALL_BTN} border-2 border-danger bg-surface text-danger`}>
              Confirmar cancelación
            </button>
            <button type="button" onClick={() => setConfirm(null)} disabled={pending} className={`${SMALL_BTN} border border-line bg-surface text-ink`}>
              Volver
            </button>
          </div>
        )}

        {b.customer_phone && confirm === null && (
          <button type="button" onClick={() => setConfirm("block")} disabled={pending} className={ROW}>
            <span className="min-w-0 flex-1">
              <span className="block font-extrabold text-danger">Bloquear este número</span>
              <span className="block text-sm text-ink-muted">No va a poder reservar en tu complejo</span>
            </span>
            <span className="text-danger"><Icon name="chevron" /></span>
          </button>
        )}
        {b.customer_phone && confirm === "block" && (
          <div className="flex flex-col gap-2 rounded-2xl border border-warning/40 bg-warning-soft p-3">
            <p className="text-sm leading-snug text-warning">
              ¿Bloquear el <strong>{formatArgentinePhone(b.customer_phone)}</strong>? No va a poder reservar más en este complejo.
            </p>
            <button type="button" onClick={() => run(onBlockPhone, "Número bloqueado", { phone: b.customer_phone! })} disabled={pending}
              className={`${SMALL_BTN} border-2 border-danger bg-surface text-danger`}>
              Confirmar bloqueo
            </button>
            <button type="button" onClick={() => setConfirm(null)} disabled={pending} className={`${SMALL_BTN} border border-line bg-surface text-ink`}>
              Volver
            </button>
          </div>
        )}

        <button type="button" onClick={onClose} className={`${SMALL_BTN} text-ink-muted`}>
          <Icon name="close" size={18} /> <span className="ml-1">Cerrar</span>
        </button>
      </div>
    </Sheet>
  );
}

/** "+ Nuevo turno" / "+ Cargar turno": un turno de un jugador o un bloqueo. */
function NewSheet({ courts, free, venueId, date, initial, onCreateBooking, onCreateBlock, onClose, onDone }: Props & {
  initial?: FreeSlot; onClose: () => void; onDone: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"turno" | "bloqueo">("turno");
  const [courtId, setCourtId] = useState(initial?.courtId ?? free[0]?.courtId ?? courts[0].id);
  const slots = free.filter((s) => s.courtId === courtId);
  const [start, setStart] = useState<string | null>(initial?.start ?? slots[0]?.start ?? null);
  const slot = slots.find((s) => s.start === start) ?? null;
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<PanelActionState>(null);

  function pickCourt(id: string) {
    setCourtId(id);
    setStart(free.find((s) => s.courtId === id)?.start ?? null);
    setState(null);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>, action: PanelAction, msg: string) {
    e.preventDefault();
    setPending(true);
    setState(null);
    const res = await action(null, new FormData(e.currentTarget));
    setPending(false);
    if (res?.error || res?.fieldErrors) setState(res);
    else onDone(msg);
  }

  const input = "min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-muted";
  const choice = (on: boolean) =>
    `min-h-11 rounded-xl border px-3 text-sm font-extrabold ${on ? "border-transparent bg-primary text-on-primary" : "border-line bg-surface text-ink hover:border-primary"}`;

  return (
    <Sheet label="Nuevo turno" onClose={onClose}>
      <h2 className="text-xl font-extrabold">Nuevo turno</h2>

      <div role="radiogroup" aria-label="Qué cargar" className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" role="radio" aria-checked={mode === "turno"} onClick={() => setMode("turno")} className={choice(mode === "turno")}>
          Turno de un jugador
        </button>
        <button type="button" role="radio" aria-checked={mode === "bloqueo"} onClick={() => setMode("bloqueo")} className={choice(mode === "bloqueo")}>
          Bloquear horario
        </button>
      </div>

      {courts.length > 1 && (
        <fieldset className="mt-4">
          <legend className="mb-1.5 text-sm font-extrabold text-ink">Cancha</legend>
          <div className="flex flex-wrap gap-2">
            {courts.map((c) => (
              <button key={c.id} type="button" aria-pressed={c.id === courtId} onClick={() => pickCourt(c.id)} className={choice(c.id === courtId)}>
                {c.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {state?.error && <p role="alert" className="mt-3 rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm text-danger">{state.error}</p>}

      {mode === "turno" ? (
        <form onSubmit={(e) => submit(e, onCreateBooking, "Turno cargado")} className="mt-4 flex flex-col gap-4">
          <input type="hidden" name="venue_id" value={venueId} />
          <input type="hidden" name="court_id" value={courtId} />
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="start" value={slot?.start ?? ""} />
          <input type="hidden" name="end" value={slot?.end ?? ""} />

          <fieldset>
            <legend className="mb-1.5 text-sm font-extrabold text-ink">Horario</legend>
            {slots.length === 0 ? (
              <p className="text-sm text-ink-muted">No quedan horarios libres en esta cancha este día.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {slots.map((s) => (
                  <button key={s.start} type="button" aria-pressed={s.start === start} onClick={() => setStart(s.start)} className={choice(s.start === start)}>
                    {fmtTime(s.start)}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-extrabold text-ink">Nombre</span>
            <input name="customer_name" autoComplete="off" className={input} placeholder="Nombre y apellido" required minLength={2} maxLength={80} />
            {state?.fieldErrors?.customer_name && <span className="text-sm text-danger">{state.fieldErrors.customer_name[0]}</span>}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-extrabold text-ink">Celular</span>
            <input name="customer_phone" type="tel" inputMode="tel" autoComplete="off" className={input} placeholder="2622 123456" required />
            {state?.fieldErrors?.customer_phone && <span className="text-sm text-danger">{state.fieldErrors.customer_phone[0]}</span>}
          </label>

          <button type="submit" disabled={pending || !slot} className={`${BIG} bg-primary text-on-primary`}>
            {pending ? "Cargando…" : "Cargar turno"}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => submit(e, onCreateBlock, "Horario bloqueado")} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="venue_id" value={venueId} />
          <input type="hidden" name="court_id" value={courtId} />
          <input type="hidden" name="date" value={date} />
          <label className="flex flex-col gap-1">
            <span className="text-sm font-extrabold text-ink">Desde</span>
            <input type="datetime-local" name="start" defaultValue={slot ? localInput(slot.start) : `${date}T08:00`} className={input} required />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-extrabold text-ink">Hasta</span>
            <input type="datetime-local" name="end" defaultValue={slot ? localInput(slot.end) : `${date}T10:00`} className={input} required />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-extrabold text-ink">Nota (opcional)</span>
            <input type="text" name="note" placeholder="Mantenimiento…" maxLength={80} className={input} />
          </label>
          <button type="submit" disabled={pending} className={`${BIG} bg-primary text-on-primary`}>
            {pending ? "Guardando…" : "Guardar bloqueo"}
          </button>
        </form>
      )}

      <button type="button" onClick={onClose} className={`${SMALL_BTN} mt-2 text-ink-muted`}>Cerrar</button>
    </Sheet>
  );
}
