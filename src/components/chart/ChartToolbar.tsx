'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Ban, Star } from 'lucide-react';
import { IconCopy, IconPin, IconTick } from '@/components/shared/icons';
import { useSettings, useSymbolList } from '@/hooks/useTerminal';
import { exceptionStore, TERMINAL_BUTTONS, toggleIn, watchlistStore } from '@/lib/settings/settings';
import type { ButtonId, TerminalButton } from '@/lib/settings/settings';
import { ICON_BTN } from './styles';
import { terminalLink, TRADINGVIEW_LINK } from './terminalLinks';
import type { TerminalLink, TerminalLinkContext } from './terminalLinks';

interface ChartToolbarProps {
  ctx: TerminalLinkContext;
  pinned: boolean;
  onTogglePin: () => void;
  /** Settings preview: render the configured buttons, but inert. */
  preview?: boolean;
}

const isTerminal = (id: ButtonId): id is TerminalButton => (TERMINAL_BUTTONS as readonly string[]).includes(id);

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API unavailable (insecure context / denied) — fall back to a hidden textarea.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function LinkButton({ link, ctx, preview }: { link: TerminalLink; ctx: TerminalLinkContext; preview: boolean }) {
  const href = link.href(ctx);
  if (preview) return <span className={`${ICON_BTN} cursor-default`} title={href ? link.label : (link.disabledHint ?? link.label)} aria-label={link.label}>{link.icon}</span>;
  return href ? (
    <a className={ICON_BTN} href={href} target="_blank" rel="noopener noreferrer" title={link.label} aria-label={link.label}>
      {link.icon}
    </a>
  ) : (
    <button type="button" className={ICON_BTN} disabled title={link.disabledHint ?? `${link.label} (not configured)`} aria-label={`${link.label} (not configured)`}>
      {link.icon}
    </button>
  );
}

/** Left-hand card toolbar: the buttons, order and terminal URLs from Settings → Buttons on Charts. */
export default function ChartToolbar({ ctx, pinned, onTogglePin, preview = false }: ChartToolbarProps) {
  const { buttons } = useSettings();
  const watchlist = useSymbolList(watchlistStore);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    if (!(await copyText(ctx.ticker))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  };
  const watched = watchlist.includes(ctx.symbol);

  const render = (id: ButtonId): ReactNode => {
    if (isTerminal(id)) return <LinkButton key={id} link={terminalLink(id, buttons.templates[id])} ctx={ctx} preview={preview} />;
    switch (id) {
      case 'copy':
        return (
          <button key={id} type="button" className={`${ICON_BTN} ${copied ? 'text-sx-up' : ''}`} onClick={() => { void copy(); }} title={copied ? 'Copied!' : `Copy ${ctx.ticker}`} aria-label={`Copy ticker ${ctx.ticker}`}>
            {copied ? <IconTick /> : <IconCopy />}
          </button>
        );
      case 'pin':
        return (
          <button
            key={id}
            type="button"
            className={`${ICON_BTN} ${pinned ? 'text-sx-alert hover:text-sx-alert' : ''}`}
            onClick={onTogglePin}
            aria-pressed={pinned}
            title={pinned ? 'Unpin coin' : 'Pin coin'}
            aria-label={pinned ? `Unpin ${ctx.symbol}` : `Pin ${ctx.symbol}`}
          >
            <IconPin filled={pinned} />
          </button>
        );
      case 'watchlist':
        return (
          <button
            key={id}
            type="button"
            className={`${ICON_BTN} ${watched ? 'text-sx-alert hover:text-sx-alert' : ''}`}
            onClick={() => toggleIn(watchlistStore, ctx.symbol, !watched)}
            aria-pressed={watched}
            title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
            aria-label={watched ? `Remove ${ctx.symbol} from watchlist` : `Add ${ctx.symbol} to watchlist`}
          >
            <Star size={14} strokeWidth={2} fill={watched ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
        );
      case 'exceptions':
        return (
          <button
            key={id}
            type="button"
            className={`${ICON_BTN} hover:text-sx-down`}
            onClick={() => toggleIn(exceptionStore, ctx.symbol, true)}
            title="Add to exceptions (hide from the Market Map)"
            aria-label={`Add ${ctx.symbol} to exceptions`}
          >
            <Ban size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        );
      case 'tradingview':
        return <LinkButton key={id} link={TRADINGVIEW_LINK} ctx={ctx} preview={preview} />;
    }
  };

  const shown = buttons.order.filter((id) => buttons.enabled.includes(id));
  if (!shown.length) return null;
  return (
    <div
      className="flex w-9 shrink-0 flex-col items-center gap-1 border-r border-sx-line py-2"
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Chart tools"
      data-preview={preview || undefined}
      // Preview: the buttons show exactly as configured but do nothing (no copy, pin, watchlist or exception changes).
      onClickCapture={preview ? (e) => { e.preventDefault(); e.stopPropagation(); } : undefined}
    >
      {shown.map(render)}
    </div>
  );
}
