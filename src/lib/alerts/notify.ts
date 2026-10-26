/**
 * In-browser side of a firing: a short beep (WebAudio) or the alert read out loud
 * (speechSynthesis), and a desktop notification through the service worker when one is
 * registered (works with the tab in the background), else the plain Notification API.
 */
import { ADAPTERS } from '@/lib/market/exchanges';
import type { AlertSound } from './types';
import type { EventView } from './client';

let ctx: AudioContext | null = null;

/** Two short tones; silently nothing where audio is blocked until a user gesture. */
export function beep(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    const t0 = ctx.currentTime;
    for (const [at, freq] of [[0, 880], [0.16, 1175]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.15);
    }
  } catch { /* no audio */ }
}

/** "BTC on Binance: price rose to 80,000" read out loud. */
export function speak(text: string): void {
  try {
    if (typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1.05;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { /* no speech */ }
}

/** Spoken form: symbol letters spaced out so "WIF" isn't read as a word, prices without symbols. */
export const spokenText = (e: Pick<EventView, 'symbol' | 'exchange' | 'text'>): string =>
  `${e.symbol.length <= 5 ? e.symbol.split('').join(' ') : e.symbol} on ${ADAPTERS[e.exchange].name}. ${e.text.replace(/\(alert at [^)]*\)/, '').replace(/\(now ([^)]*)\)/g, ', now $1')}`;

export function playSound(sound: AlertSound, e: Pick<EventView, 'symbol' | 'exchange' | 'text'>): void {
  if (sound === 'beep') beep();
  else if (sound === 'voice') { beep(); setTimeout(() => speak(spokenText(e)), 350); }
}

/** Desktop notification (if permitted). */
export async function showNotification(e: EventView): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const title = `${e.symbol} · ${ADAPTERS[e.exchange].name}`;
  const opts: NotificationOptions = { body: e.text, tag: `alert-${e.alertId}`, icon: '/icon.svg' };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) { await reg.showNotification(title, opts); return; }
    new Notification(title, opts);
  } catch { /* some browsers only allow notifications from a service worker */ }
}
