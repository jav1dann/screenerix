import { ExchangeIcon } from '@/components/shared/brand/BrandIcon';
import { EXCHANGE_NAMES } from '@/lib/landing/content';
import { COLORS } from '@/lib/theme';

/** "Live data from" + each exchange's logo and name. */
export default function ExchangesStrip({ label }: { label: string }) {
  return (
    <section className="lx-wrap" data-reveal style={{ paddingBottom: 96 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '14px 40px', padding: '20px 24px', borderTop: `1px solid ${COLORS.line}`, borderBottom: `1px solid ${COLORS.line}` }}>
        <span className="lx-muted" style={{ fontSize: 13 }}>{label}</span>
        {EXCHANGE_NAMES.map((n) => (
          <span key={n} data-exchange style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em', color: '#B9BBC4' }}><ExchangeIcon name={n} size={22} />{n}</span>
        ))}
      </div>
    </section>
  );
}
