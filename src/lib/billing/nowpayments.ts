/**
 * NOWPayments (https://nowpayments.io) — REST calls with `x-api-key`; `NOWPAYMENTS_SANDBOX=1`
 * uses the sandbox host. Each order gets its own payment (deposit address + exact amount).
 * Server-only.
 */
import type { Network } from './networks';
import { ipnSecret, ProviderError, SIGNATURE_HEADER, verifySignedBody } from './provider';
import type { PaymentProvider, ProviderPayment, ProviderStatus } from './provider';

const TIMEOUT_MS = 15_000;
const STATUSES: ReadonlySet<string> = new Set(['waiting', 'confirming', 'confirmed', 'sending', 'partially_paid', 'finished', 'failed', 'refunded', 'expired']);

const sandbox = () => process.env.NOWPAYMENTS_SANDBOX === '1';
const host = () => (sandbox() ? 'https://api-sandbox.nowpayments.io' : 'https://api.nowpayments.io');
/** Sandbox only: the outcome NOWPayments simulates for new payments (`case`: success, partially_paid, …). */
const sandboxCase = () => (sandbox() ? process.env.NOWPAYMENTS_SANDBOX_CASE?.trim() || undefined : undefined);

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

function toPayment(raw: Record<string, unknown>): ProviderPayment {
  const status = String(raw.payment_status ?? '');
  const expires = typeof raw.expiration_estimate_date === 'string' ? Date.parse(raw.expiration_estimate_date) : NaN;
  if (!raw.payment_id || !STATUSES.has(status)) throw new ProviderError('unexpected payment response');
  let actuallyPaid = num(raw.actually_paid);
  // The sandbox finishes simulated payments with actually_paid 0; no real funds move there.
  if (sandbox() && status === 'finished' && actuallyPaid === 0) actuallyPaid = num(raw.pay_amount);
  return {
    providerId: String(raw.payment_id),
    orderId: String(raw.order_id ?? ''),
    status: status as ProviderStatus,
    payAddress: String(raw.pay_address ?? ''),
    payAmount: num(raw.pay_amount),
    payCurrency: String(raw.pay_currency ?? '').toLowerCase(),
    actuallyPaid,
    ...(Number.isFinite(expires) ? { expiresAt: expires } : {}),
  };
}

export function nowPaymentsProvider(apiKey: string): PaymentProvider {
  async function call(path: string, init?: { method: 'POST'; body: unknown }): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(`${host()}/v1${path}`, {
        method: init?.method ?? 'GET',
        headers: { 'x-api-key': apiKey, ...(init ? { 'content-type': 'application/json' } : {}) },
        body: init ? JSON.stringify(init.body) : undefined,
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new ProviderError(`NOWPayments unreachable: ${(e as Error).message}`);
    }
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    // Their error bodies carry a `message`; it is logged, never shown to the user.
    if (!res.ok || !data) throw new ProviderError(`NOWPayments ${path.split('?')[0]} → ${res.status} ${String(data?.message ?? '')}`.trim());
    return data;
  }

  return {
    name: 'nowpayments',
    async quote(usd: number, network: Network) {
      const q = new URLSearchParams({ amount: String(usd), currency_from: 'usd', currency_to: network.code });
      const amount = num((await call(`/estimate?${q}`)).estimated_amount);
      if (amount <= 0) throw new ProviderError('empty estimate');
      return amount;
    },
    async create({ orderId, usd, network, callbackUrl, description }) {
      const p = toPayment(await call('/payment', {
        method: 'POST',
        body: { price_amount: usd, price_currency: 'usd', pay_currency: network.code, order_id: orderId, order_description: description, ipn_callback_url: callbackUrl, ...(sandboxCase() ? { case: sandboxCase() } : {}) },
      }));
      if (!p.payAddress || p.payAmount <= 0) throw new ProviderError('payment without address / amount');
      return p;
    },
    async get(providerId: string) {
      return toPayment(await call(`/payment/${encodeURIComponent(providerId)}`));
    },
    verifyWebhook(rawBody: string, headers: Headers) {
      const body = verifySignedBody(rawBody, headers.get(SIGNATURE_HEADER), ipnSecret());
      if (!body?.payment_id || !body.order_id) return null;
      return { orderId: String(body.order_id), providerId: String(body.payment_id) };
    },
  };
}
