'use server';

/**
 * Alerts API for the terminal: list, create / edit, pause / resume (archive / restore), delete, recent firings,
 * a one-time import of alerts kept in the browser before alerts moved to the server, and web
 * push subscriptions. Everything is scoped to the signed-in account; an expired account can
 * still read and delete but not create alerts.
 */
import { headers } from 'next/headers';
import { hasAccess } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { activeCount, alertsOf, eventsOf, patchAlert, removeAlert, saveAlert as storeAlert, setAlertLevel } from '@/lib/alerts/server/store';
import { ANY_COIN, MAX_ACTIVE_ALERTS, validateAlertInput } from '@/lib/alerts/types';
import type { Alert, AlertEvent } from '@/lib/alerts/types';
import { requireInstrument } from '@/lib/market/server/marketData';
import { addSubscription, pushPublicKey, removeSubscription } from '@/lib/push/server';
import { metricsKey, scanStore } from '@/lib/server/scan/store';
import type { MetricsEntryData } from '@/lib/server/scan/marketWorker';
import type { ExchangeId } from '@/lib/market/exchanges';
import { telegramConfigured } from '@/lib/telegram/bot';
import type { Lang } from '@/lib/telegram/i18n';
import { findById } from '@/lib/auth/users';

export type AlertsResult<T> = { ok: true; data: T } | { ok: false; error: string };

const SIGNED_OUT = { ok: false, error: 'Your session has ended. Sign in again.' } as const;

/** Alerts without the owner id (the browser doesn't need it). */
type AlertView = Omit<Alert, 'userId'>;
const view = ({ userId: _u, ...a }: Alert): AlertView => { void _u; return a; };
const viewEvent = ({ userId: _u, ...e }: AlertEvent) => { void _u; return e; };

export interface AlertsState {
  alerts: AlertView[];
  events: Array<Omit<AlertEvent, 'userId'>>;
  channels: {
    telegram: { configured: boolean; linked: boolean; username: string | null; name: string | null; lang: Lang | null };
    push: { configured: boolean; key: string | null };
  };
}

export async function getAlertsState(): Promise<AlertsResult<AlertsState>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const rec = findById(user.id);
  return {
    ok: true,
    data: {
      alerts: alertsOf(user.id).map(view),
      events: eventsOf(user.id, 50).map(viewEvent),
      channels: {
        telegram: { configured: telegramConfigured(), linked: Boolean(rec?.telegram), username: rec?.telegram?.username ?? null, name: rec?.telegram?.firstName ?? null, lang: rec?.lang ?? null },
        push: { configured: pushPublicKey() !== null, key: pushPublicKey() },
      },
    },
  };
}

/** How fresh the scan engine's price must be to decide an alert's side. */
const LIVE_PRICE_MAX_AGE_MS = 60_000;

/** The price the alert worker checks this coin against (the scan engine's latest), or null when unknown / stale. */
function enginePrice(venue: ExchangeId, symbol: string): number | null {
  const entry = scanStore().get<MetricsEntryData>(metricsKey(venue));
  if (!entry || Date.now() - entry.updatedAt > LIVE_PRICE_MAX_AGE_MS) return null;
  const p = entry.data.rows.find((r) => r.s === symbol)?.p;
  return p !== undefined && p > 0 ? p : null;
}

/**
 * The side a price alert is crossed from: from the engine's own price when it has one (so the
 * alert can't start out already "crossed" because the browser's price lagged), else the hint.
 */
const sideOf = (venue: ExchangeId, symbol: string, level: number, hint: 'above' | 'below'): 'above' | 'below' => {
  const live = enginePrice(venue, symbol);
  return live === null ? hint : level < live ? 'below' : 'above';
};

export async function saveAlert(raw: unknown): Promise<AlertsResult<AlertView>> {
  return save(raw, false);
}

/**
 * A one-click alert from a chart: like saveAlert, but a price alert's side (rises to / falls to)
 * is decided here from the engine's live price (the browser's `direction` is only the fallback).
 */
export async function saveQuickAlert(raw: unknown): Promise<AlertsResult<AlertView>> {
  return save(raw, true);
}

async function save(raw: unknown, quick: boolean): Promise<AlertsResult<AlertView>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  if (!hasAccess(user, Date.now())) return { ok: false, error: 'Your plan has ended. Upgrade to Pro to create alerts.' };
  const v = validateAlertInput(raw);
  if (!v.ok) return v;
  const input = v.input;
  if (quick && input.kind === 'price' && input.price) input.price = { ...input.price, direction: sideOf(input.exchange, input.symbol, input.price.level, input.price.direction) };
  const editing = input.id ? alertsOf(user.id).find((a) => a.id === input.id) : undefined;
  if (input.id && !editing) return { ok: false, error: 'That alert no longer exists.' };
  if (!editing || editing.status !== 'active') {
    if (activeCount(user.id) >= MAX_ACTIVE_ALERTS) return { ok: false, error: `You have ${MAX_ACTIVE_ALERTS} active alerts — pause or delete some first.` };
  }
  try {
    if (input.symbol !== ANY_COIN) await requireInstrument(input.exchange, input.symbol);
  } catch {
    return { ok: false, error: `${input.symbol} isn’t listed on this exchange.` };
  }
  if (input.channels.telegram && !findById(user.id)?.telegram) input.channels = { ...input.channels, telegram: false };
  return { ok: true, data: view(storeAlert(user.id, input)) };
}

/** Pause: stop checking it (shown as Paused; status 'archived', reason 'manual'). */
export async function archiveAlert(id: string): Promise<AlertsResult<AlertView>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  const a = patchAlert(user.id, String(id), { status: 'archived', archivedReason: 'manual', updatedAt: Date.now() });
  return a ? { ok: true, data: view(a) } : { ok: false, error: 'That alert no longer exists.' };
}

/** Resume a paused alert, or re-arm one that fired. */
export async function restoreAlert(id: string): Promise<AlertsResult<AlertView>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  if (!hasAccess(user, Date.now())) return { ok: false, error: 'Your plan has ended. Upgrade to Pro to resume alerts.' };
  if (activeCount(user.id) >= MAX_ACTIVE_ALERTS) return { ok: false, error: `You have ${MAX_ACTIVE_ALERTS} active alerts — pause or delete some first.` };
  const a = patchAlert(user.id, String(id), { status: 'active', lastTriggeredAt: null, updatedAt: Date.now() });
  return a ? { ok: true, data: view(a) } : { ok: false, error: 'That alert no longer exists.' };
}

/** Move a price alert to `level` (its chart line was dragged); its side comes from the engine's live price (`direction`: fallback). */
export async function moveAlertLevel(id: string, level: number, direction: 'above' | 'below'): Promise<AlertsResult<AlertView>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  if (!hasAccess(user, Date.now())) return { ok: false, error: 'Your plan has ended. Upgrade to Pro to change alerts.' };
  if (typeof level !== 'number' || !Number.isFinite(level) || level <= 0 || level > 1e12) return { ok: false, error: 'Invalid price.' };
  if (direction !== 'above' && direction !== 'below') return { ok: false, error: 'Invalid direction.' };
  const current = alertsOf(user.id).find((a) => a.id === String(id));
  if (!current || current.kind !== 'price') return { ok: false, error: 'That alert no longer exists.' };
  if (current.status !== 'active' && activeCount(user.id) >= MAX_ACTIVE_ALERTS) return { ok: false, error: `You have ${MAX_ACTIVE_ALERTS} active alerts — pause or delete some first.` };
  const a = setAlertLevel(user.id, current.id, level, sideOf(current.exchange, current.symbol, level, direction));
  return a ? { ok: true, data: view(a) } : { ok: false, error: 'That alert no longer exists.' };
}

export async function deleteAlert(id: string): Promise<AlertsResult<true>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  return removeAlert(user.id, String(id)) ? { ok: true, data: true } : { ok: false, error: 'That alert no longer exists.' };
}

/**
 * One-time move of alerts saved in this browser (before alerts were server-side) into the
 * account. Invalid or unlisted ones are skipped; returns how many were imported.
 */
export async function importLocalAlerts(list: unknown): Promise<AlertsResult<number>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  if (!Array.isArray(list)) return { ok: true, data: 0 };
  let n = 0;
  for (const raw of list.slice(0, 50)) {
    const old = raw as { exchange?: unknown; symbol?: unknown; price?: unknown; direction?: unknown; mode?: unknown; repeatMinutes?: unknown; active?: unknown; notify?: { browser?: unknown } };
    if (old?.active === false) continue;
    const v = validateAlertInput({
      kind: 'price', exchange: old?.exchange, symbol: old?.symbol, price: { level: old?.price, direction: old?.direction },
      channels: { browser: old?.notify?.browser !== false, telegram: false, push: false }, sound: 'beep',
      mode: old?.mode, repeatMinutes: old?.repeatMinutes ?? 5,
    });
    if (!v.ok || activeCount(user.id) >= MAX_ACTIVE_ALERTS) continue;
    try { await requireInstrument(v.input.exchange, v.input.symbol); } catch { continue; }
    storeAlert(user.id, v.input);
    n++;
  }
  return { ok: true, data: n };
}

export async function subscribePush(sub: unknown): Promise<AlertsResult<true>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  if (!pushPublicKey()) return { ok: false, error: 'Push notifications aren’t configured on this server.' };
  const ua = (await headers()).get('user-agent') ?? undefined;
  return addSubscription(user.id, sub, ua) ? { ok: true, data: true } : { ok: false, error: 'This browser’s push subscription wasn’t accepted.' };
}

export async function unsubscribePush(endpoint: string): Promise<AlertsResult<true>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  removeSubscription(user.id, String(endpoint));
  return { ok: true, data: true };
}
