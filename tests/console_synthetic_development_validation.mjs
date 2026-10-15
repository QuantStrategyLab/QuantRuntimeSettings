import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const server = spawn(process.execPath, ['web/strategy-switch-console/frontend/scripts/dev-synthetic.mjs'], {
  cwd: new URL('../', import.meta.url),
  env: { ...process.env, QSL_SYNTHETIC_PORT: '4174' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
server.stdout.on('data', chunk => { output += chunk; });
server.stderr.on('data', chunk => { output += chunk; });
const base = 'http://127.0.0.1:4174';
try {
  const deadline = Date.now() + 15_000;
  while (!output.includes('Synthetic-only audit:')) {
    if (server.exitCode !== null || Date.now() > deadline) throw new Error('Synthetic dev server did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const page = await fetch(`${base}/v2/?qa=ready`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /src\/main.tsx/);
  const session = await fetch(`${base}/api/session`).then(response => response.json());
  assert.equal(session.synthetic, true);
  assert.equal(session.login, 'synthetic-qa');
  for (const path of ['/api/switch', '/api/logout', '/api/owner-decisions', '/api/account-settings', '/api/runtime-stop']) {
    assert.equal((await fetch(base + path, { method: 'POST', body: '{}' })).status, 405, `${path} must not accept writes`);
  }
  assert.equal((await fetch(`${base}/api/unknown-provider-path`)).status, 503);
  assert.equal((await fetch(`${base}/login`)).status, 503, 'synthetic sign-in must not leave loopback');
  await fetch(`${base}/v2/?qa=config-error`);
  assert.equal((await fetch(`${base}/api/config`)).status, 503);
  await fetch(`${base}/v2/?qa=reader`);
  assert.equal((await fetch(`${base}/api/session`).then(response => response.json())).admin, false);
  await fetch(`${base}/v2/?qa=many-decisions`);
  const proposals = await fetch(`${base}/api/research-promotion-tickets`).then(response => response.json());
  assert.equal(proposals.tickets.length, 12);
  assert.ok(proposals.tickets.every(ticket => ticket.live_authority_granted === false && ticket.no_order === true));
  console.log('console_synthetic_development_validation: PASS (loopback fixtures, rejected writes, failure scenarios)');
} finally {
  const exited = once(server, 'exit');
  server.kill('SIGTERM');
  await exited;
}
