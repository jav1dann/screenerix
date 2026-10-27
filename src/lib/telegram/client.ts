/**
 * Browser side of Telegram linking: get a one-time deep link from `/api/telegram/link-token`
 * and send the user to the bot, where pressing Start connects the account.
 */

/** The bot's @username for display (`NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`, inlined at build time). */
export const TELEGRAM_BOT_USERNAME: string | null = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '') || null;

/**
 * Call synchronously from a click handler. The tab is opened before the request: a window opened
 * after an `await` loses the click's user activation and is blocked as a popup (Safari, iOS,
 * Firefox). Without a tab (blocked anyway) this page itself goes to Telegram.
 * Resolves to null once Telegram is opening, or to an error message.
 */
export function openTelegramLink(): Promise<string | null> {
  const tab = window.open('', '_blank');
  return fetch('/api/telegram/link-token', { method: 'POST' })
    .then(async (res) => {
      const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || typeof body?.url !== 'string') throw new Error(body?.error ?? 'Couldn’t start connecting Telegram. Try again.');
      if (tab) {
        tab.opener = null;
        tab.location.href = body.url;
      } else {
        window.location.href = body.url;
      }
      return null;
    })
    .catch((e: unknown) => {
      tab?.close();
      return e instanceof TypeError ? 'Couldn’t reach the server. Try again.' : (e as Error).message;
    });
}
