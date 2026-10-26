/**
 * The terminal's view of the account's alerts: loaded once, then kept current by
 * `/api/alerts/stream` (created / edited / archived / fired, from any tab or device).
 * Firings are announced to `onAlertFired` listeners (toast, sound, notification).
 * Started by `AlertsHost`; ref-counted so several mounts share one stream.
 */
import { getAlertsState, importLocalAlerts } from '@/app/actions/alerts';
import type { AlertsState } from '@/app/actions/alerts';
import type { Alert, AlertEvent } from './types';

export type AlertView = Omit<Alert, 'userId'>;
export type EventView = Omit<AlertEvent, 'userId'>;

export interface AlertsSnapshot {
  loaded: boolean;
  alerts: readonly AlertView[];
  events: readonly EventView[];
  channels: AlertsState['channels'];
  /** Firings seen since the dashboard was last opened (header badge). */
  unread: number;
}

const EMPTY: AlertsSnapshot = {
  loaded: false, alerts: [], events: [], unread: 0,
  channels: { telegram: { configured: false, linked: false }, push: { configured: false, key: null } },
};
/** Alerts saved in this browser before they moved to the account. */
const LEGACY_KEY = 'screenerix.alerts.v1';

let snap = EMPTY;
const listeners = new Set<() => void>();
const fireListeners = new Set<(e: EventView) => void>();
const set = (next: Partial<AlertsSnapshot>) => { snap = { ...snap, ...next }; listeners.forEach((l) => l()); };

export const alertsClient = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  getSnapshot: () => snap,
  getServerSnapshot: () => EMPTY,
};

/** Called for every firing that arrives while the terminal is open. */
export function onAlertFired(l: (e: EventView) => void): () => void {
  fireListeners.add(l);
  return () => { fireListeners.delete(l); };
}

/** Re-read everything from the server (after a save, or when a channel was connected). */
export async function refreshAlerts(): Promise<void> {
  const r = await getAlertsState().catch(() => null);
  if (r?.ok) set({ loaded: true, alerts: r.data.alerts, events: r.data.events, channels: r.data.channels });
}

/** Apply an alert returned by an action right away (the stream will confirm it). */
export function upsertLocal(a: AlertView): void {
  const i = snap.alerts.findIndex((x) => x.id === a.id);
  set({ alerts: i < 0 ? [a, ...snap.alerts] : snap.alerts.map((x) => (x.id === a.id ? a : x)) });
}
export function removeLocal(id: string): void {
  set({ alerts: snap.alerts.filter((x) => x.id !== id) });
}
export function markRead(): void {
  if (snap.unread) set({ unread: 0 });
}

async function importLegacy(): Promise<void> {
  let raw: string | null = null;
  try { raw = localStorage.getItem(LEGACY_KEY); } catch { return; }
  if (!raw) return;
  let list: unknown;
  try { list = JSON.parse(raw); } catch { list = null; }
  const r = Array.isArray(list) && list.length ? await importLocalAlerts(list).catch(() => null) : { ok: true as const, data: 0 };
  if (r?.ok) {
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
    if (r.data) await refreshAlerts();
  }
}

let refs = 0;
let es: EventSource | null = null;

function connect(): void {
  if (typeof EventSource === 'undefined') return;
  es = new EventSource('/api/alerts/stream');
  es.addEventListener('alert', (m) => {
    const { alert } = JSON.parse((m as MessageEvent<string>).data) as { alert: AlertView };
    upsertLocal(alert);
  });
  es.addEventListener('removed', (m) => removeLocal((JSON.parse((m as MessageEvent<string>).data) as { id: string }).id));
  es.addEventListener('fired', (m) => {
    const { event } = JSON.parse((m as MessageEvent<string>).data) as { event: EventView };
    set({ events: [event, ...snap.events.filter((e) => e.id !== event.id)].slice(0, 50), unread: snap.unread + 1 });
    fireListeners.forEach((l) => l(event));
  });
  // After a dropped connection the browser reconnects by itself; re-sync what we may have missed.
  es.addEventListener('open', () => { if (snap.loaded) void refreshAlerts(); });
}

/** Start loading + streaming (ref-counted); returns a stop function. */
export function startAlertsClient(): () => void {
  refs++;
  if (refs === 1) {
    void refreshAlerts().then(importLegacy);
    connect();
  }
  return () => {
    refs--;
    if (refs === 0) { es?.close(); es = null; }
  };
}
