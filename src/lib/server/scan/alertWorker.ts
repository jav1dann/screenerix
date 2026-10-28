/**
 * Alert worker for one venue: after every price pass of the market worker (every 5 s; 10 s on
 * Binance) it checks that venue's active alerts, records firings and delivers them. Accounts
 * whose trial / Pro has ended are skipped. It makes no upstream requests of its own; symbols
 * with complex alerts are marked hot so their candles stay fresh.
 */
import { describeCondition, METRIC_BY_ID } from '@/lib/alerts/types';
import type { Alert, AlertDetail, Metric } from '@/lib/alerts/types';
import { complexFires, complexState, priceFires } from '@/lib/alerts/rules';
import { deliver } from '@/lib/alerts/server/deliver';
import { allAlerts, recordDelivery, recordFire } from '@/lib/alerts/server/store';
import { hasAccess } from '@/lib/auth/access';
import { findById } from '@/lib/auth/users';
import { fmtPrice } from '@/lib/format';
import type { ExchangeId } from '@/lib/market/exchanges';
import type { MarketWorker } from './marketWorker';

export interface AlertWorker { stop(): void; stats(): { active: number; fired: number } }

const fmtVal = (metric: Metric, v: number) => {
  const unit = METRIC_BY_ID.get(metric)!.unit;
  return unit === '%' ? `${v >= 0 ? '+' : ''}${+v.toFixed(Math.abs(v) < 1 ? 3 : 2)}%` : unit === '×' ? `${+v.toFixed(2)}×` : fmtPrice(v);
};

export function startAlertWorker(venue: ExchangeId, market: MarketWorker): AlertWorker {
  /** Last checked price per price alert (crossing detection). */
  const lastPrice = new Map<string, number>();
  /** Whether each complex alert's conditions held on the previous pass (edge detection). */
  const held = new Map<string, boolean>();
  let fired = 0;
  let active = 0;

  function pass(): void {
    const now = Date.now();
    // Strategy alerts are matched by the strategy worker (strategyAlerts.ts), not by price.
    const mine = allAlerts().filter((a) => a.exchange === venue && a.status === 'active' && a.kind !== 'strategy');
    active = mine.length;
    const access = new Map<string, boolean>();
    const allowed = (uid: string) => {
      let ok = access.get(uid);
      if (ok === undefined) { const u = findById(uid); ok = Boolean(u && hasAccess(u, now)); access.set(uid, ok); }
      return ok;
    };
    const hot = new Set<string>();
    for (const a of mine) {
      if (!allowed(a.userId)) continue;
      if (a.kind === 'complex') hot.add(a.symbol);
      const coin = market.coin(a.symbol);
      if (!coin) continue;
      if (a.kind === 'price' && a.price) {
        const prev = lastPrice.get(a.id) ?? null;
        lastPrice.set(a.id, coin.price);
        if (!priceFires(a, prev, coin.price, now)) continue;
        const text = `Price ${a.price.direction === 'above' ? 'rose to' : 'fell to'} ${fmtPrice(coin.price)} (alert at ${fmtPrice(a.price.level)})`;
        fire(a, coin.price, text, now, { kind: 'price', direction: a.price.direction, level: a.price.level });
      } else if (a.kind === 'complex' && a.conditions?.length) {
        const { holds, values } = complexState(a.conditions, coin, now);
        const before = held.get(a.id) ?? false;
        held.set(a.id, holds);
        if (!complexFires(a, holds, before, now)) continue;
        const text = a.conditions.map((c, i) => `${describeCondition(c)} (now ${fmtVal(c.metric, values[i] as number)})`).join(' AND ');
        fire(a, coin.price, text, now, { kind: 'complex', checks: a.conditions.map((condition, i) => ({ condition, value: values[i] ?? null })) });
      }
    }
    market.setHot([...hot], 'alerts');
    // Forget state of alerts that are gone / archived.
    const live = new Set(mine.map((a) => a.id));
    for (const id of lastPrice.keys()) if (!live.has(id)) lastPrice.delete(id);
    for (const id of held.keys()) if (!live.has(id)) held.delete(id);
  }

  function fire(a: Alert, price: number, text: string, now: number, detail: AlertDetail): void {
    const r = recordFire(a, price, text, now, detail);
    if (!r) return;
    fired++;
    void deliver(r.event)
      .then((d) => { if (d.telegram || d.push !== undefined) recordDelivery(r.event, d); })
      .catch((e) => console.error(`[alerts] delivery failed: ${(e as Error).message}`));
  }

  const off = market.onPrices(() => {
    try { pass(); } catch (e) { console.error(`[alerts] ${venue} pass failed`, e); }
  });
  return { stop: off, stats: () => ({ active, fired }) };
}
