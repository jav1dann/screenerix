'use client';

import { Check, Copy, TriangleAlert } from 'lucide-react';
import { useNow } from '@/hooks/useDensities';
import { fmtCountdown, fmtUsdt } from '@/lib/billing/format';
import { networkOf } from '@/lib/billing/networks';
import type { OrderView } from '@/lib/billing/orders';
import { PERIODS } from '@/lib/billing/plans';
import { STATUS_LABEL } from '@/lib/billing/status';
import { useCopy, useQrSvg } from './hooks';
import { NetworkMark } from './PlanStep';

/** Under this much time left the countdown turns amber. */
const WARN_MS = 10 * 60_000;

/** A read-only value with a one-click copy button. */
export function CopyField({ label, value, display, field, copied, onCopy, big = false }: {
  label: string;
  value: string;
  display?: string;
  field: string;
  copied: boolean;
  onCopy: () => void;
  big?: boolean;
}) {
  return (
    <div className={`bx-field${big ? ' bx-amount' : ''}`}>
      <span className="bx-label" style={{ marginBottom: 0 }}>{label}</span>
      <div className="bx-copy">
        <code data-copy-value={field}>{display ?? value}</code>
        <button type="button" className="bx-copy-btn" onClick={onCopy} data-copy={field} data-copied={copied} aria-label={`Copy ${label.toLowerCase()}`}>
          {copied ? <Check size={14} strokeWidth={2.5} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: OrderView['status'] }) {
  return <span className="bx-pill" data-status={status} data-order-status={status}>{STATUS_LABEL[status]}</span>;
}

export default function PaymentStep({ order, onChange, onRecreate, busy, error }: {
  order: OrderView;
  /** Back to step 1 (the order stays open). */
  onChange: () => void;
  /** A fresh order with the same plan and network (after this one expired). */
  onRecreate: () => void;
  busy: boolean;
  error: string | null;
}) {
  const now = useNow(1_000);
  const qr = useQrSvg(order.payAddress);
  const { copied, copy } = useCopy();
  const net = networkOf(order.network);
  const left = order.expiresAt - now;
  const expired = order.status === 'expired' || left <= 0;
  const total = Math.max(1, order.expiresAt - order.createdAt);
  const amount = fmtUsdt(order.payAmount, false);

  return (
    <div className="bx-body">
      <div className="bx-main">
        <div className="bx-pay">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div className="bx-qr" data-loading={!qr} data-qr role="img" aria-label={`QR code of the ${net.name} deposit address`}
              // The SVG is generated locally by `qrcode` from the address (paths only, no text).
              dangerouslySetInnerHTML={qr ? { __html: qr } : undefined} />
            <span className="bx-fine">Scan with your wallet</span>
          </div>
          <div className="bx-field-group" style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <CopyField label="Exact amount" field="amount" big value={amount} display={`${fmtUsdt(order.payAmount)} USDT`} copied={copied === 'amount'} onCopy={() => copy('amount', amount)} />
            <CopyField label={`Deposit address · ${net.name} (${net.standard})`} field="address" value={order.payAddress} copied={copied === 'address'} onCopy={() => copy('address', order.payAddress)} />
          </div>
        </div>
        <div className="bx-note" data-tone="warn">
          <TriangleAlert size={16} style={{ flex: 'none', marginTop: 1 }} />
          <span>
            Send only <strong>USDT on {net.name} ({net.standard})</strong> to this address. Other tokens or networks can’t be recovered.
            Send the exact amount, or more: less won’t activate Pro. If your wallet or exchange deducts a withdrawal fee, add it on top.
          </span>
        </div>
      </div>

      <aside className="bx-side" aria-label="Order details">
        <div className="bx-timer" data-tone={expired ? 'over' : left < WARN_MS ? 'warn' : 'ok'} data-countdown>
          <span className="bx-fine">{expired ? 'Payment window closed' : 'Time left to pay'}</span>
          <span className="bx-timer-num" role="timer" aria-live="off" data-countdown-value>{fmtCountdown(expired ? 0 : left)}</span>
          <div className="bx-timer-bar"><span style={{ width: `${expired ? 0 : Math.min(100, (left / total) * 100)}%` }} /></div>
        </div>
        <div>
          <div className="bx-row"><span>Order ID</span><span data-order-id style={{ fontFamily: 'ui-monospace,monospace' }}>{order.id}</span></div>
          <div className="bx-row"><span>Plan</span><span>Pro · {PERIODS[order.period].label}</span></div>
          <div className="bx-row"><span>Network</span><span style={{ display: 'inline-flex', gap: 7, alignItems: 'center' }}><NetworkMark id={order.network} size={16} />{net.name} ({net.standard})</span></div>
          <div className="bx-row"><span>Amount</span><span>{fmtUsdt(order.payAmount)} USDT</span></div>
          <div className="bx-row"><span>Status</span><span><StatusPill status={expired ? 'expired' : order.status} /></span></div>
        </div>
        {expired ? (
          <>
            <div className="bx-note" data-tone="error">
              This order expired. Already sent the funds? Keep this window open: they’ll still be credited once confirmed.
            </div>
            {error && <div className="bx-note" data-tone="error" role="alert">{error}</div>}
            <button type="button" className="bx-btn bx-btn-primary bx-btn-block" onClick={onRecreate} disabled={busy} data-recreate>
              {busy ? 'Creating order…' : 'Create a new order'}
            </button>
          </>
        ) : (
          <div className="bx-note" data-tone="info">
            Waiting for your transfer. This window updates by itself once the network sees it ({net.eta} to confirm).
          </div>
        )}
        <button type="button" className="bx-link" onClick={onChange} style={{ alignSelf: 'center', marginTop: 'auto' }} data-change-plan>Change plan or network</button>
      </aside>
    </div>
  );
}
