import { ExchangeIcon } from '@/components/shared/brand/BrandIcon';
import { fmtPrice, lastOf } from '@/lib/format';
import { previewBook } from '@/lib/landing/content';
import type { PreviewAsset } from '@/lib/landing/content';
import { COLORS } from '@/lib/theme';

/** Floating order-book snippet and alert chip around the hero mockup (wide screens only). */
export default function HeroVisual({ assets, spikeLabel }: { assets: PreviewAsset[]; spikeLabel: string }) {
  const sol = assets[2];
  const mid = lastOf(sol.history);
  const book = previewBook(mid, 3, 0.06);
  const max = Math.max(...book.map((b) => b.size));
  return (
    <>
      <div className="lx-glass lx-float lx-hide-sm" aria-hidden="true" style={{ position: 'absolute', left: 28, bottom: -34, zIndex: 2, width: 200, padding: 10, background: 'rgba(17,18,21,0.94)', fontSize: 11, lineHeight: 1.35, boxShadow: '0 24px 60px rgba(0,0,0,0.55)', animationDelay: '-2s' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontWeight: 600 }}>
          <span>SOL · Depth</span><span style={{ color: sol.dir > 0 ? COLORS.up : COLORS.down }}>{fmtPrice(mid)}</span>
        </div>
        {book.map((b, i) => (
          <div key={i} style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', padding: '1px 6px' }}>
            <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${((b.size / max) * 100).toFixed(0)}%`, borderRadius: 3, background: b.ask ? (b.wall ? 'rgba(229,72,77,0.38)' : 'rgba(229,72,77,0.12)') : b.wall ? 'rgba(48,164,108,0.36)' : 'rgba(48,164,108,0.10)' }} />
            <span style={{ position: 'relative', color: b.ask ? COLORS.down : COLORS.up }}>{b.price.toFixed(2)}</span>
            <span style={{ position: 'relative' }}>${b.size.toFixed(0)}K</span>
          </div>
        ))}
      </div>
      <div className="lx-glass lx-float lx-hide-sm" aria-hidden="true" style={{ position: 'absolute', right: 150, top: -30, zIndex: 2, background: 'rgba(17,18,21,0.94)', display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px', fontSize: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(48,164,108,0.25)' }}>
        <span className="lx-pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: COLORS.up, boxShadow: `0 0 10px ${COLORS.up}` }} />
        <span style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 600 }}>WIF · {spikeLabel}</span>
          <span className="lx-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>×4.8 · 1m · <ExchangeIcon id="bybit" size={11} />Bybit</span>
        </span>
      </div>
    </>
  );
}
