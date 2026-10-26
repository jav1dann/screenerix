import { IconArrow } from '@/components/shared/icons';
import type { Dict } from '@/lib/landing/i18n/en';
import { COLORS } from '@/lib/theme';

export default function ClosingCta({ t, onStart }: { t: Dict['cta']; onStart: () => void }) {
  return (
    <section className="lx-wrap" style={{ paddingBottom: 80 }} data-reveal>
      <div style={{ position: 'relative', overflow: 'hidden', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 24, padding: 40, borderRadius: 16, background: 'radial-gradient(120% 140% at 0% 0%, rgba(48,164,108,0.18), rgba(17,18,21,0.7) 55%)', border: `1px solid ${COLORS.line}` }}>
        <div aria-hidden="true" className="lx-grid-bg" style={{ height: '100%', opacity: 0.6 }} />
        <h2 style={{ position: 'relative', fontSize: 'clamp(28px,3.2vw,40px)', letterSpacing: '-0.03em', flex: '1 1 420px' }}>{t.title}</h2>
        <button className="lx-btn lx-btn-lg lx-btn-primary lx-cta-glow" style={{ position: 'relative' }} onClick={onStart}>{t.button} <IconArrow /></button>
      </div>
    </section>
  );
}
