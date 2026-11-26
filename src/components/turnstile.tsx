'use client';

/**
 * Captcha Cloudflare Turnstile en modo Managed (S2). Va adentro del <form>:
 * el widget agrega el input oculto `cf-turnstile-response`, que el servidor
 * SIEMPRE verifica (lib/turnstile.ts). Con appearance "interaction-only", si
 * Cloudflare no duda el jugador no ve nada; si duda, aparece la casilla.
 *
 * - Si se toca Confirmar antes de que llegue el token, se espera y se envía
 *   solo apenas llega (el botón dice "Verificando…").
 * - El token sirve una vez: después de cada respuesta del servidor se pide otro.
 * - Si el script no carga o el widget falla, se muestra un aviso con
 *   "Reintentar": nunca queda trabado.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window { turnstile?: TurnstileApi }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** Si después de tocar Confirmar el token no llega en este tiempo, se avisa. */
const WAIT_MS = 15_000;

let loading: Promise<TurnstileApi> | null = null;

/** Carga el script una vez; si falla, el próximo intento lo vuelve a pedir. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.dataset.turnstile = '';
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
    s.onerror = () => { s.remove(); reject(new Error('turnstile')); };
    document.head.appendChild(s);
  }).catch((e) => { loading = null; throw e; });
  return loading;
}

export type CaptchaStatus = 'loading' | 'ready' | 'error';

/**
 * resetKey: cuando cambia (la respuesta del servidor), se pide un token nuevo.
 * action: etiqueta que se ve en el panel de Cloudflare (reserva, login, registro).
 */
export function useTurnstile(formRef: RefObject<HTMLFormElement | null>, resetKey: unknown, action: string) {
  const boxRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // El token vive en un ref: el envío automático (requestSubmit) lo lee en el mismo instante
  const tokenRef = useRef<string | null>(null);
  const waitingRef = useRef(false);
  const waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<CaptchaStatus>(SITE_KEY ? 'loading' : 'error');
  const [waiting, setWaiting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const stopWaiting = useCallback(() => {
    waitingRef.current = false;
    if (waitTimer.current) clearTimeout(waitTimer.current);
    waitTimer.current = null;
    setWaiting(false);
  }, []);

  // Render (y re-render en "Reintentar"). Todo cambio de estado llega por los callbacks del widget.
  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;
    const fail = () => {
      tokenRef.current = null;
      setStatus('error');
      if (waitingRef.current) stopWaiting();
    };
    loadTurnstile().then((ts) => {
      const el = boxRef.current;
      if (cancelled || !el) return;
      widgetId.current = ts.render(el, {
        sitekey: SITE_KEY,
        action,
        appearance: 'interaction-only',
        size: 'flexible',
        theme: 'auto',
        language: 'es',
        callback: (t: string) => {
          tokenRef.current = t;
          setStatus('ready');
          // Llegó mientras se esperaba: enviar
          if (waitingRef.current) {
            stopWaiting();
            queueMicrotask(() => formRef.current?.requestSubmit());
          }
        },
        'expired-callback': () => { tokenRef.current = null; setStatus('loading'); },
        'timeout-callback': () => { tokenRef.current = null; setStatus('loading'); },
        'error-callback': () => { fail(); return true; },
      });
    }).catch(() => { if (!cancelled) fail(); });
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [action, attempt, formRef, stopWaiting]);

  // Token de un solo uso: después de cada respuesta del servidor, uno nuevo
  const firstKey = useRef(resetKey);
  useEffect(() => {
    if (resetKey === firstKey.current || !widgetId.current) return;
    tokenRef.current = null;
    window.turnstile?.reset(widgetId.current);
  }, [resetKey]);

  const retry = useCallback(() => {
    tokenRef.current = null;
    setStatus(SITE_KEY ? 'loading' : 'error');
    setAttempt((a) => a + 1);
  }, []);

  /** En el onSubmit del form: true si puede seguir; si no, espera el token y envía solo. */
  const guardSubmit = useCallback((e: FormEvent<HTMLFormElement>) => {
    if (tokenRef.current) return true;
    e.preventDefault();
    if (waitingRef.current) return false;
    if (status === 'error') retry();
    waitingRef.current = true;
    setWaiting(true);
    // Esperando de más: avisar (con "Reintentar"), nunca queda trabado
    waitTimer.current = setTimeout(() => { stopWaiting(); setStatus('error'); }, WAIT_MS);
    return false;
  }, [status, retry, stopWaiting]);

  return { boxRef, status, waiting, retry, guardSubmit };
}

/** Lugar del widget (data-captcha-slot) y aviso si falló. */
export function TurnstileSlot({ boxRef, status, retry }: Pick<ReturnType<typeof useTurnstile>, 'boxRef' | 'status' | 'retry'>) {
  return (
    <div data-captcha-slot="" data-captcha-status={status}>
      <div ref={boxRef} className="flex justify-center empty:hidden" />
      {status === 'error' && (
        <div role="alert" data-testid="captcha-error"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm text-ink">
          <span>No pudimos cargar la verificación anti-robots. Revisá tu conexión.</span>
          <button type="button" onClick={retry} data-testid="captcha-reintentar"
            className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm font-extrabold text-ink hover:bg-surface-2">
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}
