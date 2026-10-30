'use server';

/**
 * Crypto checkout: quote a period + network, create (or resume) an order. Prices come from
 * `PERIODS` on the server — the browser only picks a period and a network. Expired accounts
 * can use these (that's how they renew); signed-out callers can't.
 */
import { headers } from 'next/headers';
import { DAY_MS, proPeriodStart } from '@/lib/auth/access';
import { getCurrentUser } from '@/lib/auth/dal';
import { isThrottled, recordFailure } from '@/lib/auth/throttle';
import { findById } from '@/lib/auth/users';
import { networkOf, isNetwork } from '@/lib/billing/networks';
import type { Network, NetworkId } from '@/lib/billing/networks';
import { insertOrder, newOrderId, ordersOf, toOrderView } from '@/lib/billing/orders';
import type { Order, OrderView } from '@/lib/billing/orders';
import { isPeriod, PERIODS } from '@/lib/billing/plans';
import type { Period } from '@/lib/billing/plans';
import { paymentProvider, ProviderError, WEBHOOK_PATH } from '@/lib/billing/provider';
import { appOrigin } from '@/lib/server/origin';

export type CheckoutResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: 'unavailable' | 'auth' };

export interface Quote {
  period: Period;
  network: NetworkId;
  priceUsd: number;
  /** Exact USDT to send. */
  payAmount: number;
  /** Provider / conversion fee included in `payAmount` (0: none). */
  processingFee: number;
  /** Pro end date if paid now (stacks on the current period, and on what's left of the trial). */
  proUntil: number;
  /** Whole trial days carried over on top of the purchase (0: no active trial). */
  trialDaysKept: number;
}

/** How long an order's address and amount stay valid. */
const ORDER_TTL_MS = 90 * 60_000;
/** An open order is resumed only while this much of its window is left. */
const RESUME_MIN_LEFT_MS = 10 * 60_000;
const MAX_OPEN_ORDERS = 3;
const QUOTE_TTL_MS = 60_000;

const UNAVAILABLE = { ok: false, code: 'unavailable', error: 'Crypto checkout is unavailable right now. Please try again later.' } as const;
const SIGNED_OUT = { ok: false, code: 'auth', error: 'Sign in to continue.' } as const;
const INVALID = { ok: false, error: 'Choose a plan and a network.' } as const;

const g = globalThis as typeof globalThis & { __sxQuotes?: Map<string, { at: number; amount: number }> };
const quotes = (g.__sxQuotes ??= new Map());

/** USDT amount for `usd` on `network`, cached for a minute per network and price. */
async function quoteAmount(usd: number, network: NetworkId, now: number): Promise<number> {
  const provider = paymentProvider();
  if (!provider) throw new ProviderError('unconfigured');
  const key = `${provider.name}:${network}:${usd}`;
  const hit = quotes.get(key);
  if (hit && now - hit.at < QUOTE_TTL_MS) return hit.amount;
  const amount = await provider.quote(usd, networkOf(network));
  quotes.set(key, { at: now, amount });
  return amount;
}

/** End of the new Pro period, and the trial days it keeps (same rule as `grantPro` applies on payment). */
function proUntil(userId: string, period: Period, now: number): Pick<Quote, 'proUntil' | 'trialDaysKept'> {
  const u = findById(userId);
  const start = u ? proPeriodStart(u, now) : now;
  const trialLeft = u?.trialEndsAt && u.trialEndsAt > now ? u.trialEndsAt - Math.max(now, u.proExpiresAt ?? 0) : 0;
  return { proUntil: start + PERIODS[period].days * DAY_MS, trialDaysKept: Math.max(0, Math.round(trialLeft / DAY_MS)) };
}

export async function quoteCrypto(period: Period, network: NetworkId): Promise<CheckoutResult<Quote>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  if (!isPeriod(period) || !isNetwork(network)) return INVALID;
  if (!paymentProvider()) return UNAVAILABLE;
  const now = Date.now();
  const priceUsd = PERIODS[period].usd;
  try {
    const payAmount = await quoteAmount(priceUsd, network, now);
    const processingFee = Math.max(0, Math.round((payAmount - priceUsd) * 100) / 100);
    return { ok: true, data: { period, network, priceUsd, payAmount, processingFee, ...proUntil(user.id, period, now) } };
  } catch (e) {
    console.error(`[billing] quote ${network} failed: ${(e as Error).message}`);
    return { ok: false, error: 'Couldn’t get a quote for this network. Try another one or retry shortly.' };
  }
}

/** What the customer sees when the provider refuses or can't be reached (the details go to the log). */
function createOrderError(e: unknown, net: Network): string {
  const err = e instanceof ProviderError ? e : null;
  if (!err || err.code === 'UNREACHABLE') return 'The payment provider didn’t respond. Please try again in a moment.';
  if (err.code === 'AMOUNT_MINIMAL_ERROR') return `This amount is below the payment provider’s minimum on ${net.name}. Please choose another network.`;
  if (err.status === 401 || err.status === 403) return 'Crypto payments are temporarily unavailable. Please try again later.';
  return 'The payment provider couldn’t create this order. Please try another network or retry shortly.';
}

/** Waiting inside its window, or funds seen (confirming / partly paid) in the last day. */
const isOpen = (o: Order, now: number) =>
  o.status === 'waiting' ? o.expiresAt > now : (o.status === 'confirming' || o.status === 'partially_paid') && now - o.createdAt < DAY_MS;

export async function createCryptoOrder(period: Period, network: NetworkId): Promise<CheckoutResult<OrderView>> {
  const user = await getCurrentUser();
  if (!user) return SIGNED_OUT;
  if (!isPeriod(period) || !isNetwork(network)) return INVALID;
  const provider = paymentProvider();
  if (!provider) return UNAVAILABLE;
  const now = Date.now();

  const open = ordersOf(user.id).filter((o) => isOpen(o, now));
  const same = open.find((o) => o.status === 'waiting' && o.period === period && o.network === network && o.provider === provider.name && o.expiresAt - now > RESUME_MIN_LEFT_MS);
  if (same) return { ok: true, data: toOrderView(same) };
  if (open.length >= MAX_OPEN_ORDERS) return { ok: false, error: `You already have ${MAX_OPEN_ORDERS} open orders. Pay one, or wait for one to expire.` };
  const keys = [`order:${user.id}`];
  if (isThrottled(keys, now)) return { ok: false, error: 'Too many new orders. Try again in a few minutes.' };

  const id = newOrderId();
  const net = networkOf(network);
  const priceUsd = PERIODS[period].usd;
  const h = await headers();
  const origin = h.get('origin') ?? `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost'}`;
  let pay;
  try {
    pay = await provider.create({
      orderId: id, usd: priceUsd, network: net,
      callbackUrl: `${appOrigin(origin)}${WEBHOOK_PATH}`,
      description: `Screenerix Pro · ${PERIODS[period].label}`,
    });
  } catch (e) {
    console.error(`[billing] create order ${id} (${period}, $${priceUsd}) on ${network} failed: ${(e as Error).message}`);
    return { ok: false, error: createOrderError(e, net) };
  }
  // Order creations count against the same 5-per-5-minutes budget as failed sign-ins.
  recordFailure(keys, now);
  const order = insertOrder({
    id, userId: user.id, period, network, priceUsd,
    payAmount: pay.payAmount, payCurrency: pay.payCurrency || net.code, payAddress: pay.payAddress,
    provider: provider.name, providerId: pay.providerId, status: 'waiting',
    createdAt: now, expiresAt: Math.min(now + ORDER_TTL_MS, pay.expiresAt ?? Infinity), checkedAt: now,
  });
  console.log(`[billing] order ${id} created: ${user.email} · ${period} · ${net.code} · ${pay.payAmount}`);
  return { ok: true, data: toOrderView(order) };
}

/** The account's most recent order that is still open, to resume after reopening the modal. */
export async function currentCryptoOrder(): Promise<OrderView | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const now = Date.now();
  const o = ordersOf(user.id).find((x) => isOpen(x, now));
  return o ? toOrderView(o) : null;
}
