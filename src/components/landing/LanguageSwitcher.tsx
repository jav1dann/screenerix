'use client';

import { useEffect, useRef, useState } from 'react';
import { IconChevron, IconGlobe } from '@/components/shared/icons';
import { LANG_COOKIE, LOCALE_LABELS, LOCALES, localePath } from '@/lib/landing/i18n/locales';
import type { Locale } from '@/lib/landing/i18n/locales';

const YEAR_S = 60 * 60 * 24 * 365;

/** Remembered for a year; `/` then redirects to this language (English: stays on `/`). */
function rememberLocale(l: Locale) {
  document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=${YEAR_S}; samesite=lax`;
}

/** Header language menu: links to `/`, `/ru`, `/tr`, `/az` (keeping the #section) and remembers the choice. */
export default function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="lx-btn lx-btn-sm" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)} data-lang-switcher style={{ gap: 6, padding: '8px 10px' }}>
        <IconGlobe />
        <span style={{ textTransform: 'uppercase', fontSize: 12 }}>{locale}</span>
        <IconChevron />
      </button>
      {open && (
        <div className="sx-menu" role="menu" style={{ width: 180 }}>
          {LOCALES.map((l) => (
            <a
              key={l}
              role="menuitem"
              className="sx-menu-item lx-lang-item"
              href={localePath(l) + (typeof window !== 'undefined' ? window.location.hash : '')}
              hrefLang={l}
              lang={l}
              aria-current={l === locale}
              data-lang={l}
              onClick={() => rememberLocale(l)}
            >
              {LOCALE_LABELS[l]}
              <span className="lx-muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>{l}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
