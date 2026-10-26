/**
 * Crypto payment provider adapter. `PAYMENTS_PROVIDER` picks it: `nowpayments` (default when
 * `NOWPAYMENTS_API_KEY` is set) or `mock` (development / tests only: fake addresses, the
 * webhook stands in for the chain). Unconfigured: checkout says it's unavailable.
 * Webhooks are signed NOWPayments-style either way (HMAC-SHA512 of the key-sorted JSON body,
 * `x-nowpayments-sig`, keyed with `NOWPAYMENTS_IPN_SECRET`). Server-only.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mockProvider } from './mock';
import type { Network } from './networks';
import { nowPaymentsProvider } from './nowpayments';

/** The provider's own payment states (NOWPayments' set). */
export type ProviderStatus = 'waiting' | 'confirming' | 'confirmed' | 'sending' | 'partially_paid' | 'finished' | 'failed' | 'refunded' | 'expired';

export interface ProviderPayment {
  providerId: string;
  /** Our order id, echoed back. */
  orderId: string;
  status: ProviderStatus;
  payAddress: string;
  payAmount: number;
  payCurrency: string;
  actuallyPaid: number;
  /** When the provider stops watching the address (ms), if it says. */
  expiresAt?: number;
}

export interface PaymentProvider {
  name: string;
  /** Amount of `network`'s USDT the customer sends for `usd`. */
  quote(usd: number, network: Network): Promise<number>;
  create(p: { orderId: string; usd: number; network: Network; callbackUrl: string; description: string }): Promise<ProviderPayment>;
  get(providerId: string): Promise<ProviderPayment>;
  /** A verified webhook's order / payment ids; null when the signature doesn't check out. */
  verifyWebhook(rawBody: string, headers: Headers): { orderId: string; providerId: string } | null;
}

export const WEBHOOK_PATH = '/api/payments/crypto/webhook';
export const SIGNATURE_HEADER = 'x-nowpayments-sig';

export class ProviderError extends Error {}

/** JSON with object keys sorted at every level — the string NOWPayments signs. */
export function sortedJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])]));
    return x;
  };
  return JSON.stringify(sort(v));
}

export const ipnSignature = (payload: unknown, secret: string): string => createHmac('sha512', secret).update(sortedJson(payload), 'utf8').digest('hex');

/** The parsed body when `signature` is its HMAC under `secret` (constant-time compare); else null. */
export function verifySignedBody(rawBody: string, signature: string | null, secret: string | undefined): Record<string, unknown> | null {
  if (!secret || !signature || rawBody.length > 64 * 1024) return null;
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const expected = Buffer.from(ipnSignature(body, secret), 'hex');
  const got = Buffer.from(signature.trim().toLowerCase(), 'hex');
  return expected.length === got.length && timingSafeEqual(expected, got) ? (body as Record<string, unknown>) : null;
}

export const ipnSecret = (): string | undefined => process.env.NOWPAYMENTS_IPN_SECRET?.trim() || undefined;

/** The configured provider, or null (checkout unavailable). */
export function paymentProvider(): PaymentProvider | null {
  const choice = process.env.PAYMENTS_PROVIDER?.trim().toLowerCase();
  if (choice === 'mock') {
    if (process.env.NODE_ENV === 'production' && process.env.PAYMENTS_ALLOW_MOCK !== '1') {
      console.error('[billing] PAYMENTS_PROVIDER=mock is ignored in production');
      return null;
    }
    return ipnSecret() ? mockProvider : null;
  }
  const key = process.env.NOWPAYMENTS_API_KEY?.trim();
  if ((!choice || choice === 'nowpayments') && key && ipnSecret()) return nowPaymentsProvider(key);
  return null;
}
