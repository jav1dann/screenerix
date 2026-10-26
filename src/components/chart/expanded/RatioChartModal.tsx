'use client';

/** Spread chart: live A ÷ B candles on one venue, opened from the ticker search's ÷ mode. */
import { useEffect, useEffectEvent, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Divide, SquareFunction, X } from 'lucide-react';
import { fmtPrice } from '@/lib/format';
import { ExchangeIcon } from '@/components/shared/brand/BrandIcon';
import { ADAPTERS } from '@/lib/market/exchanges';
import type { ExchangeId, Timeframe } from '@/lib/market/exchanges';
import { getRatioStream } from '@/lib/market/ratioStream';
import { CARD_TIMEFRAMES } from '@/lib/market/terminalPrefs';
import { indicatorUi, openIndicators } from '@/lib/indicators/ui';
import ChartCanvas from '../ChartCanvas';
import { BTN_RESET, ICON_BTN } from '../styles';

interface RatioChartModalProps {
  a: string;
  b: string;
  exchange: ExchangeId;
  initialInterval?: Timeframe;
  onClose: () => void;
}

const noop = () => {};

export default function RatioChartModal({ a, b, exchange, initialInterval = '1m', onClose }: RatioChartModalProps) {
  const [tf, setTf] = useState<Timeframe>(initialInterval);
  const stream = useMemo(() => getRatioStream({ exchange, a, b, tf }), [exchange, a, b, tf]);
  useEffect(() => stream.retain(), [stream]);
  const snap = useSyncExternalStore(stream.subscribe, stream.getSnapshot, stream.getSnapshot);
  const label = `${a} ÷ ${b}`;

  // Esc closes the spread chart — unless the Indicator modal on top of it is open (it handles its own Esc).
  const onKey = useEffectEvent((e: KeyboardEvent) => { if (e.key === 'Escape' && !indicatorUi.getSnapshot().open) { e.stopPropagation(); onClose(); } });
  useEffect(() => {
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[110] flex p-3 text-sx-text [&_*]:box-border" style={{ fontFamily: 'var(--font-archivo), system-ui, sans-serif' }}>
      <button type="button" aria-label="Close spread chart" onClick={onClose} className={`${BTN_RESET} absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm`} />
      <div role="dialog" aria-modal="true" aria-label={`${label} spread chart`} className="relative flex min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-solid border-sx-line2 bg-[#0E0F12] shadow-2xl shadow-black/70">
        <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-sx-line px-4 py-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.06]"><Divide size={15} aria-hidden="true" /></span>
          <span className="text-[15px] font-bold">{label}</span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sx-muted">Spread · <ExchangeIcon id={exchange} size={12} />{ADAPTERS[exchange].name}</span>
          <span className="text-sm font-semibold tabular-nums">{snap.stats.last === null ? '—' : fmtPrice(snap.stats.last)}</span>
          <div className="flex gap-0.5 rounded-[10px] border border-solid border-sx-line bg-white/[0.03] p-[3px]" role="radiogroup" aria-label="Spread timeframe">
            {CARD_TIMEFRAMES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={t === tf}
                onClick={() => setTf(t)}
                className={`${BTN_RESET} rounded-[7px] px-2 py-1 text-xs font-semibold ${t === tf ? 'bg-white/[0.08] text-sx-text' : 'text-sx-muted hover:text-sx-text'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => openIndicators('chart', null)} aria-label="Indicators" title="Indicators" aria-haspopup="dialog" className={`${ICON_BTN} ml-auto`}><SquareFunction size={15} aria-hidden="true" /></button>
          <button type="button" onClick={onClose} aria-label="Close" className={ICON_BTN}><X size={16} aria-hidden="true" /></button>
        </div>
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0">
            <ChartCanvas stream={stream} symbol={label} scope="chart" win={null} lines={[]} onPick={noop} onEdit={noop} onDelete={noop} />
          </div>
          {snap.status !== 'ready' && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-sx-muted">
              {snap.status === 'loading' ? `Loading ${label}…` : snap.status === 'unlisted' ? `${a} or ${b} isn't listed on ${ADAPTERS[exchange].name}` : `Couldn't load ${label}${snap.error ? ` — ${snap.error}` : ''}`}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
