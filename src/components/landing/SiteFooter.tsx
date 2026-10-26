'use client';

import Link from 'next/link';
import ScreenerixLogo from '@/components/shared/ScreenerixLogo';
import { useCurrentYear } from '@/hooks/useCurrentYear';
import type { Dict } from '@/lib/landing/i18n/en';
import { COLORS } from '@/lib/theme';

const col = { display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 } as const;
const colHead = { fontSize: 13, fontWeight: 600, color: COLORS.text, marginBottom: 2 } as const;

export default function SiteFooter({ nav, t }: { nav: Dict['nav']; t: Dict['footer'] }) {
  const year = useCurrentYear();
  return (
    <footer style={{ borderTop: `1px solid ${COLORS.line}` }}>
      <div className="lx-wrap" style={{ display: 'flex', flexWrap: 'wrap', gap: 48, paddingTop: 48, paddingBottom: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: '1 1 280px', maxWidth: 420 }}>
          <ScreenerixLogo size={22} fontSize={14} />
          <p className="lx-muted" style={{ fontSize: 13 }}>{t.disclaimer}</p>
        </div>
        <nav style={col} aria-label={t.product}>
          <span style={colHead}>{t.product}</span>
          <a href="#features" className="lx-muted">{nav.features}</a>
          <a href="#how" className="lx-muted">{nav.how}</a>
          <a href="#pricing" className="lx-muted">{nav.pricing}</a>
          <a href="#faq" className="lx-muted">{nav.faq}</a>
        </nav>
        <nav style={col} aria-label={t.legal} data-legal-links>
          <span style={colHead}>{t.legal}</span>
          <Link href="/privacy" className="lx-muted">{t.privacy}</Link>
          <Link href="/terms" className="lx-muted">{t.terms}</Link>
          <Link href="/refunds" className="lx-muted">{t.refunds}</Link>
          <Link href="/cookies" className="lx-muted">{t.cookies}</Link>
        </nav>
      </div>
      <div className="lx-wrap lx-muted" style={{ paddingTop: 18, paddingBottom: 28, fontSize: 13, borderTop: `1px solid ${COLORS.line}` }}>
        ©{year ? ` ${year}` : ''} Screenerix
      </div>
    </footer>
  );
}
