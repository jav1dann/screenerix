'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const getYear = () => new Date().getFullYear();
const getServerYear = () => null;

/** Current year on the client; `null` during prerender so the static shell stays deterministic. */
export function useCurrentYear(): number | null {
  return useSyncExternalStore(subscribe, getYear, getServerYear);
}
