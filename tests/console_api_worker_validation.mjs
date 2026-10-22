import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __test } from "../web/strategy-switch-console/worker.js";
import { validate } from "./console_api_contract_validation.mjs";
import { consoleApiResponse } from "../web/strategy-switch-console/application/console_api/routes.js";
const require = createRequire(
  new URL("../web/strategy-switch-console/package.json", import.meta.url),
);
const { Miniflare } = require("miniflare");
const account = {
  key: "synthetic-alpha",
  label: "Synthetic alpha",
  target_name: "synthetic-alpha",
  runtime_status_target_id: "longbridge.synthetic-alpha",
  account_selector: "SYNTHETIC",
  deployment_selector: "synthetic",
  account_scope: "SYNTHETIC",
  service_name: "synthetic-service",
  supported_domains: ["us_equity"],
  broker_environment: "paper",
  default_execution_mode: "live",
  default_strategy_profile: "synthetic-dca",
};
const bindings = {
  SESSION_SECRET: "synthetic-only-session",
  ALLOWED_GITHUB_LOGINS: "synthetic-admin,synthetic-reader",
  STRATEGY_SWITCH_ADMIN_LOGINS: "synthetic-admin",
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({
    longbridge: [account],
  }),
  STRATEGY_SWITCH_STRATEGY_PROFILES_JSON: JSON.stringify([
    {
      profile: "synthetic-growth",
      label: "Synthetic growth",
      domain: "us_equity",
      allowed_execution_modes: ["paper"],
      option_overlay_enabled: true,
    },
  ]),
};
const admin = `qsl_switch_session=${await __test.makeSession("synthetic-admin", [], bindings)}`;
const reader = `qsl_switch_session=${await __test.makeSession("synthetic-reader", [], bindings)}`;
let outbound = 0;
const mf = new Miniflare({
  cf: false,
  modules: true,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(
    new URL("../web/strategy-switch-console/worker.js", import.meta.url),
  ),
  compatibilityDate: "2026-06-08",
  bindings,
  durableObjects: {
    STRATEGY_SWITCH_RUNTIME_INSTANCES: {
      className: "RuntimeInstances",
      useSQLite: true,
    },
  },
  durableObjectsPersist: await mkdtemp(join(tmpdir(), "console-api-")),
  kvNamespaces: ["STRATEGY_SWITCH_CONFIG"],
  outboundService: () => {
    outbound++;
    return new Response("offline", { status: 503 });
  },
});
async function call(
  path,
  {
    method = "GET",
    body,
    cookie = admin,
    origin = "https://console.example",
  } = {},
) {
  const response = await mf.dispatchFetch("https://console.example" + path, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
try {
  const directoryRead = await call("/api/admin/kv-directory", { cookie: reader });
  assert.equal(directoryRead.status, 200);
  validate("directory_status", directoryRead.body);
  assert.equal(directoryRead.body.status, "unknown");
  assert.equal(directoryRead.body.complete, null);
  assert.equal((await call("/api/admin/kv-directory", { cookie: null })).status, 401);
  assert.equal((await call("/api/admin/kv-directory", { cookie: reader, method: "POST" })).status, 403);
  assert.equal(
    (
      await call("/api/admin/runtime-instances", {
        method: "POST",
        body: {
          action: "initialize",
          expected_revision: 0,
          confirm: "IMPORT_EXISTING_CONFIG",
        },
      })
    ).status,
    200,
  );
  const settings = await call(
    "/api/account-settings?platform=longbridge&key=synthetic-alpha",
  );
  assert.equal(settings.status, 200);
  const request = {
    platform: "longbridge",
    key: "synthetic-alpha",
    identity: settings.body.identity,
    expected_draft_revision: 0,
    overrides: {
      strategy_profile: "synthetic-growth",
      reserved_cash_floor: "10",
      reserved_cash_ratio: "0.15",
      income_layer_enabled: false,
      option_overlay_enabled: false,
    },
  };
  const saved = await call("/api/account-settings/draft", {
    method: "POST",
    body: request,
  });
  assert.equal(saved.status, 200);
  validate("draft", saved.body);
  assert.equal(saved.body.adopted, false);
  assert.equal(saved.body.draft.revision, 1);
  assert.deepEqual(saved.body.draft.overrides, request.overrides);
  const stale = await call("/api/account-settings/draft", {
    method: "POST",
    body: request,
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "account_settings_draft_revision_conflict");
  const invalid = await call("/api/account-settings/draft", {
    method: "POST",
    body: {
      ...request,
      expected_draft_revision: 1,
      overrides: { ...request.overrides, reserved_cash_ratio: "2" },
    },
  });
  assert.equal(invalid.status, 400);
  const after = await call(
    "/api/account-settings?platform=longbridge&key=synthetic-alpha",
  );
  assert.equal(after.body.draft.revision, 1);
  assert.deepEqual(
    after.body.draft.overrides,
    request.overrides,
    "invalid field cannot partially save other sections",
  );
  for (const forbidden of [
    { risk_preference: "BALANCED_COMPOUNDING" },
    { runtime_target_enabled: true },
    { apply: true },
  ])
    assert.equal(
      (
        await call("/api/account-settings/draft", {
          method: "POST",
          body: { ...request, ...forbidden, expected_draft_revision: 1 },
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await call("/api/account-settings/draft", {
        method: "POST",
        body: request,
        cookie: reader,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/api/account-settings/draft", {
        method: "POST",
        body: request,
        origin: "https://different.example",
      })
    ).status,
    403,
  );
  const diff = await call(
    "/api/account-settings/diff?account=synthetic-alpha",
    { cookie: reader },
  );
  assert.equal(diff.status, 200);
  validate("settings_diff", diff.body);
  assert.equal(diff.body.rows.length, 7);
  for (const row of diff.body.rows) {
    assert.equal(row.current, null);
    assert.equal(row.current_status, "unknown");
    assert.equal(row.current_reason, "reader_not_configured");
    assert.equal(row.current_source, "github_runtime_configuration");
    assert.equal(row.current_source_as_of, null);
  }
  const history = await call(
    "/api/account-settings/history?account=synthetic-alpha",
  );
  assert.equal(history.status, 200);
  validate("settings_history", history.body);
  assert.equal(history.body.items.length, 1);
  assert.equal(history.body.items[0].event, "draft_saved");
  assert.ok(!JSON.stringify(history.body).includes("synthetic-admin"));
  const accounts = await call("/api/accounts");
  assert.equal(accounts.status, 200);
  validate("accounts", accounts.body);
  assert.equal(accounts.body.accounts[0].pending_draft_count, 4);
  const combined = await call("/api/accounts?include=decisions-inbox", { cookie: reader });
  assert.equal(combined.status, 200);
  assert.deepEqual(combined.body.accounts, accounts.body, "combined accounts retain the existing body");
  validate("accounts", combined.body.accounts);
  validate("inbox", combined.body.inbox);
  assert.deepEqual(combined.body.inbox, (await call("/api/decisions-inbox", { cookie: reader })).body);
  assert.equal((await call("/api/accounts?include=decisions-inbox", { cookie: null })).status, 401);
  assert.equal((await call("/api/accounts?include=decisions-inbox", { method: "POST", body: {} })).status, 405);
  for (const query of ["include=", "include=other", "include=decisions-inbox&include=decisions-inbox",
    "include=decisions-inbox&decision_subject_id=synthetic", "include=decisions-inbox&limit=25"]) {
    assert.equal((await call(`/api/accounts?${query}`)).status, 400);
  }
  const kv = await mf.getKVNamespace("STRATEGY_SWITCH_CONFIG");
  await kv.put("current_strategies_cache", JSON.stringify({ ts: Date.now(), data: {
    longbridge: { "synthetic-alpha": { strategy_profile: "synthetic-growth" } },
  } }));
  const configured = await call("/api/config", { cookie: reader });
  const summary = await call("/api/strategies/summary", { cookie: reader });
  assert.equal(configured.body.currentStrategies.longbridge[account.key].strategy_profile, "synthetic-growth");
  assert.deepEqual(summary.body.strategies[0].configured_accounts, [{
    account_alias: account.key, platform: "longbridge", account_ref: `longbridge:${account.key}`,
    execution_mode: "unknown", dry_run_only: null, live_status: "unknown", continuation_reason: null,
    mode_source: null, runtime_observation_status: "unknown",
  }], "summary and /api/config share currentStrategies rather than the declared default");
  for (const [path, schema] of [
    ["/api/runtime/today", "today_runs"], ["/api/strategies/summary", "strategy_summary"],
    ["/api/notifications/send-log", "notification_log"], ["/api/accounts/run-controls?account=synthetic-alpha", "run_controls"],
  ]) {
    const read = await call(path, { cookie: reader });
    assert.equal(read.status, 200);
    validate(schema, read.body);
    assert.equal(read.body.no_order, true);
    assert.equal(read.body.execution_authority_granted, false);
    assert.equal((await call(path, { cookie: null })).status, 401);
    assert.equal((await call(path, { method: "POST", body: {} })).status, 405);
  }
  const controls = await call("/api/accounts/run-controls?account=synthetic-alpha");
  validate("run_controls", controls.body);
  assert.equal(controls.body.actions.enable.enabled, false);
  assert.equal(controls.body.actions.stop.enabled, false, "no dispatch client is configured");
  assert.equal(controls.body.actions.approve_application.enabled, false, "combined overrides cannot approve a profile-only application");
  assert.equal((await call("/api/accounts/run-controls?account=missing")).status, 400);
  assert.match(history.body.items[0].short_id, /^CH-[0-9A-Z]{13}$/);
  assert.ok(history.body.items[0].id);
  for (const [path, schema] of [
    ["/api/owner-decisions/history", "decision_history"],
    ["/api/decisions-inbox", "inbox"],
  ]) {
    const read = await call(path, { cookie: reader });
    assert.equal(read.status, 200);
    validate(schema, read.body);
    assert.equal((await call(path, { cookie: null })).status, 401);
    assert.equal((await call(path, { method: "POST", body: {} })).status, 405);
  }
  for (const part of [
    "calendar",
    "summary",
    "returns",
    "assets",
    "holdings",
    "trades",
  ]) {
    const result = await call("/api/performance/" + part);
    assert.equal(result.status, 200);
    validate(part, result.body);
  }
  const legacy = await call("/api/account-settings", {
    method: "POST",
    body: {
      ...request,
      expected_draft_revision: 1,
      overrides: { reserved_cash_ratio: "0.2" },
    },
  });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.draft.overrides.reserved_cash_ratio, "0.2");
  assert.equal(
    legacy.body.draft.overrides.strategy_profile,
    "synthetic-growth",
  );
  // Concurrent combined saves share the existing compare-and-swap guard.
  const race = await Promise.all(
    ["0.25", "0.3"].map((ratio) =>
      call("/api/account-settings/draft", {
        method: "POST",
        body: {
          ...request,
          expected_draft_revision: 2,
          overrides: { ...request.overrides, reserved_cash_ratio: ratio },
        },
      }),
    ),
  );
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    outbound,
    0,
    "new APIs do not contact upstream providers or dispatch workflows",
  );
} finally {
  await mf.dispose();
}
console.log("console_api_worker_validation: PASS");

// Count real route + inbox orchestration, with synthetic read ports. These are
// source-call counts, not production KV list/get or billing measurements.
const counts = { metadata: 0, owner: 0, promotion: 0, recovery: 0, credential: 0, outbound: 0 };
let generation = 0, ownerFailure = false, credentialForbidden = false;
let authoritativeFailure = false;
const json = (body, status = 200) => Response.json(body, { status });
const deps = {
  json,
  readSession: async () => ({ allowed: true, login: "synthetic-reader" }),
  accountOptions: async () => ({ options: { longbridge: [account] } }),
  command: async (_env, command) => {
    assert.equal(command.action, "console_account_metadata");
    counts.metadata++;
    if (authoritativeFailure) throw Error("synthetic_authoritative_unavailable");
    return { rows: [{ platform: "longbridge", account_key: account.key, pending_draft_count: generation }] };
  },
  owner: async () => {
    counts.owner++;
    if (ownerFailure) throw Error("private_source_sentinel_must_not_escape");
    return json({ data_status: "ready", candidates: [] });
  },
  promotion: async () => { counts.promotion++; return json({ data_status: "ready", tickets: [] }); },
  recovery: async () => { counts.recovery++; return json({ data_status: "ready", recoveries: [] }); },
  credential: async () => { counts.credential++; return credentialForbidden
    ? json({ ok: false, error: "admin required" }, 403) : json({ requires_action: false }); },
};
const request = (path) => new Request(`https://synthetic.invalid${path}`);
const read = async (path, ports = deps, env = {}) => {
  const response = await consoleApiResponse(request(path), env, ports);
  return { status: response.status, body: await response.json() };
};
const resetCounts = () => Object.keys(counts).forEach(key => { counts[key] = 0; });
const nativeFetch = globalThis.fetch;
globalThis.fetch = () => { counts.outbound++; throw Error("external_network_forbidden"); };
try {
  const oldAccounts = await read("/api/accounts");
  const oldInbox = await read("/api/decisions-inbox");
  assert.deepEqual(counts, { metadata: 1, owner: 2, promotion: 2, recovery: 2, credential: 2, outbound: 0 });
  resetCounts();
  const result = await read("/api/accounts?include=decisions-inbox");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { accounts: oldAccounts.body, inbox: oldInbox.body });
  assert.deepEqual(counts, { metadata: 1, owner: 1, promotion: 1, recovery: 1, credential: 1, outbound: 0 });
  generation = 7;
  assert.equal((await read("/api/accounts?include=decisions-inbox")).body.accounts.accounts[0].pending_draft_count, 7,
    "the next request re-reads current metadata; no cross-request cache");
  const other = await read("/api/accounts?include=decisions-inbox", { ...deps,
    readSession: async () => ({ allowed: true, login: "synthetic-other" }),
    command: async (env, command) => { assert.equal(command.actor, "synthetic-other");
      assert.equal(env.scope, "other"); return { rows: [] }; },
  }, { scope: "other" });
  assert.equal(other.body.accounts.accounts[0].pending_draft_count, 0, "env/actor do not inherit another request");
  ownerFailure = true;
  const partial = await read("/api/accounts?include=decisions-inbox");
  assert.equal(partial.body.accounts.status, "partial");
  assert.equal(partial.body.accounts.accounts[0].pending_draft_count, 7);
  assert.equal(partial.body.accounts.accounts[0].pending_decision_count, null);
  assert.equal(partial.body.inbox.status, "read_failed");
  assert.equal(partial.body.inbox.sources.find(source => source.source === "owner").status, "read_failed");
  assert.equal(JSON.stringify(partial.body).includes("private_source_sentinel_must_not_escape"), false);
  assert.deepEqual(partial.body.accounts, (await read("/api/accounts")).body, "original partial/error semantics preserved");
  ownerFailure = false;
  credentialForbidden = true;
  const forbiddenSource = await read("/api/accounts?include=decisions-inbox");
  assert.equal(forbiddenSource.body.inbox.status, "read_failed");
  assert.deepEqual(forbiddenSource.body.inbox, (await read("/api/decisions-inbox")).body,
    "a nested source 403 retains the original inbox classification");
  credentialForbidden = false;
  const beforeDenied = { ...counts };
  assert.equal((await read("/api/accounts?include=decisions-inbox", {
    ...deps, readSession: async () => ({ allowed: false }),
  })).status, 401);
  assert.deepEqual(counts, beforeDenied, "outer authentication fails before source reads");
  for (const query of ["include=wrong", "include=decisions-inbox&include=decisions-inbox",
    "include=decisions-inbox&material=synthetic", "include=decisions-inbox&cursor=0"]) {
    assert.equal((await read(`/api/accounts?${query}`)).status, 400);
    assert.deepEqual(counts, beforeDenied, "invalid combined queries do not reach source ports");
  }
  authoritativeFailure = true;
  const failed = await read("/api/accounts?include=decisions-inbox");
  assert.equal(failed.status, 503);
  assert.equal(Object.hasOwn(failed.body, "accounts"), false, "authoritative failure does not fabricate accounts");
  assert.equal(counts.outbound, 0);
} finally {
  globalThis.fetch = nativeFetch;
}
console.log("accounts_inbox_route_counts: PASS (synthetic source ports; not live KV measurements)");
