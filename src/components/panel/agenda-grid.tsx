'use client';

import { useRouter } from "next/navigation";
import { useState } from "react";
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

const BOOKING_STYLE: Record<string, string> = {
  confirmed: "bg-green-100 border-green-300 text-green-900",
  hold:      "bg-amber-100 border-amber-300 text-amber-900",
  completed: "bg-blue-100  border-blue-300  text-blue-900",
  no_show:   "bg-gray-200  border-gray-400  text-gray-600",
  cancelled: "bg-gray-100  border-gray-300  text-gray-400 opacity-60",
};
const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmado",
  hold:      "Pendiente",
  completed: "Completado",
  no_show:   "Ausente",
  cancelled: "Cancelado",
};
const BLOCK_STYLE = "bg-gray-200 border-gray-400 text-gray-700";

function PaymentBadge({ status, total, paid }: { status: string; total: number; paid: number }) {
  if (status === "paid") {
    return <span className="rounded px-1 bg-green-600 text-white text-[9px]">✓ Pagado</span>;
  }
  if (status === "deposit_paid") {
    const remaining = total - paid;
    return (
      <span className="rounded px-1 bg-amber-500 text-white text-[9px]">
        Señado — falta ${remaining.toLocaleString("es-AR")}
      </span>
    );
  }
  // unpaid
  return (
    <span className="rounded px-1 bg-red-100 text-red-700 text-[9px]">
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
  venueId, whatsappTemplate, date, courts, bookings,
  onCancel, onMarkPaid, onMarkNoShow, onBlockPhone, onCreateBlock,
}: Props) {
  const router = useRouter();

  // Sport filter
  const sports = Array.from(
    new Map(courts.map((c) => [c.sport_id, c.sport_name])).entries()
  ).map(([id, name]) => ({ id, name }));
  const [sportFilter, setSportFilter] = useState<string | null>(null);
  const visibleCourts = sportFilter ? courts.filter((c) => c.sport_id === sportFilter) : courts;

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
      <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-gray-400">
        No hay canchas activas.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Top bar: date nav + sport filter */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => changeDate(-1)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          ← Anterior
        </button>
        <span className="font-medium text-gray-800 capitalize text-sm">{dateLabel}</span>
        <button onClick={() => changeDate(1)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
          Siguiente →
        </button>

        {sports.length > 1 && (
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => setSportFilter(null)}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                sportFilter === null ? "bg-gray-800 text-white border-gray-800" : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              Todos
            </button>
            {sports.map((s) => (
              <button
                key={s.id}
                onClick={() => setSportFilter(sportFilter === s.id ? null : s.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                  sportFilter === s.id ? "bg-green-700 text-white border-green-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="overflow-auto rounded-xl border border-gray-200 bg-white" style={{ maxHeight: "75vh" }}>
        <div className="flex">
          {/* Time axis (sticky left) */}
          <div className="sticky left-0 z-20 bg-white border-r border-gray-200 shrink-0 w-14">
            <div className="h-9 border-b border-gray-200" />
            <div className="relative" style={{ height: gridHeightPx }}>
              {ticks.filter((t) => t.isHour).map((t) => (
                <span
                  key={t.label}
                  className="absolute right-1.5 text-[10px] text-gray-400"
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
              date={date}
              venueId={venueId}
              whatsappTemplate={whatsappTemplate}
              bookings={bookings.filter((b) => b.court_id === court.id)}
              ticks={ticks}
              gridHeightPx={gridHeightPx}
              startMin={startMin}
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
  court, date, venueId, whatsappTemplate, bookings, ticks, gridHeightPx, startMin,
  onCancel, onMarkPaid, onMarkNoShow, onBlockPhone, onCreateBlock, onRefresh,
}: {
  court: AgendaCourt;
  date: string;
  venueId: string;
  whatsappTemplate: string | null;
  bookings: AgendaBooking[];
  ticks: { label: string; topPx: number; isHour: boolean }[];
  gridHeightPx: number;
  startMin: number;
  onCancel: PanelAction;
  onMarkPaid: PanelAction;
  onMarkNoShow: PanelAction;
  onBlockPhone: PanelAction;
  onCreateBlock: PanelAction;
  onRefresh: () => void;
}) {
  const [showBlockForm, setShowBlockForm] = useState(false);

  return (
    <div className="shrink-0 border-r border-gray-200 last:border-r-0" style={{ minWidth: 220, width: 240 }}>
      {/* Header */}
      <div className="h-9 border-b border-gray-200 flex items-center justify-between px-2.5 bg-gray-50 sticky top-0 z-10">
        <span className="text-xs font-semibold text-gray-700 truncate">{court.name}</span>
        <button
          onClick={() => setShowBlockForm((v) => !v)}
          title="Agregar bloqueo"
          className="text-xs text-gray-400 hover:text-gray-700 ml-1 shrink-0 font-bold"
        >
          {showBlockForm ? "✕" : "+"}
        </button>
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
            className={`absolute left-0 right-0 ${t.isHour ? "border-t border-gray-200" : "border-t border-gray-100"}`}
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
  const style       = isBlock ? BLOCK_STYLE : (BOOKING_STYLE[booking.status] ?? "bg-gray-100 border-gray-300 text-gray-700");

  const [expanded, setExpanded] = useState(false);
  const [pending,  setPending]  = useState(false);
  const [err,      setErr]      = useState<string | null>(null);

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

  return (
    <div
      className={`absolute left-1 right-1 rounded-md border overflow-hidden ${style} ${pending ? "opacity-50" : ""}`}
      style={{ top: topPx, height: expanded ? undefined : heightPx, zIndex: expanded ? 30 : 1 }}
    >
      {/* Card header */}
      <div
        className="px-1.5 py-1 cursor-pointer select-none"
        onClick={() => !isBlock && !isCancelled && setExpanded((v) => !v)}
        title={isBlock || isCancelled ? undefined : "Click para acciones"}
      >
        <div className="text-[10px] font-semibold truncate leading-tight">
          {isBlock ? `🔒 ${booking.customer_name ?? "Bloqueo"}` : (booking.customer_name ?? "Sin nombre")}
        </div>
        {!isCompact && (
          <div className="text-[9px] opacity-75 leading-tight">{fmtTime(booking.start)}–{fmtTime(booking.end)}</div>
        )}
        {!isCompact && !isBlock && (
          <div className="mt-0.5 flex flex-wrap gap-0.5">
            <span className="text-[9px] opacity-60">{STATUS_LABEL[booking.status] ?? booking.status}</span>
            {!isCancelled && (
              <PaymentBadge
                status={booking.payment_status}
                total={booking.price_total}
                paid={booking.amount_paid}
              />
            )}
          </div>
        )}
      </div>

      {/* Expanded actions */}
      {expanded && !isBlock && !isCancelled && (
        <div className="bg-white/95 border-t border-gray-200 p-1.5 flex flex-col gap-1">
          {err && <p className="text-red-600 text-[9px]">{err}</p>}

          {waUrl && (
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-green-500 text-white text-[10px] px-2 py-1 font-medium hover:bg-green-600 text-center"
            >
              📱 WhatsApp
            </a>
          )}
          {booking.payment_status !== "paid" && booking.status === "confirmed" && (
            <button
              onClick={() => runAction(onMarkPaid)}
              disabled={pending}
              className="rounded bg-blue-500 text-white text-[10px] px-2 py-1 font-medium hover:bg-blue-600 disabled:opacity-50"
            >
              💰 Marcar pagado
            </button>
          )}
          {booking.status === "confirmed" && (
            <button
              onClick={() => runAction(onMarkNoShow)}
              disabled={pending}
              className="rounded bg-orange-500 text-white text-[10px] px-2 py-1 font-medium hover:bg-orange-600 disabled:opacity-50"
            >
              ✕ Marcar ausente
            </button>
          )}
          {booking.status === "confirmed" && (
            <button
              onClick={() => runAction(onCancel)}
              disabled={pending}
              className="rounded bg-gray-500 text-white text-[10px] px-2 py-1 font-medium hover:bg-gray-600 disabled:opacity-50"
            >
              🗑 Cancelar turno
            </button>
          )}
          {booking.customer_phone && (
            <button
              onClick={() => runAction(onBlockPhone, { phone: booking.customer_phone! })}
              disabled={pending}
              className="rounded bg-red-500 text-white text-[10px] px-2 py-1 font-medium hover:bg-red-600 disabled:opacity-50"
            >
              🚫 Bloquear teléfono
            </button>
          )}
          <button
            onClick={() => setExpanded(false)}
            className="rounded bg-gray-100 text-gray-600 text-[10px] px-2 py-1 hover:bg-gray-200"
          >
            Cerrar
          </button>
        </div>
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

  return (
    <form
      onSubmit={handleSubmit}
      className="border-b border-gray-200 bg-gray-50 p-2 flex flex-col gap-1.5"
    >
      <input type="hidden" name="venue_id" value={venueId}  />
      <input type="hidden" name="court_id" value={court.id} />
      <input type="hidden" name="date"     value={date}     />

      <p className="text-[10px] font-semibold text-gray-700">Nuevo bloqueo</p>

      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] text-gray-500">Inicio</span>
        <input type="datetime-local" name="start" defaultValue={`${date}T08:00`}
          className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px]" required />
      </label>

      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] text-gray-500">Fin</span>
        <input type="datetime-local" name="end" defaultValue={`${date}T10:00`}
          className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px]" required />
      </label>

      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] text-gray-500">Nota (opcional)</span>
        <input type="text" name="note" placeholder="Mantenimiento…"
          className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px]" />
      </label>

      {err && <p className="text-red-600 text-[9px]">{err}</p>}

      <button type="submit" disabled={pending}
        className="rounded bg-gray-700 text-white text-[10px] px-2 py-1 font-medium hover:bg-gray-800 disabled:opacity-50">
        {pending ? "Guardando…" : "Guardar bloqueo"}
      </button>
    </form>
  );
}
