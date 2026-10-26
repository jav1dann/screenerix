/** Checkout formatting (client-safe; dates in UTC so server and browser render the same). */

/** 100 → "100.00", 12.3456789 → "12.345679" (up to 6 decimals, at least 2). */
export const fmtUsdt = (n: number, grouping = true): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6, useGrouping: grouping });

export const fmtUsd2 = (n: number): string => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "24 Oct 2027" */
export const fmtDay = (ms: number): string => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** 5_400_000 → "90:00"; minutes are not capped at 59. */
export const fmtCountdown = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
