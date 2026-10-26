'use client';

import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { billingUi, closeBilling } from '@/lib/billing/billingUi';
import CryptoPaymentModal from './CryptoPaymentModal';

/** The payment modal inside the terminal, opened with `openBilling()` (profile menu). */
export default function BillingModalHost() {
  const ui = useSyncExternalStore(billingUi.subscribe, billingUi.getSnapshot, billingUi.getServerSnapshot);
  const router = useRouter();
  if (!ui.open) return null;
  // Paid: re-render the server components so the session's plan and end date update.
  return <CryptoPaymentModal initialPeriod={ui.period} onClose={closeBilling} onPaid={() => router.refresh()} terminalHref={null} />;
}
