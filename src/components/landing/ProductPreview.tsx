import CandleChart from '@/components/shared/CandleChart';
import ScreenerixLogo from '@/components/shared/ScreenerixLogo';
import { ExchangeIcon } from '@/components/shared/brand/BrandIcon';
import { candleGeometry, sparkPoints } from '@/lib/charts';
import { fmtPct, fmtPrice, lastOf, tone } from '@/lib/format';
import type { PreviewAsset } from '@/lib/landing/content';
import type { Candle } from '@/lib/market/types';
import { COLORS } from '@/lib/theme';

const COLS = '1fr 1fr 0.8fr 0.8fr 64px';
const GRID = 'M0 55H600M0 110H600M0 165H600M0 220H600';

export default function ProductPreview({ assets, candles, onLaunch, label }: { assets: PreviewAsset[]; candles: Candle[]; onLaunch: () => void; label: string }) {
  const g = candleGeometry(candles);
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', left: '10%', right: '10%', top: '10%', bottom: '30%', background: 'radial-gradient(closest-side, rgba(48,164,108,0.16), transparent)', filter: 'blur(30px)', pointerEvents: 'none' }} />
      <button onClick={onLaunch} aria-label={label} style={{ position: 'relative', display: 'block', width: '100%', textAlign: 'left', color: 'inherit', cursor: 'pointer', padding: 8, borderRadius: 18, background: 'rgba(255,255,255,0.025)', border: `1px solid ${COLORS.line}`, boxShadow: '0 40px 120px rgba(0,0,0,0.6)' }}>
        <div style={{ borderRadius: 12, overflow: 'hidden', background: 'rgba(17,18,21,0.75)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${COLORS.line}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderBottom: `1px solid ${COLORS.line}`, fontSize: 12 }}>
            <span style={{ marginRight: 8 }}><ScreenerixLogo size={18} fontSize={11} /></span>
            <span style={{ padding: '4px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.06)', fontWeight: 600 }}>Market Review</span>
            <span className="lx-muted" style={{ padding: '4px 10px' }}>Market Map</span>
            <span className="lx-muted" style={{ padding: '4px 10px' }}>Densities</span>
            <span className="lx-muted" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="lx-pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: COLORS.up, boxShadow: `0 0 8px ${COLORS.up}` }} />LIVE
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 360px', minWidth: 0, fontSize: 12, borderRight: `1px solid ${COLORS.line}` }}>
              <div className="lx-muted" style={{ display: 'grid', gridTemplateColumns: COLS, gap: 8, padding: '10px 14px', fontSize: 11, borderBottom: `1px solid ${COLORS.line}` }}>
                <span>Symbol</span><span>Price</span><span>1m</span><span>5m</span><span>Trend</span>
              </div>
              {assets.map((a) => {
                const h = a.history;
                const p = lastOf(h);
                const c1 = p / h[h.length - 2] - 1;
                const c5 = p / h[h.length - 6] - 1;
                const sp = h.slice(-30);
                return (
                  <div key={a.symbol} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 8, alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid rgba(30,32,36,0.6)' }}>
                    <span style={{ fontWeight: 600 }}>{a.symbol}</span>
                    <span style={{ color: a.dir > 0 ? COLORS.up : COLORS.down }}>{fmtPrice(p)}</span>
                    <span style={{ color: tone(c1) }}>{fmtPct(c1)}</span>
                    <span style={{ color: tone(c5) }}>{fmtPct(c5)}</span>
                    <svg viewBox="0 0 72 20" style={{ width: 64, height: 20, display: 'block' }} aria-hidden="true">
                      <polyline points={sparkPoints(sp, 72, 20)} fill="none" stroke={tone(lastOf(sp) - sp[0])} strokeWidth={1.4} strokeLinejoin="round" />
                    </svg>
                  </div>
                );
              })}
            </div>
            <div style={{ flex: '1.5 1 520px', minWidth: 0, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
                <span style={{ fontWeight: 800, fontSize: 16 }}>BTC/USDT</span>
                <span className="lx-muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5, alignSelf: 'center' }}>1h · <ExchangeIcon id="binance" size={12} />Binance Perp</span>
                <span style={{ marginLeft: 'auto', fontSize: 20, fontWeight: 600 }}>{g.last}</span>
                <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, color: tone(g.change), background: g.change >= 0 ? COLORS.upBg : COLORS.downBg }}>{fmtPct(g.change)}</span>
              </div>
              <CandleChart g={g} height={290} grid={GRID} />
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}
