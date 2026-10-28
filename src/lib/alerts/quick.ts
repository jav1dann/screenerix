/**
 * One-click price alerts from a chart: save the clicked level as a real alert (checked on the
 * server, listed in Alerts, delivered by Telegram / push), and move a saved alert by dragging its
 * line. The side it's crossed from comes from the live price.
 */
import { deleteAlert, moveAlertLevel, saveAlert, saveQuickAlert } from '@/app/actions/alerts';
import type { AlertInput, StrategySpec } from '@/lib/alerts/types';
import type { ExchangeId } from '@/lib/market/exchanges';
import { pushEnabled } from '@/lib/push/client';
import { alertsClient, removeLocal, upsertLocal } from './client';
import type { AlertView } from './client';

/**
 * Above or below the chart's last price: the side the alert waits for (rising to it, or falling to
 * it). Only a fallback — the server decides from the alert engine's own live price when it has one.
 */
export const directionFor = (level: number, last: number | null): 'above' | 'below' => (last !== null && level < last ? 'below' : 'above');

const SERVER_DOWN = 'Couldn’t reach the server. Try again.';

/** The account's working channels: browser, Telegram when linked, push when this browser is subscribed. */
async function workingChannels(): Promise<AlertInput['channels']> {
  const { channels } = alertsClient.getSnapshot();
  const push = channels.push.configured && (await pushEnabled().catch(() => false));
  return { browser: true, telegram: channels.telegram.linked, push };
}

/**
 * Save `level` (to six significant digits, like a dragged line) as a one-time price alert with the account's working channels: a browser
 * notification, Telegram when it's linked, push when this browser is subscribed. Resolves to an
 * error message, or null once saved (the line then comes from the alert list).
 */
export async function saveQuickPriceAlert(exchange: ExchangeId, symbol: string, level: number, last: number | null): Promise<string | null> {
  const input: AlertInput = {
    kind: 'price', exchange, symbol, price: { level: +level.toPrecision(6), direction: directionFor(level, last) },
    channels: await workingChannels(),
    sound: 'beep', mode: 'once', repeatMinutes: 5,
  };
  const r = await saveQuickAlert(input).catch(() => ({ ok: false as const, error: SERVER_DOWN }));
  if (!r.ok) return r.error;
  upsertLocal(r.data);
  return null;
}

/** Move a saved price alert to `level` (its line was dragged). Error message, or null once saved. */
export async function moveAlertLine(id: string, level: number, last: number | null): Promise<string | null> {
  const r = await moveAlertLevel(id, level, directionFor(level, last)).catch(() => ({ ok: false as const, error: SERVER_DOWN }));
  if (!r.ok) return r.error;
  upsertLocal(r.data);
  return null;
}

/** What a one-click strategy alert watches: a strategy on one coin (or any), timeframe and side. */
export type StrategyTarget = { exchange: ExchangeId; symbol: string } & Pick<StrategySpec, 'strategy' | 'tf' | 'dir'>;

/** The active strategy alert a one-click button created for `t` (same coin, strategy, timeframe, side; notifies on entry). */
export function findStrategyAlert(alerts: readonly AlertView[], t: StrategyTarget): AlertView | null {
  return alerts.find((a) => a.kind === 'strategy' && a.status === 'active' && a.exchange === t.exchange && a.symbol === t.symbol
    && a.strategy?.strategy === t.strategy && a.strategy.tf === t.tf && a.strategy.dir === t.dir && a.strategy.on === 'active' && a.strategy.minScore === 0) ?? null;
}

/**
 * One-click strategy alert: on → an infinite strategy alert for `t` that notifies each time such a
 * setup becomes ACTIVE (entry), through the account's working channels; off → that alert deleted.
 * Error message, or null when done.
 */
export async function toggleStrategyAlert(t: StrategyTarget): Promise<string | null> {
  const existing = findStrategyAlert(alertsClient.getSnapshot().alerts, t);
  if (existing) {
    const r = await deleteAlert(existing.id).catch(() => ({ ok: false as const, error: SERVER_DOWN }));
    if (!r.ok) return r.error;
    removeLocal(existing.id);
    return null;
  }
  const input: AlertInput = {
    kind: 'strategy', exchange: t.exchange, symbol: t.symbol,
    strategy: { strategy: t.strategy, tf: t.tf, dir: t.dir, minScore: 0, on: 'active' },
    channels: await workingChannels(), sound: 'beep', mode: 'infinite', repeatMinutes: 5,
  };
  const r = await saveAlert(input).catch(() => ({ ok: false as const, error: SERVER_DOWN }));
  if (!r.ok) return r.error;
  upsertLocal(r.data);
  return null;
}
