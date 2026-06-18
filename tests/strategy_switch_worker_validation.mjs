import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import worker, { __test } from "../web/strategy-switch-console/worker.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexHtml = readFileSync(resolve(root, "web/strategy-switch-console/index.html"), "utf8");
assert.ok(__test.currentStrategiesTimeoutMs >= 8000);
const renderPlatformsBody = indexHtml.match(/function renderPlatforms\(\) \{([\s\S]*?)\n    \}/)?.[1] || "";
assert.ok(!renderPlatformsBody.includes("syncStrategyForAccount("));
assert.equal(indexHtml.includes(".innerHTML"), false);
assert.ok(indexHtml.includes('<body class="app-loading">'));
assert.ok(indexHtml.includes('id="boot-screen"'));
assert.ok(indexHtml.includes('id="app-shell"'));
assert.ok(indexHtml.includes(".switch-surface.summary-hidden"));
assert.ok(indexHtml.includes('summaryPanel.hidden = !showSummary'));
assert.ok(indexHtml.includes('switchSurface.classList.toggle("summary-hidden", !showSummary)'));
assert.equal(indexHtml.includes("publicSummary"), false);
assert.ok(indexHtml.includes("function hasPrivateConfig()"));
assert.ok(indexHtml.includes('el("quick-form").hidden = !showPrivateControls'));
assert.ok(indexHtml.includes("loginLink.hidden = signedIn"));
assert.equal(indexHtml.includes("loginLink.hidden = !state.auth.available || signedIn"), false);
assert.ok(indexHtml.includes('id="min-reserved-cash-input"'));
assert.ok(indexHtml.includes('id="reserved-cash-ratio-input"'));
assert.ok(indexHtml.includes('id="reserve-policy-mode-select"'));
assert.ok(indexHtml.includes('id="runtime-target-enabled-select"'));
assert.ok(indexHtml.includes('id="plugin-mode-select"'));
assert.ok(indexHtml.includes('id="income-layer-start-usd-input"'));
assert.ok(indexHtml.includes('incomeLayerStartUsd: "收入层起始金额"'));
assert.ok(indexHtml.includes('incomeLayerStartUsd: "Income layer start amount"'));
assert.ok(indexHtml.includes('incomeLayerStartUsdVariable = "INCOME_LAYER_START_USD"'));
assert.ok(indexHtml.includes('el("income-layer-mode-select").addEventListener("change"'));
assert.ok(indexHtml.includes('el("income-layer-start-usd-input").addEventListener("input"'));
assert.ok(indexHtml.includes('el("income-layer-max-ratio-input").addEventListener("input"'));
assert.ok(indexHtml.includes('label_zh: "纳指100 / 标普500 智能定投"'));
assert.ok(indexHtml.includes('class="form-section income-layer-section"'));
assert.ok(indexHtml.includes('class="control-block reserve-policy-block section-wide"'));
assert.ok(indexHtml.includes('profile: "ibit_smart_dca"'));
assert.ok(indexHtml.includes('IBIT 比特币 ETF 智能定投'));
assert.ok(indexHtml.includes('localStrategyLabels'));
assert.ok(indexHtml.includes('function strategyLabelSet('));
assert.ok(indexHtml.includes("account-block"));
assert.ok(indexHtml.includes("strategy-block"));
assert.ok(indexHtml.includes(".form-section {"));
assert.ok(indexHtml.includes(".form-section + .form-section"));
assert.ok(indexHtml.includes("grid-template-columns: repeat(2, minmax(0, 1fr));"));
assert.ok(indexHtml.includes("grid-column: 1 / -1;"));
assert.ok(indexHtml.includes('reservePolicyNone'));
assert.ok(indexHtml.includes('reservePolicyRatio'));
assert.ok(indexHtml.includes('reservePolicyFloor'));
assert.ok(indexHtml.includes('reservePolicyMax'));
assert.ok(indexHtml.includes('pluginModeAuto'));
assert.ok(indexHtml.includes('pluginModeNone'));
assert.ok(indexHtml.includes('runtimeTargetMode: "账号运行状态"'));
assert.ok(indexHtml.includes('runtimeTargetEnabled: "启用正式运行"'));
assert.ok(indexHtml.includes('runtimeTargetDisabled: "停用正式运行"'));
assert.ok(indexHtml.includes('runtimeTargetMode: "Account status"'));
assert.ok(indexHtml.includes('pluginMode: "插件启用范围"'));
assert.ok(indexHtml.includes('pluginModeAuto: "启用插件"'));
assert.ok(indexHtml.includes('pluginModeNone: "禁用插件"'));
assert.ok(indexHtml.includes('pluginModeAuto: "Enabled"'));
assert.ok(indexHtml.includes('pluginMode: "Plugin scope"'));
assert.ok(indexHtml.includes('reservedCashDefault'));
assert.ok(indexHtml.includes('paper: "模拟"'));
assert.ok(indexHtml.includes('paper: "Dry run"'));
assert.ok(indexHtml.includes('平台默认：0 {currency} / 0%'));
assert.equal(indexHtml.includes('比例沿用策略默认，通常 3%'), false);
assert.equal(indexHtml.includes('平台默认：max(0 {currency}, 3%)'), false);
assert.ok(indexHtml.includes('function platformReservedCashDefaultText('));
assert.ok(indexHtml.includes('platformMinReservedCashVariables'));
assert.ok(indexHtml.includes('platformReservedCashRatioVariables'));
assert.ok(indexHtml.includes('extra_variables_json'));
assert.ok(indexHtml.includes('function selectedCashCurrency('));
assert.ok(indexHtml.includes('function currentReservedCashPolicyText('));
assert.ok(indexHtml.includes('function hasPendingChanges('));
assert.ok(indexHtml.includes('function pendingChangeState('));
assert.ok(indexHtml.includes('reservedCashTouched: false'));
assert.ok(indexHtml.includes('reserve-ratio-block'));
assert.ok(indexHtml.includes('.summary-row.pending'));
assert.ok(indexHtml.includes('function currentEntryHasState('));
assert.ok(indexHtml.includes('changes.reserveCashChanged'));
assert.ok(indexHtml.includes('changes.pluginModeChanged'));
assert.ok(indexHtml.includes('changes.runtimeTargetChanged'));
assert.ok(indexHtml.includes('!hasPendingChange'));
assert.ok(indexHtml.includes('hasPendingChange ? t("readyNote") : ""'));
assert.equal(indexHtml.includes('hasPendingChange ? t("readyNote") : t("noChangesNote")'), false);
assert.equal(
  indexHtml.includes('state.auth.allowed && !loadingConfig && (!hasPrivateAccounts || !hasValidStrategy || !hasPendingChange)'),
  false,
);
assert.ok(indexHtml.includes('noChangesNote'));
assert.equal(indexHtml.includes('placeholder="150"'), false);
assert.equal(indexHtml.includes('placeholder="0.03"'), false);
assert.equal(indexHtml.includes("ibkr-primary"), false);
assert.equal(indexHtml.includes("longbridge-quant-sg-service"), false);
assert.equal(indexHtml.includes('account_selector: "SG"'), false);
assert.match(indexHtml, /body\.app-loading \.shell\s*\{\s*display: none;/);

const servedPageResponse = await worker.fetch(new Request("https://switch.example/"), {});
const servedHtml = await servedPageResponse.text();
assert.equal(servedPageResponse.status, 200);
assert.ok(servedHtml.includes("function hasPrivateConfig()"));
assert.equal(servedHtml.includes("ibkr-primary"), false);
assert.equal(servedHtml.includes("longbridge-quant-sg-service"), false);
assert.equal(servedHtml.includes('account_selector: "SG"'), false);

const publicConfigResponse = await worker.fetch(new Request("https://switch.example/api/config"), {});
assert.equal(publicConfigResponse.status, 200);
assert.deepEqual(await publicConfigResponse.json(), { accountOptions: null });

assert.equal(
  __test.platformRepositories({ STRATEGY_SWITCH_LONGBRIDGE_REPO: "ForkOrg/LongBridgePlatform" }).longbridge,
  "ForkOrg/LongBridgePlatform",
);
assert.equal(
  __test.platformRepositories({
    RUNTIME_SETTINGS_PLATFORM_REPOSITORIES_JSON: JSON.stringify({
      ibkr: "ForkOrg/InteractiveBrokersPlatform",
    }),
  }).ibkr,
  "ForkOrg/InteractiveBrokersPlatform",
);

const headers = __test.responseHeaders({ "Content-Type": "text/html; charset=utf-8" });
assert.equal(headers.get("X-Frame-Options"), "DENY");
assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
assert.equal(headers.get("Referrer-Policy"), "no-referrer");
assert.match(headers.get("Content-Security-Policy") || "", /frame-ancestors 'none'/);

assert.doesNotThrow(() => __test.requireSameOrigin(
  new Request("https://switch.example/api/switch", {
    method: "POST",
    headers: { Origin: "https://switch.example" },
  }),
  { requireOrigin: true },
));
const missingOriginError = captureError(
  () => __test.requireSameOrigin(new Request("https://switch.example/api/switch", { method: "POST" }), {
    requireOrigin: true,
  }),
);
assert.match(missingOriginError.message, /Origin header is required/);
assert.equal(missingOriginError.status, 403);
const crossOriginError = captureError(
  () => __test.requireSameOrigin(
    new Request("https://switch.example/api/switch", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    }),
    { requireOrigin: true },
  ),
);
assert.match(crossOriginError.message, /cross-origin request rejected/);
assert.equal(crossOriginError.status, 403);

const unauthorizedSyncResponse = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-account-default", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }),
  { STRATEGY_SWITCH_SYNC_TOKEN: "test-sync-token" },
);
assert.equal(unauthorizedSyncResponse.status, 401);
assert.match((await unauthorizedSyncResponse.json()).error, /internal sync token is invalid/);

assert.equal(
  await __test.withTimeout(new Promise(() => {}), 1, "fallback"),
  "fallback",
);
const timeoutFetchResponse = await __test.fetchWithTimeout(
  "https://api.github.test/user",
  { headers: { Accept: "application/json" } },
  100,
  async (_resource, init) => {
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.headers.Accept, "application/json");
    return new Response('{"ok":true}', { status: 200 });
  },
);
assert.equal(timeoutFetchResponse.status, 200);
await assert.rejects(
  () => __test.fetchWithTimeout(
    "https://api.github.test/slow",
    {},
    1,
    (_resource, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }),
  ),
  /GitHub request timed out/,
);

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("Expected function to throw");
}

const strategyProfiles = __test.normalizeStrategyProfilesPayload(
  [
    {
      profile: "tqqq_growth_income",
      label: "TQQQ Growth Income",
      label_zh: "TQQQ 增长收益",
      domain: "us_equity",
      runtime_enabled: true,
    },
    {
      profile: "hk_low_vol_dividend_quality_snapshot",
      label: "HK Low-Vol Dividend Quality Snapshot",
      domain: "hk_equity",
      runtime_enabled: true,
    },
  ],
  "test_strategy_profiles",
);
assert.equal(strategyProfiles[0].label_en, "TQQQ Growth Income");
assert.equal(strategyProfiles[0].label_zh, "TQQQ 增长收益");

const accountOptions = __test.normalizeAccountOptionsPayload(
  {
    longbridge: [
      {
        key: "hk",
        label: "hk",
        target_name: "hk",
        account_selector: "HK",
        default_strategy_profile: "hk_low_vol_dividend_quality_snapshot",
        cash_currency: "HKD",
      },
      {
        key: "sg",
        label: "sg",
        target_name: "sg",
        account_selector: "SG",
        default_strategy_profile: "tqqq_growth_income",
      },
    ],
    ibkr: [
      {
        key: "ibkr-primary",
        label: "ibkr-primary",
        target_name: "ibkr-primary",
        account_selector: "DEMO_IBKR_PRIMARY",
        deployment_selector: "demo-ibkr-tqqq",
        account_scope: "demo-ibkr-tqqq",
        service_name: "interactive-brokers-demo-ibkr-tqqq-service",
      },
    ],
    schwab: [
      {
        key: "default",
        label: "default",
        target_name: "default",
        supported_domains: ["us_equity"],
      },
    ],
    firstrade: [
      {
        key: "default",
        label: "default",
        target_name: "default",
        supported_domains: ["us_equity"],
      },
    ],
  },
  "test_account_options",
);

assert.deepEqual(accountOptions.longbridge[0].supported_domains, ["us_equity", "hk_equity"]);
assert.deepEqual(accountOptions.longbridge[1].supported_domains, ["us_equity", "hk_equity"]);
assert.deepEqual(accountOptions.ibkr[0].supported_domains, ["us_equity", "hk_equity"]);
assert.equal(accountOptions.longbridge[0].cash_currency, "HKD");

const kvUnboundSyncResponse = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-account-default", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-sync-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      platform: "ibkr",
      target_name: "ibkr-primary",
      account_selector: "DEMO_IBKR_PRIMARY",
      deployment_selector: "demo-ibkr-tqqq",
      account_scope: "demo-ibkr-tqqq",
      service_name: "interactive-brokers-demo-ibkr-tqqq-service",
      strategy_profile: "tqqq_growth_income",
      execution_mode: "live",
      variable_scope: "default",
      plugin_mode: "auto",
    }),
  }),
  {
    STRATEGY_SWITCH_SYNC_TOKEN: "test-sync-token",
    STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify(accountOptions),
    STRATEGY_SWITCH_STRATEGY_PROFILES_JSON: JSON.stringify(strategyProfiles),
  },
);
assert.equal(kvUnboundSyncResponse.status, 200);
const kvUnboundSyncBody = await kvUnboundSyncResponse.json();
assert.equal(kvUnboundSyncBody.ok, true);
assert.deepEqual(kvUnboundSyncBody.account_options_sync, {
  synced: false,
  reason: "kv_not_bound",
  skipped: true,
});

const normalizedReservedCashInputs = __test.normalizeSwitchInputs({
  platform: "ibkr",
  target_name: "ibkr-primary",
  strategy_profile: "tqqq_growth_income",
  execution_mode: "live",
  account_selector: "DEMO_IBKR_PRIMARY",
  deployment_selector: "demo-ibkr-tqqq",
  account_scope: "demo-ibkr-tqqq",
  service_name: "interactive-brokers-demo-ibkr-tqqq-service",
  apply: "true",
  trigger_platform_sync: "true",
  reserved_cash_ratio: "0.03",
  min_reserved_cash_usd: "150",
  income_layer_start_usd: "250000",
  income_layer_max_ratio: "0.55",
});
assert.equal(normalizedReservedCashInputs.reserved_cash_ratio, "0.03");
assert.equal(normalizedReservedCashInputs.min_reserved_cash_usd, "150");
assert.equal(normalizedReservedCashInputs.income_layer_start_usd, "250000");
assert.equal(normalizedReservedCashInputs.income_layer_max_ratio, "0.55");
const normalizedPluginInputs = __test.normalizeSwitchInputs({
  platform: "ibkr",
  target_name: "ibkr-primary",
  strategy_profile: "tqqq_growth_income",
  execution_mode: "live",
  plugin_mode: "none",
});
assert.equal(normalizedPluginInputs.plugin_mode, "none");
const normalizedReserveClearInputs = __test.normalizeSwitchInputs({
  platform: "ibkr",
  target_name: "ibkr-primary",
  strategy_profile: "tqqq_growth_income",
  execution_mode: "live",
  extra_variables_json: JSON.stringify({
    IBKR_MIN_RESERVED_CASH_USD: "",
    IBKR_RESERVED_CASH_RATIO: "",
  }),
});
assert.equal(
  normalizedReserveClearInputs.extra_variables_json,
  JSON.stringify({
    IBKR_MIN_RESERVED_CASH_USD: "",
    IBKR_RESERVED_CASH_RATIO: "",
  }),
);
assert.throws(
  () => __test.normalizeSwitchInputs({
    platform: "ibkr",
    target_name: "ibkr-primary",
    strategy_profile: "tqqq_growth_income",
    reserved_cash_ratio: "1.25",
  }),
  /reserved_cash_ratio must be between 0 and 1/,
);

const updatedAccountOptions = __test.updateAccountOptionsDefaultStrategy(
  accountOptions,
  {
    platform: "longbridge",
    target_name: "sg",
    account_selector: "SG",
    deployment_selector: "SG",
    account_scope: "SG",
    service_name: "longbridge-quant-sg-service",
    github_environment: "longbridge-sg",
    strategy_profile: "soxl_soxx_trend_income",
    execution_mode: "live",
    variable_scope: "environment",
    plugin_mode: "auto",
  },
);
assert.equal(updatedAccountOptions.changed, true);
assert.equal(updatedAccountOptions.options.longbridge[1].default_strategy_profile, "soxl_soxx_trend_income");

const updatedPluginModeOptions = __test.updateAccountOptionsDefaultStrategy(
  accountOptions,
  {
    platform: "longbridge",
    target_name: "sg",
    account_selector: "SG",
    strategy_profile: "tqqq_growth_income",
    execution_mode: "live",
    variable_scope: "default",
    plugin_mode: "none",
  },
);
assert.equal(updatedPluginModeOptions.changed, true);
assert.equal(updatedPluginModeOptions.options.longbridge[1].plugin_mode, "none");

const kvWrites = new Map();
const syncResult = await __test.syncDefaultStrategyForAccount(
  {
    STRATEGY_SWITCH_CONFIG: {
      get: async (key) => key === "audit_log" ? "[]" : null,
      put: async (key, value) => kvWrites.set(key, value),
    },
  },
  accountOptions,
  {
    platform: "longbridge",
    target_name: "sg",
    account_selector: "SG",
    strategy_profile: "soxl_soxx_trend_income",
    execution_mode: "live",
    variable_scope: "default",
    plugin_mode: "auto",
  },
  { login: "pigbibi" },
);
assert.equal(syncResult.synced, true);
assert.equal(syncResult.changed, true);
assert.equal(JSON.parse(kvWrites.get("account_options")).longbridge[1].default_strategy_profile, "soxl_soxx_trend_income");

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const requestUrl = String(url);
  if (requestUrl.endsWith("/CLOUD_RUN_SERVICE_TARGETS_JSON")) {
    return new Response("", { status: 404 });
  }
  if (requestUrl.endsWith("/SCHWAB_MIN_RESERVED_CASH_USD")) {
    return new Response(JSON.stringify({ value: "150" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.endsWith("/SCHWAB_RESERVED_CASH_RATIO")) {
    return new Response(JSON.stringify({ value: "0.03" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.endsWith("/INCOME_LAYER_START_USD")) {
    return new Response(JSON.stringify({ value: "150000" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.endsWith("/INCOME_LAYER_MAX_RATIO")) {
    return new Response(JSON.stringify({ value: "0.95" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.endsWith("/RUNTIME_TARGET_ENABLED")) {
    return new Response(JSON.stringify({ value: "false" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.endsWith("/RUNTIME_TARGET_JSON")) {
    return new Response(JSON.stringify({
      value: JSON.stringify({
        platform_id: "schwab",
        strategy_profile: "soxl_soxx_trend_income",
        dry_run_only: false,
        account_scope: "schwab",
        service_name: "charles-schwab-quant-service",
        execution_mode: "live",
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("", { status: 404 });
};
try {
  const currentStrategies = await __test.loadCurrentStrategies(
    { schwab: accountOptions.schwab },
    { RUNTIME_SETTINGS_DISPATCH_TOKEN: "test-token" },
  );
  assert.equal(currentStrategies.schwab.default.strategy_profile, "soxl_soxx_trend_income");
  assert.equal(currentStrategies.schwab.default.execution_mode, "live");
  assert.equal(currentStrategies.schwab.default.min_reserved_cash_usd, "150");
  assert.equal(currentStrategies.schwab.default.reserved_cash_ratio, "0.03");
  assert.equal(currentStrategies.schwab.default.income_layer_start_usd, "150000");
  assert.equal(currentStrategies.schwab.default.income_layer_max_ratio, "0.95");
  assert.equal(currentStrategies.schwab.default.runtime_target_enabled, false);
  assert.equal(currentStrategies.schwab.default.source, "RUNTIME_TARGET_JSON");
} finally {
  globalThis.fetch = originalFetch;
}

globalThis.fetch = async (url) => {
  const requestUrl = String(url);
  if (requestUrl.endsWith("/CLOUD_RUN_SERVICE_TARGETS_JSON")) {
    return new Response(JSON.stringify({
      value: JSON.stringify({
        targets: [
          {
            service: "interactive-brokers-demo-ibkr-tqqq-service",
            ACCOUNT_GROUP: "demo-ibkr-tqqq",
            IBKR_MIN_RESERVED_CASH_USD: "150",
            IBKR_RESERVED_CASH_RATIO: "0.03",
            INCOME_LAYER_START_USD: "250000",
            INCOME_LAYER_MAX_RATIO: "0.55",
            RUNTIME_TARGET_ENABLED: "false",
            runtime_target: {
              platform_id: "ibkr",
              strategy_profile: "tqqq_growth_income",
              dry_run_only: false,
              account_scope: "demo-ibkr-tqqq",
              service_name: "interactive-brokers-demo-ibkr-tqqq-service",
              execution_mode: "live",
            },
          },
        ],
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("", { status: 404 });
};
try {
  const currentStrategies = await __test.loadCurrentStrategies(
    { ibkr: accountOptions.ibkr },
    { RUNTIME_SETTINGS_DISPATCH_TOKEN: "test-token" },
  );
  assert.equal(currentStrategies.ibkr["ibkr-primary"].strategy_profile, "tqqq_growth_income");
  assert.equal(currentStrategies.ibkr["ibkr-primary"].min_reserved_cash_usd, "150");
  assert.equal(currentStrategies.ibkr["ibkr-primary"].reserved_cash_ratio, "0.03");
  assert.equal(currentStrategies.ibkr["ibkr-primary"].income_layer_start_usd, "250000");
  assert.equal(currentStrategies.ibkr["ibkr-primary"].income_layer_max_ratio, "0.55");
  assert.equal(currentStrategies.ibkr["ibkr-primary"].runtime_target_enabled, false);
  assert.equal(currentStrategies.ibkr["ibkr-primary"].source, "CLOUD_RUN_SERVICE_TARGETS_JSON");
} finally {
  globalThis.fetch = originalFetch;
}

globalThis.fetch = async (url) => {
  const requestUrl = String(url);
  if (requestUrl.endsWith("/CLOUD_RUN_SERVICE_TARGETS_JSON")) {
    return new Response("", { status: 404 });
  }
  if (requestUrl.endsWith("/LONGBRIDGE_MIN_RESERVED_CASH_USD")) {
    return new Response(JSON.stringify({ value: "150" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.endsWith("/LONGBRIDGE_RESERVED_CASH_RATIO")) {
    return new Response(JSON.stringify({ value: "0.03" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response("", { status: 404 });
};
try {
  const currentStrategies = await __test.loadCurrentStrategies(
    { longbridge: [accountOptions.longbridge[0]] },
    { RUNTIME_SETTINGS_DISPATCH_TOKEN: "test-token" },
  );
  assert.equal(currentStrategies.longbridge.hk.strategy_profile, undefined);
  assert.equal(currentStrategies.longbridge.hk.min_reserved_cash_usd, "150");
  assert.equal(currentStrategies.longbridge.hk.reserved_cash_ratio, "0.03");
  assert.equal(currentStrategies.longbridge.hk.source, "RESERVED_CASH_VARIABLES");
} finally {
  globalThis.fetch = originalFetch;
}

let releaseReservedVariables;
let reservedVariableRequests = 0;
let reservedVariablesFinished = false;
let runtimeTargetStartedBeforeReservedVariablesFinished = false;
const reservedVariablesGate = new Promise((resolve) => {
  releaseReservedVariables = () => {
    reservedVariablesFinished = true;
    resolve();
  };
});
const reservedVariableFallback = setTimeout(releaseReservedVariables, 100);
globalThis.fetch = async (url) => {
  const requestUrl = String(url);
  if (requestUrl.endsWith("/CLOUD_RUN_SERVICE_TARGETS_JSON")) {
    return new Response("", { status: 404 });
  }
  if (requestUrl.endsWith("/SCHWAB_MIN_RESERVED_CASH_USD") || requestUrl.endsWith("/SCHWAB_RESERVED_CASH_RATIO")) {
    reservedVariableRequests += 1;
    await reservedVariablesGate;
    return new Response(JSON.stringify({ value: requestUrl.endsWith("/SCHWAB_RESERVED_CASH_RATIO") ? "0.03" : "150" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.endsWith("/RUNTIME_TARGET_JSON")) {
    runtimeTargetStartedBeforeReservedVariablesFinished = reservedVariableRequests === 2 && !reservedVariablesFinished;
    releaseReservedVariables();
    return new Response(JSON.stringify({
      value: JSON.stringify({
        platform_id: "schwab",
        strategy_profile: "soxl_soxx_trend_income",
        dry_run_only: false,
        account_scope: "schwab",
        service_name: "charles-schwab-quant-service",
        execution_mode: "live",
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("", { status: 404 });
};
try {
  const currentStrategies = await __test.loadCurrentStrategies(
    { schwab: accountOptions.schwab },
    { RUNTIME_SETTINGS_DISPATCH_TOKEN: "test-token" },
  );
  assert.equal(currentStrategies.schwab.default.min_reserved_cash_usd, "150");
  assert.equal(currentStrategies.schwab.default.reserved_cash_ratio, "0.03");
  assert.equal(runtimeTargetStartedBeforeReservedVariablesFinished, true);
} finally {
  clearTimeout(reservedVariableFallback);
  globalThis.fetch = originalFetch;
}

const longbridgeHk = __test.assertConfiguredAccount(
  {
    platform: "longbridge",
    target_name: "hk",
    account_selector: "HK",
    strategy_profile: "hk_low_vol_dividend_quality_snapshot",
  },
  accountOptions,
);
__test.assertStrategyAllowedForAccount(
  {
    platform: "longbridge",
    strategy_profile: "hk_low_vol_dividend_quality_snapshot",
  },
  longbridgeHk,
  strategyProfiles,
);

const ibkrAccount = __test.assertConfiguredAccount(
  {
    platform: "ibkr",
    target_name: "ibkr-primary",
    account_selector: "DEMO_IBKR_PRIMARY",
    deployment_selector: "demo-ibkr-tqqq",
    account_scope: "demo-ibkr-tqqq",
    service_name: "interactive-brokers-demo-ibkr-tqqq-service",
    strategy_profile: "tqqq_growth_income",
  },
  accountOptions,
);
__test.assertStrategyAllowedForAccount(
  {
    platform: "ibkr",
    strategy_profile: "tqqq_growth_income",
  },
  ibkrAccount,
  strategyProfiles,
);
__test.assertStrategyAllowedForAccount(
  {
    platform: "ibkr",
    strategy_profile: "hk_low_vol_dividend_quality_snapshot",
  },
  ibkrAccount,
  strategyProfiles,
);

const schwabAccount = __test.assertConfiguredAccount(
  {
    platform: "schwab",
    target_name: "default",
    strategy_profile: "tqqq_growth_income",
  },
  accountOptions,
);
__test.assertStrategyAllowedForAccount(
  {
    platform: "schwab",
    strategy_profile: "tqqq_growth_income",
  },
  schwabAccount,
  strategyProfiles,
);
assert.throws(
  () => __test.assertStrategyAllowedForAccount(
    {
      platform: "schwab",
      strategy_profile: "hk_low_vol_dividend_quality_snapshot",
    },
    schwabAccount,
    strategyProfiles,
  ),
  /not supported/,
);
