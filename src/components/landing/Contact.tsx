import type { CSSProperties, ReactNode } from 'react';
import { IconArrow, IconMail, IconSend } from '@/components/shared/icons';
import { CONTACT } from '@/lib/landing/content';
import type { Dict } from '@/lib/landing/i18n/en';
import { h2, sectionHead } from './styles';

function Channel({ href, icon, label, value, note, badge, pro = false, delay }: {
  href: string; icon: ReactNode; label: string; value: string; note: string; badge?: string; pro?: boolean; delay: number;
}) {
  const external = href.startsWith('http');
  return (
    <a
      href={href}
      className={`lx-glass lx-feature lx-contact${pro ? ' lx-card-pro' : ''}`}
      data-reveal
      data-contact
      style={{ '--d': delay } as CSSProperties}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="lx-feature-icon">{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 600, marginRight: 'auto' }}>{label}</span>
        {badge && <span className="lx-contact-badge">{badge}</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="lx-contact-value">{value}</span>
        <p className="lx-muted" style={{ fontSize: 14 }}>{note}</p>
      </div>
      <span className="lx-muted" style={{ marginTop: 'auto', alignSelf: 'flex-end' }}><IconArrow /></span>
    </a>
  );
}

/** Support channels: Telegram (fastest, highlighted) and email. */
export default function Contact({ t }: { t: Dict['contact'] }) {
  return (
    <section id="contact" className="lx-wrap lx-section">
      <div style={sectionHead} data-reveal>
        <span className="lx-kicker">{t.kicker}</span>
        <h2 style={h2}>{t.title}</h2>
        <p className="lx-muted" style={{ fontSize: 16 }}>{t.subtitle}</p>
      </div>
      <div className="lx-contact-grid">
        <Channel
          href={`https://t.me/${CONTACT.telegram}`}
          icon={<IconSend />}
          label={t.telegram.label}
          value={`@${CONTACT.telegram}`}
          note={t.telegram.note}
          badge={t.telegram.badge}
          pro
          delay={0}
        />
        <Channel
          href={`mailto:${CONTACT.email}`}
          icon={<IconMail />}
          label={t.email.label}
          value={CONTACT.email}
          note={t.email.note}
          delay={1}
        />
      </div>
    </section>
  );
}
