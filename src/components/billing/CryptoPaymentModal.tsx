'use client';

/**
 * Crypto payment modal: 1. Choose a plan (period + USDT network, live summary) → 2. Payment
 * (deposit address, QR, exact amount, countdown) → 3. Status (live via SSE / polling until the
 * webhook confirms it). Reopening resumes the account's open order.
 */
import { X } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { createCryptoOrder, currentCryptoOrder } from '@/app/actions/billing';
import type { NetworkId } from '@/lib/billing/networks';
import type { OrderView } from '@/lib/billing/orders';
import type { Period } from '@/lib/billing/plans';
import { useLiveOrder } from './hooks';
import PaymentStep from './PaymentStep';
import PlanStep from './PlanStep';
import StatusStep from './StatusStep';
import Stepper from './Stepper';

export interface CryptoPaymentModalProps {
  initialPeriod?: Period;
  onClose: () => void;
  /** Once, when the order is confirmed (e.g. refresh the session's plan). */
  onPaid?: (order: OrderView) => void;
  /** "Open terminal" target on the success step; null inside the terminal. */
  terminalHref?: string | null;
}

export default function CryptoPaymentModal({ initialPeriod, onClose, onPaid, terminalHref = '/terminal' }: CryptoPaymentModalProps) {
  const [period, setPeriod] = useState<Period>(initialPeriod ?? 'year');
  const [network, setNetwork] = useState<NetworkId>('trc20');
  const [order, setOrder] = useState<OrderView | null>(null);
  /** Back on step 1 while an order is open. */
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const live = useLiveOrder(order);

  // Resume the open order (unless the visitor came for a different period).
  useEffect(() => {
    let on = true;
    currentCryptoOrder().then((o) => {
      if (!on || !o || (initialPeriod && o.period !== initialPeriod)) return;
      setOrder((cur) => cur ?? o);
      setPeriod(o.period);
      setNetwork(o.network);
    }).catch(() => { /* start fresh */ });
    return () => { on = false; };
  }, [initialPeriod]);

  const paidOnce = useRef<string | null>(null);
  const announcePaid = useEffectEvent((o: OrderView) => onPaid?.(o));
  useEffect(() => {
    if (live?.status === 'paid' && paidOnce.current !== live.id) {
      paidOnce.current = live.id;
      announcePaid(live);
    }
  }, [live]);

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onClose();
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const create = (p: Period, n: NetworkId) => startTransition(async () => {
    setError(null);
    try {
      const r = await createCryptoOrder(p, n);
      if (r.ok) { setOrder(r.data); setEditing(false); } else setError(r.error);
    } catch {
      setError('Couldn’t reach the server. Check your connection and try again.');
    }
  });

  const stage: 'plan' | 'payment' | 'status' = !live || editing ? 'plan' : live.status === 'waiting' || live.status === 'expired' ? 'payment' : 'status';
  const step = stage === 'plan' ? 0 : stage === 'payment' ? 1 : live?.status === 'paid' ? 3 : 2;
  const openOrder = live && !editing ? null : live && (live.status === 'waiting' || live.status === 'confirming' || live.status === 'partially_paid') ? live : null;

  return createPortal(
    <div className="bx-overlay" data-billing-modal data-stage={stage}>
      <button type="button" className="bx-backdrop" aria-label="Close" onClick={onClose} />
      <div className="bx-modal" role="dialog" aria-modal="true" aria-labelledby="bx-title">
        <div className="bx-head">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="bx-title" id="bx-title">Upgrade to Pro</span>
            <span className="bx-sub">Pay with USDT · 6 networks</span>
          </div>
          <button type="button" className="bx-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <Stepper current={step as 0 | 1 | 2 | 3} />
        {stage === 'plan' && (
          <PlanStep
            period={period}
            network={network}
            onPeriod={setPeriod}
            onNetwork={setNetwork}
            onContinue={() => create(period, network)}
            busy={busy}
            error={error}
            resume={openOrder ? () => { setEditing(false); setError(null); } : undefined}
          />
        )}
        {stage === 'payment' && live && (
          <PaymentStep order={live} onChange={() => { setEditing(true); setError(null); }} onRecreate={() => create(live.period, live.network)} busy={busy} error={error} />
        )}
        {stage === 'status' && live && (
          <StatusStep order={live} onRetry={() => { setOrder(null); setEditing(false); }} onDone={onClose} terminalHref={terminalHref} />
        )}
      </div>
    </div>,
    document.body,
  );
}
