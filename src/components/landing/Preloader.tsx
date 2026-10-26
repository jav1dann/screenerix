import type { CSSProperties } from 'react';
import ScreenerixLogo from '@/components/shared/ScreenerixLogo';
import type { Dict } from '@/lib/landing/i18n/en';
import { COLORS } from '@/lib/theme';

/** A short rally drawn candle by candle: [open, close, high, low] on a 0–100 scale. */
const CANDLES: ReadonlyArray<readonly [number, number, number, number]> = [
  [20, 34, 38, 14], [34, 28, 37, 24], [28, 46, 50, 26], [46, 40, 49, 35], [40, 58, 62, 38], [58, 52, 61, 46],
  [52, 70, 74, 50], [70, 63, 72, 58], [63, 80, 85, 61], [80, 74, 83, 70], [74, 92, 96, 72],
];
const W = 300;
const H = 140;
const STEP = W / CANDLES.length;
const y = (v: number) => H - 6 - (v / 100) * (H - 12);
const CLOSES = CANDLES.map(([, c], i) => `${(i * STEP + STEP / 2).toFixed(1)},${y(c).toFixed(1)}`).join(' ');

/**
 * Entrance overlay (~2.6s): a candlestick chart forms candle by candle under a glowing price
 * line, the logo pulses, status lines step through and a progress bar fills, then the overlay
 * fades out as the hero rises. Pure CSS — it always ends, needs no JS, and is skipped with
 * reduced motion (see `.lx-preloader` in landing.css).
 */
export default function Preloader({ t }: { t: Dict['preloader'] }) {
  return (
    <div className="lx-preloader" aria-hidden="true" data-preloader>
      <div className="lx-pre-grid" />
      <div className="lx-pre-glow" />
      <div className="lx-preloader-inner">
        <div className="lx-pre-logo"><ScreenerixLogo size={44} fontSize={20} /></div>
        <svg className="lx-pre-chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} className="lx-pre-gridline" />)}
          {CANDLES.map(([o, c, h, l], i) => {
            const up = c >= o;
            const x = i * STEP + STEP / 2;
            const top = y(Math.max(o, c));
            const color = up ? COLORS.up : COLORS.down;
            return (
              <g key={i} className="lx-pre-candle" style={{ '--i': i } as CSSProperties}>
                <line x1={x} x2={x} y1={y(h)} y2={y(l)} stroke={color} strokeWidth={1.4} />
                <rect x={x - STEP * 0.3} y={top} width={STEP * 0.6} height={Math.max(2, y(Math.min(o, c)) - top)} rx={1.5} fill={color} />
              </g>
            );
          })}
          <polyline points={CLOSES} pathLength={1} className="lx-pre-line" />
          <circle cx={(CANDLES.length - 1) * STEP + STEP / 2} cy={y(CANDLES[CANDLES.length - 1][1])} r={3.5} className="lx-pre-dot" />
        </svg>
        <div className="lx-pre-status">
          {t.steps.map((s, i) => <span key={s} style={{ '--i': i } as CSSProperties} data-last={i === t.steps.length - 1 || undefined}>{s}</span>)}
        </div>
        <div className="lx-pre-bar"><span /></div>
        <span className="lx-pre-pct">{t.label}</span>
      </div>
    </div>
  );
}
