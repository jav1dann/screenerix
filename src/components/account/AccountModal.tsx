'use client';

/**
 * Account settings: email & password, linked accounts (Google, Telegram), billing.
 * Opened with `openAccount(section)`; mounted by the terminal (`AccountModalHost`).
 */
import { CreditCard, KeyRound, Link2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useState, useSyncExternalStore, useTransition } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cancelEmailChange, changeEmail, changePassword, confirmEmailChange, disconnectTelegram, getAccount, setNotifyLanguage, setPassword, unlinkGoogle } from '@/app/actions/account';
import type { AccountResult, AccountView } from '@/app/actions/account';
import { StatusPill } from '@/components/billing/PaymentStep';
import TelegramIcon from '@/components/shared/brand/TelegramIcon';
import { GoogleIcon } from '@/components/landing/GoogleButton';
import { accountUi, closeAccount, openAccount, selectAccountSection } from '@/lib/account/accountUi';
import type { AccountSection } from '@/lib/account/accountUi';
import { openBilling } from '@/lib/billing/billingUi';
import { fmtDay, fmtUsdt } from '@/lib/billing/format';
import { PERIODS } from '@/lib/billing/plans';
import { openTelegramLink, TELEGRAM_BOT_USERNAME } from '@/lib/telegram/client';
import { LANG_LABEL, LANGS } from '@/lib/telegram/i18n';

const SECTIONS: Array<{ id: AccountSection; label: string; icon: ReactNode }> = [
  { id: 'email', label: 'Email & password', icon: <KeyRound size={15} aria-hidden="true" /> },
  { id: 'linked', label: 'Linked accounts', icon: <Link2 size={15} aria-hidden="true" /> },
  { id: 'billing', label: 'Billing', icon: <CreditCard size={15} aria-hidden="true" /> },
];

/** Notices for the `?account=` code the Google link flow returns with. */
const LINK_NOTICE: Record<string, { tone: 'ok' | 'error'; text: string }> = {
  google_linked: { tone: 'ok', text: 'Google account connected.' },
  google_in_use: { tone: 'error', text: 'That Google account is already connected to another Screenerix account.' },
  google_session: { tone: 'error', text: 'Your session changed while connecting Google. Try again.' },
  google_cancelled: { tone: 'error', text: 'Connecting Google was cancelled.' },
  google_expired: { tone: 'error', text: 'That attempt expired. Press Connect again.' },
  google_unverified: { tone: 'error', text: 'That Google account’s email isn’t verified.' },
  google_unavailable: { tone: 'error', text: 'Google sign-in isn’t configured on this server.' },
  google_failed: { tone: 'error', text: 'Connecting Google didn’t work. Try again.' },
};

/** Mounted in the terminal: opens itself for `?account=<code>` (back from Google) and cleans the URL. */
export default function AccountModalHost() {
  const ui = useSyncExternalStore(accountUi.subscribe, accountUi.getSnapshot, accountUi.getServerSnapshot);
  useEffect(() => {
    const u = new URL(window.location.href);
    const code = u.searchParams.get('account');
    if (!code) return;
    u.searchParams.delete('account');
    window.history.replaceState(null, '', u.pathname + u.search + u.hash);
    openAccount('linked', LINK_NOTICE[code] ?? LINK_NOTICE.google_failed);
  }, []);
  if (!ui.open) return null;
  return <AccountModal section={ui.section} notice={ui.notice} />;
}

function AccountModal({ section, notice }: { section: AccountSection; notice?: { tone: 'ok' | 'error'; text: string } }) {
  const router = useRouter();
  const [account, setAccount] = useState<AccountView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tone: 'ok' | 'error'; text: string } | null>(notice ?? null);

  useEffect(() => {
    let on = true;
    getAccount().then((r) => { if (on) { if (r.ok) setAccount(r.account); else setError(r.error); } }).catch(() => { if (on) setError('Couldn’t load your account. Check your connection.'); });
    return () => { on = false; };
  }, []);

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    closeAccount();
  });
  useEffect(() => {
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  /** Apply an action's result: new account data, a message, and fresh server data (name / email in the header). */
  const apply = (r: AccountResult) => {
    if (r.ok) {
      setAccount(r.account);
      setFlash(r.message ? { tone: 'ok', text: r.message } : null);
      router.refresh();
      return true;
    }
    setFlash({ tone: 'error', text: r.error });
    return false;
  };

  return createPortal(
    <div className="bx-overlay" data-account-modal data-section={section}>
      <button type="button" className="bx-backdrop" aria-label="Close" onClick={closeAccount} />
      <div className="bx-modal ac-modal" role="dialog" aria-modal="true" aria-labelledby="ac-title">
        <div className="bx-head">
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span className="bx-title" id="ac-title">Account settings</span>
            <span className="bx-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{account?.email ?? ' '}</span>
          </div>
          <button type="button" className="bx-x" onClick={closeAccount} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="ac-body">
          <nav className="ac-nav" role="tablist" aria-label="Account sections">
            {SECTIONS.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={section === s.id} className="ac-tab" data-account-tab={s.id} onClick={() => { setFlash(null); selectAccountSection(s.id); }}>
                {s.icon}<span>{s.label}</span>
              </button>
            ))}
          </nav>
          <div className="ac-pane" role="tabpanel">
            {flash && <div className="bx-note" data-tone={flash.tone === 'ok' ? 'ok' : 'error'} role="status" data-account-flash={flash.tone}>{flash.text}</div>}
            {error && <div className="bx-note" data-tone="error" role="alert">{error}</div>}
            {!account && !error && <div className="bx-muted" style={{ padding: 8 }}>Loading…</div>}
            {account && section === 'email' && <EmailSection account={account} apply={apply} />}
            {account && section === 'linked' && <LinkedSection account={account} apply={apply} setAccount={setAccount} setFlash={setFlash} />}
            {account && section === 'billing' && <BillingSection account={account} />}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type Apply = (r: AccountResult) => boolean;

function Card({ title, hint, children, data }: { title: string; hint?: string; children: ReactNode; data?: string }) {
  return (
    <section className="ac-card" data-account-card={data}>
      <div className="ac-card-head"><h3>{title}</h3>{hint && <p>{hint}</p>}</div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="ac-field"><span className="bx-label" style={{ marginBottom: 0 }}>{label}</span>{children}</label>;
}

function EmailSection({ account, apply }: { account: AccountView; apply: Apply }) {
  const [busy, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const run = (fn: () => Promise<AccountResult>, after?: () => void) => start(async () => {
    try { if (apply(await fn())) after?.(); } catch { apply({ ok: false, error: 'Couldn’t reach the server. Try again.' }); }
  });
  const value = (form: FormEvent<HTMLFormElement>, name: string) => String(new FormData(form.currentTarget).get(name) ?? '');

  return (
    <>
      <Card title="Email" hint="Where you sign in and how we identify your account." data="email">
        <div className="ac-row">
          <span className="ac-value" data-account-email>{account.email}</span>
          {!editing && !account.pendingEmail && <button type="button" className="bx-btn" onClick={() => setEditing(true)} data-change-email>Change</button>}
        </div>
        {account.pendingEmail && (
          <form className="ac-form" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const code = value(e, 'code'); run(() => confirmEmailChange(code), () => f.reset()); }} data-email-confirm>
            <Field label={`Code sent to ${account.pendingEmail}`}>
              <input className="ac-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} placeholder="6-digit code" required autoFocus />
            </Field>
            <div className="ac-actions">
              <button type="button" className="bx-btn" disabled={busy} onClick={() => run(() => cancelEmailChange())}>Cancel change</button>
              <button type="submit" className="bx-btn bx-btn-primary" disabled={busy}>{busy ? 'Checking…' : 'Confirm email'}</button>
            </div>
          </form>
        )}
        {editing && !account.pendingEmail && (account.hasPassword ? (
          <form className="ac-form" onSubmit={(e) => { e.preventDefault(); const em = value(e, 'email'), pw = value(e, 'password'); run(() => changeEmail(em, pw), () => setEditing(false)); }} data-email-form>
            <Field label="New email"><input className="ac-input" name="email" type="email" autoComplete="email" required autoFocus /></Field>
            <Field label="Current password"><input className="ac-input" name="password" type="password" autoComplete="current-password" required /></Field>
            <div className="ac-actions">
              <button type="button" className="bx-btn" onClick={() => setEditing(false)}>Cancel</button>
              <button type="submit" className="bx-btn bx-btn-primary" disabled={busy}>{busy ? 'Sending code…' : 'Send code'}</button>
            </div>
          </form>
        ) : (
          <div className="bx-note" data-tone="info">This account signs in with Google. Set a password below first — it confirms changes like a new email.</div>
        ))}
      </Card>

      {account.hasPassword ? (
        <Card title="Password" hint="Changing it signs out your other devices." data="password">
          <form className="ac-form" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const cur = value(e, 'current'), next = value(e, 'next'); run(() => changePassword(cur, next), () => f.reset()); }} data-password-form>
            <Field label="Current password"><input className="ac-input" name="current" type="password" autoComplete="current-password" required /></Field>
            <Field label="New password (at least 8 characters)"><input className="ac-input" name="next" type="password" autoComplete="new-password" minLength={8} required /></Field>
            <div className="ac-actions"><button type="submit" className="bx-btn bx-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></div>
          </form>
        </Card>
      ) : (
        <Card title="Add email sign-in" hint={`Set a password to also sign in with ${account.email}.`} data="set-password">
          <form className="ac-form" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const pw = value(e, 'password'); run(() => setPassword(pw), () => f.reset()); }} data-set-password-form>
            <Field label="Password (at least 8 characters)"><input className="ac-input" name="password" type="password" autoComplete="new-password" minLength={8} required /></Field>
            <div className="ac-actions"><button type="submit" className="bx-btn bx-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button></div>
          </form>
        </Card>
      )}
    </>
  );
}

const TG_WAIT_MS = 2 * 60_000;

function LinkedSection({ account, apply, setAccount, setFlash }: {
  account: AccountView; apply: Apply;
  setAccount: (a: AccountView) => void;
  setFlash: (f: { tone: 'ok' | 'error'; text: string } | null) => void;
}) {
  const [busy, start] = useTransition();
  const [waiting, setWaiting] = useState(false);
  const linked = account.telegram.linked;

  // After "Connect Telegram": re-check every 3 s until the bot has linked the account (2 minutes at most).
  useEffect(() => {
    if (!waiting || linked) return undefined;
    const until = Date.now() + TG_WAIT_MS;
    const t = setInterval(() => {
      if (Date.now() > until) { setWaiting(false); return; }
      getAccount().then((r) => {
        if (r.ok && r.account.telegram.linked) { setAccount(r.account); setWaiting(false); setFlash({ tone: 'ok', text: 'Telegram connected.' }); }
      }).catch(() => { /* next tick */ });
    }, 3_000);
    return () => clearInterval(t);
  }, [waiting, linked, setAccount, setFlash]);

  const onTelegram = () => {
    const opening = openTelegramLink(); // in the click itself: see openTelegramLink
    start(async () => {
      const error = await opening;
      if (error) { setFlash({ tone: 'error', text: error }); return; }
      setWaiting(true);
      setFlash(null);
    });
  };

  return (
    <Card title="Linked accounts" hint={`Sign in with Google, and get alerts in Telegram${TELEGRAM_BOT_USERNAME ? ` from @${TELEGRAM_BOT_USERNAME}` : ''}.`} data="linked">
      <div className="ac-link" data-linked="google" data-connected={account.google.linked}>
        <span className="ac-link-logo"><GoogleIcon size={22} /></span>
        <span className="ac-link-text">
          <span className="ac-link-name">Google</span>
          {account.google.linked
            ? <span className="bx-fine">Connected · ID <code data-google-id>{account.google.sub}</code></span>
            : <span className="bx-fine">Not connected{account.google.configured ? '' : ' · not configured on this server'}</span>}
        </span>
        {account.google.linked
          ? <button type="button" className="bx-btn" disabled={busy} onClick={() => start(async () => { apply(await unlinkGoogle()); })} data-google-disconnect>Disconnect</button>
          : <a className="bx-btn" href="/api/auth/google?mode=link" aria-disabled={!account.google.configured} onClick={(e) => { if (!account.google.configured) e.preventDefault(); }} data-google-connect>Connect</a>}
      </div>
      <div className="ac-link" data-linked="telegram" data-connected={linked}>
        <span className="ac-link-logo"><TelegramIcon size={22} /></span>
        <span className="ac-link-text">
          <span className="ac-link-name">Telegram</span>
          {linked ? (
            <span className="bx-fine" data-telegram-status="connected">
              Connected as {account.telegram.username ? <span data-telegram-username>@{account.telegram.username}</span> : account.telegram.name ?? 'Telegram user'} · ID <code data-telegram-id>{account.telegram.id}</code>
              {account.telegram.linkedAt ? ` · since ${fmtDay(account.telegram.linkedAt)}` : ''}
            </span>
          ) : (
            <span className="bx-fine" data-telegram-status={waiting ? 'waiting' : 'not-connected'}>{!account.telegram.configured ? 'Telegram isn’t configured on this server' : waiting ? 'Waiting for you to press Start in Telegram…' : 'Not connected · alerts can be sent to Telegram'}</span>
          )}
        </span>
        {linked
          ? <button type="button" className="bx-btn" disabled={busy} onClick={() => start(async () => { apply(await disconnectTelegram()); })} data-telegram-disconnect>Disconnect</button>
          : <button type="button" className="bx-btn bx-btn-primary" disabled={busy || !account.telegram.configured} onClick={onTelegram} data-telegram-connect>{waiting ? 'Open Telegram again' : 'Connect Telegram'}</button>}
      </div>
      <div className="ac-lang" data-alert-language>
        <span className="ac-link-text">
          <span className="ac-link-name">Alert language</span>
          <span className="bx-fine">Telegram and push alerts, and the bot’s replies. You can also change it in the bot with /language.</span>
        </span>
        <div className="ac-langs" role="radiogroup" aria-label="Alert language">
          {LANGS.map((l) => (
            <button key={l} type="button" role="radio" className="ac-lang-opt" aria-checked={(account.lang ?? 'en') === l} disabled={busy}
              onClick={() => { if (account.lang !== l) start(async () => { apply(await setNotifyLanguage(l).catch(() => ({ ok: false as const, error: 'Couldn’t reach the server. Try again.' }))); }); }}
              data-lang={l}>
              {LANG_LABEL[l]}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

const STATE_TEXT = { admin: 'Admin · full access', pro: 'Pro', trial: 'Free trial', expired: 'No active plan' } as const;

function BillingSection({ account }: { account: AccountView }) {
  const { state, until } = account.access;
  return (
    <>
      <Card title="Subscription" data="plan">
        <div className="ac-row">
          <span className="ac-plan">
            <span className="ac-plan-name" data-plan-state={state}>{STATE_TEXT[state]}</span>
            <span className="bx-fine" data-plan-until>
              {state === 'pro' && until ? `Active until ${fmtDay(until)}` : state === 'trial' && until ? `Trial ends ${fmtDay(until)}` : state === 'expired' ? (until ? `Ended ${fmtDay(until)}` : 'Trial ended') : 'No subscription needed'}
            </span>
          </span>
          {state !== 'admin' && (
            <button type="button" className="bx-btn bx-btn-primary" onClick={() => { closeAccount(); openBilling(); }} data-billing-upgrade>
              {state === 'pro' ? 'Extend Pro' : 'Upgrade to Pro'}
            </button>
          )}
        </div>
        <p className="bx-fine" style={{ margin: 0 }}>Pro is paid per month or year in USDT. It never renews by itself: each payment adds time to your plan.</p>
      </Card>
      <Card title="Payments" data="orders">
        {account.orders.length ? (
          <div className="bx-scroll">
            <table className="bx-table" data-account-orders>
              <thead><tr><th>Order</th><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                {account.orders.map((o) => (
                  <tr key={o.id}>
                    <td style={{ fontFamily: 'ui-monospace,monospace' }}>{o.id}</td>
                    <td>{fmtDay(o.createdAt)}</td>
                    <td>Pro · {PERIODS[o.period].label}</td>
                    <td>{fmtUsdt(o.payAmount)} USDT</td>
                    <td><StatusPill status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="bx-muted" style={{ margin: 0 }}>No payments yet.</p>}
        <a className="bx-link" href="/billing" style={{ alignSelf: 'flex-start' }}>Open the billing page</a>
      </Card>
    </>
  );
}
