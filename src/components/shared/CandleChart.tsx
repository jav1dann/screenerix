import { COLORS } from '@/lib/theme';
import type { CandleGeometry } from '@/lib/market/types';

const DEFAULT_GRID = 'M0 55H600M0 110H600M0 165H600M150 0V220M300 0V220M450 0V220';

export default function CandleChart({ g, height, grid = DEFAULT_GRID }: { g: CandleGeometry; height: number; grid?: string }) {
  return (
    <svg viewBox="0 0 600 266" preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }} aria-hidden="true">
      <path d={grid} stroke={COLORS.line} vectorEffect="non-scaling-stroke" />
      <path d={g.upVol} fill="rgba(48,164,108,0.28)" />
      <path d={g.downVol} fill="rgba(229,72,77,0.28)" />
      <path d={g.upWick} stroke={COLORS.up} vectorEffect="non-scaling-stroke" />
      <path d={g.upBody} fill={COLORS.up} />
      <path d={g.downWick} stroke={COLORS.down} vectorEffect="non-scaling-stroke" />
      <path d={g.downBody} fill={COLORS.down} />
      <line x1={0} x2={600} y1={g.lastY} y2={g.lastY} stroke={COLORS.muted} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
