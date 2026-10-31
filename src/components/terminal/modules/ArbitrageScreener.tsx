import { useEffect, useState } from 'react';
import { fmtPct, fmtPrice, tone } from '@/lib/format';
import { TAKER_FEES } from '@/lib/market/constants';
import { ExchangeIcon, ExchangeLabel } from '@/components/shared/brand/BrandIcon';
import { exchangeName } from '@/lib/market/exchanges';
import type { MarketType } from '@/lib/alerts/alertStore';
import { buildArbRows, MIN_QUOTES, OUTLIER, QUOTE_MAX_AGE_MS } from '@/lib/market/arbitrage';
import type { ExchangeId, StatusMap, VenueQuote } from '@/lib/market/types';
import { COLORS } from '@/lib/theme';
import { h3, sectionTitle } from '../styles';
import VenuePills from '../VenuePills';

interface ArbitrageScreenerProps {
  /** Venues being compared (always includes the primary). */
  venues: readonly ExchangeId[];
  primary: ExchangeId;
  marketType: MarketType;
  status: StatusMap;
  /** Add / remove a venue from the comparison. */
  onToggleVenue: (id: ExchangeId) => void;
  getQuote: (id: ExchangeId, symbol: string) => VenueQuote | null;
  /** Base symbols each streaming venue lists (the rows come from all of them, not the primary). */
  getListed: (id: ExchangeId) => string[];
}

/** Venues list hundreds of coins; rendering is capped to the most interesting spreads. */
const MAX_ROWS = 100;
/** Re-evaluate quote freshness this often even when no new data arrives (a silent venue goes stale). */
const CLOCK_MS = 5_000;

function useClock(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Why a selected venue contributes no quotes, in a few words (null: it does). */
function venueProblem(id: ExchangeId, status: StatusMap, listed: number): string | null {
  const st = status[id];
  if (st.restricted) return `${exchangeName(id)} isn’t available from our servers’ region`;
  if (st.state === 'error') return `${exchangeName(id)} is unavailable${st.error ? ` (${st.error})` : ''}`;
  if (!listed) return `${exchangeName(id)} is loading`;
  return null;
}

export default function ArbitrageScreener({ venues, primary, marketType, status, onToggleVenue, getQuote, getListed }: ArbitrageScreenerProps) {
  // Re-render on a clock too: freshness is time-based, and a dead stream sends no updates.
  // (At most CLOCK_MS behind: a quote newer than the clock simply counts as current.)
  const now = useClock(CLOCK_MS);
  const multi = venues.length > 1;
  const cols = `0.7fr repeat(${venues.length}, minmax(0,1fr)) 0.8fr 0.8fr 1.4fr 0.7fr`;
  const listed = new Map(venues.map((id) => [id, getListed(id)]));
  const available = (id: ExchangeId) => !status[id].restricted && status[id].state !== 'error' && (listed.get(id)?.length ?? 0) > 0;
  const up = venues.filter(available);
  const problems = venues.flatMap((id) => { const p = available(id) ? null : venueProblem(id, status, listed.get(id)?.length ?? 0); return p ? [p] : []; });
  const rows = buildArbRows({ venues, available, listed: (id) => listed.get(id) ?? [], getQuote, now, fees: TAKER_FEES });
  const shownRows = rows.slice(0, MAX_ROWS);
  const usdNote = venues.includes('coinbase') ? ' · Coinbase quotes USD spot vs. USDT perps' : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={sectionTitle}>
        <h3 style={h3}>Arbitrage Screener</h3>
        <span className="sx-muted" style={{ fontSize: 12 }}>
          {multi
            ? `Ranked by spread across ${up.length} of ${venues.length} selected exchanges · live quotes only (under ${QUOTE_MAX_AGE_MS / 60_000} min old), at least ${MIN_QUOTES} per spread · net of ${(TAKER_FEES * 100).toFixed(2)}% taker fees · quotes >${OUTLIER * 100}% off the median are ignored${usdNote}${rows.length > MAX_ROWS ? ` · top ${MAX_ROWS} of ${rows.length} coins` : ''}`
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
            {venues.map((e) => (
              <span key={e} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }} title={venueProblem(e, status, listed.get(e)?.length ?? 0) ?? undefined}>
                <ExchangeLabel id={e} size={13} />
                {status[e].restricted ? <span style={{ fontSize: 10, color: COLORS.down }} data-arb-restricted={e}>restricted</span>
                  : !available(e) ? <span style={{ fontSize: 10 }}>{status[e].state === 'error' ? 'unavailable' : 'loading…'}</span> : null}
              </span>
            ))}
            <span>Spread</span><span>Funding Δ</span><span>Route</span><span style={{ textAlign: 'right' }}>Net</span>
          </div>
          <div style={{ padding: '4px 6px' }}>
            {rows.length === 0 && (
              <div className="sx-muted" style={{ padding: '16px 8px', display: 'flex', flexDirection: 'column', gap: 6 }} role="status" data-arb-empty>
                {up.length < MIN_QUOTES
                  ? <span>Spreads need live quotes from at least {MIN_QUOTES} exchanges — {up.length === 0 ? 'none' : `only ${exchangeName(up[0])}`} of the selected ones {up.length === 1 ? 'is' : 'are'} streaming. {venues.length < 3 ? 'Select more exchanges above.' : ''}</span>
                  : <span>Loading quotes from {up.map(exchangeName).join(', ')}…</span>}
                {problems.length > 0 && <span style={{ fontSize: 11 }}>{problems.join(' · ')}.</span>}
              </div>
            )}
            {rows.length > 0 && problems.length > 0 && (
              <div className="sx-muted" style={{ padding: '6px 8px', fontSize: 11 }} data-arb-problems>Not compared: {problems.join(' · ')}.</div>
            )}
            {shownRows.map((r) => {
              const hot = r.spread !== null && r.spread > 0.0025;
              return (
                <div key={r.symbol} className="sx-row" style={{ gridTemplateColumns: cols, gap: 8, cursor: 'default' }} data-arb-row={r.symbol}>
                  <span style={{ fontWeight: 700 }}>{r.symbol}</span>
                  {r.cells.map(({ quote: q, state }, j) => (
                    <span key={venues[j]} style={{ display: 'flex', flexDirection: 'column' }} data-arb-cell={state}>
                      {q && state !== 'unavailable' && state !== 'none' ? <>
                        {state === 'outlier' ? (
                          <span className="sx-muted" style={{ textDecoration: 'line-through' }} title="Left out: more than 10% from the other venues — likely a different token or contract on this exchange">{fmtPrice(q.price)}</span>
                        ) : state === 'stale' ? (
                          <span className="sx-muted" style={{ opacity: 0.55 }} title="Not current: no live update from this exchange recently (or since it reconnected) — left out of the spread">{fmtPrice(q.price)}</span>
                        ) : (
                          <span style={{ color: multi && j === r.iMn ? COLORS.up : multi && j === r.iMx ? COLORS.down : COLORS.text }}>{fmtPrice(q.price)}</span>
                        )}
                        <span className="sx-muted" style={{ fontSize: 10 }}>{q.funding === null ? '—' : fmtPct(q.funding, 4)}</span>
                      </> : <span className="sx-muted" title={state === 'unavailable' ? venueProblem(venues[j], status, listed.get(venues[j])?.length ?? 0) ?? undefined : 'No quote for this coin on this exchange'}>—</span>}
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
