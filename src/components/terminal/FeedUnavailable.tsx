import type { ExchangeId } from '@/lib/market/types';

/**
 * Why the selected exchange shows no data, and what to do: for an outage, Retry (it also retries
 * by itself); for an exchange that refuses our servers' region, a plain explanation and one-click
 * switches to exchanges that work — retrying a regional refusal right away wouldn't help.
 */
export interface FeedProblem {
  text: string;
  /** The exchange refuses our servers' region (not an outage). */
  restricted?: boolean;
  onRetry: () => void;
  /** Exchanges that work, to switch to. */
  alternatives?: Array<{ id: ExchangeId; name: string; onPick: () => void }>;
}

export default function FeedUnavailable({ problem }: { problem: FeedProblem }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', maxWidth: 520 }} role="alert" data-feed-error data-feed-restricted={problem.restricted || undefined}>
      {problem.text}
      {problem.alternatives && problem.alternatives.length > 0 && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
          {problem.alternatives.map((a) => (
            <button key={a.id} type="button" className="sx-btn" onClick={a.onPick} data-feed-switch={a.id}>Show {a.name}</button>
          ))}
        </span>
      )}
      <button type="button" className={problem.restricted ? 'sx-btn sx-muted' : 'sx-btn'} onClick={problem.onRetry} data-feed-retry>
        {problem.restricted ? 'Check again' : 'Retry now'}
      </button>
    </span>
  );
}
