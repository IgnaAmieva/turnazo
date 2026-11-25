'use client';

/**
 * Lo que el sitio recuerda del jugador EN ESTE DISPOSITIVO (localStorage):
 * nombre, celular, última localidad y último deporte. Nada más: ni email, ni
 * forma de pago, ni datos de reservas. "No soy yo" lo borra todo.
 */

import { useMemo, useSyncExternalStore } from 'react';

export const PLAYER_KEY = 'turnazo-jugador';
const CHANGE_EVENT = 'turnazo-jugador';

type Place = { slug: string; nombre: string };
export type PlayerMemory = {
  nombre?: string;
  celular?: string;
  localidad?: Place;
  deporte?: Place;
};

const text = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim() !== '' && v.length <= max ? v.trim() : undefined;

const place = (v: unknown): Place | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const p = v as Record<string, unknown>;
  const slug = text(p.slug, 60);
  const nombre = text(p.nombre, 80);
  return slug && /^[a-z0-9-]+$/.test(slug) && nombre ? { slug, nombre } : undefined;
};

/** Se queda solo con los 4 campos permitidos y valores razonables. */
export function sanitizePlayerMemory(v: unknown): PlayerMemory {
  if (!v || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  const out: PlayerMemory = {
    nombre:    text(o.nombre, 80),
    celular:   text(o.celular, 30),
    localidad: place(o.localidad),
    deporte:   place(o.deporte),
  };
  for (const k of Object.keys(out) as (keyof PlayerMemory)[]) if (out[k] === undefined) delete out[k];
  return out;
}

export function parsePlayerMemory(raw: string | null): PlayerMemory {
  if (!raw) return {};
  try { return sanitizePlayerMemory(JSON.parse(raw)); } catch { return {}; }
}

function readRaw(): string | null {
  try { return localStorage.getItem(PLAYER_KEY); } catch { return null; }
}

function notify() { window.dispatchEvent(new Event(CHANGE_EVENT)); }

/** Mezcla con lo guardado (solo los campos permitidos). */
export function rememberPlayer(patch: PlayerMemory) {
  const next = sanitizePlayerMemory({ ...parsePlayerMemory(readRaw()), ...patch });
  try {
    if (Object.keys(next).length === 0) localStorage.removeItem(PLAYER_KEY);
    else localStorage.setItem(PLAYER_KEY, JSON.stringify(next));
  } catch { /* sin almacenamiento: no se recuerda nada */ }
  notify();
}

/** "No soy yo": borra todo lo recordado. */
export function forgetPlayer() {
  try { localStorage.removeItem(PLAYER_KEY); } catch { /* nada que borrar */ }
  notify();
}

function subscribe(cb: () => void) {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => { window.removeEventListener(CHANGE_EVENT, cb); window.removeEventListener('storage', cb); };
}

/** null en el servidor y en el primer render; después, lo guardado. */
export function usePlayerMemory(): PlayerMemory | null {
  const raw = useSyncExternalStore<string | null | undefined>(subscribe, readRaw, () => undefined);
  return useMemo(() => (raw === undefined ? null : parsePlayerMemory(raw)), [raw]);
}
