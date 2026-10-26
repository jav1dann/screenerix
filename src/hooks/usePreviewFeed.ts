'use client';

import { useEffect, useState } from 'react';
import { createPreviewStore } from '@/lib/landing/content';

/** Lightweight feed that keeps the hero preview and feature visuals alive. */
export function usePreviewFeed(tickMs = 1200) {
  const [store] = useState(() => createPreviewStore());
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      store.step();
      setTick((t) => t + 1);
    }, tickMs);
    return () => window.clearInterval(id);
  }, [store, tickMs]);

  return { assets: store.assets, candles: store.candles };
}
