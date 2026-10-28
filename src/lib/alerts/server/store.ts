/**
 * Alerts and their firings in `.data/alerts.json` / `.data/alert-events.json` (same atomic-write
 * and mtime-cache pattern as users and orders). Changes are announced per user on an in-process
 * emitter, which feeds each open terminal's event stream. Server-only.
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '@/lib/auth/session';
import type { Alert, AlertDelivery, AlertDetail, AlertEvent, AlertInput } from '../types';

/** Firings kept per user (the "Recent triggers" list). */
export const MAX_EVENTS_PER_USER = 500;

export type AlertChange = { type: 'alert'; alert: Alert } | { type: 'removed'; id: string } | { type: 'event'; event: AlertEvent } | { type: 'delivered'; event: AlertEvent };

function fileStore<T>(name: string, key: string) {
  const file = () => join(DATA_DIR, name);
  let cache: { mtimeMs: number; items: T[] } | null = null;
  return {
    load(): T[] {
      const f = file();
      if (!existsSync(f)) return [];
      const { mtimeMs } = statSync(f);
      if (cache && cache.mtimeMs === mtimeMs) return cache.items;
      try {
        const raw = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
        const items = Array.isArray(raw[key]) ? (raw[key] as T[]) : [];
        cache = { mtimeMs, items };
        return items;
      } catch (e) {
        console.error(`[alerts] ${name} is unreadable`, e);
        return [];
      }
    },
    save(items: T[]): void {
      mkdirSync(DATA_DIR, { recursive: true });
      const f = file();
      const tmp = `${f}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ [key]: items }), { mode: 0o600 });
      renameSync(tmp, f);
      cache = { mtimeMs: statSync(f).mtimeMs, items };
    },
  };
}

const alerts = fileStore<Alert>('alerts.json', 'alerts');
const events = fileStore<AlertEvent>('alert-events.json', 'events');

const g = globalThis as typeof globalThis & { __sxAlertBus?: EventEmitter };
const bus = (g.__sxAlertBus ??= new EventEmitter().setMaxListeners(0));
const emit = (userId: string, change: AlertChange) => bus.emit(userId, change);

/** Subscribe to one user's alert changes and firings; returns an unsubscribe. */
export function onUserAlerts(userId: string, listener: (c: AlertChange) => void): () => void {
  bus.on(userId, listener);
  return () => { bus.off(userId, listener); };
}

export const allAlerts = (): readonly Alert[] => alerts.load();
export const alertsOf = (userId: string): Alert[] => alerts.load().filter((a) => a.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
export const findAlert = (id: string): Alert | null => alerts.load().find((a) => a.id === id) ?? null;
export const activeCount = (userId: string): number => alerts.load().filter((a) => a.userId === userId && a.status === 'active').length;

/** Create, or replace the settings of, one of `userId`'s alerts (saving re-arms it). */
export function saveAlert(userId: string, input: AlertInput, now = Date.now()): Alert {
  const list = alerts.load();
  const existing = input.id ? list.find((a) => a.id === input.id && a.userId === userId) : undefined;
  const alert: Alert = {
    id: existing?.id ?? randomUUID(),
    userId,
    kind: input.kind,
    exchange: input.exchange,
    symbol: input.symbol,
    ...(input.kind === 'price' && input.price ? { price: input.price } : {}),
    ...(input.kind === 'complex' && input.conditions ? { conditions: input.conditions } : {}),
    ...(input.kind === 'strategy' && input.strategy ? { strategy: input.strategy } : {}),
    channels: input.channels,
    sound: input.sound,
    mode: input.mode,
    repeatMinutes: input.repeatMinutes,
    ...(input.note ? { note: input.note } : {}),
    status: 'active',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastTriggeredAt: null,
    triggerCount: existing?.triggerCount ?? 0,
  };
  alerts.save(existing ? list.map((a) => (a.id === alert.id ? alert : a)) : [...list, alert]);
  emit(userId, { type: 'alert', alert });
  return alert;
}

/** Patch one of `userId`'s alerts; null when it doesn't exist or isn't theirs. */
export function patchAlert(userId: string, id: string, patch: Partial<Pick<Alert, 'status' | 'archivedReason' | 'lastTriggeredAt' | 'triggerCount' | 'updatedAt'>>): Alert | null {
  const list = alerts.load();
  const i = list.findIndex((a) => a.id === id && a.userId === userId);
  if (i < 0) return null;
  const next: Alert = { ...list[i], ...patch };
  if (next.status === 'active') delete next.archivedReason;
  alerts.save(list.map((a, k) => (k === i ? next : a)));
  emit(userId, { type: 'alert', alert: next });
  return next;
}

/**
 * Move a price alert's level (dragging its chart line): the new level and the side it is crossed
 * from, re-armed (a one-time alert that already fired is watching again).
 */
export function setAlertLevel(userId: string, id: string, level: number, direction: 'above' | 'below', now = Date.now()): Alert | null {
  const list = alerts.load();
  const i = list.findIndex((a) => a.id === id && a.userId === userId && a.kind === 'price');
  if (i < 0) return null;
  const next: Alert = { ...list[i], price: { level, direction }, status: 'active', lastTriggeredAt: null, updatedAt: now };
  delete next.archivedReason;
  alerts.save(list.map((a, k) => (k === i ? next : a)));
  emit(userId, { type: 'alert', alert: next });
  return next;
}

export function removeAlert(userId: string, id: string): boolean {
  const list = alerts.load();
  if (!list.some((a) => a.id === id && a.userId === userId)) return false;
  alerts.save(list.filter((a) => a.id !== id));
  emit(userId, { type: 'removed', id });
  return true;
}

/**
 * Record a firing: the alert's trigger count / time (one-time alerts are archived) and the
 * event (`symbol`: the coin it fired for — a strategy alert on any coin names the setup's).
 * Synchronous from read to write, so one alert never fires twice for one price pass.
 */
export function recordFire(alert: Alert, price: number, text: string, now = Date.now(), detail?: AlertDetail, symbol = alert.symbol): { alert: Alert; event: AlertEvent } | null {
  const updated = patchAlert(alert.userId, alert.id, {
    lastTriggeredAt: now, triggerCount: alert.triggerCount + 1, updatedAt: now,
    ...(alert.mode === 'once' ? { status: 'archived' as const, archivedReason: 'fired' as const } : {}),
  });
  if (!updated) return null;
  const event: AlertEvent = {
    id: randomUUID(), alertId: alert.id, userId: alert.userId, at: now, kind: alert.kind, exchange: alert.exchange,
    symbol, price, text, sound: alert.sound, channels: alert.channels, ...(detail ? { detail } : {}),
  };
  const all = events.load();
  const mine = all.filter((e) => e.userId === alert.userId);
  const drop = new Set(mine.length >= MAX_EVENTS_PER_USER ? mine.sort((a, b) => a.at - b.at).slice(0, mine.length - MAX_EVENTS_PER_USER + 1).map((e) => e.id) : []);
  events.save([...all.filter((e) => !drop.has(e.id)), event]);
  emit(alert.userId, { type: 'event', event });
  return { alert: updated, event };
}

export const eventsOf = (userId: string, limit = 50): AlertEvent[] =>
  events.load().filter((e) => e.userId === userId).sort((a, b) => b.at - a.at).slice(0, limit);

/** Store where a firing was delivered (after `deliver`), and tell open terminals. */
export function recordDelivery(event: AlertEvent, delivery: AlertDelivery): void {
  const all = events.load();
  const i = all.findIndex((e) => e.id === event.id);
  if (i < 0) return; // trimmed meanwhile
  const next = { ...all[i], delivery };
  events.save(all.map((e, k) => (k === i ? next : e)));
  emit(event.userId, { type: 'delivered', event: next });
}
