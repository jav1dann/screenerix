/**
 * USDT networks accepted at checkout. `code` is the provider's currency ticker (NOWPayments
 * `GET /v1/currencies`); `gas` is a typical sender-side fee, shown as a hint only. Client-safe.
 */
export type NetworkId = 'trc20' | 'bep20' | 'sol' | 'polygon' | 'erc20' | 'arbitrum';

export interface Network {
  id: NetworkId;
  name: string;
  standard: string;
  code: string;
  /** Typical gas the sender's wallet pays (USD). */
  gas: number;
  /** Rough time to confirm. */
  eta: string;
}

export const NETWORKS: readonly Network[] = [
  { id: 'trc20', name: 'Tron', standard: 'TRC-20', code: 'usdttrc20', gas: 1, eta: '~1 min' },
  { id: 'bep20', name: 'BNB Chain', standard: 'BEP-20', code: 'usdtbsc', gas: 0.05, eta: '~1 min' },
  { id: 'sol', name: 'Solana', standard: 'SPL', code: 'usdtsol', gas: 0.01, eta: '< 1 min' },
  { id: 'polygon', name: 'Polygon', standard: 'PoS', code: 'usdtmatic', gas: 0.02, eta: '~2 min' },
  { id: 'erc20', name: 'Ethereum', standard: 'ERC-20', code: 'usdterc20', gas: 1.5, eta: '~3 min' },
  { id: 'arbitrum', name: 'Arbitrum', standard: 'Arbitrum One', code: 'usdtarb', gas: 0.05, eta: '~1 min' },
];

export const isNetwork = (v: unknown): v is NetworkId => NETWORKS.some((n) => n.id === v);
export const networkOf = (id: NetworkId): Network => NETWORKS.find((n) => n.id === id)!;
