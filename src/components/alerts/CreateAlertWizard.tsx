'use client';

/**
 * Create / edit an alert in three steps:
 *  1. Type — price alert or complex alert;
 *  2. Exchange & delivery — exchange + market, sound, notification channels, mode;
 *  3. Coin & trigger — coin search, then the target price or the conditions.
 */
import { Bell, Check, ChevronLeft, MessageCircle, Monitor, Plus, Search, Smartphone, Trash2, Volume2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import type { ReactNode } from 'react';
import { saveAlert } from '@/app/actions/alerts';
import { BTN_RESET, GHOST_BTN, ICON_BTN, INPUT, PRIMARY_BTN } from '@/components/chart/styles';
import { ExchangeIcon, ExchangeLabel } from '@/components/shared/brand/BrandIcon';
import Modal from '@/components/strategies/Modal';
import { DropdownSelect, SegmentedGroup } from '@/components/terminal/MarketControls';
import { alertsClient, refreshAlerts, upsertLocal } from '@/lib/alerts/client';
import { closeAlertWizard } from '@/lib/alerts/alertsUi';
import type { WizardInit } from '@/lib/alerts/alertsUi';
import { playSound } from '@/lib/alerts/notify';
import { describeCondition, MAX_CONDITIONS, marketOfExchange, METRIC_BY_ID, METRICS, OPS, REPEAT_RANGE, validateAlertInput, WINDOWS_FOR } from '@/lib/alerts/types';
import type { AlertKind, AlertMode, AlertSound, Condition, MarketType, Metric } from '@/lib/alerts/types';
import { fmtPct, fmtPrice, fmtUsd } from '@/lib/format';
import { EXCHANGE_IDS } from '@/lib/market/exchanges';
import type { ExchangeId } from '@/lib/market/exchanges';
import { rankBy } from '@/lib/market/searchRank';
import { getDirectory } from '@/lib/market/venueDirectory';
import type { DirectoryEntry } from '@/lib/market/venueDirectory';
import { enablePush } from '@/lib/push/client';
import { openTelegramLink } from '@/lib/telegram/client';

const STEPS = ['Alert type', 'Exchange & notifications', 'Coin & trigger'] as const;
const MARKETS: ReadonlyArray<{ id: MarketType; label: string }> = [{ id: 'futures', label: 'Futures' }, { id: 'spot', label: 'Spot' }];
const SOUNDS: ReadonlyArray<{ id: AlertSound; label: string }> = [{ id: 'off', label: 'Off' }, { id: 'beep', label: 'Beep' }, { id: 'voice', label: 'Voice' }];
const MODES: ReadonlyArray<{ id: AlertMode; label: string }> = [{ id: 'once', label: 'One-time' }, { id: 'infinite', label: 'Infinite alert' }];
const TG_WAIT_MS = 2 * 60_000;

const newCondition = (): Condition => ({ metric: 'change', window: '5m', op: '>', value: 3 });

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div><h3 className="m-0 text-[13px] font-semibold">{title}</h3>{hint && <p className="m-0 mt-0.5 text-[11px] text-sx-muted">{hint}</p>}</div>
      {children}
    </section>
  );
}

function ChannelRow({ icon, title, hint, checked, disabled, onChange, action, data }: { icon: ReactNode; title: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; action?: ReactNode; data: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-solid border-sx-line bg-white/[0.02] px-3 py-2.5" data-channel={data} data-on={checked}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-sx-muted">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col"><span className="text-[13px] font-semibold">{title}</span><span className="text-[11px] text-sx-muted">{hint}</span></span>
      {action}
      <button type="button" role="switch" aria-checked={checked} aria-label={title} disabled={disabled} onClick={() => onChange(!checked)}
        className={`${BTN_RESET} relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40`}
        style={{ background: checked ? 'var(--sx-up)' : 'rgba(255,255,255,0.12)' }}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

export default function CreateAlertWizard({ init }: { init: WizardInit }) {
  const s = useSyncExternalStore(alertsClient.subscribe, alertsClient.getSnapshot, alertsClient.getServerSnapshot);
  const edit = init.mode === 'edit' ? init.alert : null;
  const startEx: ExchangeId = edit?.exchange ?? (init.mode === 'create' ? init.exchange : undefined) ?? 'binance';

  const [step, setStep] = useState(init.mode === 'create' && init.symbol ? 0 : 0);
  const [kind, setKind] = useState<AlertKind>(edit?.kind ?? (init.mode === 'create' ? init.kind : undefined) ?? 'price');
  const [exchange, setExchange] = useState<ExchangeId>(startEx);
  const [market, setMarket] = useState<MarketType>(marketOfExchange(startEx));
  const [sound, setSound] = useState<AlertSound>(edit?.sound ?? 'beep');
  const [channels, setChannels] = useState(edit?.channels ?? { browser: true, telegram: false, push: false });
  const [mode, setMode] = useState<AlertMode>(edit?.mode ?? 'once');
  const [repeat, setRepeat] = useState(String(edit?.repeatMinutes ?? 5));
  const [symbol, setSymbol] = useState(edit?.symbol ?? (init.mode === 'create' ? init.symbol : undefined) ?? '');
  const [level, setLevel] = useState(edit?.price ? String(edit.price.level) : init.mode === 'create' && init.price ? String(Number(init.price.toPrecision(8))) : '');
  const [conditions, setConditions] = useState<Condition[]>(edit?.conditions?.length ? edit.conditions : [newCondition()]);
  const [query, setQuery] = useState('');
  const [dir, setDir] = useState<{ ex: ExchangeId; list: DirectoryEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tgWaiting, setTgWaiting] = useState(false);
  const [busy, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  const venues = EXCHANGE_IDS.filter((id) => marketOfExchange(id) === market);
  const tg = s.channels.telegram;
  const push = s.channels.push;

  // The venue's coins for the search (cached 30 s by the directory).
  useEffect(() => {
    let on = true;
    getDirectory(exchange).then((list) => { if (on) setDir({ ex: exchange, list }); }).catch(() => { if (on) setDir({ ex: exchange, list: [] }); });
    return () => { on = false; };
  }, [exchange]);
  const coins = dir?.ex === exchange ? dir.list : null;
  const coin = coins?.find((c) => c.symbol === symbol) ?? null;
  const hits = useMemo(() => (coins ? rankBy(coins, (c) => c.symbol, query).slice(0, query ? 40 : 12) : []), [coins, query]);

  // "Connect Telegram bot": re-check every 3 s until the bot has linked the account.
  useEffect(() => {
    if (!tgWaiting) return undefined;
    const until = Date.now() + TG_WAIT_MS;
    const t = setInterval(() => {
      if (Date.now() > until) { setTgWaiting(false); return; }
      void refreshAlerts().then(() => {
        if (!alertsClient.getSnapshot().channels.telegram.linked) return;
        setTgWaiting(false);
        setChannels((c) => ({ ...c, telegram: true }));
        setNotice('Telegram connected — alerts will be sent there too.');
      });
    }, 3_000);
    return () => clearInterval(t);
  }, [tgWaiting]);

  const pickMarket = (m: MarketType) => {
    setMarket(m);
    if (marketOfExchange(exchange) !== m) { const first = EXCHANGE_IDS.find((id) => marketOfExchange(id) === m); if (first) { setExchange(first); setSymbol(''); } }
  };
  const pickExchange = (id: ExchangeId) => { setExchange(id); setSymbol(''); };

  const price = coin?.price ?? null;
  const levelNum = Number(level);
  const direction: 'above' | 'below' = price !== null && levelNum > 0 ? (levelNum >= price ? 'above' : 'below') : edit?.price?.direction ?? 'above';

  const input = () => ({
    ...(edit ? { id: edit.id } : {}),
    kind, exchange, symbol, sound, channels, mode, repeatMinutes: Number(repeat),
    ...(kind === 'price' ? { price: { level: levelNum, direction } } : { conditions }),
  });

  const next = () => {
    setError(null);
    if (step === 1 && mode === 'infinite') {
      const r = Number(repeat);
      if (!(r >= REPEAT_RANGE.min && r <= REPEAT_RANGE.max)) { setError(`Repeat interval: ${REPEAT_RANGE.min}–${REPEAT_RANGE.max} minutes.`); return; }
    }
    setStep((x) => Math.min(2, x + 1));
    if (step === 1) setTimeout(() => searchRef.current?.focus(), 50);
  };

  const save = () => {
    setError(null);
    const v = validateAlertInput(input());
    if (!v.ok) { setError(v.error); return; }
    if (channels.browser && typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
    start(async () => {
      const r = await saveAlert(input()).catch(() => ({ ok: false as const, error: 'Couldn’t reach the server. Try again.' }));
      if (!r.ok) { setError(r.error); return; }
      upsertLocal(r.data);
      closeAlertWizard();
    });
  };

  const onTelegramConnect = () => {
    const opening = openTelegramLink(); // in the click itself: see openTelegramLink
    start(async () => {
      const err = await opening;
      if (err) { setError(err); return; }
      setTgWaiting(true);
      setNotice('Press Start in Telegram — this updates by itself.');
    });
  };

  const onPush = (on: boolean) => {
    if (!on) { setChannels((c) => ({ ...c, push: false })); return; }
    if (!push.key) return;
    start(async () => {
      const err = await enablePush(push.key!).catch(() => 'Couldn’t enable push notifications.');
      if (err) setError(err); else setChannels((c) => ({ ...c, push: true }));
    });
  };

  const onBrowser = (on: boolean) => {
    setChannels((c) => ({ ...c, browser: on }));
    if (on && typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
  };

  const setCond = (i: number, patch: Partial<Condition>) => setConditions((list) => list.map((c, k) => {
    if (k !== i) return c;
    const merged = { ...c, ...patch };
    if (patch.metric && !WINDOWS_FOR[patch.metric].includes(merged.window)) merged.window = WINDOWS_FOR[patch.metric][0];
    return merged;
  }));

  const footer = (
    <>
      {step > 0 && <button type="button" className={`${GHOST_BTN} gap-1.5`} onClick={() => { setError(null); setStep(step - 1); }} data-wizard-back><ChevronLeft size={14} aria-hidden="true" />Back</button>}
      <span className="ml-auto" />
      <button type="button" className={GHOST_BTN} onClick={closeAlertWizard}>Cancel</button>
      {step < 2
        ? <button type="button" className={`${PRIMARY_BTN} gap-1.5`} onClick={next} data-wizard-next>Next</button>
        : <button type="button" className={`${PRIMARY_BTN} gap-1.5`} onClick={save} disabled={busy || !symbol} data-wizard-save><Check size={14} aria-hidden="true" />{edit ? 'Save alert' : 'Create alert'}</button>}
    </>
  );

  return (
    <Modal title={edit ? 'Edit alert' : 'Create alert'} icon={<Bell size={16} aria-hidden="true" />} onClose={closeAlertWizard} maxWidth={640} data="alert-wizard" footer={footer}>
      <ol className="m-0 flex list-none items-center gap-2 border-0 border-b border-solid border-sx-line px-5 py-3 text-xs" aria-label="Steps" data-wizard-step={step}>
        {STEPS.map((label, i) => (
          <li key={label} className="flex min-w-0 items-center gap-2" aria-current={i === step ? 'step' : undefined}>
            {i > 0 && <span className={`h-px w-6 shrink-0 ${i <= step ? 'bg-sx-up' : 'bg-sx-line2'}`} aria-hidden="true" />}
            <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${i < step ? 'bg-sx-up text-white' : i === step ? 'border border-solid border-sx-up text-sx-up' : 'border border-solid border-sx-line2 text-sx-muted'}`}>{i < step ? <Check size={11} /> : i + 1}</span>
            <span className={`truncate font-semibold ${i === step ? 'text-sx-text' : 'text-sx-muted'} ${i === step ? '' : 'max-sm:hidden'}`}>{label}</span>
          </li>
        ))}
      </ol>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-5 py-4">
        {notice && <div role="status" className="rounded-lg border border-solid border-sx-up/30 bg-sx-up/10 px-3 py-2 text-xs text-[#9BDDB9]">{notice}</div>}

        {step === 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Alert type">
            {([
              ['price', 'Price alert', 'When the price reaches a level you set — up or down.'],
              ['complex', 'Complex alert', 'When conditions hold together: % move in a window, volume spike, funding, open-interest change, price.'],
            ] as const).map(([id, title, text]) => (
              <button key={id} type="button" role="radio" aria-checked={kind === id} data-kind={id} onClick={() => setKind(id)}
                className={`${BTN_RESET} flex flex-col gap-1.5 rounded-xl border border-solid p-4 text-left transition-colors ${kind === id ? 'border-sx-up bg-sx-up/[0.08]' : 'border-sx-line2 bg-white/[0.02] hover:border-[#3A3E46]'}`}>
                <span className="text-sm font-bold">{title}</span>
                <span className="text-xs text-sx-muted">{text}</span>
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <>
            <Section title="Exchange & market">
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedGroup label="Market" options={MARKETS} value={market} onChange={pickMarket} />
                <DropdownSelect<ExchangeId> label="Exchange" options={venues} value={exchange} onChange={pickExchange} render={(id) => <ExchangeLabel id={id} size={14} />} />
              </div>
            </Section>
            <Section title="Sound" hint="Played in the terminal when the alert fires. Voice reads the coin and the trigger out loud.">
              <div className="flex items-center gap-2">
                <SegmentedGroup label="Sound" options={SOUNDS} value={sound} onChange={setSound} />
                <button type="button" className={`${GHOST_BTN} gap-1.5`} disabled={sound === 'off'} onClick={() => playSound(sound, { symbol: symbol || 'BTC', exchange, text: 'Price rose to 80,000' })} data-sound-test><Volume2 size={14} aria-hidden="true" />Test</button>
              </div>
            </Section>
            <Section title="Notifications">
              <ChannelRow data="browser" icon={<Monitor size={16} />} title="Browser" hint="A desktop notification while the terminal is open." checked={channels.browser} onChange={onBrowser} />
              <ChannelRow data="telegram" icon={<MessageCircle size={16} />} title="Telegram"
                hint={!tg.configured ? 'Telegram isn’t configured on this server.' : tg.linked ? 'Sent by the Screenerix bot to your Telegram.' : 'Connect the Screenerix bot first.'}
                checked={channels.telegram && tg.linked} disabled={!tg.linked}
                onChange={(v) => setChannels((c) => ({ ...c, telegram: v }))}
                action={tg.configured && !tg.linked ? <button type="button" className={`${GHOST_BTN} shrink-0`} onClick={onTelegramConnect} disabled={busy} data-telegram-connect>{tgWaiting ? 'Waiting…' : 'Connect Telegram bot'}</button> : undefined} />
              <ChannelRow data="push" icon={<Smartphone size={16} />} title="Push notifications"
                hint={push.configured ? 'Arrive even with Screenerix closed (this browser / device).' : 'Push isn’t configured on this server.'}
                checked={channels.push} disabled={!push.configured} onChange={onPush} />
            </Section>
            <Section title="Alert mode" hint={mode === 'once' ? 'Fires once, then moves to Archived.' : 'Keeps firing while the condition holds, at most once per interval.'}>
              <div className="flex flex-wrap items-center gap-3">
                <SegmentedGroup label="Alert mode" options={MODES} value={mode} onChange={setMode} />
                {mode === 'infinite' && (
                  <label className="flex items-center gap-2 text-xs text-sx-muted">Repeat every
                    <input className={`${INPUT} w-20`} type="number" min={REPEAT_RANGE.min} max={REPEAT_RANGE.max} value={repeat} onChange={(e) => setRepeat(e.target.value)} aria-label="Repeat interval (minutes)" data-repeat />
                    min
                  </label>
                )}
              </div>
            </Section>
          </>
        )}

        {step === 2 && (
          <>
            <Section title="Coin" hint={`On ${exchange === 'coinbase' ? 'Coinbase spot (USD)' : 'USDT perpetual futures'}.`}>
              {symbol ? (
                <div className="flex items-center gap-3 rounded-xl border border-solid border-sx-up/40 bg-sx-up/[0.06] px-3 py-2.5" data-picked={symbol}>
                  <ExchangeIcon id={exchange} size={16} />
                  <span className="font-bold">{symbol}</span>
                  {coin && <span className="text-xs text-sx-muted">{fmtPrice(coin.price)}{coin.change24h !== null && <> · <span style={{ color: coin.change24h >= 0 ? '#30A46C' : '#E5484D' }}>{fmtPct(coin.change24h)}</span></>}</span>}
                  <button type="button" className={`${ICON_BTN} ml-auto`} aria-label="Change coin" onClick={() => { setSymbol(''); setTimeout(() => searchRef.current?.focus(), 30); }}><X size={14} /></button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-sx-muted" aria-hidden="true" />
                    <input ref={searchRef} className={`${INPUT} pl-8`} placeholder="Search coin, e.g. BTC" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search coin" data-coin-search
                      onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) { setSymbol(hits[0].symbol); setQuery(''); } }} />
                  </div>
                  <ul className="m-0 grid max-h-60 list-none grid-cols-1 gap-0.5 overflow-auto p-0" data-coin-results>
                    {!coins && <li className="px-2 py-1.5 text-xs text-sx-muted">Loading coins…</li>}
                    {coins && hits.length === 0 && <li className="px-2 py-1.5 text-xs text-sx-muted">No coin matches “{query}”.</li>}
                    {hits.map((c) => (
                      <li key={c.symbol}>
                        <button type="button" className={`${BTN_RESET} flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-white/[0.05]`} onClick={() => { setSymbol(c.symbol); setQuery(''); }} data-coin={c.symbol}>
                          <span className="w-20 font-bold">{c.symbol}</span>
                          <span className="tabular-nums">{fmtPrice(c.price)}</span>
                          <span className="ml-auto text-xs tabular-nums text-sx-muted">{fmtUsd(c.volume)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>

            {kind === 'price' ? (
              <Section title="Target price">
                <input className={`${INPUT} max-w-xs`} type="number" min={0} step="any" inputMode="decimal" placeholder={price ? fmtPrice(price) : 'Price'} value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Target price" data-target-price />
                {symbol && levelNum > 0 && (
                  <p className="m-0 text-xs text-sx-muted" data-price-preview>
                    Fires when {symbol} {direction === 'above' ? 'rises' : 'falls'} to <b className="text-sx-text">{fmtPrice(levelNum)}</b>
                    {price ? <> ({fmtPct(levelNum / price - 1)} from {fmtPrice(price)})</> : null}.
                  </p>
                )}
              </Section>
            ) : (
              <Section title="Conditions" hint="All of them must hold at the same time (AND).">
                {conditions.map((c, i) => {
                  const m = METRIC_BY_ID.get(c.metric)!;
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-2" data-condition={i}>
                      {i > 0 && <span className="w-full text-[10px] font-bold uppercase tracking-wide text-sx-muted">and</span>}
                      <DropdownSelect<Metric> label="Metric" options={METRICS.map((x) => x.id)} value={c.metric} onChange={(metric) => setCond(i, { metric })} render={(id) => METRIC_BY_ID.get(id)!.label} />
                      {m.windowed && <SegmentedGroup label="Window" options={WINDOWS_FOR[c.metric].map((w) => ({ id: w, label: w }))} value={c.window} onChange={(window) => setCond(i, { window })} padX="px-2" />}
                      <SegmentedGroup label="Comparison" options={OPS.filter((o) => o.id !== 'abs>' || m.unit === '%')} value={c.op} onChange={(op) => setCond(i, { op })} padX="px-2" />
                      <span className="flex items-center gap-1">
                        <input className={`${INPUT} w-24`} type="number" step="any" value={Number.isFinite(c.value) ? c.value : ''} onChange={(e) => setCond(i, { value: e.target.value === '' ? NaN : Number(e.target.value) })} aria-label={`${m.label} value`} data-condition-value />
                        <span className="text-xs text-sx-muted">{m.unit}</span>
                      </span>
                      {conditions.length > 1 && <button type="button" className={ICON_BTN} aria-label="Remove condition" onClick={() => setConditions((l) => l.filter((_, k) => k !== i))}><Trash2 size={14} /></button>}
                    </div>
                  );
                })}
                {conditions.length < MAX_CONDITIONS && <button type="button" className={`${GHOST_BTN} gap-1.5 self-start`} onClick={() => setConditions((l) => [...l, newCondition()])} data-add-condition><Plus size={14} aria-hidden="true" />Add condition</button>}
                <p className="m-0 text-xs text-sx-muted" data-complex-preview>Fires when {symbol || 'the coin'}: {conditions.filter((c) => Number.isFinite(c.value)).map(describeCondition).join(' AND ') || '—'}</p>
              </Section>
            )}
          </>
        )}

        {error && <div role="alert" className="rounded-lg border border-solid border-sx-down/40 bg-sx-down/10 px-3 py-2 text-xs text-[#F4B3B5]" data-wizard-error>{error}</div>}
      </div>
    </Modal>
  );
}
