/**
 * Pro subscription periods and prices (USD) — the single source for the landing page and
 * checkout. Client-safe.
 */
import { TRIAL_DAYS } from '@/lib/auth/access';

export type Period = 'month' | 'year';

export const PERIODS: Record<Period, { usd: number; days: number; label: string }> = {
  month: { usd: 8, days: 30, label: '1 month' },
  year: { usd: 80, days: 365, label: '1 year' },
};

export const isPeriod = (v: unknown): v is Period => v === 'month' || v === 'year';

export { TRIAL_DAYS };

/** Yearly price per month, rounded down to the cent ($6.66). */
export const yearlyPerMonth = () => Math.floor((PERIODS.year.usd / 12) * 100) / 100;
/** Saving of yearly over 12 monthly payments, in whole percent. */
export const yearlySavingPct = () => Math.round((1 - PERIODS.year.usd / (PERIODS.month.usd * 12)) * 100);
