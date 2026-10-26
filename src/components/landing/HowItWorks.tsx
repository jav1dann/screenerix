import type { CSSProperties } from 'react';
import type { Dict } from '@/lib/landing/i18n/en';
import { h2, sectionHead } from './styles';

export default function HowItWorks({ t }: { t: Dict['how'] }) {
  return (
    <section id="how" className="lx-wrap lx-section">
      <div style={sectionHead} data-reveal>
        <span className="lx-kicker">{t.kicker}</span>
        <h2 style={h2}>{t.title}</h2>
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,230px),1fr))', gap: 16 }}>
        {t.steps.map((s, i) => (
          <li key={s.title} className="lx-glass lx-card" data-reveal data-step style={{ '--d': i, padding: 22, display: 'flex', flexDirection: 'column', gap: 12 } as CSSProperties}>
            <span className="lx-step-num">{i + 1}</span>
            <h3 style={{ fontSize: 16 }}>{s.title}</h3>
            <p className="lx-muted" style={{ fontSize: 14 }}>{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
