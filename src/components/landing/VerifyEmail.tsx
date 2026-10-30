'use client';

/**
 * Email verification step after registering (or signing in to an unverified account): six
 * digit boxes (typing, paste and one-time-code autofill all work; a full code submits itself),
 * and "Resend code" behind the server's cooldown, counted down here.
 */
import { startTransition, useActionState, useEffect, useRef, useState, useTransition } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import { resendVerification, verifyEmail } from '@/app/actions/auth';
import type { AuthState } from '@/app/actions/auth';
import type { Dict } from '@/lib/landing/i18n/en';
import { fill, fillParts } from '@/lib/landing/i18n/locales';
import { COLORS } from '@/lib/theme';

const LENGTH = 6;
const INITIAL: AuthState = { error: null };
const mmss = (ms: number) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export default function VerifyEmail({ email, resendIn, next, onBack, t }: {
  email: string;
  /** Milliseconds until the server allows another code. */
  resendIn: number;
  next: string;
  onBack: () => void;
  t: Dict['auth'];
}) {
  const [state, action, verifying] = useActionState(verifyEmail, INITIAL);
  const [digits, setDigits] = useState<string[]>(() => Array(LENGTH).fill(''));
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const form = useRef<HTMLFormElement>(null);
  const [resendAt, setResendAt] = useState(() => Date.now() + resendIn);
  const [now, setNow] = useState(() => Date.now());
  const [resending, startResend] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const wait = Math.max(0, resendAt - now);

  // Ticks once a second while the cooldown runs.
  useEffect(() => {
    if (resendAt <= now) return;
    const id = setTimeout(() => setNow(Date.now()), Math.min(1000, resendAt - now));
    return () => clearTimeout(id);
  }, [now, resendAt]);

  const submit = (code: string[]) => {
    if (!form.current || code.join('').length !== LENGTH) return;
    const fd = new FormData(form.current);
    fd.set('code', code.join(''));
    setNote(null);
    startTransition(() => action(fd));
  };

  /** Puts typed / pasted digits from box `i` onward; a completed code is sent right away. */
  const put = (i: number, raw: string) => {
    const typed = raw.replace(/\D/g, '');
    const nextDigits = [...digits];
    if (!typed) { nextDigits[i] = ''; setDigits(nextDigits); return; }
    let k = i;
    for (const ch of typed) { if (k >= LENGTH) break; nextDigits[k++] = ch; }
    setDigits(nextDigits);
    boxes.current[Math.min(k, LENGTH - 1)]?.focus();
    if (nextDigits.every(Boolean) && !verifying) submit(nextDigits);
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      e.preventDefault();
      const nextDigits = [...digits];
      nextDigits[i - 1] = '';
      setDigits(nextDigits);
      boxes.current[i - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && i > 0) boxes.current[i - 1]?.focus();
    else if (e.key === 'ArrowRight' && i < LENGTH - 1) boxes.current[i + 1]?.focus();
  };

  const onPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    put(i, e.clipboardData.getData('text'));
  };

  const resend = () => startResend(async () => {
    const r = await resendVerification(email, t.lang);
    setResendAt(Date.now() + r.resendIn);
    setNow(Date.now());
    setNote(r.ok ? { ok: true, text: t.resent } : { ok: false, text: r.error ?? t.resend });
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }} data-verify-email>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h3 style={{ fontSize: 20 }}>{t.verifyTitle}</h3>
        <span className="lx-muted" style={{ fontSize: 13 }}>
          {fillParts(t.verifySub, { email: <strong key="e" style={{ color: COLORS.text, fontWeight: 600 }}>{email}</strong> })}
        </span>
      </div>
      <form ref={form} onSubmit={(e) => { e.preventDefault(); submit(digits); }} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="code" value={digits.join('')} />
        <div className="lx-otp" role="group" aria-label={t.codeLabel}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { boxes.current[i] = el; }}
              className="lx-input lx-otp-box"
              value={d}
              // Typing into a filled box (caret beside its digit) keeps only the new digit.
              onChange={(e) => { const v = e.target.value; put(i, d && v.length === 2 ? (v[0] === d ? v[1] : v[0]) : v); }}
              onKeyDown={(e) => onKey(i, e)}
              onPaste={(e) => onPaste(i, e)}
              onFocus={(e) => e.target.select()}
              inputMode="numeric"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              maxLength={LENGTH}
              aria-label={`${t.codeLabel} ${i + 1}`}
              autoFocus={i === 0}
              disabled={verifying}
              data-otp={i}
            />
          ))}
        </div>
        {state.error && <span role="alert" data-verify-error style={{ fontSize: 13, color: COLORS.down }}>{state.error}</span>}
        <button type="submit" className="lx-btn lx-btn-primary" disabled={verifying || digits.join('').length !== LENGTH} aria-busy={verifying}>
          {verifying ? t.verifying : t.verifySubmit}
        </button>
      </form>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', fontSize: 13 }}>
        <span className="lx-muted">
          {t.noCode}{' '}
          <button type="button" className="lx-link-btn" onClick={resend} disabled={wait > 0 || resending} data-resend>
            {resending ? t.resending : wait > 0 ? fill(t.resendIn, { time: mmss(wait) }) : t.resend}
          </button>
        </span>
        {note && <span role="status" style={{ color: note.ok ? COLORS.up : COLORS.down }}>{note.text}</span>}
        <button type="button" className="lx-link-btn lx-muted" onClick={onBack}>{t.back}</button>
      </div>
    </div>
  );
}
