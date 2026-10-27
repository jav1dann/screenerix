/**
 * POST /api/telegram/link-token — a one-time Telegram deep link for the signed-in account:
 * `{ url: "https://t.me/<bot>?start=<token>", expiresAt }`. The user presses Start in Telegram
 * and the bot (lib/telegram/bot.ts) stores their chat on the account. POST only, so prefetching
 * never mints tokens; the session cookie is SameSite=Lax, so other sites can't call it as the user.
 */
import { getCurrentUser } from '@/lib/auth/dal';
import { startLink, telegramConfigured } from '@/lib/telegram/bot';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return json({ error: 'Your session has ended. Sign in again.' }, 401);
  if (!telegramConfigured()) return json({ error: 'Telegram isn’t configured on this server.' }, 503);
  const r = await startLink(user.id);
  return 'url' in r ? json(r) : json({ error: r.error }, 503);
}
