/** Browser-side client for the `/api/market/*` proxy routes. */
import { sessionExpired } from '@/lib/auth/expired';
import type { ExchangeId, FeedEvent, InstrumentMeta, OiPoint, RawCandle, SubMinute, Timeframe } from './exchanges';

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (res.status === 401) sessionExpired();
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string; retryAt?: number };
  // The status rides along so callers can tell rate limits (429 / 418) from other failures, and
  // `code` a venue that refuses our server's region ('VENUE_RESTRICTED', with the next check).
  if (!res.ok) throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { status: res.status, code: body.code, retryAt: body.retryAt });
  return body;
}

/** A request refused because the exchange doesn't serve our server's region: when the server checks again. null: another failure. */
export function restrictionOf(e: unknown): { retryAt?: number } | null {
  const err = e as { code?: unknown; retryAt?: unknown } | null;
  return err?.code === 'VENUE_RESTRICTED' ? { retryAt: typeof err.retryAt === 'number' ? err.retryAt : undefined } : null;
}

export type Instruments = Record<string, InstrumentMeta>;

const instrumentCache = new Map<ExchangeId, Promise<Instruments>>();

/** Venue instrument map, fetched once per page session (failed requests are retried on next call). */
export function fetchInstruments(id: ExchangeId): Promise<Instruments> {
  let hit = instrumentCache.get(id);
  if (!hit) {
    hit = fetchJson<{ instruments: Instruments }>(`/api/market/${id}/instruments`).then((r) => r.instruments);
    hit.catch(() => instrumentCache.delete(id));
    instrumentCache.set(id, hit);
  }
  return hit;
}

/** Resolve any base symbol on a venue (universe hits are served from the cached map); null if unlisted. */
export async function fetchInstrument(id: ExchangeId, symbol: string): Promise<InstrumentMeta | null> {
  const universe = await fetchInstruments(id).catch(() => null);
  if (universe?.[symbol]) return universe[symbol];
  const r = await fetchJson<{ instrument: InstrumentMeta | null }>(`/api/market/${id}/instruments?symbol=${encodeURIComponent(symbol)}`);
  return r.instrument;
}

/** Oldest-first candles in base-unit prices; volume in base units. */
export const fetchKlines = (id: ExchangeId, symbol: string, tf: Timeframe, limit: number, end?: number): Promise<RawCandle[]> =>
  fetchJson<{ candles: RawCandle[] }>(`/api/market/${id}/klines?symbol=${encodeURIComponent(symbol)}&tf=${tf}&limit=${limit}${end === undefined ? '' : `&end=${end}`}`).then((r) => r.candles);

/**
 * Recent 1s / 30s candles (base units); trades after `asOf` are not in them yet. `cursor` (from a
 * previous page) loads the page before it; a null `cursor` in the answer: no older history.
 */
export const fetchSubMinute = (id: ExchangeId, symbol: string, tf: SubMinute, cursor?: string): Promise<{ candles: RawCandle[]; asOf: number; cursor: string | null }> =>
  fetchJson<{ candles: RawCandle[]; asOf: number; cursor?: string | null }>(`/api/market/${id}/klines?symbol=${encodeURIComponent(symbol)}&tf=${tf}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    .then((r) => ({ candles: r.candles, asOf: r.asOf, cursor: r.cursor ?? null }));

/** Open-interest history for a chart timeframe (period is chosen server-side; null = no history). */
export const fetchOiHistory = (id: ExchangeId, symbol: string, tf: string, limit = 200): Promise<{ period: Timeframe | null; points: OiPoint[] }> =>
  fetchJson<{ period: Timeframe | null; points: OiPoint[] }>(`/api/market/${id}/oi?symbol=${encodeURIComponent(symbol)}&tf=${tf}&limit=${limit}`);

/** Current open interest in base units (venues without a live OI stream). */
export const fetchOiCurrent = (id: ExchangeId, symbol: string): Promise<number | null> =>
  fetchJson<{ oi: number | null }>(`/api/market/${id}/oi?symbol=${encodeURIComponent(symbol)}&current=1`).then((r) => r.oi);

/** Whole-market 24h ticker snapshot for a venue (venue units; scale with the instrument meta). */
export const fetchTickers = (id: ExchangeId): Promise<FeedEvent[]> =>
  fetchJson<{ tickers: FeedEvent[] }>(`/api/market/${id}/tickers`).then((r) => r.tickers);
