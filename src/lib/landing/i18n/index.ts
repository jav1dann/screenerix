/**
 * Landing dictionaries. Import from server components only: a client component gets the one
 * dictionary it needs as a prop, so the other languages never reach the browser bundle.
 */
import { az } from './az';
import type { Dict } from './en';
import { en } from './en';
import type { Locale } from './locales';
import { ru } from './ru';
import { tr } from './tr';

export type { Dict } from './en';
export * from './locales';

const DICTIONARIES: Record<Locale, Dict> = { en, ru, tr, az };

export const getDictionary = (locale: Locale): Dict => DICTIONARIES[locale];
