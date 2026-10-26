import { useId } from 'react';
import type { CSSProperties } from 'react';
import type { NetworkId } from '@/lib/billing/networks';
import type { ExchangeId } from '@/lib/market/exchanges';
import { EXCHANGES, NETWORKS, TOKENS } from './logos';
import type { Logo } from './logos';

/** Display names (as the adapters spell them), kept here so pages that only show logos don't load the adapters. */
const NAMES: Record<ExchangeId, string> = { binance: 'Binance', bybit: 'Bybit', okx: 'OKX', bitget: 'Bitget', gate: 'Gate', coinbase: 'Coinbase' };

interface MarkProps { size?: number; title?: string; style?: CSSProperties; className?: string }

/** One brand SVG. Gradient ids are made unique per instance (several logos share a page). */
function Mark({ logo, size = 16, title, style, className, kind }: MarkProps & { logo: Logo; kind: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const body = logo.body.replace(/(id="|url\(#)([\w-]+__\w+)/g, `$1$2-${uid}`);
  return (
    <svg
      width={size} height={size} viewBox={logo.viewBox} fill="none" className={className} data-brand={kind}
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
      style={{ display: 'block', flex: 'none', ...style }}
      // Static markup from our own logos.ts (generated from web3icons), never user input.
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : '') + body }}
    />
  );
}

/** A neutral tile with the venue's initial (venues without a logo in the set, e.g. "Soon" ones). */
function Initial({ name, size = 16, style }: { name: string; size?: number; style?: CSSProperties }) {
  return (
    <span aria-hidden="true" data-brand="initial" style={{ width: size, height: size, flex: 'none', display: 'inline-grid', placeItems: 'center', borderRadius: Math.round(size / 4), background: 'rgba(255,255,255,0.08)', color: '#B9BBC4', fontSize: Math.max(8, Math.round(size * 0.55)), fontWeight: 700, lineHeight: 1, ...style }}>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** Exchange logo by venue id (or a planned venue's name: "KuCoin", "MEXC" → initial tile when there's no logo). */
export function ExchangeIcon({ id, name, ...p }: MarkProps & { id?: ExchangeId | null; name?: string }) {
  const key = id ?? name?.toLowerCase().replace(/[^a-z]/g, '').replace(/io$/, '') ?? '';
  const logo = EXCHANGES[key];
  if (logo) return <Mark logo={logo} kind={`exchange:${key}`} {...p} />;
  return <Initial name={name ?? id ?? '?'} size={p.size} style={p.style} />;
}

/** Logo + name, e.g. in pills, chips and table cells. */
export function ExchangeLabel({ id, suffix, size = 14, gap = 6, style }: { id: ExchangeId; suffix?: string; size?: number; gap?: number; style?: CSSProperties }) {
  return (
    <span data-exchange-label={id} style={{ display: 'inline-flex', alignItems: 'center', gap, minWidth: 0, ...style }}>
      <ExchangeIcon id={id} size={size} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{NAMES[id]}{suffix}</span>
    </span>
  );
}

export function NetworkIcon({ id, ...p }: MarkProps & { id: NetworkId }) {
  return <Mark logo={NETWORKS[id]} kind={`network:${id}`} {...p} />;
}

export function UsdtIcon(p: MarkProps) {
  return <Mark logo={TOKENS.usdt} kind="token:usdt" {...p} />;
}
