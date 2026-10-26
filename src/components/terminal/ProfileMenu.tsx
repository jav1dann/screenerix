'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut } from '@/app/actions/auth';
import { IconChevron } from '@/components/shared/icons';
import { useNow } from '@/hooks/useDensities';
import { accessOf, DAY_MS, isAdmin } from '@/lib/auth/access';
import type { SessionUser } from '@/lib/auth/access';
import { openAccount } from '@/lib/account/accountUi';
import { openBilling } from '@/lib/billing/billingUi';
import { fmtDay } from '@/lib/billing/format';
import { openSettings } from '@/lib/settings/settingsUi';
import { COLORS } from '@/lib/theme';

/** "Ada Lovelace" → "AL"; a one-word name → its first two letters. */
const initialsOf = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase();
};
/** "Ada Lovelace" → "Ada L." */
const shortName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : (parts[0] ?? '');
};

/** "Free trial · 2d left", "PRO · until 24 Oct 2027", "Expired". */
function planBadge(user: SessionUser, now: number): { label: string; tone: 'admin' | 'ok' | 'warn' | 'bad' } {
  const { state, until } = accessOf(user, now);
  if (state === 'admin') return { label: 'Admin · Full access', tone: 'admin' };
  if (state === 'pro') return { label: `PRO · until ${fmtDay(until!)}`, tone: 'ok' };
  if (state === 'trial') {
    const left = until! - now;
    const text = left >= DAY_MS ? `${Math.ceil(left / DAY_MS)}d left` : `${Math.max(1, Math.ceil(left / 3_600_000))}h left`;
    return { label: `Free trial · ${text}`, tone: left < DAY_MS ? 'warn' : 'ok' };
  }
  return { label: 'Expired', tone: 'bad' };
}

const BADGE_STYLE = {
  admin: { background: 'rgba(180,140,255,0.16)', color: '#B48CFF' },
  ok: { background: COLORS.upBg, color: COLORS.up },
  warn: { background: 'rgba(245,197,66,0.14)', color: COLORS.alert },
  bad: { background: COLORS.downBg, color: COLORS.down },
} as const;

export default function ProfileMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  /** The Google avatar failed to load: fall back to initials. */
  const [pictureFailed, setPictureFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const admin = isAdmin(user);
  const now = useNow(60_000);
  const badge = planBadge(user, now);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="sx-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} style={{ padding: '3px 8px 3px 3px', borderRadius: 999 }}>
        {user.picture && !pictureFailed ? (
          // A 26px avatar from Google's image host: next/image's optimizer would add nothing here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.picture} alt="" width={26} height={26} referrerPolicy="no-referrer" onError={() => setPictureFailed(true)} data-avatar="google" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover', boxShadow: admin ? '0 0 0 1.5px #B48CFF' : undefined }} />
        ) : (
          <span style={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', background: admin ? 'linear-gradient(135deg,#B48CFF,#5B3D99)' : 'linear-gradient(135deg,#30A46C,#1E5C40)', color: '#fff', fontWeight: 700, fontSize: 10 }}>{initialsOf(user.name)}</span>
        )}
        <span data-profile-name>{shortName(user.name)}</span>
        <IconChevron />
      </button>
      {open && (
        <div className="sx-menu" role="menu">
          <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontWeight: 600 }}>{user.name}</span>
            <span className="sx-muted" style={{ fontSize: 12 }}>{user.email}</span>
            <span
              className="sx-tag"
              data-role-badge={user.role}
              data-plan-badge={badge.tone}
              title={admin ? 'Full access to every tool and setting' : undefined}
              style={{ alignSelf: 'flex-start', marginTop: 8, ...BADGE_STYLE[badge.tone] }}
            >
              {badge.label}
            </span>
          </div>
          <div className="sx-sep" />
          <button className="sx-menu-item" role="menuitem" onClick={() => { close(); openAccount('email'); }} data-account-open>Account settings</button>
          <button className="sx-menu-item" role="menuitem" onClick={() => { close(); openSettings(); }}>Terminal settings</button>
          <button className="sx-menu-item" role="menuitem" onClick={() => { close(); openBilling(); }} data-billing-open>{badge.tone === 'admin' ? 'Billing & plan' : accessOf(user, now).state === 'pro' ? 'Extend Pro' : 'Upgrade to Pro'}</button>
          <div className="sx-sep" />
          <form action={signOut}>
            <button type="submit" className="sx-menu-item" role="menuitem" style={{ color: COLORS.down, width: '100%' }}>Sign out</button>
          </form>
        </div>
      )}
    </div>
  );
}
