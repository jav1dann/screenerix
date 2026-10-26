/**
 * Market type shared across the terminal. Alerts themselves are stored on the server
 * (`@/lib/alerts/types`, `client.ts`); alerts once kept in this browser under
 * `screenerix.alerts.v1` are imported into the account on first load.
 */
export type { AlertMode, MarketType } from './types';
