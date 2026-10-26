'use client';

import { Field, Group, NumberInput, Toggle } from '@/components/shared/form';
import { CHART_LIMITS, updateSection } from '@/lib/settings/settings';
import type { Settings } from '@/lib/settings/settings';

type Chart = Settings['chart'];
type Watermark = Chart['watermark'];

export default function ChartTab({ settings }: { settings: Settings }) {
  const c = settings.chart;
  const wm = c.watermark;
  const set = (patch: Partial<Chart>) => updateSection('chart', patch);
  const setWm = (patch: Partial<Watermark>) => set({ watermark: { ...wm, ...patch } });
  const L = CHART_LIMITS;
  return (
    <>
      <Group title="Chart layout" hint="Shown live in the preview above. Gaps apply to the Market Map cards; candle width, spacing and grid also to the expanded chart.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Top gap"><NumberInput label="Top gap" value={c.gapTop} min={L.gapTop[0]} max={L.gapTop[1]} step={1} suffix="%" onChange={(gapTop) => set({ gapTop })} /></Field>
          <Field label="Bottom gap"><NumberInput label="Bottom gap" value={c.gapBottom} min={L.gapBottom[0]} max={L.gapBottom[1]} step={1} suffix="%" onChange={(gapBottom) => set({ gapBottom })} /></Field>
          <Field label="Candle width"><NumberInput label="Candle width" value={c.candleWidth} min={L.candleWidth[0]} max={L.candleWidth[1]} step={1} suffix="px" onChange={(candleWidth) => set({ candleWidth })} /></Field>
          <Field label="Space after last candle"><NumberInput label="Space after last candle" value={c.rightSpace} min={L.rightSpace[0]} max={L.rightSpace[1]} step={1} suffix="bars" onChange={(rightSpace) => set({ rightSpace })} /></Field>
        </div>
        <Toggle checked={c.grid} onChange={(grid) => set({ grid })} label="Show grid" />
      </Group>
      <Group title="Watermark" hint="The coin name behind the candles. Size and offsets are % of the card; the expanded chart uses Show and Opacity.">
        <Toggle checked={wm.show} onChange={(show) => setWm({ show })} label="Show watermark" />
        <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${wm.show ? '' : 'pointer-events-none opacity-40'}`}>
          <Field label="Size"><NumberInput label="Watermark size" value={wm.size} min={L.size[0]} max={L.size[1]} step={1} suffix="%" onChange={(size) => setWm({ size })} /></Field>
          <Field label="Opacity"><NumberInput label="Watermark opacity" value={wm.opacity} min={L.opacity[0]} max={L.opacity[1]} step={1} suffix="%" onChange={(opacity) => setWm({ opacity })} /></Field>
          <Field label="Horizontal offset"><NumberInput label="Watermark horizontal offset" value={wm.offsetX} min={L.offsetX[0]} max={L.offsetX[1]} step={1} suffix="%" onChange={(offsetX) => setWm({ offsetX })} /></Field>
          <Field label="Vertical offset"><NumberInput label="Watermark vertical offset" value={wm.offsetY} min={L.offsetY[0]} max={L.offsetY[1]} step={1} suffix="%" onChange={(offsetY) => setWm({ offsetY })} /></Field>
        </div>
      </Group>
      <Group title="Instrument type">
        <Toggle checked={wm.instrumentType} disabled={!wm.show} onChange={(instrumentType) => setWm({ instrumentType })} label="Show exchange and market under the name" hint="e.g. “BINANCE · FUTURES” in the watermark." />
      </Group>
    </>
  );
}
