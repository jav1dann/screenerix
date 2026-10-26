/**
 * Payment orders in `.data/orders.json` (same atomic-write / mtime-cache pattern as
 * `users.json`). Every change is announced on an in-process emitter, which wakes the
 * order's status stream. Server-only.
 */
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '@/lib/auth/session';
import type { NetworkId } from './networks';
import type { Period } from './plans';
import type { OrderStatus } from './status';

export { FINAL_STATUSES } from './status';
export type { OrderStatus };

export interface Order {
  /** Ours, shown to the user and sent to the provider as `order_id` ("SX-7K2QH9MD"). */
  id: string;
  userId: string;
  period: Period;
  network: NetworkId;
  priceUsd: number;
  /** Exact amount to send, in `payCurrency`. */
  payAmount: number;
  payCurrency: string;
  payAddress: string;
  provider: string;
  providerId: string;
  status: OrderStatus;
  /** What has arrived so far (provider's `actually_paid`). */
  actuallyPaid?: number;
  createdAt: number;
  expiresAt: number;
  /** Last provider status check (ms) — polls are rate-limited on this. */
  checkedAt?: number;
  paidAt?: number;
  /** Set once Pro has been granted for this order: a replayed confirmation can't extend it again. */
  appliedAt?: number;
  /** The account's Pro end date right after this order was applied. */
  proExpiresAt?: number;
}

/** What the browser sees of an order. */
export type OrderView = Omit<Order, 'userId' | 'provider' | 'providerId' | 'checkedAt' | 'appliedAt'>;

export function toOrderView(o: Order): OrderView {
  const view: Partial<Order> = { ...o };
  delete view.userId; delete view.provider; delete view.providerId; delete view.checkedAt; delete view.appliedAt;
  return view as OrderView;
}

const FILE = () => join(DATA_DIR, 'orders.json');
let cache: { mtimeMs: number; orders: Order[] } | null = null;

const g = globalThis as typeof globalThis & { __sxOrderEvents?: EventEmitter };
const events = (g.__sxOrderEvents ??= new EventEmitter().setMaxListeners(0));

function load(): Order[] {
  const f = FILE();
  if (!existsSync(f)) return [];
  const { mtimeMs } = statSync(f);
  if (cache && cache.mtimeMs === mtimeMs) return cache.orders;
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8')) as { orders?: Order[] };
    const orders = Array.isArray(raw.orders) ? raw.orders : [];
    cache = { mtimeMs, orders };
    return orders;
  } catch (e) {
    console.error('[billing] orders.json is unreadable', e);
    return [];
  }
}

function save(orders: Order[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const f = FILE();
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ orders }, null, 2), { mode: 0o600 });
  renameSync(tmp, f);
  cache = { mtimeMs: statSync(f).mtimeMs, orders };
}

/** "SX-" + 8 characters without look-alikes (0/O, 1/I). */
export function newOrderId(): string {
  const abc = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  return `SX-${[...randomBytes(8)].map((b) => abc[b % abc.length]).join('')}`;
}

export const findOrder = (id: string): Order | null => load().find((o) => o.id === id) ?? null;

/** The account's orders, newest first. */
export const ordersOf = (userId: string): Order[] => load().filter((o) => o.userId === userId).sort((a, b) => b.createdAt - a.createdAt);

export function insertOrder(order: Order): Order {
  save([...load(), order]);
  events.emit(order.id, order);
  return order;
}

export function patchOrder(id: string, patch: Partial<Omit<Order, 'id' | 'userId'>>): Order | null {
  const orders = load();
  const i = orders.findIndex((o) => o.id === id);
  if (i < 0) return null;
  const next = { ...orders[i], ...patch };
  save(orders.map((o, k) => (k === i ? next : o)));
  events.emit(id, next);
  return next;
}

/** Resolves on the next change of order `id`, after `ms`, or when `signal` aborts. */
export function waitForOrderChange(id: string, ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      events.off(id, done);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const t = setTimeout(done, ms);
    events.on(id, done);
    signal.addEventListener('abort', done);
  });
}
