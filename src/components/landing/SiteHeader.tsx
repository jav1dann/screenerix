import { Suspense, use } from 'react';
import ScreenerixLogo from '@/components/shared/ScreenerixLogo';
import type { Dict } from '@/lib/landing/i18n/en';
import type { Locale } from '@/lib/landing/i18n/locales';
import { COLORS } from '@/lib/theme';
import LanguageSwitcher from './LanguageSwitcher';

interface AuthActions { t: Dict['nav']; onOpenTerminal: () => void; onSignIn: () => void; onRegister: () => void }

function SignedOutButtons({ t, onSignIn, onRegister }: AuthActions) {
  return (
    <>
      <button className="lx-btn lx-btn-sm lx-hide-sm" onClick={onSignIn}>{t.signIn}</button>
      <button className="lx-btn lx-btn-sm lx-btn-primary" onClick={onRegister}>{t.register}</button>
    </>
  );
}

/** Resolves the session check streamed from the server ("Open terminal" vs Sign in / Register). */
function SessionButtons({ session, ...a }: AuthActions & { session: Promise<boolean> }) {
  return use(session)
    ? <button className="lx-btn lx-btn-sm lx-btn-primary" onClick={a.onOpenTerminal}>{a.t.openTerminal}</button>
    : <SignedOutButtons {...a} />;
}

export default function SiteHeader({ t, locale, session, onOpenTerminal, onSignIn, onRegister }: {
  t: Dict['nav'];
  locale: Locale;
  /** Whether a session exists; only these buttons wait for it, the rest of the page is static. */
  session: Promise<boolean>;
  onOpenTerminal: () => void;
  onSignIn: () => void;
  onRegister: () => void;
}) {
  const actions = { t, onOpenTerminal, onSignIn, onRegister };
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(11,12,14,0.6)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: `1px solid ${COLORS.line}` }}>
      <div className="lx-wrap" style={{ display: 'flex', alignItems: 'center', gap: 24, height: 64 }}>
        <a href="#top" style={{ marginRight: 'auto', minWidth: 0 }} aria-label={t.home}><ScreenerixLogo size={30} fontSize={16} /></a>
        <nav className="lx-nav" aria-label="Primary">
          <a href="#features" className="lx-muted">{t.features}</a>
          <a href="#how" className="lx-muted">{t.how}</a>
          <a href="#pricing" className="lx-muted">{t.pricing}</a>
          <a href="#faq" className="lx-muted">{t.faq}</a>
        </nav>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <LanguageSwitcher locale={locale} label={t.language} />
          <Suspense fallback={<SignedOutButtons {...actions} />}>
            <SessionButtons session={session} {...actions} />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
