/**
 * Upstream request budget, shared by the background worker and the API routes.
 *
 * One weighted token bucket per exchange host (or endpoint family), sized from
 * each venue's public rate limits. User-facing requests (chart history, trades)
 * are charged but never wait. The background worker also has its own bucket
 * refilling at WORKER_SHARE of the rate, and may only spend while the shared
 * bucket has room — so it never uses more than its share, and backs off when
 * users are busy. A 429 / 418 pauses the host for everyone (Retry-After, default 30s).
 *
 * Lives on `globalThis`: Next.js bundles `instrumentation.ts` and each route
 * separately, so module-level state would not be shared between them.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface BucketSpec { rate: number; weight(url: URL): number }
interface Bucket { spec: BucketSpec; tokens: number; worker: number; at: number; pausedUntil: number; spent: number; limited: number; waiters: Array<() => void> }

/** Share of each bucket the worker may use (the rest is kept for user requests). */
const WORKER_SHARE = 0.7;
const DEFAULT_PAUSE_MS = 30_000;

const n = (u: URL, k: string, d: number) => Number(u.searchParams.get(k) ?? d);
const bnFutDepth = (l: number) => (l <= 50 ? 2 : l <= 100 ? 5 : l <= 500 ? 10 : 20);
const bnSpotDepth = (l: number) => (l <= 100 ? 5 : l <= 500 ? 25 : l <= 1000 ? 50 : 250);
const bnKlines = (l: number) => (l < 100 ? 1 : l < 500 ? 2 : l <= 1000 ? 5 : 10);

/** Bucket key + spec for a URL; unknown hosts are not limited. */
function bucketFor(u: URL): { key: string; spec: BucketSpec } | null {
  const p = u.pathname;
  switch (u.hostname) {
    case 'fapi.binance.com':
      // Open-interest statistics have their own limit (1000 / 5 min per IP).
      if (p.startsWith('/futures/data/')) return { key: 'binance-fut-stats', spec: { rate: 1000 / 300, weight: () => 1 } };
      return {
        key: 'binance-fut',
        spec: {
          rate: 2400 / 60,
          weight: (x) => {
            if (x.pathname.endsWith('/depth')) return bnFutDepth(n(x, 'limit', 500));
            if (x.pathname.endsWith('/klines')) return bnKlines(n(x, 'limit', 500));
            if (x.pathname.endsWith('/ticker/24hr')) return x.searchParams.has('symbol') ? 1 : 40;
            if (x.pathname.endsWith('/premiumIndex')) return x.searchParams.has('symbol') ? 1 : 10;
            // Aggregate trades are expensive (sub-minute backfills page through many of them).
            if (x.pathname.endsWith('/aggTrades')) return 20;
            return 1;
          },
        },
      };
    case 'api.binance.com':
      return {
        key: 'binance-spot',
        spec: {
          rate: 6000 / 60,
          weight: (x) => (x.pathname.endsWith('/depth') ? bnSpotDepth(n(x, 'limit', 100)) : x.pathname.endsWith('/ticker/24hr') ? (x.searchParams.has('symbol') ? 2 : 80) : 2),
        },
      };
    case 'www.okx.com':
      // books-full: 10 requests / 2s; other public market data ~20 / 2s.
      if (p.endsWith('/books-full')) return { key: 'okx-books', spec: { rate: 5, weight: () => 1 } };
      return { key: 'okx', spec: { rate: 10, weight: () => 1 } };
    case 'api.bybit.com': return { key: 'bybit', spec: { rate: 20, weight: () => 1 } };
    case 'api.bitget.com': return { key: 'bitget', spec: { rate: 15, weight: () => 1 } };
    case 'api.gateio.ws': return { key: 'gate', spec: { rate: 15, weight: () => 1 } };
    case 'api.exchange.coinbase.com': return { key: 'coinbase', spec: { rate: 8, weight: () => 1 } };
    default: return null;
  }
}

export class RateLimitedError extends Error {
  readonly status = 429;
}

export interface Limiter {
  /** Wait for budget (worker) or charge it (user requests). Throws RateLimitedError while the host is paused (user requests). */
  acquire(url: string): Promise<void>;
  /** Feed back an upstream response status (429 / 418 pause the host). */
  report(url: string, status: number, retryAfter: string | null): void;
  /** Run `fn` as background-worker work (it then waits for its share of the budget). */
  asWorker<T>(fn: () => Promise<T>): Promise<T>;
  stats(): Record<string, { rate: number; spentPerMin: number; paused: boolean; limited: number }>;
}

function createLimiter(): Limiter {
  const buckets = new Map<string, Bucket>();
  const worker = new AsyncLocalStorage<boolean>();
  const windowStart = Date.now();

  const bucket = (url: string): Bucket | null => {
    let u: URL;
    try { u = new URL(url); } catch { return null; }
    const b = bucketFor(u);
    if (!b) return null;
    let hit = buckets.get(b.key);
    if (!hit) { hit = { spec: b.spec, tokens: b.spec.rate, worker: b.spec.rate * WORKER_SHARE, at: Date.now(), pausedUntil: 0, spent: 0, limited: 0, waiters: [] }; buckets.set(b.key, hit); }
    return hit;
  };
  const refill = (b: Bucket) => {
    const now = Date.now();
    const secs = (now - b.at) / 1000;
    b.tokens = Math.min(b.spec.rate, b.tokens + secs * b.spec.rate);
    b.worker = Math.min(b.spec.rate * WORKER_SHARE, b.worker + secs * b.spec.rate * WORKER_SHARE);
    b.at = now;
  };
  const weightOf = (url: string, b: Bucket) => { try { return b.spec.weight(new URL(url)); } catch { return 1; } };
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  return {
    async acquire(url) {
      const b = bucket(url);
      if (!b) return;
      const w = weightOf(url, b);
      if (!worker.getStore()) {
        if (Date.now() < b.pausedUntil) throw new RateLimitedError('Upstream rate limit — paused');
        refill(b);
        b.tokens -= w; // user requests never wait; the worker slows down instead
        b.spent += w;
        return;
      }
      // Worker: needs its own share and room in the shared bucket; one waiter at a time per bucket (FIFO).
      await new Promise<void>((resolve) => { b.waiters.push(resolve); if (b.waiters.length === 1) resolve(); });
      try {
        const share = b.spec.rate * WORKER_SHARE;
        // A request heavier than the worker bucket can hold waits for a full bucket instead.
        const need = Math.min(w, share);
        for (;;) {
          const now = Date.now();
          if (now < b.pausedUntil) { await sleep(b.pausedUntil - now); continue; }
          refill(b);
          if (b.worker >= need - 1e-9 && b.tokens >= Math.min(w, b.spec.rate) - 1e-9) break;
          const lack = Math.max((need - b.worker) / share, (Math.min(w, b.spec.rate) - b.tokens) / b.spec.rate);
          await sleep(Math.max(10, lack * 1000));
        }
        b.worker -= w;
        b.tokens -= w;
        b.spent += w;
      } finally {
        b.waiters.shift();
        b.waiters[0]?.();
      }
    },
    report(url, status, retryAfter) {
      if (status !== 429 && status !== 418) return;
      const b = bucket(url);
      if (!b) return;
      const secs = Number(retryAfter);
      b.pausedUntil = Date.now() + (Number.isFinite(secs) && secs > 0 ? Math.min(secs, 600) * 1000 : DEFAULT_PAUSE_MS);
      b.limited++;
    },
    asWorker: (fn) => worker.run(true, fn),
    stats() {
      const mins = Math.max(1 / 60, (Date.now() - windowStart) / 60_000);
      return Object.fromEntries([...buckets].map(([k, b]) => [k, { rate: b.spec.rate * 60, spentPerMin: Math.round(b.spent / mins), paused: Date.now() < b.pausedUntil, limited: b.limited }]));
    },
  };
}

const KEY = Symbol.for('screenerix.limiter');
type Global = typeof globalThis & { [KEY]?: Limiter };

/** The process-wide limiter (created on first use). */
export function limiter(): Limiter {
  const g = globalThis as Global;
  return (g[KEY] ??= createLimiter());
}
