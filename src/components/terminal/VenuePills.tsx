import type { MarketType } from '@/lib/alerts/alertStore';
import { ExchangeIcon } from '@/components/shared/brand/BrandIcon';
import { ADAPTERS, EXCHANGE_IDS } from '@/lib/market/exchanges';
import type { ExchangeId, StatusMap } from '@/lib/market/types';

const STATE_LABEL: Record<string, string> = {
  live: 'Live', connecting: 'Connecting…', reconnecting: 'Reconnecting…', error: 'Error', idle: 'Not streaming',
};

interface VenuePillsProps {
  /** Visible label before the pills, e.g. "Exchange" or "Compare". */
  label: string;
  hint: string;
  market: MarketType;
  status: StatusMap;
  isSelected: (id: ExchangeId) => boolean;
  onPick: (id: ExchangeId) => void;
  /** Venue to tag as "primary" (comparison mode). */
  primary?: ExchangeId;
  /** Venues to show (Settings → Exchanges & Markets); all when omitted. */
  venues?: readonly ExchangeId[];
}

/**
 * Exchange pills with live-connection dots. Venues that don't trade the current
 * market type (Futures / Spot) are shown disabled with an explanation.
 */
export default function VenuePills({ label, hint, market, status, isSelected, onPick, primary, venues = EXCHANGE_IDS }: VenuePillsProps) {
  return (
    <>
      <span className="sx-muted" style={{ fontSize: 12, marginRight: 6, flex: 'none' }} title={hint}>{label}</span>
      {EXCHANGE_IDS.filter((id) => venues.includes(id)).map((id) => {
        const a = ADAPTERS[id];
        const venueMarket: MarketType = a.market === 'perp' ? 'futures' : 'spot';
        const disabled = venueMarket !== market;
        const selected = !disabled && isSelected(id);
        const st = status[id];
        // A regional refusal isn't an outage: its own dot and wording (no "Error" / "Reconnecting").
        const dot = st.restricted ? 'restricted' : st.state !== 'idle' ? st.state : undefined;
        const title = disabled
          ? (venueMarket === 'spot' ? `${a.name} is spot-only — switch to Spot` : `Spot coming soon on ${a.name}`)
          : st.restricted
            ? `${a.name} doesn’t serve market data to our servers’ region — not available here. Other exchanges work normally.`
            : `${a.name} ${a.market === 'perp' ? 'USDT perpetuals' : 'spot (USD)'} · ${STATE_LABEL[st.state] ?? st.state}${st.error ? ` — ${st.error}` : ''}`;
        return (
          <button
            key={id}
            type="button"
            className="sx-pill"
            data-active={selected}
            data-disabled={disabled}
            aria-pressed={selected}
            aria-disabled={disabled}
            title={title}
            onClick={() => { if (!disabled) onPick(id); }}
          >
            <span className="sx-dot" data-status={dot} /><ExchangeIcon id={id} size={14} />{a.name}
            {!disabled && st.restricted && <span className="sx-muted" style={{ fontSize: 10, fontWeight: 400 }} data-venue-restricted={id}>unavailable</span>}
            {id === primary && <span className="sx-muted" style={{ fontSize: 10, fontWeight: 400 }}>primary</span>}
          </button>
        );
      })}
    </>
  );
}
