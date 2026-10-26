/**
 * Open-interest series for one (exchange, symbol, chart timeframe), ref-counted
 * like `chartStream`. History comes from the `/api/market/:ex/oi` proxy (period
 * chosen server-side, ≥ 5m); live values come from the venue's WS (tickers or a
 * dedicated OI channel) or, where there is none, a REST poll.
 */
import { ADAPTERS, TIMEFRAME_MS } from './exchanges';
import type { ChartTimeframe, ExchangeId, FeedEvent, InstrumentMeta, OiPoint } from './exchanges';
import { createEmitter } from './feed';
import { fetchInstrument, fetchOiCurrent, fetchOiHistory } from './marketApi';
import { openChannel } from './socketHub';
import type { SocketChannel } from './socketHub';

const POLL_MS = 15_000;
const MAX_POINTS = 1_000;
const RELEASE_DELAY_MS = 2_000;

export interface OiKey { exchange: ExchangeId; symbol: string; tf: ChartTimeframe }

export type OiStatus = 'loading' | 'ready' | 'unavailable' | 'error';

export interface OiSnapshot {
  status: OiStatus;
  /** True when the venue has no OI history (series starts when the chart opens). */
  liveOnly: boolean;
  error?: string;
}

export interface OiStream {
  subscribe(listener: () => void): () => void;
  getSnapshot(): OiSnapshot;
  /** Oldest-first samples in base units. */
  getPoints(): OiPoint[];
  onData(listener: () => void): () => void;
  retain(): () => void;
}

function createOiStream(key: OiKey): OiStream & { dispose(): void } {
  const { exchange, symbol } = key;
  const adapter = ADAPTERS[exchange];
  const emitter = createEmitter(500);
  const dataListeners = new Set<() => void>();
  let snapshot: OiSnapshot = { status: 'loading', liveOnly: false };
  let points: OiPoint[] = [];
  let bucketMs = TIMEFRAME_MS['1m'];
  let meta: InstrumentMeta | null = null;
  let channel: SocketChannel | null = null;
  let poll: ReturnType<typeof setInterval> | undefined;
  let refs = 0;
  let gen = 0;
  let started = false;

  const set = (s: Partial<OiSnapshot>) => { snapshot = { ...snapshot, ...s }; emitter.notify(); };
  const changed = () => { dataListeners.forEach((l) => l()); emitter.notify(); };

  /** Record a live value in the current bucket. */
  function push(oi: number, now = Date.now()): void {
    const t = Math.floor(now / bucketMs) * bucketMs;
    const last = points[points.length - 1];
    if (last && last.t === t) points[points.length - 1] = { t, oi };
    else if (!last || t > last.t) {
      points.push({ t, oi });
      if (points.length > MAX_POINTS) points.shift();
    }
    changed();
  }

  function onEvents(events: FeedEvent[]): void {
    const m = meta;
    if (!m) return;
    for (const ev of events) {
      if (ev.kind === 'oi' && ev.inst === m.inst) push(ev.units === 'contracts' ? ev.value * m.contractSize : ev.value);
    }
  }

  async function start(): Promise<void> {
    const g = ++gen;
    set({ status: 'loading', error: undefined });
    if (adapter.market === 'spot') { set({ status: 'unavailable' }); return; }
    try {
      const m = await fetchInstrument(exchange, symbol);
      if (g !== gen) return;
      if (!m) { set({ status: 'unavailable' }); return; }
      meta = m;
      const oiTopics = adapter.ws.oiTopics(m.inst);
      if (oiTopics.length) {
        channel = openChannel(adapter, adapter.ws.tickerUrl, { onEvents });
        channel.setTopics(new Set(oiTopics));
      }
      const { period, points: history } = await fetchOiHistory(exchange, symbol, key.tf);
      if (g !== gen) return;
      if (period) bucketMs = TIMEFRAME_MS[period];
      // Keep any live samples newer than the history.
      const tail = points.filter((p) => !history.length || p.t > history[history.length - 1].t);
      points = [...history, ...tail].slice(-MAX_POINTS);
      if (!oiTopics.length && adapter.rest.oi?.currentUrl) {
        const tick = () => { fetchOiCurrent(exchange, symbol).then((v) => { if (g === gen && v !== null) push(v); }).catch(() => {}); };
        tick();
        poll = setInterval(tick, POLL_MS);
      }
      const liveCapable = oiTopics.length > 0 || Boolean(adapter.rest.oi?.currentUrl);
      if (!history.length && !liveCapable) { set({ status: 'unavailable' }); return; }
      set({ status: 'ready', liveOnly: !history.length });
      changed();
    } catch (e) {
      if (g !== gen) return;
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  function stop(): void {
    gen++;
    started = false;
    clearInterval(poll);
    channel?.close();
    channel = null;
  }

  const self: OiStream & { dispose(): void } = {
    subscribe: emitter.subscribe,
    getSnapshot: () => snapshot,
    getPoints: () => points,
    onData(listener) {
      dataListeners.add(listener);
      return () => { dataListeners.delete(listener); };
    },
    retain() {
      refs++;
      if (!started) {
        started = true;
        oiStreams.set(oiKeyOf(key), self);
        void start();
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        refs--;
        if (refs === 0) setTimeout(() => { if (refs === 0) { self.dispose(); oiStreams.delete(oiKeyOf(key)); } }, RELEASE_DELAY_MS);
      };
    },
    dispose: stop,
  };
  return self;
}

const oiStreams = new Map<string, OiStream & { dispose(): void }>();
const oiKeyOf = (k: OiKey) => `${k.exchange}|${k.symbol}|${k.tf}`;

/** Get (or create) the shared OI stream for a key. No network until `retain()`. */
export function getOiStream(key: OiKey): OiStream {
  const id = oiKeyOf(key);
  let s = oiStreams.get(id);
  if (!s) {
    s = createOiStream(key);
    oiStreams.set(id, s);
  }
  return s;
}
