import { fmtPct, fmtPrice, tone } from '@/lib/format';
import { TAKER_FEES } from '@/lib/market/constants';
import { ExchangeIcon, ExchangeLabel } from '@/components/shared/brand/BrandIcon';
import { exchangeName } from '@/lib/market/exchanges';
import type { MarketType } from '@/lib/alerts/alertStore';
import type { Asset, ExchangeId, StatusMap, VenueQuote } from '@/lib/market/types';
import { COLORS } from '@/lib/theme';
import { h3, sectionTitle } from '../styles';
import VenuePills from '../VenuePills';

interface ArbitrageScreenerProps {
  market: Asset[];
  /** Venues being compared (always includes the primary). */
  venues: readonly ExchangeId[];
  primary: ExchangeId;
  marketType: MarketType;
  status: StatusMap;
  /** Add / remove a venue from the comparison. */
  onToggleVenue: (id: ExchangeId) => void;
  getQuote: (id: ExchangeId, symbol: string) => VenueQuote | null;
}

/** Venues list hundreds of coins; rendering is capped to the most interesting spreads. */
const MAX_ROWS = 100;
/**
 * A quote this far from the median of the venues is treated as a different asset
 * (venues reuse tickers for unrelated tokens, e.g. two different "CAT"s), not an
 * arbitrage opportunity, and is left out of the spread.
 */
const OUTLIER = 0.1;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export default function ArbitrageScreener({ market, venues, primary, marketType, status, onToggleVenue, getQuote }: ArbitrageScreenerProps) {
  const multi = venues.length > 1;
  const cols = `0.7fr repeat(${venues.length}, minmax(0,1fr)) 0.8fr 0.8fr 1.4fr 0.7fr`;
  const rows = market
    .map((a) => {
      const quotes = venues.map((e) => getQuote(e, a.symbol));
      const all = quotes.flatMap((q, j) => (q ? [{ j, p: q.price }] : []));
      const mid = all.length ? median(all.map((x) => x.p)) : 0;
      const priced = all.filter((x) => Math.abs(x.p / mid - 1) <= OUTLIER);
      const excluded = new Set(all.filter((x) => !priced.includes(x)).map((x) => x.j));
      const fundings = quotes.flatMap((q) => (q && q.funding !== null ? [q.funding] : []));
      let iMn = -1, iMx = -1, spread: number | null = null;
      if (priced.length >= 2) {
        const mn = priced.reduce((m, x) => (x.p < m.p ? x : m));
        const mx = priced.reduce((m, x) => (x.p > m.p ? x : m));
        iMn = mn.j; iMx = mx.j;
        spread = (mx.p - mn.p) / mn.p;
      }
      return {
        a, quotes, excluded, iMn, iMx, spread,
        net: spread === null ? null : spread - TAKER_FEES,
        fundDelta: fundings.length >= 2 ? Math.max(...fundings) - Math.min(...fundings) : null,
      };
    })
    .sort((x, y) => (y.spread ?? -1) - (x.spread ?? -1));
  // Every listed coin is compared; the table shows the widest spreads.
  const shownRows = rows.slice(0, MAX_ROWS);
  const usdNote = venues.includes('coinbase') ? ' · Coinbase quotes USD spot vs. USDT perps' : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={sectionTitle}>
        <h3 style={h3}>Arbitrage Screener</h3>
        <span className="sx-muted" style={{ fontSize: 12 }}>
          {multi
            ? `Ranked by spread across ${venues.length} selected exchanges · net of ${(TAKER_FEES * 100).toFixed(2)}% taker fees · quotes >${OUTLIER * 100}% off the median are ignored${usdNote}${rows.length > MAX_ROWS ? ` · top ${MAX_ROWS} of ${rows.length} coins` : ''}`
            : 'Select at least two exchanges to compare spreads'}
        </span>
      </div>
      {/* Venue comparison lives here (the header's exchange row is Market-Map-only). */}
      <div className="sx-noscroll" role="group" aria-label="Exchanges to compare" style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', padding: '0 4px' }}>
        <VenuePills
          label="Compare"
          hint="Toggle venues to compare (the primary venue is always included)"
          market={marketType}
          status={status}
          isSelected={(id) => venues.includes(id)}
          onPick={onToggleVenue}
          primary={primary}
        />
      </div>
      <div className="sx-glass sx-scroll" style={{ overflowX: 'auto', fontSize: 12 }}>
        <div style={{ minWidth: 760 }}>
          <div className="sx-muted" style={{ display: 'grid', gridTemplateColumns: cols, gap: 8, padding: '10px 14px', fontSize: 11, borderBottom: `1px solid ${COLORS.line}` }}>
            <span>Pair</span>
            {venues.map((e) => <ExchangeLabel key={e} id={e} size={13} />)}
            <span>Spread</span><span>Funding Δ</span><span>Route</span><span style={{ textAlign: 'right' }}>Net</span>
          </div>
          <div style={{ padding: '4px 6px' }}>
            {rows.length === 0 && <div className="sx-muted" style={{ padding: '16px 8px' }}>Waiting for quotes…</div>}
            {shownRows.map((r) => {
              const hot = r.spread !== null && r.spread > 0.0025;
              return (
                <div key={r.a.symbol} className="sx-row" style={{ gridTemplateColumns: cols, gap: 8, cursor: 'default' }}>
                  <span style={{ fontWeight: 700 }}>{r.a.symbol}</span>
                  {r.quotes.map((q, j) => (
                    <span key={venues[j]} style={{ display: 'flex', flexDirection: 'column' }}>
                      {q ? <>
                        {r.excluded.has(j) ? (
                          <span className="sx-muted" style={{ textDecoration: 'line-through' }} title="Left out: more than 10% from the other venues — likely a different token or contract on this exchange">{fmtPrice(q.price)}</span>
                        ) : (
                          <span style={{ color: multi && j === r.iMn ? COLORS.up : multi && j === r.iMx ? COLORS.down : COLORS.text }}>{fmtPrice(q.price)}</span>
                        )}
                        <span className="sx-muted" style={{ fontSize: 10 }}>{q.funding === null ? '—' : fmtPct(q.funding, 4)}</span>
                      </> : <span className="sx-muted">—</span>}
                    </span>
                  ))}
                  <span>{r.spread === null ? <span className="sx-muted">—</span> : <span className="sx-badge" style={{ color: hot ? COLORS.up : COLORS.text, background: hot ? COLORS.upBg : 'rgba(255,255,255,0.04)' }}>{fmtPct(r.spread, 3)}</span>}</span>
                  <span className="sx-muted">{r.fundDelta === null ? '—' : fmtPct(r.fundDelta, 4)}</span>
                  <span className="sx-muted" title={r.iMn >= 0 ? `${exchangeName(venues[r.iMn])} → ${exchangeName(venues[r.iMx])}` : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{r.iMn >= 0 ? <><ExchangeIcon id={venues[r.iMn]} size={13} />→<ExchangeIcon id={venues[r.iMx]} size={13} /><span style={{ marginLeft: 2 }}>{exchangeName(venues[r.iMn])} → {exchangeName(venues[r.iMx])}</span></> : '—'}</span>
                  <span style={{ textAlign: 'right', fontWeight: 600, color: r.net === null ? COLORS.muted : tone(r.net) }}>{r.net === null ? '—' : fmtPct(r.net, 3)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
