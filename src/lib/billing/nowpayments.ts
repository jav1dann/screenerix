/**
 * NOWPayments (https://nowpayments.io) — REST calls with `x-api-key`; `NOWPAYMENTS_SANDBOX=1`
 * (or `true`) uses the sandbox host, anything else the live one. Each order gets its own
 * payment (deposit address + exact amount). Failed calls are logged with the request and the
 * provider's raw response under `[nowpayments]` (never the API key). Server-only.
 */
import type { Network } from './networks';
import { ipnSecret, ProviderError, SIGNATURE_HEADER, verifySignedBody } from './provider';
import type { PaymentProvider, ProviderPayment, ProviderStatus } from './provider';

const TIMEOUT_MS = 15_000;
/** Creating a payment generates a deposit address, which NOWPayments can take a while over. */
const CREATE_TIMEOUT_MS = 30_000;
/** Response bodies are logged up to this many characters. */
const LOG_BODY_MAX = 2000;
const STATUSES: ReadonlySet<string> = new Set(['waiting', 'confirming', 'confirmed', 'sending', 'partially_paid', 'finished', 'failed', 'refunded', 'expired']);

const sandbox = () => /^(1|true|yes|on)$/i.test(process.env.NOWPAYMENTS_SANDBOX?.trim() ?? '');
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
  async function call(path: string, init?: { method: 'POST'; body: unknown; timeoutMs?: number }): Promise<Record<string, unknown>> {
    const timeoutMs = init?.timeoutMs ?? TIMEOUT_MS;
    // e.g. "POST https://api.nowpayments.io/v1/payment (live)" — shows which host and key mode was used.
    const label = `${init?.method ?? 'GET'} ${host()}/v1${path} (${sandbox() ? 'sandbox' : 'live'})`;
    const request = init ? { request: init.body } : {};
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${host()}/v1${path}`, {
        method: init?.method ?? 'GET',
        headers: { 'x-api-key': apiKey, ...(init ? { 'content-type': 'application/json' } : {}) },
        body: init ? JSON.stringify(init.body) : undefined,
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const err = e as Error & { cause?: { code?: string; message?: string } };
      const why = err.name === 'TimeoutError' ? `no answer within ${timeoutMs} ms` : `${err.name}: ${err.message}`;
      const cause = err.cause ? ` (cause: ${[err.cause.code, err.cause.message].filter(Boolean).join(' ')})` : '';
      console.error(`[nowpayments] ${label} failed after ${Date.now() - started} ms — ${why}${cause}`, request);
      throw new ProviderError(`NOWPayments unreachable: ${why}`, { code: 'UNREACHABLE' });
    }
    const text = await res.text().catch(() => '');
    let data: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    } catch { /* not JSON: logged as text below */ }
    if (!res.ok || !data) {
      // Error bodies look like {"status":false,"statusCode":400,"code":"AMOUNT_MINIMAL_ERROR","message":"…"}.
      console.error(`[nowpayments] ${label} → HTTP ${res.status} in ${Date.now() - started} ms`, { ...request, response: text.slice(0, LOG_BODY_MAX) || '(empty body)' });
      const code = typeof data?.code === 'string' ? data.code : undefined;
      throw new ProviderError(`NOWPayments ${path.split('?')[0]} → ${res.status} ${code ?? ''} ${String(data?.message ?? '')}`.replace(/\s+/g, ' ').trim(), { status: res.status, code });
    }
    return data;
  }

  /** `toPayment`, logging the raw body when NOWPayments answers 2xx with something unusable. */
  function paymentFrom(raw: Record<string, unknown>, what: string): ProviderPayment {
    try {
      return toPayment(raw);
    } catch (e) {
      console.error(`[nowpayments] ${what}: unexpected response`, { response: JSON.stringify(raw).slice(0, LOG_BODY_MAX) });
      throw e;
    }
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
      // POST /v1/payment: price_amount is a number, currencies are lower-case tickers, order_id a string.
      const body = {
        price_amount: usd,
        price_currency: 'usd',
        pay_currency: network.code,
        order_id: orderId,
        order_description: description,
        ipn_callback_url: callbackUrl,
        ...(sandboxCase() ? { case: sandboxCase() } : {}),
      };
      const raw = await call('/payment', { method: 'POST', body, timeoutMs: CREATE_TIMEOUT_MS });
      const p = paymentFrom(raw, `create payment for order ${orderId}`);
      if (!p.payAddress || p.payAmount <= 0) {
        console.error(`[nowpayments] payment ${p.providerId} for order ${orderId} has no address / amount`, { response: JSON.stringify(raw).slice(0, LOG_BODY_MAX) });
        throw new ProviderError('payment without address / amount');
      }
      return p;
    },
    async get(providerId: string) {
      return paymentFrom(await call(`/payment/${encodeURIComponent(providerId)}`), `payment ${providerId}`);
    },
    verifyWebhook(rawBody: string, headers: Headers) {
      const body = verifySignedBody(rawBody, headers.get(SIGNATURE_HEADER), ipnSecret());
      if (!body?.payment_id || !body.order_id) return null;
      return { orderId: String(body.order_id), providerId: String(body.payment_id) };
    },
  };
}
