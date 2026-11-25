'use client';

import { useState, useEffect } from 'react';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

type State = 'loading' | 'unsupported' | 'denied' | 'subscribed' | 'idle';

export default function PushSubscribeButton() {
  const [state, setState] = useState<State>('loading');

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }
    // Use Permissions API (more reliable than Notification.permission in some contexts)
    const checkPermAndSub = async () => {
      try {
        const perm = await navigator.permissions.query({ name: 'notifications' as PermissionName });
        if (perm.state === 'denied') {
          setState('denied');
          return;
        }
      } catch {
        // Permissions API not available; fall through
      }
      // Check for existing subscription without blocking on serviceWorker.ready
      try {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js');
        if (reg) {
          const sub = await reg.pushManager.getSubscription();
          setState(sub ? 'subscribed' : 'idle');
        } else {
          setState('idle');
        }
      } catch {
        setState('idle');
      }
    };
    checkPermAndSub();
  }, []);

  async function subscribe() {
    if (!VAPID_PUBLIC_KEY) return;
    try {
      // Register SW if not yet registered
      let reg = await navigator.serviceWorker.getRegistration('/sw.js');
      if (!reg) {
        reg = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const json = sub.toJSON();
      await fetch('/api/push/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      setState('subscribed');
    } catch (err) {
      if ((err as { name?: string }).name === 'NotAllowedError') {
        setState('denied');
      }
    }
  }

  async function unsubscribe() {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/subscribe', {
          method:  'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState('idle');
    } catch {
      // ignore
    }
  }

  if (state === 'loading' || state === 'unsupported') return null;

  if (state === 'denied') {
    return (
      <p className="text-xs text-ink-muted leading-tight">
        Notificaciones bloqueadas en este navegador.
      </p>
    );
  }

  if (state === 'subscribed') {
    return (
      <div>
        <p className="text-xs text-brand px-3">Notificaciones activadas</p>
        <button
          onClick={unsubscribe}
          className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm text-ink-muted hover:bg-surface-2 hover:text-danger transition-colors"
        >
          Desactivar
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={subscribe}
      className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm text-brand hover:bg-surface-2 transition-colors"
    >
      Activar notificaciones
    </button>
  );
}
