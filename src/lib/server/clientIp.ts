/**
 * The visitor's IP address for rate limits, from what the reverse proxy in front of the app
 * reports. Server actions and route handlers have no socket address, so without a proxy there
 * is no trustworthy IP at all (and limits count per email / account only).
 *
 * `TRUST_PROXY` says how many proxies sit in front of the app and append to X-Forwarded-For:
 *   unset / 0     no proxy: the header is ignored (a client could write anything into it)
 *   1 / true      one proxy (nginx, Caddy, a load balancer)
 *   2, 3…         that many proxies in a chain (e.g. a CDN in front of nginx)
 *   cloudflare    Cloudflare in front: its CF-Connecting-IP header (only if the origin accepts
 *                 traffic from Cloudflare alone, or anyone can send that header directly)
 * Each proxy appends the address it saw, so the client is that many entries from the RIGHT;
 * the leftmost entries are whatever the client sent and are never used.
 * Server-only.
 */
import 'server-only';
import { isIP } from 'node:net';

export type ProxyTrust = { kind: 'none' } | { kind: 'hops'; hops: number } | { kind: 'cloudflare' };

export function proxyTrust(raw = process.env.TRUST_PROXY): ProxyTrust {
  const v = raw?.trim().toLowerCase() ?? '';
  if (v === 'cloudflare') return { kind: 'cloudflare' };
  if (v === 'true' || v === 'yes' || v === 'on') return { kind: 'hops', hops: 1 };
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? { kind: 'hops', hops: n } : { kind: 'none' };
}

/** IPv6 addresses are grouped by their /64 network: one subscriber can switch addresses inside it freely. */
function rateKeyOf(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const [head, tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

let missingWarned = false;

/**
 * The client's address (IPv6: its /64) per `TRUST_PROXY`, or null: no proxy is trusted, or the
 * proxy didn't send what was expected (logged once, as that means TRUST_PROXY is wrong).
 */
export function clientIp(headers: Headers, trust = proxyTrust()): string | null {
  if (trust.kind === 'none') return null;
  let ip: string | undefined;
  if (trust.kind === 'cloudflare') {
    ip = headers.get('cf-connecting-ip')?.trim();
  } else {
    const chain = (headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    ip = chain.length >= trust.hops ? chain[chain.length - trust.hops] : undefined;
  }
  // "[::1]:1234" / "1.2.3.4:5678" forms some proxies use.
  ip = ip?.replace(/^\[([^\]]+)\](?::\d+)?$/, '$1').replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, '$1');
  if (!ip || !isIP(ip)) {
    if (!missingWarned) {
      missingWarned = true;
      console.error(`[security] TRUST_PROXY=${process.env.TRUST_PROXY} but the request carries no usable ${trust.kind === 'cloudflare' ? 'CF-Connecting-IP' : 'X-Forwarded-For'} — IP rate limits are off until the proxy sends it (or fix TRUST_PROXY)`);
    }
    return null;
  }
  return rateKeyOf(ip);
}
