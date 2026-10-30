#!/usr/bin/env node
/**
 * `npm run test:alerts` — end-to-end test of the server-side alert pipeline and the Telegram bot
 * (scripts/alerts-harness.ts).
 *
 * Sets up an isolated world, then runs the harness with tsx (so `@/…` imports resolve):
 *   - a temporary data dir (never `.data/`), deleted afterwards
 *   - a mock Telegram Bot API on a free local port (records calls, feeds updates, injects failures)
 *   - a throwaway self-signed TLS cert for the local push service (web-push only speaks HTTPS);
 *     trusted through NODE_EXTRA_CA_CERTS — TLS verification stays on
 *   - fresh VAPID keys and a dummy bot token: `.env.local` and real services are never used
 * Needs `openssl` on PATH (for the cert).
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'sx-alerts-test-'));

/**
 * Mock Telegram Bot API. Records every call (`GET /__calls`), queues incoming updates
 * (`POST /__update` with an Update body; getUpdates long-polls them) and fails sendMessage on
 * purpose for some chats: 7001 → one 429 (retry_after 1), 7002 → 400 chat not found, 7003 → 403.
 */
function startMockTelegram() {
  const calls = [];
  const updates = [];
  let waiters = [];
  let nextId = 1;
  const flooded = new Set();
  const json = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === '/__calls') return json(res, calls);
      if (url.pathname === '/__update') {
        updates.push({ update_id: nextId++, ...body });
        waiters.forEach((w) => w());
        waiters = [];
        return json(res, { ok: true });
      }
      const method = url.pathname.split('/').pop();
      if (method === 'getUpdates') {
        const ready = () => updates.filter((u) => u.update_id >= (body.offset ?? 0));
        if (ready().length) return json(res, { ok: true, result: ready() });
        const done = () => { clearTimeout(timer); waiters = waiters.filter((w) => w !== done); json(res, { ok: true, result: ready() }); };
        const timer = setTimeout(done, 1_000);
        waiters.push(done);
        return;
      }
      calls.push({ method, ...body });
      if (method === 'getMe') return json(res, { ok: true, result: { id: 1, is_bot: true, username: 'sx_test_bot' } });
      if (method === 'sendMessage') {
        if (body.chat_id === 7001 && !flooded.has(body.text)) { flooded.add(body.text); return json(res, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 1', parameters: { retry_after: 1 } }, 429); }
        if (body.chat_id === 7002) return json(res, { ok: false, error_code: 400, description: 'Bad Request: chat not found' }, 400);
        if (body.chat_id === 7003) return json(res, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 403);
        return json(res, { ok: true, result: { message_id: calls.length } });
      }
      json(res, { ok: true, result: true });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let code = 1;
const telegram = await startMockTelegram();
try {
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', join(dir, 'push-key.pem'), '-out', join(dir, 'push-cert.pem'), '-days', '1',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
    ], { stdio: 'ignore' });
  } catch {
    throw new Error('openssl is required (it makes the local push service’s TLS certificate)');
  }
  const vapid = webpush.generateVAPIDKeys();
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    SX_DATA_DIR: join(dir, 'data'),
    SX_TEST_DIR: dir,
    TELEGRAM_BOT_TOKEN: '123:test',
    TELEGRAM_API_BASE: `http://127.0.0.1:${telegram.address().port}`,
    // The local push server stands in for FCM / Mozilla / Apple (ignored in production).
    PUSH_TEST_HOSTS: 'localhost',
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: 'mailto:test@screenerix.local',
    NODE_EXTRA_CA_CERTS: join(dir, 'push-cert.pem'),
  };
  const tsx = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
  code = await new Promise((resolve) => {
    const child = spawn(tsx, ['--tsconfig', join(root, 'tsconfig.json'), join(root, 'scripts', 'alerts-harness.ts')], { cwd: root, env, stdio: 'inherit' });
    child.on('exit', (c) => resolve(c ?? 1));
  });
} catch (e) {
  console.error(`test:alerts: ${e.message}`);
} finally {
  telegram.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
