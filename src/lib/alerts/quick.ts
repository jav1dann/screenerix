/**
 * One-click price alerts from a chart: save the clicked level as a real alert (checked on the
 * server, listed in Alerts, delivered by Telegram / push), and move a saved alert by dragging its
 * line. The side it's crossed from comes from the live price.
 */
import { moveAlertLevel, saveQuickAlert } from '@/app/actions/alerts';
import type { AlertInput } from '@/lib/alerts/types';
import type { ExchangeId } from '@/lib/market/exchanges';
import { pushEnabled } from '@/lib/push/client';
import { alertsClient, upsertLocal } from './client';

/**
 * Above or below the chart's last price: the side the alert waits for (rising to it, or falling to
 * it). Only a fallback — the server decides from the alert engine's own live price when it has one.
 */
export const directionFor = (level: number, last: number | null): 'above' | 'below' => (last !== null && level < last ? 'below' : 'above');

const SERVER_DOWN = 'Couldn’t reach the server. Try again.';

/**
 * Save `level` as a one-time price alert with the account's working channels: a browser
 * notification, Telegram when it's linked, push when this browser is subscribed. Resolves to an
 * error message, or null once saved (the line then comes from the alert list).
 */
export async function saveQuickPriceAlert(exchange: ExchangeId, symbol: string, level: number, last: number | null): Promise<string | null> {
  const { channels } = alertsClient.getSnapshot();
  const push = channels.push.configured && (await pushEnabled().catch(() => false));
  const input: AlertInput = {
    kind: 'price', exchange, symbol, price: { level, direction: directionFor(level, last) },
    channels: { browser: true, telegram: channels.telegram.linked, push },
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
