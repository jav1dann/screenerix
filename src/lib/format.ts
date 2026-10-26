import { COLORS } from './theme';

export type Rng = () => number;

/** Deterministic Park–Miller PRNG — identical output on server and client for the same seed. */
export function createRng(seed: number): Rng {
  let s = (seed % 2147483646) + 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export const lastOf = (a: number[]): number => a[a.length - 1];

export const fmtPrice = (p: number): string => {
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 10) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  if (p >= 0.01) return p.toFixed(5);
  return p.toPrecision(4);
};

export const fmtPct = (x: number, d = 2): string => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;

export const fmtUsd = (v: number): string => {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

export const fmtQty = (q: number): string => {
  if (q >= 1e6) return `${(q / 1e6).toFixed(2)}M`;
  if (q >= 1e3) return `${(q / 1e3).toFixed(1)}K`;
  if (q >= 10) return q.toFixed(1);
  return q.toFixed(3);
};

/** Compact count: 936276 → "936.3K". */
export const fmtCount = (n: number): string => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
};

const pad2 = (n: number) => String(n).padStart(2, '0');
/** Local "YYYY-MM-DD HH:mm". */
export const fmtDateTime = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

export const tone =(x: number): string => (x >= 0 ? COLORS.up : COLORS.down);
export const toneBg = (x: number): string => (x >= 0 ? COLORS.upBg : COLORS.downBg);
export const utcClock = (): string => new Date().toISOString().slice(11, 19);
export const isEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
