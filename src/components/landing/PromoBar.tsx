'use client';

/**
 * Announcement bar above the landing header: the free-trial offer, a sign-up button and a close
 * button. Closing it is remembered in localStorage. An inline script checks that before the bar
 * is painted, so a dismissed bar never flashes in on reload or shifts the page.
 */
import { useState } from 'react';
import { IconArrow, IconX } from '@/components/shared/icons';
import type { Dict } from '@/lib/landing/i18n/en';

const KEY = 'sx_promo_dismissed';
const OFF_ATTR = 'data-promo-off';
/** Runs as the HTML is parsed (before the bar): hides it via `html[data-promo-off]` when dismissed. */
const EARLY = `try{if(localStorage.getItem('${KEY}')==='1')document.documentElement.setAttribute('${OFF_ATTR}','')}catch(e){}`;

export default function PromoBar({ t, onClaim }: { t: Dict['promo']; onClaim: () => void }) {
  const [closed, setClosed] = useState(false);
  const close = () => {
    setClosed(true);
    document.documentElement.setAttribute(OFF_ATTR, '');
    try { localStorage.setItem(KEY, '1'); } catch { /* private mode: hidden until reload */ }
  };
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: EARLY }} />
      {!closed && (
        <div className="lx-promo" role="region" aria-label={t.label} data-promo>
          <div className="lx-promo-inner">
            <p className="lx-promo-text"><span className="lx-promo-dot" aria-hidden="true" />{t.text}</p>
            <button type="button" className="lx-promo-cta" onClick={onClaim} data-promo-cta>{t.cta} <IconArrow /></button>
          </div>
          <button type="button" className="lx-promo-x" onClick={close} aria-label={t.close} data-promo-close><IconX /></button>
        </div>
      )}
    </>
  );
}
