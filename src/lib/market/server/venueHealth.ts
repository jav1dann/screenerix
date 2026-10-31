/**
 * Per-host circuit breaker for exchange REST calls made by this server (route handlers and the
 * background workers alike — every call goes through `upstreamJson`).
 *
 * An exchange that refuses this server's region answers HTTP 451 (Binance: "restricted location")
 * or 403 (Bybit's CDN). That is not an outage: retrying just repeats a refused request. So the
 * first such answer opens the breaker for the host: further calls fail at once, without touching
 * the network, until `RECHECK_MS` has passed; then ONE request goes through as a probe. A probe
 * that succeeds closes the breaker (the exchange is back for everyone); a refused one re-opens it.
 *
 * Keyed by host, not venue: one exchange can be refused on one API (Binance futures, fapi) and
 * serve another. Nothing here routes around a refusal — it only stops asking. Server-only.
 */
import 'server-only';
import { ADAPTERS, EXCHANGE_IDS } from '@/lib/market/exchanges';
import type { ExchangeId } from '@/lib/market/exchanges';

export const RECHECK_MS = 15 * 60_000;

export interface HostHealth {
  state: 'ok' | 'restricted';
  /** The refusing HTTP status (451 / 403). */
  status?: number;
  /** When it was first refused (this streak). */
  since?: number;
  /** When the next probe may go out. */
  retryAt?: number;
  /** A probe is in flight. */
  probing?: boolean;
}

/** HTTP statuses an exchange uses to refuse a region / network, as opposed to failing. */
export const isRestrictionStatus = (status: number): boolean => status === 451 || status === 403;

const g = globalThis as typeof globalThis & { __sxHostHealth?: Map<string, HostHealth>; __sxHostHealthListeners?: Set<() => void> };
const hosts = (g.__sxHostHealth ??= new Map<string, HostHealth>());
const listeners = (g.__sxHostHealthListeners ??= new Set<() => void>());
const changed = () => listeners.forEach((l) => { try { l(); } catch { /* a listener's failure is its own */ } });

const hostOf = (url: string): string => { try { return new URL(url).host; } catch { return url; } };

/** Thrown instead of calling a host whose breaker is open. */
export class RestrictedError extends Error {
  readonly code = 'restricted' as const;
  constructor(readonly host: string, readonly status: number, readonly retryAt: number) {
    super(`refused by the exchange from this server's region (HTTP ${status})`);
  }
}

/**
 * Call before a request: throws `RestrictedError` while the host's breaker is open. After
 * `RECHECK_MS` the first caller is let through as the probe (others still get the error).
 */
export function beforeRequest(url: string, now = Date.now()): void {
  const h = hosts.get(hostOf(url));
  if (!h || h.state === 'ok') return;
  if (now < (h.retryAt ?? 0) || h.probing) throw new RestrictedError(hostOf(url), h.status ?? 451, h.probing ? now + RECHECK_MS : h.retryAt ?? now);
  h.probing = true;
}

/** Feed back how a request to `url` ended: an HTTP status, or 'network' (no answer). */
export function reportResult(url: string, outcome: number | 'network', now = Date.now()): void {
  const host = hostOf(url);
  const h = hosts.get(host);
  if (typeof outcome === 'number' && isRestrictionStatus(outcome)) {
    const first = !h || h.state === 'ok';
    hosts.set(host, { state: 'restricted', status: outcome, since: first ? now : h.since, retryAt: now + RECHECK_MS, probing: false });
    if (first) console.warn(`[market] ${host} refuses this server (HTTP ${outcome}) — paused; checking again every ${RECHECK_MS / 60_000} min`);
    changed();
    return;
  }
  if (!h || h.state === 'ok') return;
  if (outcome === 'network') { h.probing = false; h.retryAt = now + RECHECK_MS; return; }
  // Any real answer that isn't a refusal (even a 5xx or 404) means the host serves us again.
  hosts.delete(host);
  console.log(`[market] ${host} answers this server again (HTTP ${outcome}) — resumed`);
  changed();
}

export const hostHealth = (url: string): HostHealth => hosts.get(hostOf(url)) ?? { state: 'ok' };

/** A venue's health: that of its market REST API (the one every feature here relies on). */
export function venueHealth(id: ExchangeId): HostHealth {
  const h = hostHealth(ADAPTERS[id].rest.instrumentsUrl);
  return h.state === 'ok' ? h : { ...h };
}

export const allVenueHealth = (): Record<ExchangeId, HostHealth> =>
  Object.fromEntries(EXCHANGE_IDS.map((id) => [id, venueHealth(id)])) as Record<ExchangeId, HostHealth>;

export const isVenueRestricted = (id: ExchangeId, now = Date.now()): boolean => {
  const h = venueHealth(id);
  return h.state === 'restricted' && now < (h.retryAt ?? 0);
};

/** The `/api/market/venues` answer: each venue's state, with a plain explanation when refused. */
export function venueHealthReport(): { venues: Record<ExchangeId, { state: 'ok' } | { state: 'restricted'; status?: number; retryAt?: number; message: string }> } {
  const health = allVenueHealth();
  const venues = Object.fromEntries(EXCHANGE_IDS.map((id) => {
    const h = health[id];
    return [id, h.state === 'restricted'
      ? { state: 'restricted' as const, status: h.status, retryAt: h.retryAt, message: `${ADAPTERS[id].name} doesn’t serve market data to this server’s region (HTTP ${h.status}).` }
      : { state: 'ok' as const }];
  })) as ReturnType<typeof venueHealthReport>['venues'];
  return { venues };
}

/** Notified when any host is refused or recovers. */
export function onHealthChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Tests only: forget every host's state. */
export function resetHealth(): void { hosts.clear(); }
