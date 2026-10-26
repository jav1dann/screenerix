'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { quoteCrypto } from '@/app/actions/billing';
import { NetworkIcon, UsdtIcon } from '@/components/shared/brand/BrandIcon';
import type { CheckoutResult, Quote } from '@/app/actions/billing';
import { fmtDay, fmtUsd2, fmtUsdt } from '@/lib/billing/format';
import { NETWORKS, networkOf } from '@/lib/billing/networks';
import type { NetworkId } from '@/lib/billing/networks';
import { PERIODS, yearlyPerMonth, yearlySavingPct } from '@/lib/billing/plans';
import type { Period } from '@/lib/billing/plans';

/** The chain's official logo. */
export function NetworkMark({ id, size = 28 }: { id: NetworkId; size?: number }) {
  return <NetworkIcon id={id} size={size} className="bx-net-icon" />;
}

/** The live quote for a period + network (null while it loads). */
function useQuote(period: Period, network: NetworkId): CheckoutResult<Quote> | null {
  const key = `${period}:${network}`;
  const [q, setQ] = useState<{ key: string; r: CheckoutResult<Quote> } | null>(null);
  useEffect(() => {
    let on = true;
    quoteCrypto(period, network)
      .then((r) => { if (on) setQ({ key: `${period}:${network}`, r }); })
      .catch(() => { if (on) setQ({ key: `${period}:${network}`, r: { ok: false, error: 'Couldn’t reach the server. Check your connection and retry.' } }); });
    return () => { on = false; };
  }, [period, network]);
  return q?.key === key ? q.r : null;
}

const Skel = () => <span className="bx-skel" aria-label="Loading" />;

export default function PlanStep({ period, network, onPeriod, onNetwork, onContinue, busy, error, resume }: {
  period: Period;
  network: NetworkId;
  onPeriod: (p: Period) => void;
  onNetwork: (n: NetworkId) => void;
  onContinue: () => void;
  busy: boolean;
  error: string | null;
  /** Back to an order that is still open. */
  resume?: () => void;
}) {
  const quote = useQuote(period, network);
  const q = quote?.ok ? quote.data : null;
  const net = networkOf(network);
  const unavailable = quote && !quote.ok && quote.code === 'unavailable';

  return (
    <div className="bx-body">
      <div className="bx-main">
        <div>
          <div className="bx-label" id="bx-period">Subscription period</div>
          <div className="bx-periods" role="radiogroup" aria-labelledby="bx-period">
            {(['month', 'year'] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={period === p} className="bx-opt" data-period={p} onClick={() => onPeriod(p)}>
                {p === 'year' && <span className="bx-opt-badge">Save {yearlySavingPct()}%</span>}
                <span className="bx-opt-title">{PERIODS[p].label}</span>
                <span className="bx-opt-price">${PERIODS[p].usd}</span>
                <span className="bx-opt-meta">{p === 'year' ? `$${yearlyPerMonth()} / month · billed yearly` : 'Billed monthly'}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="bx-label">Currency</div>
          <span className="bx-asset"><UsdtIcon size={24} className="bx-usdt" />USDT <span className="bx-muted" style={{ fontWeight: 500 }}>Tether</span></span>
        </div>
        <div>
          <div className="bx-label" id="bx-network">Network</div>
          <div className="bx-networks" role="radiogroup" aria-labelledby="bx-network">
            {NETWORKS.map((n) => (
              <button key={n.id} type="button" role="radio" aria-checked={network === n.id} className="bx-opt bx-net" data-network={n.id} onClick={() => onNetwork(n.id)}>
                <NetworkMark id={n.id} />
                <span className="bx-net-text">
                  <span className="bx-opt-title">{n.name}</span>
                  <span className="bx-opt-meta">{n.standard}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <aside className="bx-side" aria-label="Order summary" data-summary>
        <div className="bx-label" style={{ marginBottom: 0 }}>Order summary</div>
        <div>
          <div className="bx-row"><span>Plan</span><span data-sum-plan>Pro · {PERIODS[period].label}</span></div>
          <div className="bx-row"><span>Price</span><span data-sum-price>{fmtUsd2(PERIODS[period].usd)}</span></div>
          <div className="bx-row"><span>Network</span><span data-sum-network>{net.name} ({net.standard})</span></div>
          <div className="bx-row"><span>Processing fee</span><span data-sum-fee>{q ? (q.processingFee > 0 ? fmtUsd2(q.processingFee) : 'Included') : quote ? '—' : <Skel />}</span></div>
          <div className="bx-row"><span>Est. network gas</span><span data-sum-gas>≈ {fmtUsd2(net.gas)} <span className="bx-muted">· your wallet</span></span></div>
        </div>
        <div className="bx-sep" />
        <div className="bx-total">
          <span className="bx-muted">You pay</span>
          <span className="bx-total-num" data-sum-total>{q ? `${fmtUsdt(q.payAmount)} USDT` : quote ? '—' : <Skel />}</span>
        </div>
        {q && <div className="bx-fine" data-sum-until>Pro active until <strong style={{ color: 'var(--sx-text)' }}>{fmtDay(q.proUntil)}</strong></div>}
        {quote && !quote.ok && <div className="bx-note" data-tone={unavailable ? 'info' : 'error'} role="alert">{quote.error}</div>}
        {error && <div className="bx-note" data-tone="error" role="alert" data-order-error>{error}</div>}
        <button type="button" className="bx-btn bx-btn-primary bx-btn-block" onClick={onContinue} disabled={!q || busy} data-continue style={{ marginTop: 'auto' }}>
          {busy ? 'Creating order…' : 'Continue to payment'}
        </button>
        {resume && <button type="button" className="bx-link" onClick={resume} style={{ alignSelf: 'center' }}>Back to your open order</button>}
        <p className="bx-fine" style={{ margin: 0 }}>
          One-time payment, no auto-renewal. Crypto payments are final once confirmed. See the <Link href="/refunds" target="_blank">Refund Policy</Link>.
        </p>
      </aside>
    </div>
  );
}
