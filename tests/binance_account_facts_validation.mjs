import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { __test } from '../web/strategy-switch-console/worker.js';
import { normalizeBinanceFactsBinding, normalizeBinanceAccountFacts, projectBinanceAccountFacts,
  BINANCE_FACTS_KEY, binanceWalletHistoryEntry, binanceWalletHistoryStorageKey } from '../web/strategy-switch-console/binance_account_facts.js';
import { binanceProviderProductTypeForDisplay } from '../web/strategy-switch-console/frontend/src/types.ts';
import { verifyBinanceAccountFactsReceiver } from '../scripts/verify_binance_account_facts_receiver.mjs';

const require = createRequire(new URL('../web/strategy-switch-console/package.json', import.meta.url));
const { Miniflare } = require('miniflare');

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
const productType = {
  value: 'SPOT', source: 'GET /api/v3/account.accountType', observed_at: report.spot_observed_at,
};
const productTypeReport = { ...report, provider_product_type: productType };
assert.equal(normalizeBinanceAccountFacts(productTypeReport, binding, { now, ingest: true }), productTypeReport);
assert.deepEqual(projectBinanceAccountFacts(productTypeReport, binding, { now }).provider_product_type, productType,
  'the native product type is preserved only with its exact source and spot observation timestamp');
const unknownProductTypeReport = { ...report, provider_product_type: { ...productType, value: 'unknown' } };
const unknownProductTypeProjection = projectBinanceAccountFacts(unknownProductTypeReport, binding, { now });
assert.equal(unknownProductTypeProjection.provider_product_type.value, 'unknown');
assert.equal(binanceProviderProductTypeForDisplay(unknownProductTypeProjection, true), null,
  'unknown remains unclassified in the UI');
const invalidProductTypeReports = [
  { ...productType, value: 'MARGIN' }, { ...productType, value: 'provider raw text' },
  { ...productType, source: 'GET /api/v3/account' }, { ...productType, observed_at: time(-49_000) },
  { ...productType, observed_at: '2026-02-30T00:00:00Z' }, { ...productType, extra: 'synthetic-private' },
];
for (const invalidProductType of invalidProductTypeReports) {
  const invalidOptionalReport = { ...report, provider_product_type: invalidProductType };
  const safelyProjected = projectBinanceAccountFacts(invalidOptionalReport, binding, { now });
  assert.equal(safelyProjected.assets.length, report.assets.length,
    'an invalid optional type never hides otherwise valid balances');
  assert.equal(Object.hasOwn(safelyProjected, 'provider_product_type'), false,
    'invalid optional type is safely omitted');
  assert.equal(JSON.stringify(safelyProjected).includes('synthetic-private'), false,
    'provider details are never copied raw into the public projection');
}
assert.equal(projectBinanceAccountFacts({ ...report, provider_product_type: { ...productType, observed_at: time(-61_000) } }, binding, { now }).provider_product_type, undefined,
  'provider observation outside the validated report window is omitted');
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
assert.equal(binanceProviderProductTypeForDisplay(null, false), null, 'stale report does not display a provider type');
assert.equal(binanceProviderProductTypeForDisplay(projectBinanceAccountFacts(productTypeReport, binding, { now }), false), null,
  'an unbound, mismatched, or unmapped account report is hidden by the existing eligibility gate');
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
  failNextPut: false,
  put: async (key, value, options) => {
    if (kv.failNextPut) { kv.failNextPut = false; throw new Error('synthetic KV write failure'); }
    values.set(key, value); puts.push({ key, value, options });
  },
};
const option = { key: binding.account_key, account_scope: binding.account_scope,
  target_name: binding.target_name, service_name: '', deployment_selector: binding.deployment_selector,
  account_selector: binding.account_selector, label: 'Synthetic wallet', default_strategy_profile: 'crypto_live_pool_rotation' };
const persist = mkdtempSync(join(tmpdir(), 'binance-wallet-history-'));
const mf = new Miniflare({
  modules: true,
  modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
  scriptPath: fileURLToPath(new URL('../web/strategy-switch-console/worker.js', import.meta.url)),
  compatibilityDate: '2026-06-08',
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: 'RuntimeInstances', useSQLite: true } },
  durableObjectsPersist: persist,
});
const runtimeInstances = await mf.getDurableObjectNamespace('STRATEGY_SWITCH_RUNTIME_INSTANCES');
const env = { SESSION_SECRET: 'synthetic-session-secret', ALLOWED_GITHUB_LOGINS: 'synthetic-reader',
  STRATEGY_SWITCH_ADMIN_LOGINS: 'different-admin', STRATEGY_SWITCH_CONFIG: kv,
  ACCOUNT_FACTS_READ_MODEL_ENABLED: 'true', STRATEGY_SWITCH_RUNTIME_INSTANCES: runtimeInstances,
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
const getWalletHistory = (settings = env, authenticated = true, accountKey = binding.account_key) => worker.fetch(new Request(
  `https://console.example/api/binance-account-facts/history?account_key=${encodeURIComponent(accountKey)}`,
  { headers: authenticated ? { Cookie: `qsl_switch_session=${cookie}` } : {} },
), settings);
const runtimeStub = runtimeInstances.get(runtimeInstances.idFromName('runtime-instances'));
async function putHistoryEntry(history, entryBinding = binding) {
  const response = await runtimeStub.fetch('https://runtime-instances/', {
    method: 'POST',
    body: JSON.stringify({
      action: 'binance_wallet_history_put',
      account_key: entryBinding.account_key,
      storage_account_key: binanceWalletHistoryStorageKey(entryBinding),
      target_id: entryBinding.target_id,
      account_scope: entryBinding.account_scope,
      source_binding_id: entryBinding.source_binding.id,
      history,
    }),
  });
  return { status: response.status, body: await response.json() };
}
async function readRawHistoryBucket(entryBinding) {
  const response = await runtimeStub.fetch('https://runtime-instances/', {
    method: 'POST',
    body: JSON.stringify({
      action: 'binance_wallet_history_read',
      account_key: entryBinding.account_key,
      storage_account_key: binanceWalletHistoryStorageKey(entryBinding),
      target_id: entryBinding.target_id,
      account_scope: entryBinding.account_scope,
      source_binding_id: entryBinding.source_binding.id,
    }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).days;
}
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
const postConfigReadFailure = await post({}, { ...env, STRATEGY_SWITCH_RUNTIME_INSTANCES: {
  idFromName: () => 'synthetic-do-id',
  get: () => ({ fetch: async () => new Response(JSON.stringify({ error: 'synthetic-sensitive-detail' }), { status: 503 }) }),
} });
assert.equal(postConfigReadFailure.status, 503);
const postConfigFailureBody = await postConfigReadFailure.text();
assert.deepEqual(JSON.parse(postConfigFailureBody), {
  ok: false, error: 'binance_account_facts_account_options_unavailable',
});
assert.equal(postConfigFailureBody.includes('synthetic-sensitive-detail'), false,
  'POST configuration read failure uses a fixed category and hides DO error text');
assert.equal(puts.length, 0, 'failed POST configuration read does not write facts');
const realHandlerFetch = (settings = env) => (url, init) => worker.fetch(new Request(url, init), settings);
const failedDoCalls = [];
const failedDoEnv = { ...env, STRATEGY_SWITCH_RUNTIME_INSTANCES: {
  idFromName: () => 'synthetic-do-id',
  get: () => ({ fetch: async (...args) => {
    failedDoCalls.push(args);
    return new Response(JSON.stringify({ error: 'synthetic-sensitive-detail' }), { status: 503 });
  } }),
} };
const verifierCalls = [];
await assert.rejects(verifyBinanceAccountFactsReceiver({
  consoleUrl: 'https://console.example', token: env.BINANCE_ACCOUNT_FACTS_SYNC_TOKEN,
  fetchImpl: (url, init) => {
    verifierCalls.push(init.method);
    return realHandlerFetch(failedDoEnv)(url, init);
  },
}), error => error.category === 'account_options_unavailable' && error.httpStatus === 503);
assert.deepEqual(verifierCalls, ['POST'], 'POST configuration read failure has no readiness fallback or retry');
assert.equal(failedDoCalls.length, 1, 'POST configuration read failure invokes the DO read once');
assert.equal(puts.length, 0, 'POST configuration read failure does not write facts');
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
assert.equal((await getWalletHistory(env, false)).status, 401, 'wallet history requires the existing authenticated session');
const unavailableWalletHistory = await (await getWalletHistory()).json();
assert.deepEqual(unavailableWalletHistory, {
  ok: true, metric: 'wallet_valuation', currency: 'USDT', scope: 'provider_returned_wallet_rows',
  points: [], gap_dates: [new Date(Date.parse(report.observed_finished_at)).toISOString().slice(0, 10)],
  first_sample_date: null, retention_days: 366,
  return: { status: 'unavailable', reason: 'external_cashflow_required' },
}, 'missing wallet valuation records a gap and never fabricates zero');
for (const privateValue of [binding.account_key, binding.account_scope_sha256, binding.source_binding.id,
  binding.reader_revision, binding.account_selector]) {
  assert.equal(JSON.stringify(unavailableWalletHistory).includes(privateValue), false,
    'public wallet history must omit native binding and account identifiers');
}
const freshWalletReport = {
  ...report,
  observed_started_at: time(-20_000), spot_observed_at: time(-15_000),
  earn_observed_at: time(-10_000), observed_finished_at: time(-2_000),
  wallet_valuation: { ...walletValuation, observed_at: time(-8_000) },
};
assert.equal((await post(freshWalletReport)).status, 200);
assert.equal((await (await post(freshWalletReport)).json()).status, 'unchanged',
  'same report retries preserve the existing idempotent receiver result after history save');
const walletHistory = await (await getWalletHistory()).json();
assert.deepEqual(walletHistory.points, [{
  observation_date: new Date(Date.parse(freshWalletReport.wallet_valuation.observed_at)).toISOString().slice(0, 10),
  observed_at: freshWalletReport.wallet_valuation.observed_at,
  amount: freshWalletReport.wallet_valuation.amount,
}],
'wallet history retains the valuation amount and its original UTC observation time');
assert.deepEqual(walletHistory.gap_dates, [], 'a stored wallet observation does not generate a missing day');
assert.equal(walletHistory.currency, 'USDT');
assert.equal(JSON.stringify(walletHistory).includes(binding.source_binding.id), false);
const dailyEntry = (date, amount = null, reportMinute = '10:01:00', entryBinding = binding) => binanceWalletHistoryEntry({
  observed_finished_at: `${date}T${reportMinute}Z`,
  wallet_valuation: amount === null ? undefined : {
    status: 'available', amount, currency: 'USDT',
    source: 'GET /sapi/v1/asset/wallet/balance', scope: 'provider_returned_wallet_rows',
    observed_at: `${date}T10:00:00Z`, wallet_count: 2,
  },
}, entryBinding);
const dayOne = dailyEntry('2026-09-28', '100');
const dayGap = dailyEntry('2026-09-29');
const dayThree = dailyEntry('2026-09-30', '125');
assert.deepEqual((await putHistoryEntry(dayOne)).body, { ok: true, unchanged: false });
assert.deepEqual((await putHistoryEntry(dayOne)).body, { ok: true, unchanged: true }, 'same-time history report is idempotent');
assert.equal((await putHistoryEntry({ ...dayOne, amount: '101' })).status, 409,
  'same-time different daily content conflicts');
assert.deepEqual((await putHistoryEntry({ ...dayOne, amount: '99', report_observed_finished_at: '2026-09-28T10:00:00Z' })).body,
  { ok: true, unchanged: true }, 'older daily history cannot overwrite a newer observation');
assert.deepEqual((await putHistoryEntry(dayGap)).body, { ok: true, unchanged: false });
assert.deepEqual((await putHistoryEntry(dayThree)).body, { ok: true, unchanged: false });
const chartDays = await (await getWalletHistory()).json();
assert.ok(chartDays.points.some((point) => point.observation_date === '2026-09-28' && point.amount === '100'));
assert.ok(chartDays.points.some((point) => point.observation_date === '2026-09-30' && point.amount === '125'));
assert.ok(!chartDays.points.some((point) => point.observation_date === '2026-09-29'), 'missing valuation never becomes a zero point');
assert.ok(chartDays.gap_dates.includes('2026-09-29'), 'explicit missing report is represented as a gap');
assert.ok(chartDays.gap_dates.includes('2026-10-01'), 'unreported UTC calendar days remain gaps');
const rotatedBinding = structuredClone(binding);
rotatedBinding.reader_revision = 'f'.repeat(40);
rotatedBinding.source_binding.id = createHash('sha256').update(JSON.stringify({
  account_scope_sha256: rotatedBinding.account_scope_sha256,
  approved_application_revision: rotatedBinding.approved_application_revision,
  reader_public_revision: rotatedBinding.reader_revision,
  scope: 'spot+flexible_earn',
})).digest('hex');
const rotatedView = await getWalletHistory({ ...env, BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify(rotatedBinding) });
assert.deepEqual((await rotatedView.json()).points, [], 'current source version does not join prior-version observations');
await putHistoryEntry(dailyEntry('2026-10-01', '140', '10:01:00', rotatedBinding), rotatedBinding);
await putHistoryEntry(dailyEntry('2026-09-30', null, '10:02:00', rotatedBinding), rotatedBinding);
await putHistoryEntry(dailyEntry('2026-09-29', null, '10:01:00', rotatedBinding), rotatedBinding);
await putHistoryEntry(dailyEntry('2025-09-30', '1', '10:01:00', rotatedBinding), rotatedBinding);
const rotatedHistory = await (await getWalletHistory({ ...env, BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify(rotatedBinding) })).json();
assert.deepEqual(rotatedHistory.points.map((point) => point.observation_date), ['2026-10-01']);
assert.ok(!rotatedHistory.points.some((point) => point.observation_date === '2025-09-30'),
  'merged history retains at most the latest 366 calendar days');
const historyEnabledEnv = {
  ...env,
  BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify(rotatedBinding),
  BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON: JSON.stringify([binding]),
};
const oldBucketBeforeProjection = JSON.stringify(await readRawHistoryBucket(binding));
const continuousHistory = await (await getWalletHistory(historyEnabledEnv)).json();
assert.deepEqual(continuousHistory.points.map((point) => point.observation_date),
  ['2026-09-28', '2026-10-01', new Date(Date.parse(freshWalletReport.wallet_valuation.observed_at)).toISOString().slice(0, 10)]);
assert.ok(continuousHistory.gap_dates.includes('2026-09-30'),
  'the newest cross-source daily row wins even when it is an explicit gap');
assert.ok(continuousHistory.gap_dates.includes('2026-09-29'),
  'identical observations from two trusted source partitions deduplicate');
assert.equal(continuousHistory.points[1].break_before, true,
  'an authorized reader transition is explicit so chart rendering does not connect versions');
assert.equal(JSON.stringify(continuousHistory).includes(binding.source_binding.id), false,
  'history source identifiers are never returned publicly');
assert.equal(JSON.stringify(await readRawHistoryBucket(binding)), oldBucketBeforeProjection,
  'multi-source projection leaves original stored history rows unchanged');
assert.equal((await post(report, { ...env, BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify(rotatedBinding) })).status, 409,
  'old reader reports remain invalid for current POST even when history continuity is enabled');
await putHistoryEntry(dailyEntry('2026-09-28', '101', '10:01:00', rotatedBinding), rotatedBinding);
assert.equal((await getWalletHistory(historyEnabledEnv)).status, 409,
  'same-time cross-source rows with different values fail closed');
const invalidHistoryBinding = { ...binding, account_key: 'another-synthetic-account' };
assert.equal((await getWalletHistory({ ...historyEnabledEnv,
  BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON: JSON.stringify([invalidHistoryBinding]) })).status, 503,
'history whitelist rejects an old source whose account identity differs');
assert.equal((await getWalletHistory({ ...historyEnabledEnv,
  BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON: JSON.stringify(Array(17).fill(binding)) })).status, 503,
'history whitelist has a fixed source count cap');
assert.equal((await getWalletHistory({ ...historyEnabledEnv,
  BINANCE_ACCOUNT_FACTS_HISTORY_BINDINGS_JSON: JSON.stringify([binding, binding]) })).status, 503,
'history whitelist rejects duplicate source ids');
assert.ok((await (await getWalletHistory()).json()).points.some((point) => point.observation_date === '2026-09-30'),
  'prior source history remains stored and readable only with its original binding');
const mismatchedOption = { ...option, account_selector: 'synthetic-other-selector' };
const rotatedMismatch = await getWalletHistory({
  ...env, BINANCE_ACCOUNT_FACTS_BINDING_JSON: JSON.stringify(rotatedBinding),
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ binance: [mismatchedOption] }),
});
assert.equal(rotatedMismatch.status, 409, 'history read revalidates current unique physical option identity');
assert.equal((await getWalletHistory(env, true, 'another-configured-account')).status, 409,
  'wallet observations cannot be shown under a different account selection');
const failedCrossStoreReport = {
  ...report,
  observed_started_at: time(-4_000), spot_observed_at: time(-3_500),
  earn_observed_at: time(-3_000), observed_finished_at: time(-1_500),
  wallet_valuation: { ...walletValuation, observed_at: time(-2_000) },
};
kv.failNextPut = true;
assert.equal((await post(failedCrossStoreReport)).status, 503,
  'history success followed by latest-KV failure is not reported as a full publication');
assert.equal((await (await get()).json()).report.observed_finished_at, freshWalletReport.observed_finished_at,
  'failed latest-KV update leaves the old latest report intact');
assert.ok((await (await getWalletHistory()).json()).points.some((point) => point.amount === failedCrossStoreReport.wallet_valuation.amount),
  'the separately committed DO history remains available after KV failure');
const conflictingWalletReport = structuredClone(freshWalletReport);
conflictingWalletReport.wallet_valuation.amount = '999';
assert.equal((await post(conflictingWalletReport)).status, 409,
  'same report timestamp with different content remains a conflict');
assert.equal((await post(report)).status, 409, 'older report cannot overwrite the newer wallet report');
assert.equal((await (await get()).json()).report.observed_finished_at, freshWalletReport.observed_finished_at,
  'legacy latest report remains the latest report');
const genericWalletHistory = await worker.fetch(new Request(
  `https://console.example/api/account-facts/history?platform=binance&account_key=${binding.account_key}&currency=USDT`,
  { headers: { Cookie: `qsl_switch_session=${cookie}` } },
), env);
assert.equal(genericWalletHistory.status, 400,
  'USDT wallet history stays outside the generic three-letter account history contract');
const conflicting = structuredClone(report); conflicting.assets[0].spot_free = '4.1'; conflicting.assets[0].quantity = '15.5';
assert.equal((await post(conflicting)).status, 409);
assert.equal(puts.length, 2);
const invalidReceiverCases = invalid.map((item, index) => index === 12
  ? { ...item, observed_finished_at: new Date(Date.now() + 61_000).toISOString() }
  : item);
for (const [index, bad] of invalidReceiverCases.entries()) {
  assert.notEqual((await post(bad)).status, 200, `invalid report case ${index} must not be accepted`);
}
assert.equal(puts.length, 2);
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
const typedReport = { ...nativeReport,
  observed_started_at: time(-30_000), spot_observed_at: time(-20_000), earn_observed_at: time(-10_000),
  observed_finished_at: time(0),
  wallet_valuation: { ...walletValuation, observed_at: time(-5_000) },
  provider_product_type: { ...productType, observed_at: time(-20_000) } };
const typedPost = await post(typedReport);
assert.equal(typedPost.status, 200, await typedPost.clone().text());
const typedReadback = await get();
const typedApiReport = (await typedReadback.json()).report;
assert.deepEqual(typedApiReport.provider_product_type, typedReport.provider_product_type,
  'Worker POST→GET retains a valid native product type');
assert.equal(typedApiReport.wallet_valuation.status, 'available');
assert.deepEqual(binanceProviderProductTypeForDisplay(typedApiReport, true), typedReport.provider_product_type,
  'the actual projected API report displays SPOT even with wallet valuation available');
assert.equal(binanceProviderProductTypeForDisplay(typedApiReport, false), null,
  'an unmapped account does not display the type');
const mismatchedOptions = { ...env, STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ binance: [{
  ...option, account_selector: 'synthetic-mismatched-selector',
}] }) };
const mismatchApiReport = (await (await get(mismatchedOptions)).json()).report;
assert.equal(mismatchApiReport, null, 'a source-binding mismatch returns no public report');
assert.equal(binanceProviderProductTypeForDisplay(mismatchApiReport, false), null,
  'a mismatched account does not display the type');
values.set(`${BINANCE_FACTS_KEY}:${binding.source_binding.id}`, JSON.stringify({ ...typedReport,
  observed_started_at: time(-37 * 3_600_000 - 30_000), spot_observed_at: time(-37 * 3_600_000 - 20_000),
  earn_observed_at: time(-37 * 3_600_000 - 10_000), observed_finished_at: time(-37 * 3_600_000),
  provider_product_type: { ...productType, observed_at: time(-37 * 3_600_000 - 20_000) },
  wallet_valuation: { ...walletValuation, observed_at: time(-37 * 3_600_000 - 5_000) },
}));
const staleApiReport = (await (await get()).json()).report;
assert.equal(staleApiReport, null, 'stale source facts produce no public report');
assert.equal(binanceProviderProductTypeForDisplay(staleApiReport, false), null,
  'a stale account does not display the type');
const writesBeforeFillerChecks = puts.length;
for (const asset of ['\u115f', '\u1160', '\u3164', '\uffa0']) {
  const response = await post({ ...nativeReport, assets: [nativeAssetRow(asset)] });
  assert.notEqual(response.status, 200, `Worker POST must reject default-ignorable Hangul filler U+${asset.codePointAt(0).toString(16).toUpperCase()}`);
}
assert.equal(puts.length, writesBeforeFillerChecks, 'rejected Hangul fillers must not be persisted');
const overviewSource = readFileSync(new URL('../web/strategy-switch-console/frontend/src/OverviewPage.tsx', import.meta.url), 'utf8');
assert.match(overviewSource, /wallet\.assets\.map\([\s\S]*?<strong>\{item\.asset\}<\/strong>/,
  'overview wallet rows must render the native asset string without filtering');
assert.match(overviewSource, /binanceProviderProductTypeForDisplay\([\s\S]*?showWallet && walletAccount\?\.id === account\.id/,
  'overview product type requires the existing fresh and mapped-account eligibility gate');
assert.match(overviewSource, /API账户类型：现货/,
  'overview labels Spot only from the native provider type');
console.log(`Binance account facts: native decimals, ${invalid.length + invalidNativeAssets.length} rejection cases, privacy, token isolation, binding and worker tests PASS`);
await mf.dispose();
rmSync(persist, { recursive: true, force: true });
