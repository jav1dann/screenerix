/**
 * Shared, ref-counted exchange WebSockets.
 *
 * Every consumer (the terminal feed, each chart card) opens a *channel* on a
 * venue URL and declares the topics it needs. Channels on the same URL share
 * one socket that subscribes to the union of their topics, so a page with a
 * dozen charts still holds a single connection per venue endpoint.
 *
 * Each socket handles its own heartbeat, a stale-message watchdog and jittered
 * exponential reconnect with resubscribe. Subscription changes are batched so
 * many consumers mounting at once stay inside exchange rate limits.
 */
import type { ExchangeAdapter, FeedEvent } from './exchanges';
import type { ConnState } from './types';

const STALE_MS = 30_000; // reconnect if a socket is silent this long
const MAX_BACKOFF_MS = 30_000;
const SYNC_DELAY_MS = 50; // batch subscription changes

export interface ChannelHandlers {
  onEvents(events: FeedEvent[]): void;
  /** Connection dropped: incremental state (order books) must be discarded. */
  onReset?(): void;
  /** Connection state changed. */
  onChange?(): void;
}

export interface SocketChannel {
  readonly url: string;
  readonly state: ConnState;
  readonly error: string | undefined;
  /** Replace this channel's topic set (empty = no interest). */
  setTopics(topics: Set<string>): void;
  /** Force an immediate reconnect of the underlying socket. */
  retry(): void;
  /** Release the channel; the socket closes when no channel needs it. */
  close(): void;
}

class SharedSocket {
  state: ConnState = 'idle';
  error: string | undefined;
  readonly channels = new Map<object, { handlers: ChannelHandlers; topics: Set<string> }>();
  private ws: WebSocket | null = null;
  private desired = new Set<string>();
  private active = new Set<string>();
  private attempts = 0;
  private lastMessage = 0;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  /** Subscription frames waiting for the venue's rate limit. */
  private queue: string[] = [];
  private drainTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly url: string, private readonly adapter: ExchangeAdapter) {}

  /** Recompute the topic union after a channel changed. */
  refresh(): void {
    const next = new Set<string>();
    this.channels.forEach((c) => c.topics.forEach((t) => next.add(t)));
    this.desired = next;
    if (!next.size) { this.shutdown(); return; }
    if (!this.ws) this.connect();
    else this.scheduleSync();
  }

  retry(): void {
    if (!this.desired.size) return;
    this.attempts = 0;
    this.drop();
    this.connect();
  }

  private connect(): void {
    clearTimeout(this.reconnectTimer);
    this.setState(this.attempts ? 'reconnecting' : 'connecting', this.error);
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'WebSocket failed';
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.active.clear();

    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.attempts = 0;
      this.lastMessage = Date.now();
      this.setState('live');
      this.sync();
      const ping = this.adapter.ws.ping;
      if (ping) this.pingTimer = setInterval(() => this.send(ping.frame()), ping.everyMs);
      this.watchdog = setInterval(() => {
        if (Date.now() - this.lastMessage > STALE_MS) ws.close();
      }, 5_000);
    };
    ws.onmessage = (e: MessageEvent) => {
      if (ws !== this.ws) return;
      this.lastMessage = Date.now();
      if (typeof e.data !== 'string') return;
      const events = this.adapter.ws.parse(e.data);
      if (events.length) this.channels.forEach((c) => c.handlers.onEvents(events));
    };
    ws.onclose = (e: CloseEvent) => {
      if (ws !== this.ws) return;
      this.drop();
      this.channels.forEach((c) => c.handlers.onReset?.());
      if (!this.desired.size) { this.setState('idle'); return; }
      this.error = e.reason || `Disconnected (code ${e.code})`;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    this.attempts++;
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (this.attempts - 1)) * (0.75 + Math.random() * 0.5);
    // After a few failures surface it as an error, but keep retrying.
    this.setState(this.attempts > 3 ? 'error' : 'reconnecting', this.error);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private scheduleSync(): void {
    if (this.syncTimer || this.ws?.readyState !== WebSocket.OPEN) return;
    this.syncTimer = setTimeout(() => { this.syncTimer = undefined; this.sync(); }, SYNC_DELAY_MS);
  }

  /** Diff desired vs. active topics and send the frames. */
  private sync(): void {
    clearTimeout(this.syncTimer);
    this.syncTimer = undefined;
    const add = [...this.desired].filter((t) => !this.active.has(t));
    const remove = [...this.active].filter((t) => !this.desired.has(t));
    if (remove.length) this.adapter.ws.frames('unsubscribe', remove).forEach((f) => this.enqueue(f));
    if (add.length) this.adapter.ws.frames('subscribe', add).forEach((f) => this.enqueue(f));
    this.active = new Set(this.desired);
  }

  /** Send subscription frames no faster than the venue allows. */
  private enqueue(frame: string): void {
    const rate = this.adapter.ws.framesPerSecond;
    if (!rate) { this.send(frame); return; }
    this.queue.push(frame);
    if (!this.drainTimer) this.drain(1000 / rate);
  }

  private drain(gapMs: number): void {
    const frame = this.queue.shift();
    if (frame === undefined) { this.drainTimer = undefined; return; }
    this.send(frame);
    this.drainTimer = setTimeout(() => this.drain(gapMs), gapMs);
  }

  private send(frame: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(frame);
  }

  private shutdown(): void {
    this.attempts = 0;
    this.drop();
    this.setState('idle');
  }

  /** Tear down the current socket and timers without triggering reconnect. */
  private drop(): void {
    clearTimeout(this.syncTimer);
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    clearInterval(this.watchdog);
    clearTimeout(this.drainTimer);
    this.drainTimer = undefined;
    this.queue = [];
    this.syncTimer = undefined;
    const ws = this.ws;
    this.ws = null;
    this.active.clear();
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    }
  }

  private setState(state: ConnState, error?: string): void {
    if (state === 'live') error = undefined;
    if (this.state === state && this.error === error) return;
    this.state = state;
    this.error = error;
    this.channels.forEach((c) => c.handlers.onChange?.());
  }
}

const sockets = new Map<string, SharedSocket>();

/** Open a channel on `url` (one shared socket per URL). */
export function openChannel(adapter: ExchangeAdapter, url: string, handlers: ChannelHandlers): SocketChannel {
  let socket = sockets.get(url);
  if (!socket) {
    socket = new SharedSocket(url, adapter);
    sockets.set(url, socket);
  }
  const s = socket;
  const key = {};
  s.channels.set(key, { handlers, topics: new Set() });
  let closed = false;
  return {
    url,
    get state() { return s.channels.get(key)?.topics.size ? s.state : 'idle'; },
    get error() { return s.error; },
    setTopics(topics) {
      const ch = s.channels.get(key);
      if (!ch || closed) return;
      ch.topics = new Set(topics);
      s.refresh();
    },
    retry: () => s.retry(),
    close() {
      if (closed) return;
      closed = true;
      s.channels.delete(key);
      s.refresh();
    },
  };
}

/** Open sockets right now — for diagnostics and tests. */
export const openSocketCount = (): number => [...sockets.values()].filter((s) => s.state !== 'idle').length;
