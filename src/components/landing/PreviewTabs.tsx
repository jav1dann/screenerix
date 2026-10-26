'use client';

import { useState } from 'react';
import { sparkPoints } from '@/lib/charts';
import { fmtPct, fmtPrice, lastOf, tone, toneBg } from '@/lib/format';
import { previewBook } from '@/lib/landing/content';
import type { PreviewAsset } from '@/lib/landing/content';
import type { Dict } from '@/lib/landing/i18n/en';
import { COLORS } from '@/lib/theme';
import { h2, sectionHead } from './styles';

type Tab = 'map' | 'densities' | 'review';
const TABS: Tab[] = ['map', 'densities', 'review'];
/** Fixed per-coin volumes and spike ratios for the mockups (the feed only moves prices). */
const VOL = [1840, 1210, 612, 288, 402, 230, 96, 141];
const SPIKE = [1.2, 1.6, 4.8, 0.9, 2.3, 3.1, 1.1, 1.4];

const change5 = (h: number[]) => lastOf(h) / h[h.length - 6] - 1;

function MapView({ assets }: { assets: PreviewAsset[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8, padding: 12 }}>
      {assets.map((a, i) => {
        const c = change5(a.history);
        const sp = a.history.slice(-36);
        return (
          <div key={a.symbol} className="lx-inset" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, borderColor: SPIKE[i] > 3 ? 'rgba(48,164,108,0.5)' : undefined }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 700 }}>{a.symbol}</span>
              <span style={{ color: tone(c) }}>{fmtPct(c)}</span>
            </div>
            <svg viewBox="0 0 120 34" preserveAspectRatio="none" style={{ width: '100%', height: 34, display: 'block' }} aria-hidden="true">
              <polyline points={sparkPoints(sp, 120, 34)} fill="none" stroke={tone(lastOf(sp) - sp[0])} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="lx-muted" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span>${VOL[i]}M</span>
              <span style={{ color: SPIKE[i] > 3 ? COLORS.up : undefined }}>×{SPIKE[i].toFixed(1)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DensitiesView({ assets, t }: { assets: PreviewAsset[]; t: Dict['preview'] }) {
  const coins = [assets[0], assets[2], assets[5]];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, padding: 12 }}>
      {coins.map((a, k) => {
        const mid = lastOf(a.history);
        const book = previewBook(mid, 5, mid * 0.0009, 19 + k * 7);
        const max = Math.max(...book.map((b) => b.size));
        return (
          <div key={a.symbol} className="lx-inset" style={{ padding: 10, fontSize: 11, lineHeight: 1.4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: 12, marginBottom: 6 }}>
              <span>{a.symbol}/USDT</span><span style={{ color: a.dir > 0 ? COLORS.up : COLORS.down }}>{fmtPrice(mid)}</span>
            </div>
            {book.map((b, i) => (
              <div key={i} style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, padding: '1px 6px' }}>
                <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${((b.size / max) * 100).toFixed(0)}%`, borderRadius: 3, background: b.ask ? (b.wall ? 'rgba(229,72,77,0.38)' : 'rgba(229,72,77,0.11)') : b.wall ? 'rgba(48,164,108,0.36)' : 'rgba(48,164,108,0.09)' }} />
                <span style={{ position: 'relative', color: b.ask ? COLORS.down : COLORS.up }}>{fmtPrice(b.price)}</span>
                <span style={{ position: 'relative', fontWeight: b.wall ? 700 : 400 }}>${b.size.toFixed(0)}K</span>
                <span className="lx-muted" style={{ position: 'relative', minWidth: 44, textAlign: 'right' }}>{b.wall ? t.wall : `${(((b.price - mid) / mid) * 100).toFixed(2)}%`}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ReviewView({ assets, t }: { assets: PreviewAsset[]; t: Dict['preview'] }) {
  const cols = '1fr 1fr 0.8fr 0.8fr 0.7fr 72px';
  const rows = assets.map((a, i) => ({ a, i, c: change5(a.history) })).sort((x, y) => SPIKE[y.i] - SPIKE[x.i]);
  return (
    <div style={{ fontSize: 12, overflowX: 'auto' }}>
      <div style={{ minWidth: 520 }}>
        <div className="lx-muted" style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '10px 14px', fontSize: 11, borderBottom: `1px solid ${COLORS.line}` }}>
          <span>{t.cols.symbol}</span><span>{t.cols.price}</span><span>{t.cols.change}</span><span>{t.cols.volume}</span><span>{t.cols.spike} ▾</span><span />
        </div>
        {rows.map(({ a, i, c }) => {
          const sp = a.history.slice(-30);
          return (
            <div key={a.symbol} style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, alignItems: 'center', padding: '7px 14px', borderBottom: '1px solid rgba(30,32,36,0.6)' }}>
              <span style={{ fontWeight: 600 }}>{a.symbol}</span>
              <span style={{ color: a.dir > 0 ? COLORS.up : COLORS.down }}>{fmtPrice(lastOf(a.history))}</span>
              <span style={{ color: tone(c) }}>{fmtPct(c)}</span>
              <span>${VOL[i]}M</span>
              <span><span className="lx-tag" style={{ padding: '1px 7px', background: SPIKE[i] > 3 ? toneBg(1) : 'rgba(255,255,255,0.05)', color: SPIKE[i] > 3 ? COLORS.up : COLORS.text }}>×{SPIKE[i].toFixed(1)}</span></span>
              <svg viewBox="0 0 72 20" style={{ width: 64, height: 20, display: 'block' }} aria-hidden="true">
                <polyline points={sparkPoints(sp, 72, 20)} fill="none" stroke={tone(lastOf(sp) - sp[0])} strokeWidth={1.4} strokeLinejoin="round" />
              </svg>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** "Live preview": simulated Market Map / Densities / Market Review modules, fed by the preview feed. */
export default function PreviewTabs({ t, assets }: { t: Dict['preview']; assets: PreviewAsset[] }) {
  const [tab, setTab] = useState<Tab>('map');
  return (
    <section id="preview" className="lx-wrap lx-section">
      <div style={sectionHead} data-reveal>
        <span className="lx-kicker">{t.kicker}</span>
        <h2 style={h2}>{t.title}</h2>
        <p className="lx-muted" style={{ fontSize: 16 }}>{t.subtitle}</p>
      </div>
      <div data-reveal style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="lx-seg" data-cols="3" role="tablist" aria-label={t.kicker} style={{ alignSelf: 'flex-start', width: 'min(100%,460px)' }}>
          {TABS.map((k) => (
            <button key={k} type="button" role="tab" id={`pv-tab-${k}`} aria-controls="pv-panel" aria-selected={tab === k} className="lx-seg-opt" data-active={tab === k} onClick={() => setTab(k)}>{t.tabs[k]}</button>
          ))}
        </div>
        <div className="lx-glass" id="pv-panel" role="tabpanel" aria-labelledby={`pv-tab-${tab}`} data-preview={tab} style={{ overflow: 'hidden', boxShadow: '0 30px 90px rgba(0,0,0,0.5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: `1px solid ${COLORS.line}`, fontSize: 12 }}>
            <span className="lx-pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: COLORS.up, boxShadow: `0 0 8px ${COLORS.up}` }} />
            <span className="lx-muted">{t.captions[tab]}</span>
          </div>
          <div style={{ minHeight: 300 }}>
            {tab === 'map' && <MapView assets={assets} />}
            {tab === 'densities' && <DensitiesView assets={assets} t={t} />}
            {tab === 'review' && <ReviewView assets={assets} t={t} />}
          </div>
        </div>
      </div>
    </section>
  );
}
