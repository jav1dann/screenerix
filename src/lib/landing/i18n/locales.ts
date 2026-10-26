/** Landing languages (client-safe: no dictionaries here). English lives at `/`, the rest at `/<locale>`. */
export const LOCALES = ['en', 'ru', 'tr', 'az'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_LABELS: Record<Locale, string> = { en: 'English', ru: 'Русский', tr: 'Türkçe', az: 'Azərbaycan' };

/** Remembers the visitor's choice; `/` redirects to it (see `proxy.ts`). */
export const LANG_COOKIE = 'sx_lang';

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

export const localePath = (l: Locale) => (l === DEFAULT_LOCALE ? '/' : `/${l}`);

/** `fill('Save {pct}%', { pct: 31 })` → "Save 31%". */
export const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

/** Splits a template around `{name}` slots, so React nodes (links) can be put in them. */
export function fillParts<T>(s: string, slots: Record<string, T>): Array<string | T> {
  return s.split(/(\{\w+\})/).filter(Boolean).map((p) => {
    const k = /^\{(\w+)\}$/.exec(p)?.[1];
    return k && k in slots ? slots[k] : p;
  });
}

/**
 * The landing language for a first visit to `/`: the browser's preferred language (the
 * first entry of `Accept-Language` this site speaks), else English.
 */
export function negotiateLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage.split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = Number(params.find((p) => p.trim().startsWith('q='))?.trim().slice(2) ?? 1);
      return { lang: tag.trim().toLowerCase().split('-')[0], q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.lang && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return ranked.map((x) => x.lang).find(isLocale) ?? DEFAULT_LOCALE;
}
