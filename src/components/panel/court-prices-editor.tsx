"use client";

import { startTransition, useActionState, useState } from "react";
import type { PanelActionState } from "@/app/actions/panel";
import type { CourtHour } from "@/lib/slots";
import { defaultPriceRow } from "@/lib/price-coverage";
import { useSavedNotice } from "@/components/panel/saved-toast";

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

interface PriceRow {
  weekday: number;
  from_time: string;
  to_time: string;
  price: number;
}

interface OtherCourt {
  id: string;
  name: string;
  prices: { weekday: number; from_time: string; to_time: string; price: number }[];
}

interface CourtPricesEditorProps {
  action: (state: PanelActionState, formData: FormData) => Promise<PanelActionState>;
  initialPrices: PriceRow[];
  otherCourts?: OtherCourt[];
  /** Horario de apertura y duración de turno: la fila por defecto cubre lo abierto sin precio. */
  courtHours?: CourtHour[];
  slotMinutes?: number;
}

function normalizeTime(t: string) {
  return t.slice(0, 5);
}

export function CourtPricesEditor({ action, initialPrices, otherCourts = [], courtHours = [], slotMinutes = 60 }: CourtPricesEditorProps) {
  const [rows, setRows] = useState<PriceRow[]>(
    initialPrices.map((p) => ({
      weekday:   p.weekday,
      from_time: normalizeTime(p.from_time),
      to_time:   normalizeTime(p.to_time),
      price:     p.price,
    }))
  );
  const [state, formAction, pending] = useActionState(action, null);
  useSavedNotice(pending, state, "Precios guardados");

  function addRow() {
    // Propone el tramo abierto que falta cubrir (no 08:00–22:00 fijo: así quedó futmates sin precio de 22 a 00)
    setRows((prev) => [...prev, { ...defaultPriceRow(courtHours, prev, slotMinutes), price: 0 }]);
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateRow(idx: number, field: keyof PriceRow, value: string | number) {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  // Toma la primera fila (by from/to times) y la replica a todos los días con el mismo precio
  function copyToAllDays() {
    if (rows.length === 0) return;
    const { from_time, to_time, price } = rows[0];
    setRows(
      Array.from({ length: 7 }, (_, weekday) => ({ weekday, from_time, to_time, price }))
    );
  }

  function loadFromCourt(courtId: string) {
    const court = otherCourts.find((c) => c.id === courtId);
    if (!court) return;
    setRows(
      court.prices.map((p) => ({
        weekday:   p.weekday,
        from_time: normalizeTime(p.from_time),
        to_time:   normalizeTime(p.to_time),
        price:     p.price,
      }))
    );
  }

  return (
    <form
      // onSubmit y no action=: al terminar una acción de formulario React 19 hace
      // form.reset() y los selects controlados quedan mostrando el primer día
      // ("Dom") aunque lo guardado y el estado sean correctos.
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(() => formAction(formData));
      }}
    >
      <input type="hidden" name="prices" value={JSON.stringify(rows)} readOnly />

      {state?.error && <p className="mb-3 text-sm text-danger">{state.error}</p>}

      {/* Cargar desde otra cancha */}
      {otherCourts.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xs text-ink-muted shrink-0">Cargar desde:</span>
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) loadFromCourt(e.target.value); e.target.value = ""; }}
            className="min-h-11 rounded-lg border border-line px-2 text-sm text-ink bg-surface-2"
          >
            <option value="">Otra cancha…</option>
            {otherCourts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {rows.length === 0 && (
        <p className="text-sm text-ink-muted mb-3">Sin precios configurados.</p>
      )}

      <div className="space-y-2 mb-4">
        {rows.map((row, idx) => (
          <div key={idx} className="flex items-center gap-2 flex-wrap">
            <select
              value={row.weekday}
              onChange={(e) => updateRow(idx, "weekday", Number(e.target.value))}
              className="min-h-11 rounded-lg border border-line bg-surface px-2 text-sm text-ink"
            >
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
            <input
              type="time" value={row.from_time}
              onChange={(e) => updateRow(idx, "from_time", e.target.value)}
              className="min-h-11 rounded-lg border border-line bg-surface px-2 text-sm text-ink"
            />
            <span className="text-ink-muted text-sm">→</span>
            <input
              type="time" value={row.to_time}
              onChange={(e) => updateRow(idx, "to_time", e.target.value)}
              className="min-h-11 rounded-lg border border-line bg-surface px-2 text-sm text-ink"
            />
            <span className="text-ink-muted text-sm">$</span>
            <input
              type="number" value={row.price} min={0} step={100}
              onChange={(e) => updateRow(idx, "price", Number(e.target.value))}
              className="w-24 min-h-11 rounded-lg border border-line bg-surface px-2 text-sm text-ink"
            />
            <button
              type="button" onClick={() => removeRow(idx)}
              className="flex h-11 w-11 items-center justify-center text-ink-muted hover:text-danger text-sm"
              aria-label="Eliminar"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button" onClick={addRow}
          className="text-sm text-brand hover:text-ink border border-primary rounded-lg min-h-11 px-3"
        >
          + Agregar precio
        </button>
        {rows.length > 0 && (
          <button
            type="button" onClick={copyToAllDays}
            className="text-sm text-ink-muted hover:text-ink border border-line rounded-lg min-h-11 px-3"
            title="Replica la primera franja a los 7 días"
          >
            Copiar a todos los días
          </button>
        )}
        <button
          type="submit" disabled={pending}
          className="min-h-11 rounded-xl bg-primary px-4 text-sm font-medium text-on-primary hover:opacity-90 disabled:opacity-60 transition-colors"
        >
          {pending ? "Guardando…" : "Guardar precios"}
        </button>
      </div>
    </form>
  );
}
