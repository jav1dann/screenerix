/**
 * Global scan cache: the background worker writes, API routes read.
 *
 * Each entry (one venue's metric table, one venue × market's density cards)
 * carries a version that bumps on every change. Serialised responses are
 * memoised per projection of the current version (least recently used out past
 * MEMO_MAX_BYTES), so a hit is a string send.
 * Entries are persisted to `.scan-cache/` and reloaded on boot, so a restarted
 * server answers immediately with the last known state.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface Entry<T> {
  version: number;
  updatedAt: number;
  data: T;
}

export interface ScanStore {
  get<T>(key: string): Entry<T> | undefined;
  /** Replace an entry's data and bump its version. */
  put<T>(key: string, data: T): Entry<T>;
  keys(): string[];
  /** Memoised serialisation of a projection of `key` (recomputed when the entry's version changes). */
  serialize(key: string, projection: string, build: () => unknown): { version: number; body: string } | null;
  /** Wait until any entry in `keys` is newer than the given versions (or the timeout passes). */
  waitForChange(keys: readonly string[], since: Record<string, number>, timeoutMs: number, signal?: AbortSignal): Promise<void>;
  persist(): Promise<void>;
  restore(): Promise<number>;
}

const CACHE_DIR = path.join(process.cwd(), '.scan-cache');
/** Memoised bodies are 0.1–1.5 MB each (one per distinct projection): cap their total size. */
const MEMO_MAX_BYTES = 48 * 1024 * 1024;
const fileOf = (key: string) => path.join(CACHE_DIR, `${key.replace(/[^a-z0-9_-]/gi, '_')}.json`);

function createStore(): ScanStore {
  const entries = new Map<string, Entry<unknown>>();
  /** `key|projection` → body, in least-recently-used order. */
  const memo = new Map<string, { key: string; version: number; body: string }>();
  let memoBytes = 0;
  const forget = (id: string) => {
    const hit = memo.get(id);
    if (hit) { memoBytes -= hit.body.length * 2; memo.delete(id); }
  };
  const waiters = new Set<() => void>();
  const dirty = new Set<string>();

  return {
    get: <T>(key: string) => entries.get(key) as Entry<T> | undefined,
    put<T>(key: string, data: T) {
      const prev = entries.get(key);
      const entry: Entry<T> = { version: (prev?.version ?? 0) + 1, updatedAt: Date.now(), data };
      entries.set(key, entry);
      // Bodies of the old version are never served again.
      for (const [id, m] of memo) if (m.key === key) forget(id);
      dirty.add(key);
      waiters.forEach((w) => w());
      return entry;
    },
    keys: () => [...entries.keys()],
    serialize(key, projection, build) {
      const entry = entries.get(key);
      if (!entry) return null;
      const id = `${key}|${projection}`;
      const hit = memo.get(id);
      if (hit && hit.version === entry.version) {
        memo.delete(id);
        memo.set(id, hit);
        return hit;
      }
      forget(id);
      const out = { key, version: entry.version, body: JSON.stringify(build()) };
      memo.set(id, out);
      memoBytes += out.body.length * 2;
      while (memoBytes > MEMO_MAX_BYTES && memo.size > 1) forget(memo.keys().next().value as string);
      return out;
    },
    waitForChange(keys, since, timeoutMs, signal) {
      const changed = () => keys.some((k) => (entries.get(k)?.version ?? 0) > (since[k] ?? 0));
      if (changed()) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); waiters.delete(check); signal?.removeEventListener('abort', done); resolve(); };
        const check = () => { if (changed()) done(); };
        const timer = setTimeout(done, timeoutMs);
        waiters.add(check);
        signal?.addEventListener('abort', done);
      });
    },
    async persist() {
      if (!dirty.size) return;
      await mkdir(CACHE_DIR, { recursive: true });
      const keys = [...dirty];
      dirty.clear();
      await Promise.all(keys.map((k) => {
        const e = entries.get(k);
        return e ? writeFile(fileOf(k), JSON.stringify({ key: k, ...e })).catch(() => { dirty.add(k); }) : undefined;
      }));
    },
    async restore() {
      let files: string[];
      try { files = await readdir(CACHE_DIR); } catch { return 0; }
      let n = 0;
      for (const f of files.filter((x) => x.endsWith('.json'))) {
        try {
          const raw = JSON.parse(await readFile(path.join(CACHE_DIR, f), 'utf8')) as { key?: unknown; version?: unknown; updatedAt?: unknown; data?: unknown };
          if (typeof raw.key !== 'string' || typeof raw.version !== 'number' || typeof raw.updatedAt !== 'number' || raw.data === undefined) continue;
          if (!entries.has(raw.key)) { entries.set(raw.key, { version: raw.version, updatedAt: raw.updatedAt, data: raw.data }); n++; }
        } catch { /* a corrupt file is ignored; it is rewritten on the next persist */ }
      }
      return n;
    },
  };
}

const KEY = Symbol.for('screenerix.scanStore');
type Global = typeof globalThis & { [KEY]?: ScanStore };

/** The process-wide scan cache (shared by the worker and every route bundle). */
export function scanStore(): ScanStore {
  const g = globalThis as Global;
  return (g[KEY] ??= createStore());
}

export const metricsKey = (venue: string) => `metrics_${venue}`;
export const densityKey = (venue: string, market: string) => `densities_${venue}_${market}`;
export const strategyKey = (venue: string) => `strategies_${venue}`;
