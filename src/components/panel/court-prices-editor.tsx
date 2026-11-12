"use client";

import { useActionState, useState } from "react";
import type { PanelActionState } from "@/app/actions/panel";

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
}

function normalizeTime(t: string) {
  return t.slice(0, 5);
}

export function CourtPricesEditor({ action, initialPrices, otherCourts = [] }: CourtPricesEditorProps) {
  const [rows, setRows] = useState<PriceRow[]>(
    initialPrices.map((p) => ({
      weekday:   p.weekday,
      from_time: normalizeTime(p.from_time),
      to_time:   normalizeTime(p.to_time),
      price:     p.price,
    }))
  );
  const [state, formAction, pending] = useActionState(action, null);

  function addRow() {
    setRows((prev) => [...prev, { weekday: 1, from_time: "08:00", to_time: "22:00", price: 0 }]);
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
    <form action={formAction}>
      <input type="hidden" name="prices" value={JSON.stringify(rows)} readOnly />

      {state?.error && <p className="mb-3 text-sm text-red-600">{state.error}</p>}
      {state !== null && !state?.error && (
        <p className="mb-3 text-sm text-green-600">Precios guardados.</p>
      )}

      {/* Cargar desde otra cancha */}
      {otherCourts.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xs text-gray-500 shrink-0">Cargar desde:</span>
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) loadFromCourt(e.target.value); e.target.value = ""; }}
            className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 bg-gray-50"
          >
            <option value="">Otra cancha…</option>
            {otherCourts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {rows.length === 0 && (
        <p className="text-sm text-gray-500 mb-3">Sin precios configurados.</p>
      )}

      <div className="space-y-2 mb-4">
        {rows.map((row, idx) => (
          <div key={idx} className="flex items-center gap-2 flex-wrap">
            <select
              value={row.weekday}
              onChange={(e) => updateRow(idx, "weekday", Number(e.target.value))}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            >
              {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
            <input
              type="time" value={row.from_time}
              onChange={(e) => updateRow(idx, "from_time", e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
            <span className="text-gray-400 text-sm">→</span>
            <input
              type="time" value={row.to_time}
              onChange={(e) => updateRow(idx, "to_time", e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
            <span className="text-gray-500 text-sm">$</span>
            <input
              type="number" value={row.price} min={0} step={100}
              onChange={(e) => updateRow(idx, "price", Number(e.target.value))}
              className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
            <button
              type="button" onClick={() => removeRow(idx)}
              className="text-gray-400 hover:text-red-500 text-sm px-1"
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
          className="text-sm text-green-700 hover:text-green-900 border border-green-300 rounded-lg px-3 py-1.5"
        >
          + Agregar precio
        </button>
        {rows.length > 0 && (
          <button
            type="button" onClick={copyToAllDays}
            className="text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg px-3 py-1.5"
            title="Replica la primera franja a los 7 días"
          >
            Copiar a todos los días
          </button>
        )}
        <button
          type="submit" disabled={pending}
          className="rounded-xl bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60 transition-colors"
        >
          {pending ? "Guardando…" : "Guardar precios"}
        </button>
      </div>
    </form>
  );
}
