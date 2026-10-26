'use client';

import ChartWorkspace from '@/components/chart/expanded/ChartWorkspace';
import type { ChartLevel } from '@/components/chart/expanded/AdvancedChart';
import type { MarketType } from '@/lib/alerts/alertStore';
import type { ExchangeId } from '@/lib/market/exchanges';

interface MarketReviewProps {
  symbol: string;
  exchange: ExchangeId;
  marketType: MarketType;
  /** Order-book walls of `symbol`, drawn on the chart. */
  levels: readonly ChartLevel[];
  /** Height of the sticky terminal header (the workspace fills the rest of the viewport). */
  headerHeight: number;
  /** Live funding rate of `symbol` (fraction; perpetual venues). */
  funding?: number | null;
}

/**
 * Market Review: one full-height chart workspace for the coin picked in the
 * ticker sidebar (timeframes, drawing rail, density levels, OI pane).
 * Picking another coin swaps the data in place.
 */
export default function MarketReview({ symbol, exchange, marketType, levels, headerHeight, funding }: MarketReviewProps) {
  return (
    <div style={{ height: `calc(100vh - ${headerHeight}px - 24px)`, minHeight: 420 }}>
      <ChartWorkspace symbol={symbol} exchange={exchange} marketType={marketType} levels={levels} funding={funding} />
    </div>
  );
}
