/**
 * Replacing a chart's candles without moving the user's view.
 *
 * lightweight-charts keeps the visible *logical* range (bar indices) across `setData`. When the
 * new series has bars added before the old ones (older history paged in — possibly by another
 * chart sharing the stream — or a re-seed after a reconnect), the same indices point at other
 * candles and the view jumps. Restoring a time range instead (`getVisibleRange`) is no better:
 * it only spans existing bars, so a view zoomed out past the first candle snaps back in.
 *
 * Here the logical range is shifted by however many bars now precede the old last bar, which keeps
 * the zoom and the position exactly — empty space included.
 */
import type { IChartApi, ISeriesApi, SeriesType, UTCTimestamp } from 'lightweight-charts';

/** Index of `time` (seconds) in ascending `times`, or -1. */
function indexOf(times: readonly number[], time: number): number {
  let lo = 0, hi = times.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] === time) return mid;
    if (times[mid] < time) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

/**
 * Run `apply` (which calls `series.setData(next)`), then put the view back where it was.
 * `nextTimes`: the new bars' times in seconds, ascending.
 */
export function setDataKeepingView<T extends SeriesType>(chart: IChartApi, series: ISeriesApi<T>, nextTimes: readonly number[], apply: () => void): void {
  const prev = series.data();
  const range = prev.length ? chart.timeScale().getVisibleLogicalRange() : null;
  apply();
  if (!range || !nextTimes.length) return;
  const lastPrev = prev[prev.length - 1].time as UTCTimestamp;
  const at = indexOf(nextTimes, lastPrev);
  // The old last bar is still there: shift by the bars now before it. Gone (a re-seed after a long
  // gap): keep the same distance from the newest bar.
  const shift = at >= 0 ? at - (prev.length - 1) : nextTimes.length - prev.length;
  if (shift !== 0) chart.timeScale().setVisibleLogicalRange({ from: range.from + shift, to: range.to + shift });
}
