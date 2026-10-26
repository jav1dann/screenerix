import type { Settings } from '@/lib/settings/settings';

/** Watermark layer behind a transparent chart canvas (needs a `container-type: size` parent). */
export default function ChartWatermark({ symbol, sub, settings }: { symbol: string; sub: string; settings: Settings['chart'] }) {
  const wm = settings.watermark;
  if (!wm.show) return null;
  const color = `rgba(237,238,240,${wm.opacity / 100})`;
  return (
    <div
      className="pointer-events-none absolute inset-0 flex select-none flex-col items-center justify-center leading-none"
      style={{ transform: `translate(${wm.offsetX}cqw, ${wm.offsetY}cqh)`, color }}
      data-watermark
      aria-hidden="true"
    >
      <span className="font-extrabold whitespace-nowrap" style={{ fontSize: `min(${wm.size}cqh, ${wm.size * 0.7}cqw)` }}>{symbol}</span>
      {wm.instrumentType && sub && <span className="mt-[0.4em] font-bold tracking-widest whitespace-nowrap" style={{ fontSize: `min(${wm.size * 0.22}cqh, ${wm.size * 0.16}cqw)` }}>{sub}</span>}
    </div>
  );
}
