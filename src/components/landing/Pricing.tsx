'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { IconCheck } from '@/components/shared/icons';
import type { Period } from '@/lib/billing/plans';
import { PRICING, yearlyPerMonth, yearlySavingPct } from '@/lib/landing/content';
import type { Dict } from '@/lib/landing/i18n/en';
import { fill } from '@/lib/landing/i18n/locales';
import { COLORS } from '@/lib/theme';
import { h2, sectionHead } from './styles';

type Billing = 'monthly' | 'yearly';

const priceStyle: CSSProperties = { fontWeight: 800, fontSize: 48, letterSpacing: '-0.04em', lineHeight: 1 };

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14, flex: 1 }}>
      {items.map((f) => <li key={f} style={{ display: 'flex', gap: 10 }}><span style={{ marginTop: 3 }}><IconCheck /></span>{f}</li>)}
    </ul>
  );
}

/** Two options: the free trial and Pro (monthly or yearly), both with everything included. */
export default function Pricing({ t, onSelect, onSelectPro }: { t: Dict['pricing']; onSelect: () => void; onSelectPro: (period: Period) => void }) {
  const [billing, setBilling] = useState<Billing>('yearly');
  const yearly = billing === 'yearly';
  const perMonth = yearly ? yearlyPerMonth() : PRICING.monthly;

  return (
    <section id="pricing" className="lx-wrap lx-section">
      <div style={{ ...sectionHead, alignSelf: 'center', alignItems: 'center', textAlign: 'center' }} data-reveal>
        <span className="lx-kicker">{t.kicker}</span>
        <h2 style={h2}>{t.title}</h2>
        <p className="lx-muted" style={{ fontSize: 16 }}>{t.subtitle}</p>
        <div className="lx-seg" role="radiogroup" aria-label={t.kicker} style={{ marginTop: 8, width: 300 }} data-billing={billing}>
          <button type="button" role="radio" aria-checked={!yearly} className="lx-seg-opt" data-active={!yearly} onClick={() => setBilling('monthly')}>{t.monthly}</button>
          <button type="button" role="radio" aria-checked={yearly} className="lx-seg-opt" data-active={yearly} onClick={() => setBilling('yearly')} style={{ display: 'inline-flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
            {t.yearly}<span className="lx-tag" style={{ padding: '1px 6px', background: COLORS.upBg, color: COLORS.up }}>{fill(t.save, { pct: yearlySavingPct() })}</span>
          </button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 16, alignItems: 'stretch', maxWidth: 860, width: '100%', alignSelf: 'center' }}>
        <div className="lx-glass" data-plan="trial" data-reveal style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.muted }}>{t.trialName}</span>
            <span className="lx-tag" style={{ background: 'rgba(255,255,255,0.06)', color: COLORS.text }}>{t.everything}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={priceStyle}>$0</span>
            <span className="lx-muted">{t.trialPeriod}</span>
          </div>
          <p className="lx-muted" style={{ fontSize: 14 }}>{t.trialBlurb}</p>
          <div style={{ height: 1, background: COLORS.line }} />
          <FeatureList items={t.features} />
          <button className="lx-btn" onClick={onSelect}>{t.trialCta}</button>
        </div>
        <div className="lx-glass lx-card-pro" data-plan="pro" data-reveal style={{ '--d': 1, display: 'flex', flexDirection: 'column', gap: 20, padding: 28 } as CSSProperties}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t.proName}</span>
            <span className="lx-tag" style={{ background: COLORS.upBg, color: COLORS.up }}>{yearly ? t.popular : t.everything}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={priceStyle} data-price>${perMonth}</span>
              <span className="lx-muted">{t.perMonth}</span>
            </div>
            <span className="lx-muted" style={{ fontSize: 13 }} data-billed>{yearly ? fill(t.billedYearly, { total: `$${PRICING.yearly}` }) : t.billedMonthly}</span>
          </div>
          <p className="lx-muted" style={{ fontSize: 14 }}>{t.proBlurb}</p>
          <div style={{ height: 1, background: COLORS.line }} />
          <FeatureList items={t.features} />
          <button className="lx-btn lx-btn-primary lx-cta-glow" onClick={() => onSelectPro(yearly ? 'year' : 'month')} data-pro-cta>{t.proCta}</button>
        </div>
      </div>
    </section>
  );
}
