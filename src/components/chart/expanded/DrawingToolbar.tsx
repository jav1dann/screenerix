'use client';

import { useState } from 'react';
import { CalendarSearch, ChevronRight, Eye, EyeOff, Lock, LockOpen, Magnet, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { BTN_RESET } from '../styles';
import Popover from '@/components/shared/Popover';
import { TOOL_GROUPS, TOOL_LABEL, ToolIcon } from './tools';
import type { CursorTool, Tool } from './tools';

interface DrawingToolbarProps {
  tool: Tool;
  /** The persisted cursor tool (shown on the Cursors button while a drawing tool is active). */
  cursor: CursorTool;
  onTool: (t: Tool) => void;
  magnet: boolean;
  onMagnet: () => void;
  locked: boolean;
  onLock: () => void;
  hidden: boolean;
  onHide: () => void;
  hasSelection: boolean;
  drawingCount: number;
  onRemoveSelected: () => void;
  onRemoveAll: () => void;
  /** Scroll the chart to a moment (ms since epoch). */
  onGoTo: (ms: number) => void;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** `datetime-local` value (local time, minutes). */
const localInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** Calendar button: pick a date & time and jump the chart there. */
function GoToDate({ onGoTo }: { onGoTo: (ms: number) => void }) {
  const [value, setValue] = useState('');
  /** When the picker opened — the latest moment it offers. */
  const [now, setNow] = useState(0);
  return (
    <Popover
      placement="right-start"
      className="-top-1 w-64"
      trigger={(open, toggle) => (
        <button
          type="button"
          className={`${SLOT} ${open ? ACTIVE : ''}`}
          onClick={() => {
            if (!open) { const t = Date.now(); setNow(t); setValue(localInput(t - 86_400_000)); }
            toggle();
          }}
          aria-expanded={open}
          title="Go to date"
          aria-label="Go to date"
        >
          <CalendarSearch size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    >
      {(close) => {
        const ms = value ? new Date(value).getTime() : NaN;
        const valid = Number.isFinite(ms) && ms <= now + 60_000;
        const go = () => { if (valid) { onGoTo(ms); close(); } };
        return (
          <form className="flex flex-col gap-2 p-2" onSubmit={(e) => { e.preventDefault(); go(); }}>
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wide text-sx-muted">
              Go to date
              <input
                type="datetime-local"
                value={value}
                max={localInput(now)}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label="Date and time"
                className="h-8 rounded-md border border-solid border-sx-line2 bg-[#0B0C0E] px-2 text-[13px] normal-case tracking-normal text-sx-text [color-scheme:dark]"
              />
            </label>
            <div className="flex justify-end gap-1.5">
              <button type="button" className={`${MENU_ITEM} w-auto`} onClick={close}>Cancel</button>
              <button type="submit" disabled={!valid} className={`${BTN_RESET} rounded-lg bg-sx-up/15 px-3 py-1.5 text-[13px] font-semibold text-sx-up hover:bg-sx-up/25 disabled:opacity-40`}>Go</button>
            </div>
          </form>
        );
      }}
    </Popover>
  );
}

const SLOT = `${BTN_RESET} relative grid h-9 w-9 place-items-center rounded-lg text-sx-muted transition-colors hover:bg-white/[0.06] hover:text-sx-text focus-visible:outline-2 focus-visible:outline-sx-up`;
const ACTIVE = 'bg-sx-up/15 text-sx-up hover:bg-sx-up/20 hover:text-sx-up';
const MENU_ITEM = `${BTN_RESET} flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left hover:bg-white/[0.06] disabled:opacity-40 disabled:hover:bg-transparent`;

function ToggleButton({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button type="button" className={`${SLOT} ${active ? ACTIVE : ''}`} onClick={onClick} aria-pressed={active} title={label} aria-label={label}>
      {children}
    </button>
  );
}

export default function DrawingToolbar(p: DrawingToolbarProps) {
  // Each group remembers the last tool picked from its flyout (TradingView-style).
  const [lastByGroup, setLastByGroup] = useState<Record<string, Tool>>({});

  return (
    <div className="relative z-20 flex w-11 shrink-0 flex-col items-center gap-0.5 border-0 border-r border-solid border-sx-line py-2" role="toolbar" aria-orientation="vertical" aria-label="Drawing tools">
      {TOOL_GROUPS.map((g) => {
        const shown = g.tools.includes(p.tool) ? p.tool : g.id === 'cursor' ? p.cursor : (lastByGroup[g.id] ?? g.tools[0]);
        const active = g.tools.includes(p.tool);
        return (
          <div key={g.id} className="group relative">
            <button
              type="button"
              className={`${SLOT} ${active ? ACTIVE : ''}`}
              onClick={() => p.onTool(shown)}
              title={shown === 'trend' ? 'Trend line (Alt+T)' : TOOL_LABEL[shown]}
              aria-label={TOOL_LABEL[shown]}
              aria-pressed={active}
            >
              <ToolIcon tool={shown} />
            </button>
            {g.tools.length > 1 && (
              <div className="absolute -right-0.5 bottom-0">
                <Popover
                  placement="right-start"
                  className="-top-8 min-w-48"
                  trigger={(open, toggle) => (
                    <button
                      type="button"
                      onClick={toggle}
                      aria-label={`More ${g.label.toLowerCase()}`}
                      aria-expanded={open}
                      title={g.label}
                      className={`${BTN_RESET} grid h-3.5 w-3.5 place-items-center rounded text-sx-muted opacity-60 hover:bg-white/10 hover:opacity-100 group-hover:opacity-100`}
                    >
                      <ChevronRight size={10} strokeWidth={2.5} aria-hidden="true" />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <div className="px-2.5 pb-1 pt-0.5 text-[10px] uppercase tracking-wide text-sx-muted">{g.label}</div>
                      {g.tools.map((t) => (
                        <button
                          key={t}
                          type="button"
                          role="menuitemradio"
                          aria-checked={p.tool === t}
                          className={`${MENU_ITEM} ${p.tool === t ? 'text-sx-up' : ''}`}
                          onClick={() => { setLastByGroup((m) => ({ ...m, [g.id]: t })); p.onTool(t); close(); }}
                        >
                          <ToolIcon tool={t} />{TOOL_LABEL[t]}
                        </button>
                      ))}
                    </>
                  )}
                </Popover>
              </div>
            )}
          </div>
        );
      })}

      <span className="my-1 h-px w-6 shrink-0 bg-sx-line" aria-hidden="true" />
      <button
        type="button"
        className={`${SLOT} ${p.tool === 'measure' ? ACTIVE : ''}`}
        onClick={() => p.onTool(p.tool === 'measure' ? 'cross' : 'measure')}
        aria-pressed={p.tool === 'measure'}
        title="Measure — or hold Shift and drag"
        aria-label="Measure"
      >
        <ToolIcon tool="measure" />
      </button>
      <GoToDate onGoTo={p.onGoTo} />
      <button
        type="button"
        className={`${SLOT} ${p.tool === 'alert' ? 'bg-sx-alert/15 text-sx-alert hover:bg-sx-alert/20 hover:text-sx-alert' : ''}`}
        onClick={() => p.onTool(p.tool === 'alert' ? 'cross' : 'alert')}
        aria-pressed={p.tool === 'alert'}
        title="Price alert — click the chart to place"
        aria-label="Price alert tool"
      >
        <ToolIcon tool="alert" />
      </button>
      <ToggleButton active={p.magnet} onClick={p.onMagnet} label={p.magnet ? 'Magnet on: snap to candle high / low / open / close' : 'Magnet off (hold Ctrl to snap)'}>
        <Magnet size={16} strokeWidth={1.75} aria-hidden="true" />
      </ToggleButton>
      <ToggleButton active={p.locked} onClick={p.onLock} label={p.locked ? 'Unlock drawings' : 'Lock all drawings'}>
        {p.locked ? <Lock size={16} strokeWidth={1.75} aria-hidden="true" /> : <LockOpen size={16} strokeWidth={1.75} aria-hidden="true" />}
      </ToggleButton>
      <ToggleButton active={p.hidden} onClick={p.onHide} label={p.hidden ? 'Show drawings' : 'Hide drawings'}>
        {p.hidden ? <EyeOff size={16} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={16} strokeWidth={1.75} aria-hidden="true" />}
      </ToggleButton>

      <Popover
        placement="right-start"
        className="-top-1 min-w-52"
        trigger={(open, toggle) => (
          <button type="button" className={`${SLOT} hover:text-sx-down`} onClick={toggle} aria-expanded={open} title="Remove drawings" aria-label="Remove drawings">
            <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      >
        {(close) => (
          <>
            <button type="button" className={MENU_ITEM} disabled={!p.hasSelection || p.locked} onClick={() => { p.onRemoveSelected(); close(); }}>
              <Trash2 size={14} aria-hidden="true" />Remove selected
              <span className="ml-auto pl-4 text-[11px] text-sx-muted">Del</span>
            </button>
            <button type="button" className={`${MENU_ITEM} text-sx-down`} disabled={!p.drawingCount || p.locked} onClick={() => { p.onRemoveAll(); close(); }}>
              <Trash2 size={14} aria-hidden="true" />Remove all drawings
              <span className="ml-auto pl-4 text-[11px] text-sx-muted">{p.drawingCount}</span>
            </button>
          </>
        )}
      </Popover>
    </div>
  );
}
