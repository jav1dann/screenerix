import type { Dict } from '@/lib/landing/i18n/en';
import { h2, sectionHead } from './styles';

/** Native <details> accordion: keyboard-accessible and works without JS. */
export default function Faq({ t }: { t: Dict['faq'] }) {
  return (
    <section id="faq" className="lx-wrap lx-section lx-faq-wrap">
      <div style={sectionHead} data-reveal>
        <span className="lx-kicker">{t.kicker}</span>
        <h2 style={h2}>{t.title}</h2>
      </div>
      <div className="lx-faq" data-reveal style={{ minWidth: 0, borderTop: '1px solid var(--sx-line)' }}>
        {t.items.map((f) => (
          <details key={f.q} data-faq>
            <summary>{f.q}<span className="lx-faq-mark" aria-hidden="true">+</span></summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
