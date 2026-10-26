import type { Metadata } from 'next';
import LandingPage from '@/components/landing/LandingPage';
import { getCurrentUser } from '@/lib/auth/dal';
import { googleConfigured } from '@/lib/auth/google';
import { getDictionary, LOCALES, localePath } from '@/lib/landing/i18n';
import type { Locale } from '@/lib/landing/i18n';

/** Title, description and hreflang alternates for one landing language. */
export function landingMetadata(locale: Locale): Metadata {
  const { meta } = getDictionary(locale);
  return {
    title: meta.title,
    description: meta.description,
    alternates: {
      canonical: localePath(locale),
      languages: { ...Object.fromEntries(LOCALES.map((l) => [l, localePath(l)])), 'x-default': '/' },
    },
    openGraph: { title: meta.title, description: meta.description, locale },
  };
}

/**
 * The landing page in one language. The page itself is static; only the session check (the
 * header's "Open terminal" vs Sign in / Register) streams in, as a promise the header resolves.
 * The Google flag is read when the page is prerendered.
 */
export default function LandingRoute({ locale }: { locale: Locale }) {
  const session = getCurrentUser().then((u) => u !== null, () => false);
  return <LandingPage locale={locale} dict={getDictionary(locale)} session={session} googleEnabled={googleConfigured()} />;
}
