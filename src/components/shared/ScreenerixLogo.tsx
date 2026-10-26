import { COLORS } from '@/lib/theme';

export default function ScreenerixLogo({ size = 26, fontSize = 14, wordmark = true }: { size?: number; fontSize?: number; wordmark?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <svg width={size} height={size} viewBox="300 240 650 760" aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
        <g fill={COLORS.text} stroke={COLORS.text} strokeWidth={22} strokeLinejoin="round">
          <path d="M402 578 509 634 509 940 402 884Z" />
          <path d="M572 408 682 466 682 846 572 788Z" />
          <path d="M746 310 852 366 852 680 746 624Z" />
        </g>
      </svg>
      {wordmark && (
        <span style={{ fontWeight: 800, fontSize, letterSpacing: '0.08em', color: COLORS.text }}>
          SCREENER<span style={{ color: COLORS.up }}>IX</span>
        </span>
      )}
    </span>
  );
}
