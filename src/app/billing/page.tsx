import type { Metadata } from "next";
import { Suspense } from "react";
import BillingPanel from "@/components/billing/BillingPanel";
import { accessNow, requireUser } from "@/lib/auth/dal";
import { ordersOf, toOrderView } from "@/lib/billing/orders";
import { isPeriod } from "@/lib/billing/plans";

export const metadata: Metadata = { title: "Billing — Screenerix" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Plan status, order history and the payment modal (open on arrival). Reachable with an
 * expired trial or Pro period: that's where the terminal sends those accounts.
 */
async function BillingGate({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const period = first(sp.period);
  const back = `/billing${isPeriod(period) ? `?period=${period}` : ""}`;
  const user = await requireUser(back);
  const access = accessNow(user);
  return (
    <BillingPanel
      user={{ name: user.name, email: user.email }}
      access={access}
      orders={ordersOf(user.id).slice(0, 20).map(toOrderView)}
      initialPeriod={isPeriod(period) ? period : undefined}
      expired={access.state === "expired" || first(sp.expired) === "1"}
    />
  );
}

export default function BillingPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<main className="bx-page" aria-busy="true" />}>
      <BillingGate searchParams={searchParams} />
    </Suspense>
  );
}
