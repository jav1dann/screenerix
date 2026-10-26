/**
 * Server-side sources for the Densities screener: the coin universe and deep
 * order-book snapshots of every venue × market.
 *
 * Futures (and Coinbase spot) reuse the exchange adapters' instruments and
 * ticker snapshots; spot on the other venues has its own small REST mapping
 * (USDT pairs only). Books are trimmed to ±MAX_RANGE around the mid and
 * returned as [price, base quantity], best first.
 */
import { ADAPTERS } from '@/lib/market/exchanges';
import type { ExchangeId, InstrumentMeta } from '@/lib/market/exchanges';
import { isObj, num } from '@/lib/market/exchanges/shared';
import type { DensityMarket, DepthBook, DepthLevel, UniverseRow } from '@/lib/densities/types';
import { getTickers, loadInstruments, lookupInstrument, UpstreamError, upstreamJson } from './marketData';

/** Book levels further than this from the mid are dropped (fraction). */
const MAX_RANGE = 0.12;
/** Levels kept per side after trimming. */
const MAX_LEVELS = 1_500;
const UNIVERSE_TTL_MS = 20_000;

type Rows = unknown;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const field = (o: unknown, k: string): unknown => (isObj(o) ? o[k] : undefined);

/** `[price, qty]` rows (arrays or `{p, s}` objects) → numbers, scaled. */
function rowsOf(rows: Rows, priceScale = 1, sizeScale = 1): DepthLevel[] {
  const out: DepthLevel[] = [];
  for (const r of list(rows)) {
    const p = num(Array.isArray(r) ? r[0] : field(r, 'p'));
    const s = num(Array.isArray(r) ? r[1] : field(r, 's'));
    if (p !== undefined && s !== undefined && p > 0 && s > 0) out.push([p * priceScale, s * sizeScale]);
  }
  return out;
}

function trim(bids: DepthLevel[], asks: DepthLevel[]): DepthBook {
  bids.sort((a, b) => b[0] - a[0]);
  asks.sort((a, b) => a[0] - b[0]);
  if (!bids.length || !asks.length) return { bids, asks, ts: Date.now() };
  const mid = (bids[0][0] + asks[0][0]) / 2;
  return {
    bids: bids.filter((l) => l[0] >= mid * (1 - MAX_RANGE)).slice(0, MAX_LEVELS),
    asks: asks.filter((l) => l[0] <= mid * (1 + MAX_RANGE)).slice(0, MAX_LEVELS),
    ts: Date.now(),
  };
}

/* ── Futures (and Coinbase spot): adapters ── */

interface AdapterDepth { url(meta: InstrumentMeta): string; parse(json: unknown): { bids: Rows; asks: Rows } }

const ADAPTER_DEPTH: Partial<Record<ExchangeId, AdapterDepth>> = {
  binance: { url: (m) => `https://fapi.binance.com/fapi/v1/depth?symbol=${m.inst}&limit=500`, parse: (j) => ({ bids: field(j, 'bids'), asks: field(j, 'asks') }) },
  bybit: {
    url: (m) => `https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${m.inst}&limit=1000`,
    parse: (j) => ({ bids: field(field(j, 'result'), 'b'), asks: field(field(j, 'result'), 'a') }),
  },
  okx: {
    url: (m) => `https://www.okx.com/api/v5/market/books-full?instId=${m.inst}&sz=1500`,
    parse: (j) => { const d = list(field(j, 'data'))[0]; return { bids: field(d, 'bids'), asks: field(d, 'asks') }; },
  },
  bitget: {
    url: (m) => `https://api.bitget.com/api/v2/mix/market/merge-depth?symbol=${m.inst}&productType=USDT-FUTURES&limit=max`,
    parse: (j) => ({ bids: field(field(j, 'data'), 'bids'), asks: field(field(j, 'data'), 'asks') }),
  },
  gate: {
    url: (m) => `https://api.gateio.ws/api/v4/futures/usdt/order_book?contract=${m.inst}&limit=300`,
    parse: (j) => ({ bids: field(j, 'bids'), asks: field(j, 'asks') }),
  },
  coinbase: {
    url: (m) => `https://api.exchange.coinbase.com/products/${m.inst}/book?level=2`,
    parse: (j) => ({ bids: field(j, 'bids'), asks: field(j, 'asks') }),
  },
};

async function adapterUniverse(id: ExchangeId): Promise<UniverseRow[]> {
  const [instruments, events] = await Promise.all([loadInstruments(id), getTickers(id)]);
  const byInst = new Map(Object.entries(instruments).map(([base, m]) => [m.inst, { base, m }]));
  const out: UniverseRow[] = [];
  for (const ev of events) {
    if (ev.kind !== 'ticker' || ev.last === undefined) continue;
    const hit = byInst.get(ev.inst);
    if (!hit) continue;
    const last = ev.last * hit.m.priceScale;
    const open = ev.open24h === undefined ? undefined : ev.open24h * hit.m.priceScale;
    out.push({ symbol: hit.base, last, volume24h: ev.quoteVol ?? 0, change24h: open ? last / open - 1 : null });
  }
  return out;
}

/* ── Spot on the futures venues (USDT pairs) ── */

interface SpotSource {
  tickersUrl: string;
  /** Rows → universe (base symbol), USDT pairs only. */
  parseTickers(json: unknown): UniverseRow[];
  depthUrl(base: string): string;
  parseDepth(json: unknown): { bids: Rows; asks: Rows };
}

const row = (symbol: string, last: number | undefined, volume: number | undefined, change: number | null | undefined): UniverseRow | null =>
  last !== undefined && last > 0 ? { symbol, last, volume24h: volume ?? 0, change24h: change ?? null } : null;
const usdtBase = (pair: string, sep = ''): string | null => (pair.endsWith(`${sep}USDT`) ? pair.slice(0, -(4 + sep.length)) : null);
const changeFrom = (last: number | undefined, open: number | undefined) => (last !== undefined && open ? last / open - 1 : null);

const SPOT: Partial<Record<ExchangeId, SpotSource>> = {
  binance: {
    tickersUrl: 'https://api.binance.com/api/v3/ticker/24hr',
    parseTickers: (j) => list(j).flatMap((t) => {
      const base = usdtBase(String(field(t, 'symbol')));
      const last = num(field(t, 'lastPrice'));
      const r = base ? row(base, last, num(field(t, 'quoteVolume')), changeFrom(last, num(field(t, 'openPrice')))) : null;
      return r ? [r] : [];
    }),
    depthUrl: (b) => `https://api.binance.com/api/v3/depth?symbol=${b}USDT&limit=500`,
    parseDepth: (j) => ({ bids: field(j, 'bids'), asks: field(j, 'asks') }),
  },
  bybit: {
    tickersUrl: 'https://api.bybit.com/v5/market/tickers?category=spot',
    parseTickers: (j) => list(field(field(j, 'result'), 'list')).flatMap((t) => {
      const base = usdtBase(String(field(t, 'symbol')));
      const last = num(field(t, 'lastPrice'));
      const r = base ? row(base, last, num(field(t, 'turnover24h')), changeFrom(last, num(field(t, 'prevPrice24h')))) : null;
      return r ? [r] : [];
    }),
    depthUrl: (b) => `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${b}USDT&limit=200`,
    parseDepth: (j) => ({ bids: field(field(j, 'result'), 'b'), asks: field(field(j, 'result'), 'a') }),
  },
  okx: {
    tickersUrl: 'https://www.okx.com/api/v5/market/tickers?instType=SPOT',
    parseTickers: (j) => list(field(j, 'data')).flatMap((t) => {
      const base = usdtBase(String(field(t, 'instId')), '-');
      const last = num(field(t, 'last'));
      const r = base ? row(base, last, num(field(t, 'volCcy24h')), changeFrom(last, num(field(t, 'open24h')))) : null;
      return r ? [r] : [];
    }),
    depthUrl: (b) => `https://www.okx.com/api/v5/market/books-full?instId=${b}-USDT&sz=1500`,
    parseDepth: (j) => { const d = list(field(j, 'data'))[0]; return { bids: field(d, 'bids'), asks: field(d, 'asks') }; },
  },
  bitget: {
    tickersUrl: 'https://api.bitget.com/api/v2/spot/market/tickers',
    parseTickers: (j) => list(field(j, 'data')).flatMap((t) => {
      const base = usdtBase(String(field(t, 'symbol')));
      const last = num(field(t, 'lastPr'));
      // Bitget lists many dead pairs with no quotes (and nonsense volumes): keep two-sided markets only.
      const quoted = (num(field(t, 'bidPr')) ?? 0) > 0 && (num(field(t, 'askPr')) ?? 0) > 0;
      const r = base && quoted ? row(base, last, num(field(t, 'usdtVolume')) ?? num(field(t, 'quoteVolume')), changeFrom(last, num(field(t, 'open')))) : null;
      return r ? [r] : [];
    }),
    depthUrl: (b) => `https://api.bitget.com/api/v2/spot/market/orderbook?symbol=${b}USDT&type=step0&limit=150`,
    parseDepth: (j) => ({ bids: field(field(j, 'data'), 'bids'), asks: field(field(j, 'data'), 'asks') }),
  },
  gate: {
    tickersUrl: 'https://api.gateio.ws/api/v4/spot/tickers',
    parseTickers: (j) => list(j).flatMap((t) => {
      const base = usdtBase(String(field(t, 'currency_pair')), '_');
      const pct = num(field(t, 'change_percentage'));
      const r = base ? row(base, num(field(t, 'last')), num(field(t, 'quote_volume')), pct === undefined ? null : pct / 100) : null;
      return r ? [r] : [];
    }),
    depthUrl: (b) => `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${b}_USDT&limit=1000`,
    parseDepth: (j) => ({ bids: field(j, 'bids'), asks: field(j, 'asks') }),
  },
};

/** Coinbase lists spot through its adapter; every other spot venue has a SpotSource. */
const viaAdapter = (venue: ExchangeId, market: DensityMarket) => (market === 'futures' ? venue !== 'coinbase' : venue === 'coinbase');

export function hasDepth(venue: ExchangeId, market: DensityMarket): boolean {
  return viaAdapter(venue, market) ? Boolean(ADAPTER_DEPTH[venue]) : Boolean(SPOT[venue]);
}

const universes = new Map<string, { at: number; data: Promise<UniverseRow[]> }>();

/** Liquid-first coin list of a venue × market (shared for a few seconds across requests). */
export function getDensityUniverse(venue: ExchangeId, market: DensityMarket): Promise<UniverseRow[]> {
  const key = `${venue}|${market}`;
  const hit = universes.get(key);
  if (hit && Date.now() - hit.at < UNIVERSE_TTL_MS) return hit.data;
  const spot = SPOT[venue];
  const data = (viaAdapter(venue, market) ? adapterUniverse(venue) : upstreamJson(spot!.tickersUrl, 30_000).then((j) => spot!.parseTickers(j)))
    .then((rows) => rows.sort((a, b) => b.volume24h - a.volume24h));
  data.catch(() => universes.delete(key));
  universes.set(key, { at: Date.now(), data });
  return data;
}

/** Deep order book of one coin, trimmed to ±12% of the mid, in base units. */
export async function getDepth(venue: ExchangeId, market: DensityMarket, base: string): Promise<DepthBook> {
  if (viaAdapter(venue, market)) {
    const src = ADAPTER_DEPTH[venue];
    if (!src) throw new UpstreamError(`No order book for ${ADAPTERS[venue].name}`, 400);
    const meta = await lookupInstrument(venue, base);
    if (!meta) throw new UpstreamError(`${base} is not listed on ${ADAPTERS[venue].name}`, 404);
    const { bids, asks } = src.parse(await upstreamJson(src.url(meta)));
    return trim(rowsOf(bids, meta.priceScale, meta.contractSize), rowsOf(asks, meta.priceScale, meta.contractSize));
  }
  const spot = SPOT[venue];
  if (!spot) throw new UpstreamError(`No spot order book for ${ADAPTERS[venue].name}`, 400);
  // Spot pairs aren't in the instrument lists: an unknown pair comes back as an upstream 400 / 404.
  const json = await upstreamJson(spot.depthUrl(base)).catch((e: unknown) => {
    throw e instanceof UpstreamError && e.status === 404 ? new UpstreamError(`${base}/USDT is not listed on ${ADAPTERS[venue].name} Spot`, 404) : e;
  });
  const { bids, asks } = spot.parseDepth(json);
  return trim(rowsOf(bids), rowsOf(asks));
}
