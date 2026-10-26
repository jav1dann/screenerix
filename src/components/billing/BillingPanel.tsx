'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import ScreenerixLogo from '@/components/shared/ScreenerixLogo';
import type { AccessState } from '@/lib/auth/access';
import { fmtDay, fmtUsdt } from '@/lib/billing/format';
import { networkOf } from '@/lib/billing/networks';
import type { OrderView } from '@/lib/billing/orders';
import { PERIODS } from '@/lib/billing/plans';
import type { Period } from '@/lib/billing/plans';
import CryptoPaymentModal from './CryptoPaymentModal';
import { StatusPill } from './PaymentStep';

const noSubscribe = () => () => {};

const STATE_TEXT: Record<AccessState, string> = {
  admin: 'Admin: full access, no subscription needed',
  pro: 'Pro',
  trial: 'Free trial',
  expired: 'No active plan',
};

/** /billing: where the account stands, its orders, and the payment modal. */
export default function BillingPanel({ user, access, orders, initialPeriod, expired }: {
  user: { name: string; email: string };
  access: { state: AccessState; until?: number };
  orders: OrderView[];
  initialPeriod?: Period;
  expired: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  // The modal is portalled into <body>: only once the page is in the browser.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const canUseTerminal = access.state !== 'expired';

  return (
    <main className="bx-page" data-billing-page data-access={access.state}>
      <div className="bx-page-wrap">
        <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" aria-label="Screenerix home"><ScreenerixLogo size={26} fontSize={15} /></Link>
          <span style={{ marginLeft: 'auto' }} />
          {canUseTerminal && <Link href="/terminal" className="bx-btn">Open terminal</Link>}
        </header>

        {expired && access.state === 'expired' && (
          <div className="bx-note" data-tone="warn" role="status" data-expired-banner>
            {access.until ? `Your plan ended on ${fmtDay(access.until)}.` : 'Your free trial has ended.'} Upgrade to Pro to keep using the terminal.
          </div>
        )}

        <section className="bx-card" style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: '1 1 260px' }}>
            <span className="bx-label" style={{ marginBottom: 0 }}>Your plan</span>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }} data-plan-state>{STATE_TEXT[access.state]}</span>
            <span className="bx-muted" style={{ fontSize: 13 }}>
              {access.state === 'pro' && access.until ? `Active until ${fmtDay(access.until)} · ` : ''}
              {access.state === 'trial' && access.until ? `Ends ${fmtDay(access.until)} · ` : ''}
              {user.email}
            </span>
          </div>
          <button type="button" className="bx-btn bx-btn-primary" onClick={() => setOpen(true)} data-billing-open>
            {access.state === 'pro' ? 'Extend Pro' : 'Upgrade to Pro'}
          </button>
        </section>

        <section className="bx-card">
          <div className="bx-label">Payments</div>
          {orders.length ? (
            <div className="bx-scroll">
              <table className="bx-table" data-orders>
                <thead><tr><th>Order</th><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td style={{ fontFamily: 'ui-monospace,monospace' }}>{o.id}</td>
                      <td>{fmtDay(o.createdAt)}</td>
                      <td>Pro · {PERIODS[o.period].label}</td>
                      <td>{fmtUsdt(o.payAmount)} USDT <span className="bx-muted">· {networkOf(o.network).standard}</span></td>
                      <td><StatusPill status={o.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="bx-muted" style={{ margin: 0 }}>No payments yet.</p>}
        </section>
        <p className="bx-fine" style={{ margin: 0 }}>
          Questions about a payment? Contact support with your order ID. See the <Link href="/refunds">Refund Policy</Link> and <Link href="/terms">Terms</Link>.
        </p>
      </div>
      {mounted && open && (
        <CryptoPaymentModal initialPeriod={initialPeriod} onClose={() => { setOpen(false); router.refresh(); }} onPaid={() => router.refresh()} />
      )}
    </main>
  );
}
