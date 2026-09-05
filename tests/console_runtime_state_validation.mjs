import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import worker, { __test } from '../web/strategy-switch-console/worker.js';

const source = readFileSync(new URL('../web/strategy-switch-console/app.js', import.meta.url), 'utf8');
function frontendFunction(name, context) {
  const start = source.indexOf(`    function ${name}(`);
  assert.ok(start >= 0);
  const end = source.indexOf('\n    function ', start + 1);
  return vm.runInNewContext(`(${source.slice(start, end).trim()})`, context);
}
const cleanOptionalBoolean = (value) => typeof value === 'boolean' ? value : null;
for (const value of [undefined, true, false]) {
  test(`frontend does not invent enabled: ${value}`, () => {
    const fn = frontendFunction('runtimeTargetStateForAccount', {
      currentEntryForAccount: () => ({ strategy_profile: 'example', runtime_target_enabled: value }),
      cleanOptionalBoolean,
    });
    const result = fn('ibkr', {});
    assert.equal(result.known, value !== undefined);
    assert.equal(result.enabled, value ?? null);
  });
}
test('account routing defaults do not become runtime observations', () => {
  const fn = frontendFunction('currentEntryForAccount', {
    state: { currentStrategies: {} }, resolveCurrentEntryByKey: () => null,
    window: { __DEFAULT_ACCOUNT_OPTIONS__: { ibkr: [{ runtime_target_enabled: true }] } },
    platformConfig: {}, platformSupportsMarginPolicy: () => false, cleanOptionalBoolean,
  });
  assert.equal(fn('ibkr', { key: 'example' }).runtime_target_enabled ?? null, null);
});

for (const sample of [
  { name: 'repo disabled fallback', scoped: false, expected: false },
  { name: 'explicit target enabled', target: true, scoped: false, expected: true },
  { name: 'explicit target disabled', target: false, scoped: true, expected: false },
  { name: 'environment enabled', environment: true, scoped: true, expected: true },
  { name: 'missing remains unknown', expected: undefined },
  { name: 'nested service env enabled beats repo disabled', nested: true, scoped: false, expected: true },
  { name: 'nested service env disabled beats repo enabled', nested: false, scoped: true, expected: false },
  { name: 'top-level service override beats nested env', target: false, nested: true, scoped: true, expected: false },
]) {
  test(sample.name, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const path = String(url);
      let value;
      if (path.endsWith('/CLOUD_RUN_SERVICE_TARGETS_JSON')) value = JSON.stringify({ targets: [{
        service: 'example-service',
        ...(sample.nested === undefined ? {} : { env: {
          RUNTIME_TARGET_ENABLED: String(sample.nested),
          IBKR_CASH_ONLY_EXECUTION: 'false', IBKR_RESERVED_CASH_RATIO: '0.07',
          INCOME_LAYER_ENABLED: 'true', OPTION_OVERLAY_ENABLED: 'false',
        } }),
        ...(sample.target === undefined ? {} : { RUNTIME_TARGET_ENABLED: String(sample.target) }),
        runtime_target: { platform_id: 'ibkr', strategy_profile: 'tqqq_growth_income',
          service_name: 'example-service', account_scope: 'example' },
      }] });
      else if (path.endsWith('/RUNTIME_TARGET_ENABLED')) {
        if (sample.environment) {
          value = path.includes('/environments/example/') ? String(sample.scoped) : 'false';
        } else if (sample.scoped !== undefined) value = String(sample.scoped);
      }
      return value === undefined ? new Response('', { status: 404 })
        : Response.json({ value });
    };
    try {
      const result = await __test.loadCurrentStrategies({ ibkr: [{
        key: 'example', target_name: 'example', service_name: 'example-service', account_scope: 'example',
        ...(sample.environment ? { variable_scope: 'environment', github_environment: 'example' } : {}),
      }] }, { RUNTIME_SETTINGS_DISPATCH_TOKEN: 'synthetic-only' });
      assert.equal(result.ibkr.example.runtime_target_enabled, sample.expected);
      if (sample.nested !== undefined) {
        assert.equal(result.ibkr.example.cash_only_execution, false);
        assert.equal(result.ibkr.example.reserved_cash_ratio, '0.07');
        assert.equal(result.ibkr.example.income_layer_enabled, true);
        assert.equal(result.ibkr.example.option_overlay_enabled, false);
      }
    } finally { globalThis.fetch = original; }
  });
}

test('loading an account never silently prepares an enable override', () => {
  for (const configured of [undefined, true, false]) {
    const form = { runtimeTargetTouched: false };
    const fn = frontendFunction('syncRuntimeTargetForAccount', {
      state: { forms: { ibkr: form } }, selectedAccount: () => ({}),
      runtimeTargetEnabledForAccount: () => configured ?? null,
    });
    fn('ibkr');
    assert.equal(form.runtimeTargetMode, 'current');
  }
});

for (const sample of [
  { name: 'signed out', ready: true, allowed: false, available: true, login: null, message: 'loginDescription' },
  { name: 'session unavailable', ready: true, allowed: false, available: false, login: null, message: 'loginUnavailable' },
  { name: 'access denied', ready: true, allowed: false, available: true, login: 'example', message: 'loginDenied' },
  { name: 'signed in', ready: true, allowed: true, available: true, login: 'example', message: 'loginDenied' },
  { name: 'loading', ready: false, allowed: false, available: false, login: null, message: 'loginUnavailable' },
]) {
  test(`private shell visibility: ${sample.name}`, () => {
    const nodes = {};
    const el = (id) => nodes[id] ??= {};
    const render = frontendFunction('renderAppVisibility', {
      state: { appReady: sample.ready, auth: sample, bootMessageKey: 'loading' },
      document: { body: { classList: { toggle() {} } } }, el, t: (key) => key,
    });
    render();
    assert.equal(el('app-shell').hidden, !sample.ready || !sample.allowed);
    assert.equal(el('login-screen').hidden, !sample.ready || sample.allowed);
    assert.equal(el('login-message').textContent, sample.message);
  });
}

for (const hidden of ['', 'qmt', 'qmt,binance']) {
  test(`console visibility is deployment configuration only: ${hidden || 'all visible'}`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response('', { status: 503 });
    try {
      const meta = await __test.loadPlatformMeta({ STRATEGY_SWITCH_HIDDEN_PLATFORMS: hidden });
      assert.equal(meta.qmt.console_visible, !hidden.includes('qmt'));
      assert.equal(meta.binance.console_visible, !hidden.includes('binance'));
      assert.equal(meta.ibkr.console_visible, true);
      assert.equal(Object.keys(meta).length, 6);
    } finally { globalThis.fetch = original; }
  });
}


test('admin page CSP permits only its own inline script and style', async () => {
  const env = {
    SESSION_SECRET: 'synthetic-admin-session', STRATEGY_SWITCH_ADMIN_LOGINS: 'operator',
    STRATEGY_SWITCH_CONFIG: { get: async () => null, put: async () => {} },
  };
  const cookie = await __test.makeSession('operator', [], env);
  const response = await worker.fetch(new Request('https://switch.example/admin', {
    headers: { Cookie: `qsl_switch_session=${cookie}` },
  }), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  const csp = response.headers.get('Content-Security-Policy');
  const nonce = html.match(/<script nonce="([a-zA-Z0-9]+)">/)?.[1];
  assert.ok(nonce);
  assert.ok(html.includes(`<style nonce="${nonce}">`));
  assert.ok(csp.includes(`script-src 'self' 'nonce-${nonce}'`));
  assert.ok(csp.includes(`style-src 'self' 'nonce-${nonce}'`));
  assert.ok(!csp.includes('unsafe-inline'));
});

for (const intent of [null, { decision: 'approved' }]) {
  test(`completed owner decision is not an outstanding action: ${Boolean(intent)}`, () => {
    const fn = frontendFunction('candidateNeedsOperatorAction', {
      ownerDecisionEntry: () => ({ intent }),
    });
    assert.equal(fn({ lifecycle: { status: 'owner_decision_required' } }), !intent);
  });
}
