'use client';

/**
 * Screenerix — expanded chart terminal.
 *
 *   <ExpandedChartModal symbol="CFX" exchange="binance" initialInterval="1m" onClose={…} />
 *
 * Full-viewport dialog around `ChartWorkspace` (timeframes, drawings, panes,
 * alerts, snapshot, fullscreen). It reads the same shared `chartStream` as the
 * card that opened it, so opening on the card's timeframe reuses the live
 * subscription.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { MarketType } from '@/lib/alerts/alertStore';
import type { ChartTimeframe, ExchangeId } from '@/lib/market/exchanges';
import type { TradeLevels } from '@/lib/strategies/chartLines';
import ChartWorkspace from './ChartWorkspace';

export interface ExpandedChartModalProps {
  symbol: string;
  exchange: ExchangeId;
  marketType?: MarketType;
  /** Defaults to the last timeframe used in the terminal. */
  initialInterval?: ChartTimeframe;
  onClose: () => void;
  /** A strategy formation's Entry / SL / TP1 / TP2. */
  tradeLevels?: TradeLevels | null;
}

export default function ExpandedChartModal({ onClose, ...chart }: ExpandedChartModalProps) {
  /* ── Scroll lock and focus restore ── */
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[110] text-sx-text [&_*]:box-border" style={{ fontFamily: 'var(--font-archivo), system-ui, sans-serif' }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" onClick={onClose} />
      <ChartWorkspace {...chart} onClose={onClose} modal />
    </div>,
    document.body,
  );
}
