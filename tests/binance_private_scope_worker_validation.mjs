import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import worker, { __test } from "../web/strategy-switch-console/worker.js";

const values = new Map();
const puts = [];
const kv = {
  async get(key) { return values.get(key) || null; },
  async list({ prefix }) {
    return { keys: [...values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })) };
  },
  async put(key, value, options) {
    values.set(key, value);
    puts.push({ key, value, options });
  },
};
const env = {
  SESSION_SECRET: "synthetic-private-scope-session",
  ALLOWED_GITHUB_LOGINS: "scope-admin,scope-reader",
  STRATEGY_SWITCH_ADMIN_LOGINS: "scope-admin",
  RECONCILIATION_RECOVERY_SYNC_TOKEN: "private-scope-sync",
  STRATEGY_HEALTH_SYNC_TOKEN: "other-service-token",
  STRATEGY_SWITCH_CONFIG: kv,
};

const adminCookie = await __test.makeSession("scope-admin", [], env);
const readerCookie = await __test.makeSession("scope-reader", [], env);
const cookieHeaders = (value) => ({ Cookie: `qsl_switch_session=${value}` });
const now = Date.now();
const validReport = {
  platform: "binance",
  observed_at: new Date(now - 30_000).toISOString(),
  source_run_id: "12345678901234567890",
  source_sha: "a".repeat(40),
  account_scope_sha256: "b".repeat(64),
  assets: [
    { asset: "BTC", free: "0.01000000", locked: "0" },
    { asset: "测试1", free: "12.3400", locked: "0.6600" },
  ],
  historical_difference_unresolved: true,
  no_order: true,
  execution_authority_granted: false,
};

async function post(body, token = env.RECONCILIATION_RECOVERY_SYNC_TOKEN) {
  return worker.fetch(new Request("https://console.example/api/internal/binance-private-scope", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), env);
}

assert.equal((await worker.fetch(new Request("https://console.example/api/binance-private-scope"), env)).status, 401);
assert.equal((await worker.fetch(new Request("https://console.example/api/binance-private-scope", {
  headers: cookieHeaders(readerCookie),
}), env)).status, 403);
assert.equal((await worker.fetch(new Request("https://console.example/api/binance-private-scope", {
  headers: { Authorization: `Bearer ${env.STRATEGY_HEALTH_SYNC_TOKEN}` },
}), env)).status, 401);
assert.equal((await post(validReport, env.STRATEGY_HEALTH_SYNC_TOKEN)).status, 401);
const missingStore = await worker.fetch(new Request("https://console.example/api/internal/binance-private-scope", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RECONCILIATION_RECOVERY_SYNC_TOKEN}` },
  body: JSON.stringify(validReport),
}), { ...env, STRATEGY_SWITCH_CONFIG: undefined });
assert.equal(missingStore.status, 503);
assert.deepEqual(await missingStore.json(), { ok: false, error: "binance_private_scope_storage_unavailable" });

const accepted = await post(validReport);
assert.equal(accepted.status, 200);
assert.deepEqual(await accepted.json(), {
  ok: true,
  observed_at: validReport.observed_at,
  source_run_id: validReport.source_run_id,
  asset_count: 2,
});
assert.equal(puts.length, 1);
assert.equal(puts[0].key, "private_binance_scope_report");
assert.deepEqual(puts[0].options, { expirationTtl: 86400 });
assert.deepEqual(JSON.parse(puts[0].value), validReport);

const readable = await worker.fetch(new Request("https://console.example/api/binance-private-scope", {
  headers: cookieHeaders(adminCookie),
}), env);
assert.equal(readable.status, 200);
assert.equal(readable.headers.get("Cache-Control"), "no-store");
assert.deepEqual(await readable.json(), { ok: true, report: validReport });

const invalidReports = [
  { ...validReport, extra: true },
  { ...validReport, platform: "ibkr" },
  { ...validReport, observed_at: new Date(now - 10 * 60_000 - 1_000).toISOString() },
  { ...validReport, observed_at: new Date(now + 61_000).toISOString() },
  { ...validReport, observed_at: "2026-09-12T12:00:00" },
  { ...validReport, observed_at: Date.now() },
  { ...validReport, source_run_id: "run-1" },
  { ...validReport, source_run_id: "0" },
  { ...validReport, source_run_id: "1".repeat(21) },
  { ...validReport, source_run_id: 123 },
  { ...validReport, source_sha: "g".repeat(40) },
  { ...validReport, source_sha: 1 },
  { ...validReport, account_scope_sha256: "a".repeat(63) },
  { ...validReport, account_scope_sha256: 1 },
  { ...validReport, historical_difference_unresolved: false },
  { ...validReport, no_order: false },
  { ...validReport, execution_authority_granted: true },
  { ...validReport, assets: [...validReport.assets, { ...validReport.assets[0] }] },
  { ...validReport, assets: [{ asset: "BTC-USDT", free: "1", locked: "0" }] },
  { ...validReport, assets: [{ asset: 123, free: "1", locked: "0" }] },
  { ...validReport, assets: [{ asset: "BTC", free: "0", locked: "0.000" }] },
  { ...validReport, assets: [{ asset: "BTC", free: -1, locked: "0" }] },
  { ...validReport, assets: [{ asset: "BTC", free: "-1", locked: "0" }] },
  { ...validReport, assets: [{ asset: "BTC", free: "Infinity", locked: "0" }] },
  { ...validReport, assets: [{ asset: "BTC", free: "1e3", locked: "0" }] },
  { ...validReport, assets: [{ asset: "BTC", free: "1", locked: "0", extra: "secret" }] },
  { ...validReport, assets: Array.from({ length: 5001 }, (_, i) => ({ asset: `A${i}`, free: "1", locked: "0" })) },
];
for (const candidate of invalidReports) {
  const before = puts.length;
  const response = await post(candidate);
  assert.ok(response.status >= 400, JSON.stringify(candidate).slice(0, 160));
  assert.equal(puts.length, before);
}
assert.equal((await post(" ".repeat(256 * 1024 + 1))).status, 413);
const malformed = await post('{"assets":"synthetic-private-asset-fragment"');
assert.equal(malformed.status, 400);
assert.equal((await malformed.text()).includes("synthetic-private-asset-fragment"), false);
const storageFailure = await worker.fetch(new Request("https://console.example/api/internal/binance-private-scope", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RECONCILIATION_RECOVERY_SYNC_TOKEN}` },
  body: JSON.stringify(validReport),
}), {
  ...env,
  STRATEGY_SWITCH_CONFIG: {
    get: kv.get,
    async put() { throw new Error("synthetic-private-storage-detail"); },
  },
});
assert.equal(storageFailure.status, 503);
assert.equal((await storageFailure.text()).includes("synthetic-private-storage-detail"), false);

values.set("private_binance_scope_report", JSON.stringify({
  ...validReport,
  observed_at: new Date(now - 24 * 60 * 60_000 - 1_000).toISOString(),
}));
const stale = await worker.fetch(new Request("https://console.example/api/binance-private-scope", {
  headers: cookieHeaders(adminCookie),
}), env);
assert.deepEqual(await stale.json(), { ok: true, report: null });

const ordinaryResponses = await Promise.all([
  worker.fetch(new Request("https://console.example/api/session", { headers: cookieHeaders(adminCookie) }), env),
  worker.fetch(new Request("https://console.example/api/admin/config", { headers: cookieHeaders(adminCookie) }), env),
  worker.fetch(new Request("https://console.example/api/strategy-health", { headers: cookieHeaders(adminCookie) }), env),
  worker.fetch(new Request("https://console.example/api/reconciliation-recovery", { headers: cookieHeaders(adminCookie) }), env),
]);
for (const response of ordinaryResponses) {
  const text = await response.text();
  assert.equal(text.includes("0.01000000"), false);
  assert.equal(text.includes("private_binance_scope_report"), false);
}

const app = readFileSync(new URL("../web/strategy-switch-console/frontend/src/App.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../web/strategy-switch-console/frontend/src/api.ts", import.meta.url), "utf8");
const overview = readFileSync(new URL("../web/strategy-switch-console/frontend/src/OverviewPage.tsx", import.meta.url), "utf8");
assert.match(api, /session\.admin[\s\S]*\/api\/binance-private-scope/);
assert.match(app, /isAdmin=\{model\?\.session\.admin === true\}[\s\S]*privateScope=\{model\?\.privateScope \|\| null\}/);
assert.match(overview, /allAccounts: accountId === "all"/);
assert.match(overview, /binancePrivateScope\?\.assets\.length/);
assert.match(overview, /item\.asset/);
assert.match(overview, /item\.free/);
assert.match(overview, /item\.locked/);
assert.match(overview, /binancePrivateScope\.observed_at/);
assert.equal(overview.includes("source_run_id"), false);
assert.equal(overview.includes("source_sha"), false);
assert.equal(overview.includes("account_scope_sha256"), false);
assert.equal(overview.includes(".innerHTML"), false);
assert.equal(app.includes(".innerHTML"), false);
const logout = app.slice(app.indexOf("const logout"), app.indexOf("const currentForm"));
assert.ok(logout.indexOf("clearPrivateState") < logout.indexOf('postJson("/api/logout"'));
assert.equal(logout.includes("/api/switch"), false);

assert.equal(app.includes("refreshBinancePrivateScope"), false);
assert.equal(overview.includes("0.01000000"), false);
assert.equal(app.includes("0.01000000"), false);

console.log("Binance private scope: admin-only read, dedicated write, strict payload, TTL/staleness, isolation and UI clearing checks passed");
