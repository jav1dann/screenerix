'use client';

/**
 * Screenerix — Public marketing & landing page (one language per route; see `LandingRoute`).
 */
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePreviewFeed } from '@/hooks/usePreviewFeed';
import { useReveal } from '@/hooks/useReveal';
import type { Period } from '@/lib/billing/plans';
import type { AuthMode } from '@/lib/landing/content';
import type { Dict } from '@/lib/landing/i18n/en';
import type { Locale } from '@/lib/landing/i18n/locales';
import AuthModal from './AuthModal';
import ClosingCta from './ClosingCta';
import Contact from './Contact';
import ExchangesStrip from './ExchangesStrip';
import Faq from './Faq';
import Features from './Features';
import Hero from './Hero';
import HowItWorks from './HowItWorks';
import Preloader from './Preloader';
import PromoBar from './PromoBar';
import PreviewTabs from './PreviewTabs';
import Pricing from './Pricing';
import SiteFooter from './SiteFooter';
import SiteHeader from './SiteHeader';

export interface LandingPageProps {
  locale: Locale;
  /** This language's copy (only the one dictionary is sent to the browser). */
  dict: Dict;
  /** Resolves to whether a session exists (header: "Open terminal" vs Sign in / Register). */
  session: Promise<boolean>;
  /** Google Sign-In is configured on the server (the auth modal offers it). */
  googleEnabled?: boolean;
}

export default function LandingPage({ locale, dict, session, googleEnabled = false }: LandingPageProps) {
  const { assets, candles } = usePreviewFeed();
  const [auth, setAuth] = useState<AuthMode | null>(null);
  /** Where the auth modal sends the visitor afterwards (checkout, from the Pro button). */
  const [authNext, setAuthNext] = useState<string | undefined>(undefined);
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  // /terminal is gated: signed-out visitors land on /login (and come back after signing in).
  const onLaunchTerminal = () => router.push('/terminal');
  const onRegister = () => { setAuthNext(undefined); setAuth('register'); };
  // Promo bar: sign up; already signed in → straight to the terminal.
  const onClaimTrial = () => { void session.then((signedIn) => (signedIn ? router.push('/terminal') : onRegister())); };
  // Pro: signed in → checkout; signed out → register first, then checkout.
  const onSelectPro = (period: Period) => {
    const checkout = `/billing?period=${period}`;
    void session.then((signedIn) => {
      if (signedIn) router.push(checkout);
      else { setAuthNext(checkout); setAuth('register'); }
    });
  };

  return (
    <div ref={root} className="lx-root" lang={locale} data-locale={locale}>
      <Preloader t={dict.preloader} />
      <div aria-hidden="true" className="lx-grid-bg" />
      <div aria-hidden="true" className="lx-glow" style={{ left: '50%', top: -200, width: 1100, height: 720, transform: 'translateX(-50%)', background: 'radial-gradient(closest-side, rgba(48,164,108,0.16), transparent 70%)' }} />
      <div aria-hidden="true" className="lx-glow" style={{ right: -260, top: 1400, width: 700, height: 700, background: 'radial-gradient(closest-side, rgba(48,164,108,0.07), transparent 70%)' }} />
      <PromoBar t={dict.promo} onClaim={onClaimTrial} />
      <SiteHeader t={dict.nav} locale={locale} session={session} onOpenTerminal={onLaunchTerminal} onSignIn={() => { setAuthNext(undefined); setAuth('signin'); }} onRegister={onRegister} />
      <main>
        <Hero t={dict.hero} assets={assets} candles={candles} onLaunch={onLaunchTerminal} onRegister={onRegister} />
        <ExchangesStrip label={dict.exchanges.label} />
        <Features t={dict.features} />
        <PreviewTabs t={dict.preview} assets={assets} />
        <HowItWorks t={dict.how} />
        <Pricing t={dict.pricing} onSelect={onRegister} onSelectPro={onSelectPro} />
        <Faq t={dict.faq} />
        <Contact t={dict.contact} />
        <ClosingCta t={dict.cta} onStart={onRegister} />
      </main>
      <SiteFooter nav={dict.nav} t={dict.footer} />
      {auth && (
        <AuthModal
          mode={auth}
          onModeChange={setAuth}
          onClose={() => { setAuth(null); setAuthNext(undefined); }}
          next={authNext}
          googleEnabled={googleEnabled}
          t={dict.auth}
        />
      )}
    </div>
  );
}
