import type { CSSProperties } from 'react';
import { IconArrow } from '@/components/shared/icons';
import type { PreviewAsset } from '@/lib/landing/content';
import type { Dict } from '@/lib/landing/i18n/en';
import type { Candle } from '@/lib/market/types';
import { COLORS } from '@/lib/theme';
import HeroVisual from './HeroVisual';
import ProductPreview from './ProductPreview';

const rise = (d: number) => ({ '--d': d }) as CSSProperties;

export default function Hero({ t, assets, candles, onLaunch, onRegister }: { t: Dict['hero']; assets: PreviewAsset[]; candles: Candle[]; onLaunch: () => void; onRegister: () => void }) {
  return (
    <section id="top" className="lx-wrap" style={{ position: 'relative', paddingTop: 88, paddingBottom: 72, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 26 }}>
      <a href="#features" className="lx-glass lx-muted lx-rise" style={{ ...rise(0), display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px 5px 6px', borderRadius: 999, fontSize: 12 }}>
        <span className="lx-tag" style={{ background: COLORS.upBg, color: COLORS.up, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="lx-pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: COLORS.up }} />LIVE
        </span>
        {t.badge}
      </a>
      <h1 className="lx-rise" style={{ ...rise(1), fontSize: 'clamp(40px,6vw,80px)', lineHeight: 1.02, letterSpacing: '-0.04em', maxWidth: 980, textWrap: 'balance' } as CSSProperties}>
        {t.title}
      </h1>
      <p className="lx-muted lx-rise" style={{ ...rise(2), fontSize: 18, maxWidth: 620, textWrap: 'pretty' } as CSSProperties}>
        {t.subtitle}
      </p>
      <div className="lx-rise" style={{ ...rise(3), display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button className="lx-btn lx-btn-lg lx-btn-primary lx-cta-glow" onClick={onLaunch}>{t.launch} <IconArrow /></button>
        <button className="lx-btn lx-btn-lg" onClick={onRegister}>{t.trial}</button>
      </div>
      <span className="lx-muted lx-rise" style={{ ...rise(4), fontSize: 13, marginTop: -12 }}>{t.note}</span>
      <div className="lx-rise" style={{ ...rise(5), position: 'relative', width: '100%', marginTop: 28, textAlign: 'left' }}>
        <HeroVisual assets={assets} spikeLabel={t.spike} />
        <ProductPreview assets={assets} candles={candles} onLaunch={onLaunch} label={t.openPreview} />
      </div>
    </section>
  );
}
