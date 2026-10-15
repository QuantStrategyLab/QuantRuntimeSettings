import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __test } from "../web/strategy-switch-console/worker.js";
import { validate } from "./console_api_contract_validation.mjs";
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
