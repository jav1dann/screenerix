/**
 * Mock provider for development and tests (`PAYMENTS_PROVIDER=mock`): fake deposit addresses
 * and an exact 1:1 USDT amount. There is no chain — a signed webhook (same signature check as
 * NOWPayments) is the simulated payment: it updates this provider's record, which the webhook
 * route then re-fetches like it would from NOWPayments. In memory, per server process.
 */
import 'server-only';
import { randomBytes } from 'node:crypto';
import type { Network } from './networks';
import { ipnSecret, ProviderError, SIGNATURE_HEADER, verifySignedBody } from './provider';
import type { PaymentProvider, ProviderPayment, ProviderStatus } from './provider';

const MOCK_TTL_MS = 90 * 60_000;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const g = globalThis as typeof globalThis & { __sxMockPayments?: Map<string, ProviderPayment> };
const payments = (g.__sxMockPayments ??= new Map<string, ProviderPayment>());

const b58 = (n: number) => [...randomBytes(n)].map((b) => B58[b % B58.length]).join('');

/** An address that looks right for the network (not a real wallet). */
function fakeAddress(network: Network): string {
  if (network.id === 'trc20') return `T${b58(33)}`;
  if (network.id === 'sol') return b58(44);
  return `0x${randomBytes(20).toString('hex')}`;
}

export const mockProvider: PaymentProvider = {
  name: 'mock',
  async quote(usd: number) {
    return usd;
  },
  async create({ orderId, usd, network }) {
    const p: ProviderPayment = {
      providerId: `mock_${randomBytes(6).toString('hex')}`,
      orderId, status: 'waiting', payAddress: fakeAddress(network), payAmount: usd, payCurrency: network.code, actuallyPaid: 0,
      expiresAt: Date.now() + MOCK_TTL_MS,
    };
    payments.set(p.providerId, p);
    return { ...p };
  },
  async get(providerId: string) {
    const p = payments.get(providerId);
    if (!p) throw new ProviderError(`mock payment ${providerId} not found (server restarted?)`);
    return { ...p };
  },
  verifyWebhook(rawBody: string, headers: Headers) {
    const body = verifySignedBody(rawBody, headers.get(SIGNATURE_HEADER), ipnSecret());
    if (!body?.payment_id || !body.order_id) return null;
    const providerId = String(body.payment_id);
    const p = payments.get(providerId);
    if (p && typeof body.payment_status === 'string') {
      payments.set(providerId, { ...p, status: body.payment_status as ProviderStatus, actuallyPaid: Number(body.actually_paid) || 0 });
    }
    return { orderId: String(body.order_id), providerId };
  },
};
