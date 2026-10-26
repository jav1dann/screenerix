'use client';

import { Check, LoaderCircle, X } from 'lucide-react';
import Link from 'next/link';
import { fmtDay, fmtUsdt } from '@/lib/billing/format';
import { networkOf } from '@/lib/billing/networks';
import type { OrderView } from '@/lib/billing/orders';
import { PERIODS } from '@/lib/billing/plans';
import { useCopy } from './hooks';
import { CopyField, StatusPill } from './PaymentStep';

function Receipt({ order }: { order: OrderView }) {
  const net = networkOf(order.network);
  return (
    <div className="bx-receipt">
      <div className="bx-row"><span>Order ID</span><span style={{ fontFamily: 'ui-monospace,monospace' }}>{order.id}</span></div>
      <div className="bx-row"><span>Plan</span><span>Pro · {PERIODS[order.period].label}</span></div>
      <div className="bx-row"><span>Network</span><span>{net.name} ({net.standard})</span></div>
      <div className="bx-row"><span>Amount</span><span>{fmtUsdt(order.payAmount)} USDT</span></div>
      <div className="bx-row"><span>Status</span><span><StatusPill status={order.status} /></span></div>
    </div>
  );
}

/** Step 3: confirming → paid, or what to do about a partial / failed payment. */
export default function StatusStep({ order, onRetry, onDone, terminalHref }: {
  order: OrderView;
  /** Start over at step 1. */
  onRetry: () => void;
  onDone: () => void;
  /** "Open terminal" link outside the terminal; null inside it. */
  terminalHref: string | null;
}) {
  const { copied, copy } = useCopy();

  if (order.status === 'paid') {
    return (
      <div className="bx-status" data-result="paid">
        <span className="bx-badge" data-tone="ok">
          <svg className="bx-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
        <h3>You’re on Pro</h3>
        <p data-pro-until>Payment confirmed. Pro is active until <strong style={{ color: 'var(--sx-text)' }}>{order.proExpiresAt ? fmtDay(order.proExpiresAt) : '—'}</strong>.</p>
        <Receipt order={order} />
        <div className="bx-actions">
          {terminalHref
            ? <Link href={terminalHref} className="bx-btn bx-btn-primary" data-finish>Open terminal</Link>
            : <button type="button" className="bx-btn bx-btn-primary" onClick={onDone} data-finish>Start trading</button>}
        </div>
      </div>
    );
  }

  if (order.status === 'partially_paid') {
    const rest = Math.max(0, order.payAmount - (order.actuallyPaid ?? 0));
    const restText = fmtUsdt(rest, false);
    return (
      <div className="bx-status" data-result="partially_paid">
        <span className="bx-badge" data-tone="wait"><LoaderCircle className="bx-spin" /></span>
        <h3>Partial payment received</h3>
        <p>We received {fmtUsdt(order.actuallyPaid ?? 0)} of {fmtUsdt(order.payAmount)} USDT. Send the remaining <strong style={{ color: 'var(--sx-text)' }}>{fmtUsdt(rest)} USDT</strong> to the same address to activate Pro.</p>
        <div style={{ width: 'min(460px,100%)', display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}>
          <CopyField label="Remaining amount" field="rest" big value={restText} display={`${fmtUsdt(rest)} USDT`} copied={copied === 'rest'} onCopy={() => copy('rest', restText)} />
          <CopyField label={`Deposit address · ${networkOf(order.network).name}`} field="address" value={order.payAddress} copied={copied === 'address'} onCopy={() => copy('address', order.payAddress)} />
        </div>
        <p className="bx-fine">Stuck? Contact support with order <strong>{order.id}</strong>.</p>
      </div>
    );
  }

  if (order.status === 'failed') {
    return (
      <div className="bx-status" data-result="failed">
        <span className="bx-badge" data-tone="bad"><X /></span>
        <h3>Payment failed</h3>
        <p>The payment provider couldn’t complete this payment. If funds left your wallet, contact support with order <strong style={{ color: 'var(--sx-text)' }}>{order.id}</strong>.</p>
        <Receipt order={order} />
        <div className="bx-actions"><button type="button" className="bx-btn bx-btn-primary" onClick={onRetry} data-retry>Try again</button></div>
      </div>
    );
  }

  return (
    <div className="bx-status" data-result="confirming">
      <span className="bx-badge" data-tone="wait"><LoaderCircle className="bx-spin" /></span>
      <h3>Payment detected</h3>
      <p>Waiting for network confirmations ({networkOf(order.network).eta}). You can close this window: Pro activates automatically.</p>
      <Receipt order={order} />
      <div className="bx-actions"><button type="button" className="bx-btn" onClick={onDone}>Close</button></div>
      <span className="bx-fine" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Check size={13} /> Updates live</span>
    </div>
  );
}
