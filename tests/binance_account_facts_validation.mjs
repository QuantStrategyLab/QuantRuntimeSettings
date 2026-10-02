import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker, { __test } from '../web/strategy-switch-console/worker.js';
import { normalizeBinanceFactsBinding, normalizeBinanceAccountFacts, projectBinanceAccountFacts,
  BINANCE_FACTS_KEY } from '../web/strategy-switch-console/binance_account_facts.js';
import { verifyBinanceAccountFactsReceiver } from '../scripts/verify_binance_account_facts_receiver.mjs';

const now = Date.now();
const binding = {
  platform: 'binance', account_key: 'synthetic-wallet', account_scope: 'synthetic-scope',
  target_name: 'synthetic-target', service_name: '', deployment_selector: 'synthetic-runtime',
  account_selector: 'synthetic-selector', target_id: 'synthetic-target', account_scope_sha256: 'b'.repeat(64),
  reader_revision: 'c'.repeat(40), approved_application_revision: 'd'.repeat(40),
  source_binding: { kind: 'binance_readonly_scope_revision', id: 'e'.repeat(64) },
};
binding.source_binding.id = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({
  account_scope_sha256: binding.account_scope_sha256,
  approved_application_revision: binding.approved_application_revision,
  reader_public_revision: binding.reader_revision,
  scope: "spot+flexible_earn",
}))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const time = offset => new Date(now + offset).toISOString();
const report = {
  schema_version: 'binance_account_facts.v1', platform: 'binance', target_id: binding.target_id,
  account_scope_sha256: binding.account_scope_sha256, source_binding: binding.source_binding,
  source_revision: binding.reader_revision, approved_application_revision: binding.approved_application_revision,
  observed_started_at: time(-60_000), spot_observed_at: time(-50_000), earn_observed_at: time(-40_000),
  observed_finished_at: time(-30_000), snapshot_atomic: false, scope: 'spot+flexible_earn',
  completeness: 'complete_for_scope', assets: [
    { asset: 'USDT', quantity: '14.5', spot_free: '3.1', spot_locked: '0.2', flexible_earn: '11.2' },
    { asset: 'BTC', quantity: '0.000000000000000000000000000003', spot_free: '0.000000000000000000000000000001', spot_locked: '0', flexible_earn: '0.000000000000000000000000000002' },
  ], uncovered_scopes: ['funding', 'margin', 'futures', 'locked_earn'], no_order: true, execution_authority_granted: false,
};
assert.equal(normalizeBinanceFactsBinding(binding), binding);
assert.equal(normalizeBinanceAccountFacts(report, binding, { now, ingest: true }), report);
const projection = projectBinanceAccountFacts(report, binding, { now });
assert.equal(projection.assets[0].asset, 'USDT');
for (const text of [binding.account_selector, binding.account_scope_sha256, binding.source_binding.id, binding.reader_revision]) {
  assert.equal(JSON.stringify(projection).includes(text), false);
}
assert.equal(Object.hasOwn(projection, 'wallet_valuation'), false, 'legacy reports remain valid without wallet valuation');
const walletValuation = {
  status: 'available', amount: '1234.5', currency: 'USDT',
  source: 'GET /sapi/v1/asset/wallet/balance', scope: 'provider_returned_wallet_rows',
  observed_at: time(-35_000), wallet_count: 2,
};
const walletReport = { ...report, wallet_valuation: walletValuation };
assert.equal(normalizeBinanceAccountFacts(walletReport, binding, { now, ingest: true }), walletReport);
assert.deepEqual(projectBinanceAccountFacts(walletReport, binding, { now }).wallet_valuation, walletValuation);
const walletFailureCodes = [
  'wallet_read_failed', 'wallet_response_invalid', 'wallet_row_invalid',
  'wallet_duplicate_name', 'wallet_inactive_nonzero', 'wallet_balance_invalid',
];
for (const reason_code of walletFailureCodes) {
  const unavailable = {
    status: 'unavailable', amount: null, currency: null,
    source: walletValuation.source, scope: walletValuation.scope,
    observed_at: null, wallet_count: null, reason_code,
  };
  const unavailableReport = { ...report, wallet_valuation: unavailable };
  assert.equal(normalizeBinanceAccountFacts(unavailableReport, binding, { now, ingest: true }), unavailableReport);
  assert.deepEqual(projectBinanceAccountFacts(unavailableReport, binding, { now }).wallet_valuation, unavailable);
}
const invalidWalletValuations = [
  { ...walletValuation, amount: '-1' }, { ...walletValuation, amount: '1e3' },
  { ...walletValuation, amount: '1\n' }, { ...walletValuation, amount: '1\r' },
  { ...walletValuation, amount: '1\u2028' }, { ...walletValuation, amount: '1\u2029' },
  { ...walletValuation, amount: '1234.50' }, { ...walletValuation, amount: '1.0' },
  { ...walletValuation, amount: '0.0' }, { ...walletValuation, amount: 'NaN' },
  { ...walletValuation, amount: 'Infinity' },
  { ...walletValuation, amount: 1 }, { ...walletValuation, currency: 'USD' },
  { ...walletValuation, source: 'GET /sapi/v1/account/wallet/balance' },
  { ...walletValuation, scope: 'all_wallets' }, { ...walletValuation, wallet_count: 0 },
  { ...walletValuation, wallet_count: 33 }, { ...walletValuation, wallet_count: 1.5 },
  { ...walletValuation, observed_at: time(-45_000) },
  { ...walletValuation, observed_at: time(-61_000) }, { ...walletValuation, observed_at: time(-29_000) },
  { ...walletValuation, observed_at: '2026-10-02T10:00:00+00:00' },
  { ...walletValuation, extra: true },
  { ...walletValuation, status: 'unavailable', amount: null },
  { status: 'unavailable', amount: null, currency: null, source: walletValuation.source,
    scope: walletValuation.scope, observed_at: null, wallet_count: null, reason_code: 'unknown_reason' },
];
for (const value of invalidWalletValuations) {
  assert.throws(() => normalizeBinanceAccountFacts({ ...report, wallet_valuation: value }, binding, { now, ingest: true }),
    'wallet valuation must match its exact closed contract');
}
assert.equal(projectBinanceAccountFacts(report, binding, { now: now + 37 * 3_600_000 }), null);
const invalid = [
  { ...report, extra: true }, { ...report, platform: 'ibkr' }, { ...report, scope: 'all' },
  { ...report, snapshot_atomic: true }, { ...report, no_order: false }, { ...report, execution_authority_granted: true },
  { ...report, account_scope_sha256: 'a'.repeat(64) }, { ...report, source_revision: 'a'.repeat(40) },
  { ...report, approved_application_revision: 'a'.repeat(40) },
  { ...report, source_binding: { ...binding.source_binding, id: 'a'.repeat(64) } },
  { ...report, uncovered_scopes: ['funding'] }, { ...report, completeness: 'partial' },
  { ...report, observed_finished_at: time(61_000) }, { ...report, observed_started_at: time(-400_000) },
  { ...report, spot_observed_at: time(-20_000) }, { ...report, earn_observed_at: '2026-02-30T00:00:00Z' },
  { ...report, assets: [...report.assets, report.assets[0]] },
  { ...report, assets: [{ ...report.assets[0], quantity: '14.6' }] },
  { ...report, assets: [{ ...report.assets[0], spot_locked: '-0.2' }] },
  { ...report, assets: [{ asset: 'USDT', quantity: '0', spot_free: '0', spot_locked: '0', flexible_earn: '0' }] },
  { ...report, assets: [{ ...report.assets[0], native_uid: 'synthetic-private' }] },
];
for (const value of invalid) assert.throws(() => normalizeBinanceAccountFacts(value, binding, { now, ingest: true }));

const nativeAssetRow = asset => ({ asset, quantity: '1', spot_free: '1', spot_locked: '0', flexible_earn: '0' });
const validNativeAssets = ['USDT', '币', 'ＡＢＣ', '１２３', '𐐀', 'A'.repeat(128), '𐐀'.repeat(128)];
for (const asset of validNativeAssets) {
  const nativeReport = { ...report, assets: [nativeAssetRow(asset)] };
  assert.equal(normalizeBinanceAccountFacts(nativeReport, binding, { now, ingest: true }), nativeReport);
  assert.equal(projectBinanceAccountFacts(nativeReport, binding, { now }).assets[0].asset, asset,
    `native asset spelling must remain unchanged: ${asset}`);
}
const invalidNativeAssets = [
  '', ' BTC', 'BTC ', 'BtC', 'BTC\n', '币\u00a0', '币\u0000', '币\u202e', '币\u2066',
  '币\u200b', '币\u200d', '币\u0301', 'BTC-USD', 'BTC.ETH', '🚀', '\ud800',
  '\u115f', '\u1160', '\u3164', '\uffa0',
  '𐐀'.repeat(129),
];
for (const asset of invalidNativeAssets) {
  assert.throws(() => normalizeBinanceAccountFacts({ ...report, assets: [nativeAssetRow(asset)] }, binding, { now, ingest: true }),
    `unsafe or invalid native asset spelling must reject: ${asset}`);
}
assert.throws(() => normalizeBinanceAccountFacts({ ...report, assets: [nativeAssetRow('币'), nativeAssetRow('币')] }, binding, { now, ingest: true }),
  'duplicate native strings must reject');
const distinctNativeSpellings = { ...report, assets: [nativeAssetRow('A'), nativeAssetRow('Ａ')] };
assert.equal(normalizeBinanceAccountFacts(distinctNativeSpellings, binding, { now, ingest: true }), distinctNativeSpellings,
  'asset validation must preserve raw strings without compatibility normalization');

const values = new Map(), puts = [], reads = [];
const kv = {
  get: async key => { reads.push(key); return values.get(key) || null; },
  put: async (key, value, options) => { values.set(key, value); puts.push({ key, value, options }); },
};
const option = { key: binding.account_key, account_scope: binding.account_scope,
  target_name: binding.target_name, service_name: '', deployment_selector: binding.deployment_selector,
  account_selector: binding.account_selector, label: 'Synthetic wallet', default_strategy_profile: 'crypto_live_pool_rotation' };
const env = { SESSION_SECRET: 'synthetic-session-secret', ALLOWED_GITHUB_LOGINS: 'synthetic-reader',
  STRATEGY_SWITCH_ADMIN_LOGINS: 'different-admin', STRATEGY_SWITCH_CONFIG: kv,
  BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify(binding), BINANCE_ACCOUNT_FACTS_SYNC_TOKEN: 'synthetic-binance-facts',
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ binance: [option] }) };
const cookie = await __test.makeSession('synthetic-reader', [], env);
const post = (body, settings = env, token = env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN) => worker.fetch(
  new Request('https://console.example/api/internal/binance-account-facts', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), settings);
const readiness = (settings = env, token = env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN) => worker.fetch(
  new Request('https://console.example/api/internal/binance-account-facts', {
    method: 'GET', headers: { Authorization: `Bearer ${token}` },
  }), settings);
const get = (settings = env, authenticated = true) => worker.fetch(new Request('https://console.example/api/binance-account-facts', {
  headers: authenticated ? { Cookie: `qsl_switch_session=${cookie}` } : {},
}), settings);
assert.equal((await get(env, false)).status, 401);
assert.equal((await post({}, env, 'another-purpose-token')).status, 401);
assert.equal((await readiness(env, 'another-purpose-token')).status, 401);
assert.equal((await post(report, { ...env, ACCOUNT_FACTS_SYNC_TOKEN: env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN })).status, 503);
assert.equal((await readiness({ ...env, ACCOUNT_FACTS_SYNC_TOKEN: env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN })).status, 503);
assert.equal((await post(report, { ...env, BINANCE_ACCOUNT_FACTS_BINDING_JSON: '' })).status, 503);
assert.equal((await post(report, { ...env, BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify({ ...binding,
  source_binding: { ...binding.source_binding, id: 'e'.repeat(64) } }) })).status, 503);
assert.equal((await post({}, { ...env, STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ binance: [{ ...option,
  account_scope: 'different-scope' }] }) })).status, 409);
const receiverAcceptance = await post({});
assert.equal(receiverAcceptance.status, 400);
assert.equal((await receiverAcceptance.json()).error, 'invalid_binance_account_facts');
assert.equal(puts.length, 0, 'empty receiver acceptance request rejects before any facts write');
reads.length = 0;
const readinessResponse = await readiness();
assert.equal(readinessResponse.status, 200);
assert.deepEqual(await readinessResponse.json(), {
  ok: true, ready: true, binding_valid: true, account_options_readable: true, unique_match: true,
});
assert.equal(reads.some(key => key.startsWith(`${BINANCE_FACTS_KEY}:`)), false,
  'readiness checks do not read the facts storage key');
assert.equal(puts.length, 0, 'readiness checks do not write facts');
const unmatchedReadiness = await readiness({ ...env, STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ binance: [{ ...option,
  account_scope: 'different-scope' }] }) });
assert.equal(unmatchedReadiness.status, 409);
assert.deepEqual(await unmatchedReadiness.json(), {
  ok: false, ready: false, binding_valid: true, account_options_readable: true,
  unique_match: false, error: 'binance_account_facts_binding_unmatched',
});
assert.equal(puts.length, 0, 'unmatched readiness check does not write facts');
const configReadFailure = await readiness({ ...env, STRATEGY_SWITCH_RUNTIME_INSTANCES: {
  idFromName: () => 'synthetic-do-id',
  get: () => ({ fetch: async () => new Response(JSON.stringify({ error: 'synthetic-sensitive-detail' }), { status: 503 }) }),
} });
assert.equal(configReadFailure.status, 503);
const configFailureBody = await configReadFailure.text();
assert.deepEqual(JSON.parse(configFailureBody), {
  ok: false, ready: false, binding_valid: true, account_options_readable: false,
  unique_match: false, error: 'binance_account_facts_account_options_unavailable',
});
assert.equal(configFailureBody.includes('synthetic-sensitive-detail'), false,
  'readiness hides runtime configuration error details');
assert.equal(puts.length, 0, 'failed readiness check does not write facts');
const realHandlerFetch = (settings = env) => (url, init) => worker.fetch(new Request(url, init), settings);
const acceptedReceiverCheck = await verifyBinanceAccountFactsReceiver({
  consoleUrl: 'https://console.example', token: env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN,
  fetchImpl: realHandlerFetch(),
});
assert.deepEqual(acceptedReceiverCheck, { status: 'verified', httpStatus: 400 });
const readinessOnlyCheck = await verifyBinanceAccountFactsReceiver({
  consoleUrl: 'https://console.example', token: env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN,
  readinessOnly: true, fetchImpl: realHandlerFetch(),
});
assert.deepEqual(readinessOnlyCheck, {
  status: 'ready', bindingValid: true, accountOptionsReadable: true, uniqueMatch: true,
});
await assert.rejects(verifyBinanceAccountFactsReceiver({
  consoleUrl: 'https://console.example', token: 'synthetic-wrong-token', fetchImpl: realHandlerFetch(),
}), error => error.category === 'token_invalid' && error.httpStatus === 401);
const unmatchedOptionEnv = { ...env, STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ binance: [{ ...option,
  account_scope: 'different-scope' }] }) };
const readinessCalls = [];
await assert.rejects(verifyBinanceAccountFactsReceiver({
  consoleUrl: 'https://console.example', token: env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN,
  readinessOnly: true,
  fetchImpl: (url, init) => { readinessCalls.push(init.method); return realHandlerFetch(unmatchedOptionEnv)(url, init); },
}), error => error.category === 'binding_unmatched' && error.httpStatus === 409);
assert.deepEqual(readinessCalls, ['GET'], 'unready worker response stops before any POST');
await assert.rejects(verifyBinanceAccountFactsReceiver({
  consoleUrl: 'https://console.example', token: env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN,
  fetchImpl: realHandlerFetch(unmatchedOptionEnv),
}), error => error.category === 'binding_unmatched' && error.httpStatus === 409);
assert.equal(puts.length, 0, 'receiver check against the real Worker handler does not write facts');
const accepted = await post(report);
assert.equal(accepted.status, 200, JSON.stringify(await accepted.clone().json()));
assert.equal((await accepted.json()).status, 'published');
assert.equal(puts.length, 1);
assert.equal(puts[0].key, `${BINANCE_FACTS_KEY}:${binding.source_binding.id}`);
assert.equal((await (await post(report)).json()).status, 'unchanged');
assert.equal(puts.length, 1);
const read = await get();
assert.equal(read.status, 200);
assert.deepEqual((await read.json()).report, projection);
const conflicting = structuredClone(report); conflicting.assets[0].spot_free = '4.1'; conflicting.assets[0].quantity = '15.5';
assert.equal((await post(conflicting)).status, 409);
assert.equal(puts.length, 1);
for (const bad of invalid) assert.notEqual((await post(bad)).status, 200);
assert.equal(puts.length, 1);
assert.equal((await get({ ...env, BINANCE_ACCOUNT_FACTS_BINDING_JSON: '' })).status, 200);
assert.equal((await (await get({ ...env, BINANCE_ACCOUNT_FACTS_BINDING_JSON: '' })).json()).report, null);
// The same bytes are generated and checked by the Python producer tests.
const fixtureBytes = readFileSync(new URL('./fixtures/binance_account_facts.v1.synthetic.json', import.meta.url));
assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'), '06231ffef64bbfdcad8b3f70f0c2264abcb69aed2854b3c62400869c308ef6e9');
const fixture = JSON.parse(fixtureBytes);
const fixtureBinding = { ...binding, target_id: fixture.target_id, account_scope_sha256: fixture.account_scope_sha256,
  reader_revision: fixture.source_revision, approved_application_revision: fixture.approved_application_revision,
  source_binding: fixture.source_binding };
assert.equal(normalizeBinanceAccountFacts(fixture, fixtureBinding, { now: Date.parse(fixture.observed_finished_at), ingest: true }), fixture);
const freshFixture = { ...fixture, observed_started_at: report.observed_started_at, spot_observed_at: report.spot_observed_at,
  earn_observed_at: report.earn_observed_at, observed_finished_at: report.observed_finished_at };
const fixtureEnv = { ...env, BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify(fixtureBinding) };
assert.equal((await post(freshFixture, fixtureEnv)).status, 200);
assert.deepEqual((await (await get(fixtureEnv)).json()).report.assets, fixture.assets);

const projectedNativeAssets = ['币', 'ＡＢＣ', '１２３', '𐐀', '𐐀'.repeat(128)];
const nativeReport = { ...report,
  observed_started_at: time(-30_000), spot_observed_at: time(-20_000), earn_observed_at: time(-10_000),
  observed_finished_at: time(-1_000), assets: projectedNativeAssets.map(nativeAssetRow) };
assert.equal((await post(nativeReport)).status, 200);
const nativeReadback = await get();
assert.equal(nativeReadback.status, 200);
assert.deepEqual((await nativeReadback.json()).report.assets.map(item => item.asset), projectedNativeAssets,
  'Worker POST→GET must retain native Unicode asset strings exactly');
const writesBeforeFillerChecks = puts.length;
for (const asset of ['\u115f', '\u1160', '\u3164', '\uffa0']) {
  const response = await post({ ...nativeReport, assets: [nativeAssetRow(asset)] });
  assert.notEqual(response.status, 200, `Worker POST must reject default-ignorable Hangul filler U+${asset.codePointAt(0).toString(16).toUpperCase()}`);
}
assert.equal(puts.length, writesBeforeFillerChecks, 'rejected Hangul fillers must not be persisted');
const overviewSource = readFileSync(new URL('../web/strategy-switch-console/frontend/src/OverviewPage.tsx', import.meta.url), 'utf8');
assert.match(overviewSource, /wallet\.assets\.map\([\s\S]*?<strong>\{item\.asset\}<\/strong>/,
  'overview wallet rows must render the native asset string without filtering');
console.log(`Binance account facts: native decimals, ${invalid.length + invalidNativeAssets.length} rejection cases, privacy, token isolation, binding and worker tests PASS`);
