"use client";

import { useActionState, useState } from "react";
import type { PanelActionState } from "@/app/actions/panel";

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

interface HourRow {
  weekday: number;
  open_time: string;
  close_time: string;
}

interface OtherCourt {
  id: string;
  name: string;
  hours: { weekday: number; open_time: string; close_time: string }[];
}

interface CourtHoursEditorProps {
  action: (state: PanelActionState, formData: FormData) => Promise<PanelActionState>;
  initialHours: HourRow[];
  otherCourts?: OtherCourt[];
}

function normalizeTime(t: string) {
  return t.slice(0, 5); // "HH:MM:SS" → "HH:MM"
}

export function CourtHoursEditor({ action, initialHours, otherCourts = [] }: CourtHoursEditorProps) {
  const [rows, setRows] = useState<HourRow[]>(
    initialHours.map((h) => ({
      weekday:    h.weekday,
      open_time:  normalizeTime(h.open_time),
      close_time: normalizeTime(h.close_time),
    }))
  );
  const [state, formAction, pending] = useActionState(action, null);

  function addRow() {
    setRows((prev) => [...prev, { weekday: 1, open_time: "08:00", close_time: "22:00" }]);
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateRow(idx: number, field: keyof HourRow, value: string | number) {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  function copyToAllDays() {
    if (rows.length === 0) return;
    const { open_time, close_time } = rows[0];
    setRows(
      Array.from({ length: 7 }, (_, weekday) => ({ weekday, open_time, close_time }))
    );
  }

  function loadFromCourt(courtId: string) {
    const court = otherCourts.find((c) => c.id === courtId);
    if (!court) return;
    setRows(
      court.hours.map((h) => ({
        weekday:    h.weekday,
        open_time:  normalizeTime(h.open_time),
        close_time: normalizeTime(h.close_time),
      }))
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="hours" value={JSON.stringify(rows)} readOnly />

      {state?.error && <p className="mb-3 text-sm text-red-600">{state.error}</p>}
      {state !== null && !state?.error && (
        <p className="mb-3 text-sm text-green-600">Horarios guardados.</p>
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
        <p className="text-sm text-gray-500 mb-3">Sin horarios configurados.</p>
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
              type="time" value={row.open_time}
              onChange={(e) => updateRow(idx, "open_time", e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
            <span className="text-gray-400 text-sm">→</span>
            <input
              type="time" value={row.close_time}
              onChange={(e) => updateRow(idx, "close_time", e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
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
          + Agregar tramo
        </button>
        {rows.length > 0 && (
          <button
            type="button" onClick={copyToAllDays}
            className="text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg px-3 py-1.5"
            title="Replica el primer tramo a los 7 días"
          >
            Copiar a todos los días
          </button>
        )}
        <button
          type="submit" disabled={pending}
          className="rounded-xl bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60 transition-colors"
        >
          {pending ? "Guardando…" : "Guardar horarios"}
        </button>
      </div>
    </form>
  );
}
