/** Alert helpers shared by the chart card and the expanded terminal (alerts themselves live in `@/lib/alerts`). */
import { deleteAlert } from '@/app/actions/alerts';
import type { MarketType } from '@/lib/alerts/alertStore';
import { openAlertWizard } from '@/lib/alerts/alertsUi';
import { removeLocal } from '@/lib/alerts/client';
import type { AlertView } from '@/lib/alerts/client';
import { ADAPTERS } from '@/lib/market/exchanges';
import type { ExchangeId, InstrumentMeta } from '@/lib/market/exchanges';
import type { AlertLine } from './ChartCanvas';

export const DRAFT_ID = 'draft';

/** Venue ticker without separators: BTC-USDT-SWAP → BTCUSDT, 1000PEPEUSDT stays. */
export const tickerOf = (meta: InstrumentMeta | null, symbol: string, ex: ExchangeId): string =>
  meta ? meta.inst.replace(/-SWAP$/, '').replace(/[-_]/g, '') : `${symbol}${ADAPTERS[ex].quote}`;

export const venueMarket = (ex: ExchangeId): MarketType => (ADAPTERS[ex].market === 'perp' ? 'futures' : 'spot');

/** Price lines for a chart: the coin's active price alerts plus an unsaved draft. */
export const alertLines = (alerts: readonly AlertView[], draft: number | null): AlertLine[] => [
  ...alerts.flatMap((a) => (a.price ? [{ id: a.id, price: a.price.level, draft: false, active: true }] : [])),
  ...(draft !== null ? [{ id: DRAFT_ID, price: draft, draft: true, active: true }] : []),
];

/** "Edit" on a line: the wizard, prefilled with the draft's price or the saved alert. */
export function editAlertLine(id: string, draft: number | null, alerts: readonly AlertView[], exchange: ExchangeId, symbol: string): boolean {
  if (id === DRAFT_ID) {
    if (draft === null) return false;
    openAlertWizard({ mode: 'create', kind: 'price', exchange, symbol, price: draft });
    return true;
  }
  const a = alerts.find((x) => x.id === id);
  if (a) openAlertWizard({ mode: 'edit', alert: a });
  return Boolean(a);
}

/** "Delete" on a saved line. */
export function deleteAlertLine(id: string): void {
  removeLocal(id);
  void deleteAlert(id).catch(() => {});
}
