import type { ReactNode } from 'react';
import { IconChartLine, IconTerminal } from '@/components/shared/icons';
import type { MarketType } from '@/lib/alerts/alertStore';
import type { ExchangeId } from '@/lib/market/exchanges';
import type { TerminalButton } from '@/lib/settings/settings';

export interface TerminalLinkContext {
  exchange: ExchangeId;
  marketType: MarketType;
  /** Base symbol, e.g. "CFX". */
  symbol: string;
  /** Venue ticker without separators, e.g. "CFXUSDT" or "1000PEPEUSDT". */
  ticker: string;
}

export interface TerminalLink {
  id: string;
  label: string;
  icon: ReactNode;
  /** URL to open, or null when the link isn't configured (button renders disabled). */
  href: (ctx: TerminalLinkContext) => string | null;
  /** Tooltip for the disabled state. */
  disabledHint?: string;
}

const TRADINGVIEW_PREFIX: Record<ExchangeId, string> = {
  binance: 'BINANCE', bybit: 'BYBIT', okx: 'OKX', bitget: 'BITGET', coinbase: 'COINBASE', gate: 'GATEIO',
};

/** e.g. BINANCE:CFXUSDT.P for perpetuals, COINBASE:BTCUSD for spot. */
export const tradingViewSymbol = (ctx: TerminalLinkContext): string =>
  `${TRADINGVIEW_PREFIX[ctx.exchange]}:${ctx.ticker}${ctx.marketType === 'futures' ? '.P' : ''}`;

/**
 * Fill a URL template. Placeholders: {symbol} {ticker} {exchange} {market}.
 * Example: "https://example.com/open?ticker={ticker}&ex={exchange}"
 */
export function fillTemplate(template: string, ctx: TerminalLinkContext): string {
  return template
    .replaceAll('{symbol}', encodeURIComponent(ctx.symbol))
    .replaceAll('{ticker}', encodeURIComponent(ctx.ticker))
    .replaceAll('{exchange}', encodeURIComponent(ctx.exchange))
    .replaceAll('{market}', encodeURIComponent(ctx.marketType));
}

const TIGER_ENV = process.env.NEXT_PUBLIC_TIGER_TERMINAL_URL ?? '';

const TERMINAL_NAME: Record<TerminalButton, string> = { tiger: 'Tiger', metascalp: 'Metascalp', vataga: 'Vataga', colibri: 'Colibri' };

/** Small letter badge so the four terminal buttons are told apart. */
const terminalIcon = (letter: string) => (
  <span className="relative grid place-items-center">
    <IconTerminal />
    <span className="absolute -bottom-1 -right-1.5 rounded-[3px] bg-sx-line2 px-[2px] text-[8px] font-bold leading-[10px] text-sx-text">{letter}</span>
  </span>
);

export const TRADINGVIEW_LINK: TerminalLink = {
  id: 'tradingview',
  label: 'Open in TradingView',
  icon: <IconChartLine />,
  href: (ctx) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tradingViewSymbol(ctx))}`,
};

/** An external-terminal button from its URL template (Settings → Buttons on Charts). */
export function terminalLink(id: TerminalButton, template: string): TerminalLink {
  const url = template.trim() || (id === 'tiger' ? TIGER_ENV : '');
  const name = TERMINAL_NAME[id];
  return {
    id,
    label: `Open in ${name}`,
    icon: terminalIcon(name[0]),
    href: (ctx) => (url ? fillTemplate(url, ctx) : null),
    disabledHint: `Set the ${name} URL in Settings → Buttons on Charts to enable this button`,
  };
}
