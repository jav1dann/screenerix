'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { MarketFeed } from '@/lib/market/feed';
import { createLiveFeed } from '@/lib/market/liveExchangeService';
import type { ExchangeId } from '@/lib/market/types';

interface Options {
  primary: ExchangeId;
  compare: readonly ExchangeId[];
  focus: string;
}

/**
 * Subscribes the component to the live market feed and keeps the feed's
 * venue / symbol configuration in sync with the UI.
 */
export function useMarketFeed({ primary, compare, focus }: Options): MarketFeed {
  const [feed] = useState(createLiveFeed);
  const compareKey = compare.join(',');

  useEffect(() => {
    feed.configure({ primary, compare: compareKey ? (compareKey.split(',') as ExchangeId[]) : [], focus });
  }, [feed, primary, compareKey, focus]);

  useEffect(() => {
    feed.start();
    return () => feed.stop();
  }, [feed]);

  useSyncExternalStore(feed.subscribe, feed.getVersion, feed.getVersion);
  return feed;
}
