import { sparkPoints } from '@/lib/charts';

export default function Sparkline({ values, color, width = 60, height = 20 }: { values: number[]; color: string; width?: number; height?: number }) {
  return (
    <svg viewBox="0 0 88 22" preserveAspectRatio="none" style={{ width, height, display: 'block' }} aria-hidden="true">
      <polyline points={sparkPoints(values, 88, 22)} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
