/**
 * Coin directory for venues other than the streaming primary: every listed coin
 * with its last price, 24h change and turnover, from one REST ticker snapshot.
 * Used by the ticker search when it covers several exchanges.
 */
import type { ExchangeId } from './exchanges';
import { fetchInstruments, fetchTickers } from './marketApi';

export interface DirectoryEntry {
  symbol: string;
  price: number;
  /** Fraction, e.g. 0.012 = +1.2%; null when the venue omits the 24h open. */
  change24h: number | null;
  /** 24h turnover in quote currency. */
  volume: number;
}

const TTL_MS = 30_000;
const cache = new Map<ExchangeId, { at: number; data: Promise<DirectoryEntry[]> }>();

async function load(id: ExchangeId): Promise<DirectoryEntry[]> {
  const [instruments, tickers] = await Promise.all([fetchInstruments(id), fetchTickers(id)]);
  const byInst = new Map(Object.entries(instruments).map(([base, meta]) => [meta.inst, { base, meta }]));
  const out = new Map<string, DirectoryEntry>();
  for (const ev of tickers) {
    if (ev.kind !== 'ticker' || ev.last === undefined) continue;
    const hit = byInst.get(ev.inst);
    if (!hit) continue;
    const price = ev.last * hit.meta.priceScale;
    out.set(hit.base, {
      symbol: hit.base,
      price,
      change24h: ev.open24h ? ev.last / ev.open24h - 1 : null,
      volume: ev.quoteVol ?? 0,
    });
  }
  return [...out.values()].sort((a, b) => b.volume - a.volume);
}

/** Most traded first; cached for 30s, failed loads are retried on the next call. */
export function getDirectory(id: ExchangeId): Promise<DirectoryEntry[]> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const data = load(id);
  data.catch(() => cache.delete(id));
  cache.set(id, { at: Date.now(), data });
  return data;
}
