# Production checklist

What to set, check and click before and after a deploy. Variables are documented in
[`.env.example`](../.env.example); this page is the order of operations.

## 1. Environment

| Variable | When it's read | Notes |
| --- | --- | --- |
| `AUTH_SECRET` | runtime | 32+ random characters. Unset in production = an error in the log. |
| `AUTH_URL` | runtime | Public HTTPS origin, e.g. `https://screenerix.com` (Google redirect, payment webhooks, "Open Screenerix" links in Telegram). |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | runtime | Unset: an admin with a random password is printed to the log once. |
| `TELEGRAM_BOT_TOKEN` | runtime | From @BotFather. Server-only — never `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | **build** | Inlined by `next build`: set it in the build environment (CI, Docker build args), rebuild after a change. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | runtime | Web push. Generate once on the server (command in `.env.example`); `VAPID_SUBJECT` = your real `mailto:` / `https:`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | runtime | Redirect URI `https://<domain>/api/auth/google/callback`. |
| `NOWPAYMENTS_API_KEY` / `NOWPAYMENTS_IPN_SECRET` | runtime | Not `NOWPAYMENTS_SANDBOX`, not `PAYMENTS_PROVIDER=mock`. |
| `SX_DATA_DIR` | runtime | Accounts, orders, alerts, push subscriptions are files here — put it on a persistent volume. |

Never set in production: `TELEGRAM_API_BASE`, `PAYMENTS_ALLOW_MOCK`, `AUTH_INSECURE_COOKIE`.

Run **one** server instance: Telegram allows one poller per token, and the file storage has one writer.
A second instance (pages only) needs `SCANNER=off` and no `TELEGRAM_BOT_TOKEN`.

## 2. Before deploying

```bash
npm ci
npm run lint
npm run typecheck    # next typegen + tsc: route types exist without a build
npm run build          # with NEXT_PUBLIC_TELEGRAM_BOT_USERNAME set
npm run test:alerts    # alert worker + Telegram bot + push, against local mocks (needs openssl)
npm run test:strategies  # continuation-after-sweep rules + strength index, on synthetic candles
npm audit --omit=dev
```

All must pass cleanly. Build from a clean checkout (or `rm -rf .next`): an incremental `.next`
cache can serve stale CSS.

## 3. After deploying — server log

Expected on start:

```
[telegram] bot starting…
[telegram] bot @YourBot connected (long polling)
```

| Log line | Meaning | Fix |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN was rejected by Telegram — bot not started` | Wrong or revoked token | Paste the current token from @BotFather, restart |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME is @A, but TELEGRAM_BOT_TOKEN belongs to @B` | Variable names another bot | Fix the variable, **rebuild** (links already use @B meanwhile) |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME "…" isn't a valid bot username — ignored` | Typo | Fix it, rebuild |
| `another process is polling this bot token` (repeating) | Two servers on one token (or a dev machine) | Stop the other one |
| `getMe failed (…) — will keep trying` / `polling: fetch failed` | No route to `api.telegram.org` | Check outbound HTTPS / firewall |

## 4. Live Telegram alert flow — sanity check (≈ 5 minutes)

1. **Link.** Sign in → profile menu → **Account settings → Linked accounts** → **Connect Telegram**.
   Telegram opens `t.me/<YourBot>?start=…` → press **Start**.
   - Bot replies "✅ Connected to Screenerix as **you@…**" and shows 🇦🇿 / 🇬🇧 / 🇷🇺 buttons.
   - The page switches to "Connected as @your_username" by itself (within ~3 s).
2. **Language.** Tap a language in the bot → the buttons turn into a confirmation in that language.
   Account settings → **Alert language** shows the same choice (and changing it there works too).
3. **Alert.** Terminal → **Alerts → Create alert** → Price alert on a liquid coin (e.g. BTC, Binance
   Futures), level just past the current price, **Telegram** on, One-time → save.
   - Within ~10 s of the price crossing: a Telegram message "🔔 **BTC** · Binance Futures …" in the
     chosen language, with an "Open Screenerix" link to your domain.
   - The alert moves to **Triggered**; **Recent triggers** shows a green "Telegram".
4. **Push (optional).** Allow notifications in the wizard's Push option, repeat step 3 →
   a system notification; Recent triggers shows "Push · 1 device".
5. **Bot commands.** `/language` re-asks; `/stop` disconnects (Account settings shows "Not connected"
   after a reload); `/start` again shows how to reconnect.
6. **Failure path.** Block the bot in Telegram, fire another alert → Recent triggers shows
   "Telegram failed", the account is unlinked, and other users' alerts keep arriving.

If step 1's link opens the wrong bot, see the mismatch line in section 3.
