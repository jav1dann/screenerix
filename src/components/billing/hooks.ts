'use client';

import { useEffect, useState } from 'react';
import type { OrderView } from '@/lib/billing/orders';
import { FINAL_STATUSES } from '@/lib/billing/status';

const POLL_MS = 5_000;

/**
 * `order`, kept current: Server-Sent Events from the order's status stream, falling back to
 * polling the order every 5 s when EventSource isn't available or the stream fails for good.
 * Stops once the order is paid or failed.
 */
export function useLiveOrder(order: OrderView | null): OrderView | null {
  const [live, setLive] = useState<OrderView | null>(null);
  const id = order?.id;
  const done = order ? FINAL_STATUSES.has(order.status) : true;

  useEffect(() => {
    if (!id || done) return undefined;
    const url = `/api/payments/crypto/orders/${encodeURIComponent(id)}`;
    let stopped = false;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | undefined;
    const stop = () => { stopped = true; es?.close(); clearInterval(poll); };
    const take = (o: OrderView | undefined) => {
      if (stopped || !o || o.id !== id) return;
      setLive(o);
      if (FINAL_STATUSES.has(o.status)) stop();
    };
    const startPolling = () => {
      if (poll || stopped) return;
      poll = setInterval(() => {
        fetch(url, { cache: 'no-store' })
          .then((r) => (r.ok ? (r.json() as Promise<{ order: OrderView }>) : null))
          .then((d) => take(d?.order))
          .catch(() => { /* next tick retries */ });
      }, POLL_MS);
    };
    if (typeof EventSource === 'undefined') startPolling();
    else {
      es = new EventSource(`${url}/events`);
      es.addEventListener('status', (e) => take((JSON.parse((e as MessageEvent<string>).data) as { order: OrderView }).order));
      // CLOSED: the browser gave up (401 / 404 / not an event stream) — poll instead.
      es.onerror = () => { if (es?.readyState === EventSource.CLOSED) startPolling(); };
    }
    return stop;
  }, [id, done]);

  return live && live.id === id ? live : order;
}

/** The QR code of `text` as an SVG string (null while it renders). */
export function useQrSvg(text: string): string | null {
  const [qr, setQr] = useState<{ text: string; svg: string } | null>(null);
  useEffect(() => {
    let on = true;
    import('qrcode')
      .then((QR) => QR.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0B0C0E', light: '#FFFFFF' } }))
      .then((svg) => { if (on) setQr({ text, svg }); })
      .catch(() => { /* the address and copy button still work */ });
    return () => { on = false; };
  }, [text]);
  return qr?.text === text ? qr.svg : null;
}

/** Copies `text`; `copied` is true for a moment afterwards. */
export function useCopy(): { copied: string | null; copy: (key: string, text: string) => void } {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(null), 1_600);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = (key: string, text: string) => {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } finally { ta.remove(); }
    };
    (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard'))).catch(fallback).finally(() => setCopied(key));
  };
  return { copied, copy };
}
