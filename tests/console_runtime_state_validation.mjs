import { githubVariableListMock } from "./helpers/github_variable_list_mock.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import worker, { __test } from "../web/strategy-switch-console/worker.js";
import { normalizeAccountOptionsPayload as normalizeAccountSchema } from "../web/strategy-switch-console/account_options_schema.js";
import { isLiveSwitchAllowed } from "../web/strategy-switch-console/catalog.js";
import {
  accountMatchesStatusFilter,
  applicationRetryAllowed,
  buildSwitchInputs,
  defaultSwitchDraft,
  diagnosisUserSummary,
  pageFromWorkspace,
  presentAccountState,
  promotionSuggestion,
  recoveryBinding,
} from "../web/strategy-switch-console/frontend/src/operations.ts";
import { createAccountSettingsController } from "../web/strategy-switch-console/frontend/src/accountSettingsState.ts";
import {
  accountDisplayTitle,
  activationFromProjection,
  decisionActionState,
  listDailyDecisions,
  paperApplicationReady,
  safeActionVisibility,
  strategyDisplayName,
} from "../web/strategy-switch-console/frontend/src/presentation.ts";

const pageFiles = [
  "frontend/src/App.tsx",
  "frontend/src/OverviewPage.tsx",
  "frontend/src/AccountsPage.tsx",
  "frontend/src/DecisionsPage.tsx",
  "frontend/src/presentation.ts",
  "frontend/src/styles.css",
];
const pages = pageFiles.map((file) => readFileSync(new URL(`../web/strategy-switch-console/${file}`, import.meta.url), "utf8")).join("\n");
const appSource = readFileSync(new URL("../web/strategy-switch-console/frontend/src/App.tsx", import.meta.url), "utf8");
const accountsSource = readFileSync(new URL("../web/strategy-switch-console/frontend/src/AccountsPage.tsx", import.meta.url), "utf8");
const decisionsSource = readFileSync(new URL("../web/strategy-switch-console/frontend/src/DecisionsPage.tsx", import.meta.url), "utf8");
const overviewSource = readFileSync(new URL("../web/strategy-switch-console/frontend/src/OverviewPage.tsx", import.meta.url), "utf8");
const digest = "a".repeat(64);

function settingsPayload(overrides = {}) {
  return {
    platform: "ibkr",
    key: "example",
    identity: { account_id: "example" },
    risk: { preference: "", revision: 1 },
    draft: { status: "current", revision: 1, overrides: {} },
    ...overrides,
  };
}

function monitored(overrides = {}) {
  return {
    scope: "monitoring_only",
    limit: "not_trading_or_books",
    health: "unknown",
    activation: "unknown",
    reason: "evidence_insufficient",
    ...overrides,
  };
}

function sources(overrides = {}) {
  return {
    language: "zh",
    profiles: [],
    promotions: { value: { data_status: "ready", tickets: [] } },
    owners: { value: { data_status: "ready", candidates: [] } },
    recovery: { value: { data_status: "ready", recoveries: [] } },
    accountsFor: () => [{ platform: "ibkr", key: "example", label: "Example" }],
    ...overrides,
  };
}

test("pending option layer has one editable label across draft states", () => {
  assert.equal((accountsSource.match(/t\("待应用期权层"\)/g) || []).length, 1);
  assert.match(accountsSource, /<label className="cash-floor-field">\{t\("待应用期权层"\)\}\s*<select value=\{optionValue\}/);
  assert.match(accountsSource, /controller\.revertOption\(\)/);
});

test("runtime mode normalization keeps paper identity while dispatch stays fail closed", () => {
  const base = { platform: "ibkr", target_name: "example", strategy_profile: "tqqq_growth_income", apply: "false" };
  assert.equal(__test.normalizeSwitchInputs({ ...base, execution_mode: "paper" }).execution_mode, "dry_run");
  assert.equal(__test.normalizeSwitchInputs({ ...base, execution_mode: "dry_run" }).execution_mode, "dry_run");
  assert.throws(() => __test.normalizeSwitchInputs({ ...base, execution_mode: "sandbox" }));
  const account = { key: "example", target_name: "example" };
  const form = defaultSwitchDraft(account, { strategy_profile: "tqqq_growth_income", execution_mode: "dry_run" }, "ibkr");
  assert.equal(buildSwitchInputs("ibkr", account, form).execution_mode, "dry_run");
  assert.throws(() => buildSwitchInputs("ibkr", account, { ...form, executionMode: "paper" }));
  assert.match(appSource, /const ACCOUNT_PLAN_SUBMISSION_AVAILABLE = false/);
  assert.equal(accountsSource.includes("executionMode"), false);
});

test("frontend account normalization and display preserve broker identity and all U account selectors", () => {
  const normalized = normalizeAccountSchema({
    ibkr: [{
      key: "example",
      label: "主账户",
      target_name: "example",
      supported_domains: ["us_equity"],
      account_selector: "U10000001, U10000002",
      broker_environment: "live",
    }],
  });
  assert.equal(normalized.ibkr[0].account_selector, "U10000001, U10000002");
  assert.equal(normalized.ibkr[0].broker_environment, "live");
  assert.equal(accountDisplayTitle(normalized.ibkr[0], "IBKR", "实盘"), "主账户");
  assert.equal(accountDisplayTitle({ key: "internal-key" }, "IBKR", "实盘"), "账户");
  assert.equal(accountDisplayTitle(normalized.ibkr[0], "IBKR", "实盘").includes("0001"), false);
  assert.equal(accountDisplayTitle({ label: "soxl", account_selector: "U10000001" }, "IBKR", "实盘"), "U10000001");
  assert.equal(accountDisplayTitle({ key: "hk", account_selector: "U10000001, U10000002" }, "IBKR", "实盘"), "账户 · hk");
  const binance = { key: "crypto_combo", target_name: "crypto_combo" };
  assert.equal(accountDisplayTitle(binance, "Binance", ""), "账户 · live");
  assert.equal(binance.key, "crypto_combo");
  assert.equal(binance.target_name, "crypto_combo");
});

test("account persistence preserves explicit observation and variable-source bindings", () => {
  const source = { ibkr: [{ key: "fixture", label: "Fixture", target_name: "fixture", supported_domains: ["us_equity"],
    runtime_status_target_id: "ibkr.fixture", github_environment: "fixture-environment", variable_scope: "environment" }] };
  assert.deepEqual(normalizeAccountSchema(source), source);
});

test("account schema preserves an explicit broker environment without inferring missing values", () => {
  const normalized = normalizeAccountSchema({
    longbridge: [{
      key: "paper", label: "Paper", target_name: "paper", supported_domains: ["us_equity"],
      broker_environment: "paper", default_execution_mode: "live",
    }],
    ibkr: [{ key: "legacy", label: "Legacy", target_name: "legacy", supported_domains: ["us_equity"] }],
  });
  assert.equal(normalized.longbridge[0].broker_environment, "paper");
  assert.equal(normalized.longbridge[0].default_execution_mode, "live");
  assert.equal("broker_environment" in normalized.ibkr[0], false);
  assert.throws(() => normalizeAccountSchema({
    longbridge: [{ key: "bad", label: "Bad", target_name: "bad", supported_domains: ["us_equity"], broker_environment: "sandbox" }],
  }), /broker_environment/);
});

test("strategy display distinguishes an unread account from an explicit unknown readback", () => {
  assert.match(appSource, /useEffect\(\(\) => \{\s*setObservedStrategy\(current => current\?\.id === selectedId \? current : null\);\s*\}, \[selectedId\]\);/);
  assert.match(appSource, /const overlay = observedStrategy\?\.id === row\.id \? observedStrategy : null;\s*const profileId = overlay \? overlay\.profile : row\.current\?\.strategy_profile;/);
  assert.match(appSource, /strategy: overlay && !overlay\.profile \? t\("未知"\) : namedStrategy\(profileId\)/);
  assert.match(appSource, /setObservedStrategy\(current => current\?\.id === id && current\.profile === profile \? current : \{ id, profile \}\)/);
});

for (const [mode, expected] of [["current", false], ["none", true], ["floor", true]]) {
  test(`cash preview preserves current policy unless explicitly overridden: ${mode}`, () => {
    const account = { key: "example", target_name: "example" };
    const form = defaultSwitchDraft(account, { strategy_profile: "tqqq_growth_income", execution_mode: "dry_run" }, "ibkr");
    form.touched = { reserve: mode !== "current" };
    form.reserveMode = mode;
    if (mode === "floor") form.reserveFloor = "100";
    const inputs = buildSwitchInputs("ibkr", account, form);
    assert.equal(inputs.reserved_cash_policy_mode !== undefined, expected);
    if (mode === "current") assert.equal(inputs.extra_variables_json, undefined);
  });
}

for (const value of [undefined, true, false]) {
  test(`frontend does not invent enabled: ${value}`, () => {
    const controller = createAccountSettingsController();
    const op = controller.select({ platform: "ibkr", key: "example" });
    assert.equal(controller.applyRead(op, settingsPayload(value === undefined ? {} : { runtime_target_enabled: value })), true);
    assert.equal(JSON.stringify(controller.view().draft).includes("runtime_target"), false);
    assert.equal(controller.startSave("draft"), null);
    const inputs = buildSwitchInputs("ibkr", { key: "example", target_name: "example" }, defaultSwitchDraft(
      { key: "example", target_name: "example" },
      { strategy_profile: "tqqq_growth_income", execution_mode: "dry_run", runtime_target_enabled: value },
      "ibkr",
    ));
    assert.equal(inputs.runtime_target_enabled_mode, "current");
    assert.equal(inputs.extra_variables_json, undefined);
  });
}

test("account routing defaults do not become runtime observations", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 404 });
  try {
    const result = await __test.loadCurrentStrategies({ ibkr: [{
      key: "example", target_name: "example", runtime_target_enabled: true, default_execution_mode: "live",
    }] }, { RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-only" });
    assert.notEqual(result.ibkr?.example?.runtime_target_enabled, true);
  } finally { globalThis.fetch = original; }
});

for (const sample of [
  { name: "repo disabled fallback", scoped: false, expected: false },
  { name: "explicit target enabled", target: true, scoped: false, expected: true },
  { name: "explicit target disabled", target: false, scoped: true, expected: false },
  { name: "environment enabled", environment: true, scoped: true, expected: true },
  { name: "missing remains unknown", expected: undefined },
  { name: "nested service env enabled beats repo disabled", nested: true, scoped: false, expected: true },
  { name: "nested service env disabled beats repo enabled", nested: false, scoped: true, expected: false },
  { name: "top-level service override beats nested env", target: false, nested: true, scoped: true, expected: false },
]) {
  test(sample.name, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = githubVariableListMock(async (url) => {
      const path = String(url);
      let value;
      if (path.endsWith("/CLOUD_RUN_SERVICE_TARGETS_JSON")) value = JSON.stringify({ targets: [{
        service: "example-service",
        ...(sample.nested === undefined ? {} : { env: {
          RUNTIME_TARGET_ENABLED: String(sample.nested),
          IBKR_CASH_ONLY_EXECUTION: "false", IBKR_RESERVED_CASH_RATIO: "0.07",
          INCOME_LAYER_ENABLED: "true", OPTION_OVERLAY_ENABLED: "false",
        } }),
        ...(sample.target === undefined ? {} : { RUNTIME_TARGET_ENABLED: String(sample.target) }),
        runtime_target: { platform_id: "ibkr", strategy_profile: "tqqq_growth_income",
          service_name: "example-service", account_scope: "example" },
      }] });
      else if (path.endsWith("/RUNTIME_TARGET_ENABLED")) {
        if (sample.environment) {
          value = path.includes("/environments/example/") ? String(sample.scoped) : "false";
        } else if (sample.scoped !== undefined) value = String(sample.scoped);
      }
      return value === undefined ? new Response("", { status: 404 })
        : Response.json({ value });
    });
    try {
      const result = await __test.loadCurrentStrategies({ ibkr: [{
        key: "example", target_name: "example", service_name: "example-service", account_scope: "example",
        ...(sample.environment ? { variable_scope: "environment", github_environment: "example" } : {}),
      }] }, { RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-only" });
      assert.equal(result.ibkr.example.runtime_target_enabled, sample.expected);
      if (sample.nested !== undefined) {
        assert.equal(result.ibkr.example.cash_only_execution, false);
        assert.equal(result.ibkr.example.reserved_cash_ratio, "0.07");
        assert.equal(result.ibkr.example.income_layer_enabled, true);
        assert.equal(result.ibkr.example.option_overlay_enabled, false);
      }
    } finally { globalThis.fetch = original; }
  });
}

test("missing runtime mode stays unread instead of using account defaults", () => {
  const controller = createAccountSettingsController();
  const op = controller.select({ platform: "ibkr", key: "example" });
  assert.equal(controller.applyRead(op, settingsPayload({ default_execution_mode: "live" })), true);
  assert.equal(controller.view().draft.strategy, "");
  assert.equal(controller.startSave("draft"), null);
});

test("refresh keeps dirty strategy and execution edits intact", () => {
  const controller = createAccountSettingsController();
  const first = controller.select({ platform: "ibkr", key: "example" });
  assert.equal(controller.applyRead(first, settingsPayload()), true);
  assert.equal(controller.edit({ strategy: "edited_strategy", strategyTouched: true }), true);
  const refresh = controller.start("read");
  assert.equal(controller.applyRead(first, settingsPayload({
    draft: { status: "current", revision: 2, overrides: { strategy_profile: "server_strategy" } },
  })), false);
  assert.equal(controller.view().draft.strategy, "edited_strategy");
  assert.equal(controller.applyRead(refresh, settingsPayload()), true);
  assert.equal(controller.view().draft.strategy, "");
  assert.equal(controller.view().draft.strategyTouched, false);
});

test("unknown income layer stays current until readback or an explicit edit", () => {
  const account = { key: "example", target_name: "example" };
  const form = defaultSwitchDraft(account, { strategy_profile: "tqqq_growth_income", execution_mode: "dry_run" }, "ibkr");
  assert.equal(buildSwitchInputs("ibkr", account, form).income_layer_mode, "current");
  const edited = buildSwitchInputs("ibkr", account, { ...form, touched: { income: true }, incomeMode: "disabled" });
  assert.match(edited.extra_variables_json, /"INCOME_LAYER_ENABLED":"false"/);
  assert.equal(edited.dca_mode, undefined);
});

test("untouched DCA settings never become a submitted override", () => {
  const account = { key: "example", target_name: "example" };
  const inputs = buildSwitchInputs("ibkr", account, defaultSwitchDraft(
    account, { strategy_profile: "tqqq_growth_income", execution_mode: "dry_run" }, "ibkr",
  ));
  assert.equal(inputs.dca_mode, undefined);
  assert.equal(inputs.dca_base_investment_usd, undefined);
});

test("buildInputs keeps untouched policy layers current and serializes only touched layers", () => {
  const account = { key: "example", target_name: "example" };
  const form = defaultSwitchDraft(account, { strategy_profile: "tqqq_growth_income", execution_mode: "dry_run" }, "ibkr");
  const inputs = buildSwitchInputs("ibkr", account, {
    ...form,
    touched: { reserve: true },
    reserveMode: "none",
  });
  assert.equal(inputs.reserved_cash_policy_mode, "none");
  assert.equal(inputs.income_layer_mode, "current");
  assert.equal(inputs.option_overlay_mode, "current");
  assert.equal(inputs.dca_mode, undefined);
  assert.equal(inputs.runtime_target_enabled_mode, "current");
});

test("account settings copy removes guesswork and prioritizes research candidates", () => {
  assert.match(accountsSource, /保存策略草案/);
  assert.doesNotMatch(accountsSource, /暂不能修改/);
  assert.equal(pages.includes('id="open-system-status"'), false);
  assert.equal(pages.includes("id=\"health-view\""), false);
});

test("missing optional strategy fields distinguish a successful read from a read failure", () => {
  const normalized = normalizeAccountSchema({
    ibkr: [{ key: "example", label: "Example", target_name: "example", supported_domains: ["us_equity"] }],
  });
  assert.equal("broker_environment" in normalized.ibkr[0], false);
  assert.equal("default_strategy_profile" in normalized.ibkr[0], false);
  const controller = createAccountSettingsController();
  const op = controller.select({ platform: "ibkr", key: "example" });
  assert.equal(controller.applyUnavailable(op, "暂时无法读取"), true);
  assert.equal(controller.view().settings, null);
  assert.equal(controller.startSave("draft"), null);
});

test("diagnosis action keeps progress in a compact busy button and completed result outside it", () => {
  assert.equal(diagnosisUserSummary({ available: false }).status, "暂时无法检查");
  assert.equal(diagnosisUserSummary({ available: true, task: { status: "unknown" } }).status, "结果暂未确认");
  assert.match(diagnosisUserSummary({ available: true, task: { status: "succeeded", recheck_status: "passed" } }).reason, /不代表账户、订单或账务已全面核实/);
  assert.equal(pages.includes("id=\"diagnosis-log\""), false);
});

test("loading an account never silently prepares an enable override", () => {
  const controller = createAccountSettingsController();
  const op = controller.select({ platform: "ibkr", key: "example" });
  assert.equal(controller.applyRead(op, settingsPayload({ runtime_target_enabled: false })), true);
  assert.equal(controller.startSave("draft"), null);
  assert.equal(safeActionVisibility({
    settingsUnavailable: true,
    activation: "—",
    refreshSupported: false,
    resumeSupported: false,
  }).stop, true);
  assert.equal(accountsSource.includes(">启用<"), false);
  assert.match(accountsSource, /statusLabel === "—" \? "待确认"/);
  assert.match(accountsSource, /activation === "—" \? "待确认"/);
  assert.doesNotMatch(accountsSource, /statusLabel === "—" \? "已启用"|activation === "—" \? "已启用"/);
  assert.match(appSource, /loadAdminModel\(\)/);
  assert.doesNotMatch(appSource, /refreshChangeLog|onChangeLog/);
  assert.doesNotMatch(accountsSource, /最近变更/);
});

for (const sample of [
  { name: "signed out", allowed: false },
  { name: "session unavailable", allowed: false },
  { name: "access denied", allowed: false },
  { name: "signed in", allowed: true },
]) {
  test(`private shell visibility: ${sample.name}`, async () => {
    const env = {
      SESSION_SECRET: "synthetic-admin-session",
      STRATEGY_SWITCH_ADMIN_LOGINS: "operator",
      STRATEGY_SWITCH_CONFIG: { get: async () => null, put: async () => {} },
    };
    const headers = sample.allowed ? { Cookie: `qsl_switch_session=${await __test.makeSession("operator", [], env)}` } : {};
    const response = await worker.fetch(new Request("https://switch.example/api/config", { headers }), env);
    const body = await response.json();
    if (sample.allowed) assert.equal("currentStrategies" in body, true);
    else {
      assert.equal(body.accountOptions, null);
      assert.equal("currentStrategies" in body, false);
    }
  });
}

for (const hidden of ["", "qmt", "qmt,binance"]) {
  test(`console visibility is deployment configuration only: ${hidden || "all visible"}`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response("", { status: 503 });
    try {
      const meta = await __test.loadPlatformMeta({ STRATEGY_SWITCH_HIDDEN_PLATFORMS: hidden });
      assert.equal(meta.qmt.console_visible, !hidden.includes("qmt"));
      assert.equal(meta.binance.console_visible, !hidden.includes("binance"));
      assert.equal(meta.ibkr.console_visible, true);
      assert.equal(Object.keys(meta).length, 6);
    } finally { globalThis.fetch = original; }
  });
}

test("root shell keeps its content security policy and /admin is an unknown page", async () => {
  const env = {
    SESSION_SECRET: "synthetic-admin-session", STRATEGY_SWITCH_ADMIN_LOGINS: "operator",
    STRATEGY_SWITCH_CONFIG: { get: async () => null, put: async () => {} },
  };
  const cookie = await __test.makeSession("operator", [], env);
  const response = await worker.fetch(new Request("https://switch.example/"), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  const csp = response.headers.get("Content-Security-Policy");
  assert.match(html, /<div id="root"><\/div>/, "the root page serves the React application shell");
  assert.match(html, /\/v2\/assets\/index-[\w-]+\.js/, "the root shell loads the versioned application bundle");
  assert.doesNotMatch(html, /<script[^>]*>[^<]/i, "the shell contains no inline script");
  assert.equal(csp, "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; connect-src 'self'; script-src 'self'; style-src 'self'");
  assert.doesNotMatch(csp, /unsafe-inline|nonce-/);
  const adminPage = await worker.fetch(new Request("https://switch.example/admin", {
    headers: { Cookie: `qsl_switch_session=${cookie}` },
  }), env);
  assert.equal(adminPage.status, 404);
  assert.equal((await adminPage.json()).error, "not_found");
});

test("only current P6 evidence becomes an owner action", () => {
  const candidate = { candidate_id: "candidate", candidate_evidence_sha256: digest };
  assert.ok(listDailyDecisions(sources({
    owners: { value: { data_status: "ready", candidates: [{ candidate, candidate_evidence_sha256: digest }] } },
  })).items.some((item) => item.id === "owner:candidate"));
  assert.equal(listDailyDecisions(sources({
    owners: { value: { data_status: "stale", candidates: [{ candidate, candidate_evidence_sha256: digest }] } },
  })).items.some((item) => item.kind === "owner_observation"), false);
  assert.equal(listDailyDecisions(sources({
    owners: { value: { data_status: "ready", candidates: [{ candidate, candidate_evidence_sha256: digest, intent: { decision: "keep_parked" } }] } },
  })).items.some((item) => item.kind === "owner_observation"), false);
});

test("a parked AIAudit research result stays outside the owner-action queue", () => {
  const listed = listDailyDecisions(sources({
    owners: { value: { data_status: "ready", candidates: [{ candidate: {
      candidate_id: "aiaudit.soxl_manual_validation",
      lifecycle: { stage: "P3", status: "parked" },
      recommendation: { code: "park" },
    } }] } },
  }));
  assert.equal(listed.items.some((item) => String(item.id).includes("aiaudit")), false);
  assert.equal(pages.includes("actions/runs/34407783620"), false);
});

test("stale research material is not presented as a read failure", () => {
  const listed = listDailyDecisions(sources({
    promotions: { value: { data_status: "stale", tickets: [{ ticket_id: "stale", state: "awaiting_human" }] } },
  }));
  assert.equal(listed.blocked, true);
  assert.equal(listed.items.some((item) => item.id === "promotion:stale"), false);
  const failed = listDailyDecisions(sources({
    promotions: { error: "control_plane_request_failed", value: { data_status: "unavailable", tickets: [] } },
  }));
  assert.equal(failed.blocked, true);
  assert.equal(failed.items.length, 0);
});

test("only the explicit AIAudit SOXL validation source gets a run link", () => {
  assert.equal(pages.includes("https://github.com/QuantStrategyLab/AIAuditBridge/actions/runs/"), false);
});

test("parked research results preserve the source reason and use a neutral fallback", () => {
  assert.equal(strategyDisplayName({ label: "中文", label_en: "English" }, "en"), "English");
  assert.equal(strategyDisplayName({ recommendation: { reason: "Drawdown improvement was insufficient." } }, "zh"), "未命名策略");
});

test("all platforms remain readable within the Worker external request budget", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  const options = {
    longbridge: ["hk", "sg", "paper"].map(key => ({ key, target_name: key })),
    ibkr: [0, 1, 2, 3].map(i => ({ key: `example-${i}`, target_name: `example-${i}` })),
    schwab: [{ key: "default", target_name: "default" }],
    firstrade: [{ key: "default", target_name: "default" }],
    binance: [{ key: "default", target_name: "default" }],
  };
  globalThis.fetch = async url => {
    if (++requests > 50) throw new Error("Too many subrequests");
    const path = new URL(url).pathname;
    if (path.endsWith("/variables")) return Response.json({ total_count: 1,
      variables: [{ name: "RUNTIME_TARGET_ENABLED", value: "false" }] });
    return path.endsWith("/RUNTIME_TARGET_ENABLED") ? Response.json({ value: "false" })
      : new Response("", { status: 404 });
  };
  try {
    const result = await __test.loadCurrentStrategies(options, { RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-only" });
    for (const [platform, accounts] of Object.entries(options)) {
      for (const account of accounts) assert.equal(result[platform]?.[account.key]?.runtime_target_enabled, false, platform);
    }
    assert.ok(requests <= 10, `expected scoped bulk reads, got ${requests}`);
  } finally { globalThis.fetch = original; }
});

for (const secondPageStatus of [200, 403, 404, 429, 500]) {
  test(`paginated variable reads are complete or unknown: ${secondPageStatus}`, async () => {
    const original = globalThis.fetch;
    const requested = [];
    globalThis.fetch = async url => {
      const request = new URL(url);
      requested.push(request);
      assert.equal(request.origin, "https://api.github.com");
      assert.equal(request.pathname, "/repos/QuantStrategyLab/FirstradePlatform/actions/variables");
      if (request.searchParams.get("page") === "1") return Response.json({ total_count: 31,
        variables: Array.from({ length: 30 }, (_, i) => ({ name: `EXAMPLE_${i}`, value: "unused" })),
      }, { headers: { Link: "<https://untrusted.example/next>; rel=\"next\"" } });
      return secondPageStatus === 200 ? Response.json({ total_count: 31,
        variables: [{ name: "RUNTIME_TARGET_ENABLED", value: "false" }],
      }) : new Response("", { status: secondPageStatus });
    };
    try {
      const result = await __test.loadCurrentStrategies({ firstrade: [{ key: "default", target_name: "default" }] },
        { RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-only" });
      assert.equal(result.firstrade?.default?.runtime_target_enabled, secondPageStatus === 200 ? false : undefined);
      assert.equal(requested.length, 2, "failed pages must not trigger retries or per-variable fallback");
    } finally { globalThis.fetch = original; }
  });
}

test("failed variable-list page never publishes a partial configuration", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    if (++requests > 1) throw new Error("synthetic timeout");
    return Response.json({ total_count: 2, variables: [{ name: "RUNTIME_TARGET_ENABLED", value: "true" }] },
      { headers: { Link: "<https://api.github.com/example?page=2>; rel=\"next\"" } });
  };
  try {
    const result = await __test.loadCurrentStrategies({ binance: [{ key: "default", target_name: "default" }] },
      { RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-only" });
    assert.equal(result.binance, undefined);
    assert.equal(requests, 2);
  } finally { globalThis.fetch = original; }
});

test("console account metadata preserves an explicit monitoring reference", () => {
  const options = __test.normalizeAccountOptionsPayload({ ibkr: [{key:"example",target_name:"example",runtime_status_target_id:"ibkr.monitor-a"}] },"fixture");
  assert.equal(options.ibkr[0].runtime_status_target_id,"ibkr.monitor-a");
});

for (const scenario of ["ready", "stale", "missing", "wrong-platform", "duplicate-source", "duplicate-account", "unlinked"]) {
  test(`account monitoring match is exact and read-only: ${scenario}`, () => {
    const account = { key: "a", runtime_status_target_id: scenario === "unlinked" ? "" : "ibkr.monitor-a" };
    const entry = { target: { target_id: "ibkr.monitor-a", target: { platform: scenario === "wrong-platform" ? "binance" : "ibkr" } } };
    const targets = scenario === "missing" ? [] : scenario === "duplicate-source" ? [entry, entry] : [entry];
    const accounts = scenario === "duplicate-account" ? [account, { ...account, key: "b" }] : [account];
    const uses = new Map();
    for (const item of accounts) {
      if (!item.runtime_status_target_id) continue;
      const link = `ibkr:${item.runtime_status_target_id}`;
      uses.set(link, (uses.get(link) || 0) + 1);
    }
    const hits = targets.filter((record) => record?.target?.target_id === account.runtime_status_target_id && record?.target?.target?.platform === "ibkr");
    const matched = account.runtime_status_target_id && hits.length === 1 && uses.get(`ibkr:${account.runtime_status_target_id}`) === 1 ? hits[0] : null;
    assert.equal(Boolean(matched), scenario === "ready" || scenario === "stale");
    assert.match(appSource, /record\?\.target\?\.target_id === reference && record\?\.target\?\.target\?\.platform === platform/);
    assert.match(appSource, /monitoringUses\.get\(`\$\{platform\}:\$\{reference\}`\) === 1/);
  });
}

test("control-plane visibility stays on the daily pages and hides engineering views", () => {
  assert.equal(pages.includes("id=\"health-view\""), false);
  assert.equal(pages.includes("id=\"control-plane-view\""), false);
  assert.equal(pageFromWorkspace("research"), "strategy");
  assert.equal(decisionActionState({ canAdopt: true, canReject: true, accountChoices: [] }, {
    admin: false, busy: false, selectedAccountId: "",
  }).adoptEnabled, false);
});

test("browsing compatible strategies does not require live authorization", () => {
  const research = {
    profile: "sample_research", domain: "us_equity", runtime_enabled: false, can_switch_live: false,
    lifecycle_stage: "research_active", allowed_execution_modes: ["paper", "dry_run"],
  };
  assert.doesNotThrow(() => __test.assertStrategyAllowedForAccount(
    { platform: "ibkr", strategy_profile: "sample_research", execution_mode: "dry_run" },
    { key: "example", supported_domains: ["us_equity"] },
    [research],
  ));
});

test("browsing a candidate does not make it runnable", () => {
  const research = {
    profile: "sample_research", domain: "us_equity", runtime_enabled: false, can_switch_live: false,
    lifecycle_stage: "research_active", allowed_execution_modes: ["paper", "dry_run"],
  };
  assert.throws(() => __test.assertStrategyAllowedForAccount(
    { platform: "ibkr", strategy_profile: "sample_research", execution_mode: "live" },
    { key: "example", supported_domains: ["us_equity"] },
    [research],
  ), /not live-enabled/);
  assert.equal(isLiveSwitchAllowed(research), false);
});

test("operator page has no engineering diagnostics entry point", () => {
  assert.equal(pages.includes('id="open-system-status"'), false);
  assert.equal(overviewSource.includes("id=\"health-view\""), false);
  assert.equal(overviewSource.includes("monitoring-diagnostics"), false);
});

test("monitoring compares saved configuration without inventing runtime", () => {
  const mismatched = __test.projectRuntimeAccountState({
    freshness: { data_status: "ready" },
    deployment_freshness: { data_status: "ready" },
    target: {
      target: { configured_state: "enabled" },
      deployment: { runtime_enabled: false, scheduler_state: "paused", observed_at: "2026-09-28T00:00:00Z" },
      monitoring: { runtime_guard: "pass", execution_heartbeat: "not_applicable" },
      disposition: { code: "continue_disabled_validation" },
    },
  });
  assert.equal(mismatched.reason, "config_inconsistent");
  assert.equal(presentAccountState(mismatched).label, "异常");
  const savedOnly = __test.projectRuntimeAccountState({
    freshness: { data_status: "ready" },
    target: { target: { configured_state: "disabled" }, monitoring: {}, disposition: {} },
  });
  assert.equal(savedOnly.activation, "unknown");
  assert.equal(presentAccountState(savedOnly).label, "—");
});

test("Binance without an explicit market uses crypto, not US equities", () => {
  assert.deepEqual(__test.inferAccountSupportedDomains("binance", {}), ["crypto"]);
  assert.equal(__test.inferAccountSupportedDomains("binance", {}).includes("us_equity"), false);
});

test("only current complete recovery evidence becomes an action", () => {
  const ready = {
    freshness: { data_status: "ready" },
    recovery: {
      recovery_id: "recovery",
      readiness: "awaiting_human_confirmation",
      blocker_codes: [],
      candidate_sha256: digest,
      dual_review: { evidence_binding_sha256: digest },
    },
  };
  assert.equal(recoveryBinding(ready, "approve")?.decision, "approve");
  assert.equal(recoveryBinding({ ...ready, confirmation: {} }), null);
  assert.equal(recoveryBinding({ ...ready, rejection: {} }, "reject"), null);
  assert.equal(recoveryBinding({ ...ready, freshness: { data_status: "stale" } }), null);
  assert.equal(recoveryBinding({ ...ready, recovery: { ...ready.recovery, readiness: "blocked" } }), null);
  assert.equal(recoveryBinding({ ...ready, recovery: { ...ready.recovery, blocker_codes: ["missing_sample"] } }), null);
  assert.equal(recoveryBinding({ ...ready, recovery: { ...ready.recovery, dual_review: { evidence_binding_sha256: "b".repeat(64) } } }), null);
  const listed = listDailyDecisions(sources({
    recovery: { value: { data_status: "ready", recoveries: [ready] } },
  }));
  assert.equal(listed.items.some((item) => item.kind === "recovery"), true);
  assert.equal(decisionActionState(listed.items.find((item) => item.kind === "recovery"), {
    admin: false, busy: false, selectedAccountId: "",
  }).adoptEnabled, false);
});

test("overview research link counts pending recovery confirmations", () => {
  const listed = listDailyDecisions(sources({
    recovery: { value: { data_status: "ready", recoveries: [{
      freshness: { data_status: "ready" },
      recovery: {
        recovery_id: "recovery",
        readiness: "awaiting_human_confirmation",
        blocker_codes: [],
        candidate_sha256: digest,
        dual_review: { evidence_binding_sha256: digest },
      },
    }] } },
  }));
  assert.equal(listed.items.filter((item) => item.kind === "recovery").length, 1);
  assert.equal(listed.items.filter((item) => item.kind === "promotion").length, 0);
});

for (const observation of [
  {runtime_enabled:false,scheduler_state:"paused",strategy_profile:"example",execution_mode:"live"},
  {runtime_enabled:null,scheduler_state:"unknown",strategy_profile:null,execution_mode:null},
]) test("deployment observation survives Worker normalization without inferred values "+JSON.stringify(observation),()=>{
  const target={target_id:"example",target:{platform:"ibkr",configured_state:"disabled",execution_mode:"live"},
    monitoring:{runtime_guard:"pass",execution_heartbeat:"not_applicable"},
    disposition:{code:"continue_disabled_validation",reason_code:"target_intentionally_disabled"},no_order:true};
  assert.deepEqual(__test.normalizeRuntimeTargetLifecycleTarget({...target,deployment:observation},"test").deployment,observation);
  assert.equal(__test.normalizeRuntimeTargetLifecycleTarget(target,"test").deployment,undefined);
  assert.throws(()=>__test.normalizeRuntimeTargetLifecycleTarget({...target,deployment:{...observation,runtime_enabled:"false"}},"test"));
  assert.throws(()=>__test.normalizeRuntimeTargetLifecycleTarget({...target,deployment:{...observation,raw_cloud_id:"private"}},"test"));
});

for (const scenario of ["missing", "stale", "true", "false"]) test(`actual deployment never falls back to saved settings: ${scenario}`, () => {
  const fresh = scenario === "true" || scenario === "false";
  const projected = __test.projectRuntimeAccountState({
    freshness: { data_status: "ready" },
    deployment_freshness: { data_status: scenario === "stale" ? "stale" : "ready" },
    target: {
      target: { configured_state: "enabled" },
      monitoring: {},
      disposition: {},
      ...(scenario === "missing" ? {} : { deployment: {
        runtime_enabled: scenario === "true",
        scheduler_state: scenario === "true" ? "enabled" : "paused",
        observed_at: "2026-09-28T00:00:00Z",
      } }),
    },
  });
  assert.equal(projected.activation, fresh ? (scenario === "true" ? "enabled" : "disabled") : "unknown");
});

test("application status requires deployment and scheduler agreement", () => {
  const agreed = __test.projectRuntimeAccountState({
    freshness: { data_status: "ready" },
    deployment_freshness: { data_status: "ready" },
    target: {
      target: { configured_state: "enabled" },
      deployment: { runtime_enabled: true, scheduler_state: "enabled", strategy_profile: "example", observed_at: "2026-09-28T00:00:00Z" },
      monitoring: { runtime_guard: "pass", execution_heartbeat: "pass" },
      disposition: { code: "continue_enabled_monitoring" },
    },
  });
  assert.equal(agreed.reason, "monitoring_agrees");
  assert.equal(presentAccountState(agreed).label, "正常");
  const disagreed = __test.projectRuntimeAccountState({
    freshness: { data_status: "ready" },
    deployment_freshness: { data_status: "ready" },
    target: {
      target: { configured_state: "enabled" },
      deployment: { runtime_enabled: false, scheduler_state: "paused", observed_at: "2026-09-28T00:00:00Z" },
      monitoring: { runtime_guard: "pass", execution_heartbeat: "not_applicable" },
      disposition: { code: "continue_disabled_validation" },
    },
  });
  assert.equal(disagreed.reason, "config_inconsistent");
  assert.equal(presentAccountState(disagreed).label, "异常");
});

test("account details keep saved, deployed and application state separate", () => {
  assert.equal(overviewSource.includes("{status.detail}"), false);
  assert.equal(overviewSource.includes("{row.statusDetail}"), false);
  const saved = presentAccountState(monitored({ health: "unknown", activation: "disabled", reason: "evidence_insufficient" }));
  assert.equal(saved.label, "—");
  const observed = presentAccountState(monitored({ health: "normal", activation: "disabled", reason: "monitoring_agrees" }));
  assert.equal(observed.label, "正常");
  assert.equal(activationFromProjection(monitored({ health: "normal", activation: "disabled", reason: "monitoring_agrees" })), "已停用");
});

test("legacy lifecycle alias with explicit live flags is not downgraded by the browser", () => {
  const entry = { runtime_enabled: true, can_switch_live: true, allowed_execution_modes: ["live"], lifecycle_stage: "runtime_enabled" };
  assert.equal(isLiveSwitchAllowed(entry), true);
  assert.equal(isLiveSwitchAllowed({ ...entry, can_switch_live: false }), false);
  assert.equal(isLiveSwitchAllowed({ ...entry, runtime_enabled: false }), false);
});

test("fresh publication cannot refresh an old runtime report", () => {
  const projected = __test.projectRuntimeAccountState({
    freshness: { data_status: "ready" },
    deployment_freshness: { data_status: "stale" },
    target: {
      target: { configured_state: "enabled" },
      deployment: { runtime_enabled: true, scheduler_state: "enabled", observed_at: "2026-09-01T00:00:00Z" },
      monitoring: { runtime_guard: "pass", execution_heartbeat: "pass" },
      disposition: { code: "continue_enabled_monitoring" },
    },
  });
  assert.equal(projected.activation, "unknown");
  assert.equal(projected.health, "unknown");
  assert.equal(presentAccountState(projected).label, "—");
});

test("promotion confirmation uses the selected account mode as read-only context", () => {
  assert.match(appSource, /expected_proposed_params/);
  assert.equal(promotionSuggestion({
    ticket_id: "ticket", strategy_profile: "example", research_summary: { ai_explanation: { status: "available" } },
  }, "zh"), null);
  assert.equal(paperApplicationReady({
    application: { status: "submitted" },
    application_preparation: { preflight_status: "ready", preview_request: {}, account_options: [{ platform: "longbridge", key: "paper", label: "Paper" }] },
  }, "longbridge:paper"), false);
});

test("promotion research summary keeps numeric evidence bounded and identity-bound", () => {
  assert.equal(promotionSuggestion({ ticket_id: "ticket", research_summary: { comparison: { return: 999 } } }, "zh"), null);
});

test("promotion ticket queue surfaces login, load failure, and empty states", () => {
  assert.equal(listDailyDecisions(sources({ promotions: { error: "unauthorized" } })).blocked, true);
  assert.equal(listDailyDecisions(sources()).items.filter((item) => item.kind === "promotion").length, 0);
});

test("selected promotion ticket prefers ticket suggested risk profile", () => {
  assert.equal(appSource.includes("ticket.suggested_risk_profile"), false);
  assert.match(appSource, /CAPITAL_PRESERVATION/);
});

test("promotion panel shows actionable candidates only", () => {
  const listed = listDailyDecisions(sources({
    promotions: { value: { data_status: "ready", tickets: [
      { ticket_id: "blocked", state: "blocked" },
      { ticket_id: "check", state: "awaiting_human", source_check_required: true },
      { ticket_id: "open", state: "awaiting_human", strategy_profile: "example" },
    ] } },
  }));
  assert.deepEqual(listed.items.filter((item) => item.kind === "promotion").map((item) => item.id), ["promotion:open"]);
});

test("Binance private scope is shown only with a valid report", () => {
  assert.equal(pages.includes("/api/binance-private-scope"), false);
  assert.equal(pages.includes("0.01000000"), false);
  assert.equal(pages.includes('id="binance-private-scope"'), false);
});

test("only reviewable promotion tickets create a dashboard research entry", () => {
  const listed = listDailyDecisions(sources({
    promotions: { value: { data_status: "ready", tickets: [
      { ticket_id: "needs-check", state: "awaiting_human", source_check_required: true },
    ] } },
  }));
  assert.equal(listed.items.length, 0);
});

test("research page puts current decisions before collapsed history and labels the intent platform", () => {
  assert.ok(decisionsSource.indexOf("items.map") < decisionsSource.indexOf("technical"));
  assert.match(decisionsSource, /采用只记录|impact|explanation/);
});

test("unknown scheduler readback remains unknown when the switch agrees", () => {
  const projected = __test.projectRuntimeAccountState({
    freshness: { data_status: "ready" },
    deployment_freshness: { data_status: "ready" },
    target: {
      target: { configured_state: "enabled" },
      deployment: { runtime_enabled: true, scheduler_state: "unknown", observed_at: "2026-09-28T00:00:00Z" },
      monitoring: { runtime_guard: "pass", execution_heartbeat: "pass" },
      disposition: { code: "continue_enabled_monitoring" },
    },
  });
  assert.equal(projected.activation, "unknown");
  assert.equal(activationFromProjection(projected), "—");
});

test("account status follows runtime readback instead of the form execution mode", () => {
  const projected = monitored({ health: "unknown", activation: "unknown", reason: "activation_unconfirmed" });
  assert.equal(presentAccountState(projected).label, "—");
  assert.equal(activationFromProjection({ ...projected, execution_mode: "live" }), "—");
  assert.equal(activationFromProjection(monitored({ health: "normal", activation: "enabled", reason: "monitoring_agrees" })), "已启用");
});

test("account status shows a next step only when observed state needs attention", () => {
  assert.equal(overviewSource.includes("{row.statusDetail}"), false);
  assert.equal(overviewSource.includes("{status.detail}"), false);
  assert.equal(presentAccountState(monitored()).label, "—");
  assert.equal(presentAccountState(monitored()).detail, "现有证据不足以确认运行状态");
});

test("opening account settings selects the exact account without submitting or enabling", () => {
  const controller = createAccountSettingsController();
  const op = controller.select({ platform: "binance", key: "default" });
  assert.equal(controller.selectedId(), "binance:default");
  assert.equal(controller.applyRead(op, settingsPayload({ platform: "binance", key: "default" })), true);
  assert.equal(controller.startSave("draft"), null);
  assert.equal(controller.view().draft.floorTouched, false);
  assert.equal(controller.view().draft.clearFloor, false);
  assert.match(accountsSource, /current-strategy/);
  assert.match(accountsSource, /待应用策略/);
  assert.doesNotMatch(accountsSource, /暂不能修改/);
});

test("viewing a prepared application opens its account without replacing the current draft", () => {
  const controller = createAccountSettingsController();
  const op = controller.select({ platform: "ibkr", key: "example" });
  assert.equal(controller.applyRead(op, settingsPayload()), true);
  assert.equal(controller.edit({ strategy: "kept", strategyTouched: true }), true);
  assert.equal(paperApplicationReady({
    application: null,
    application_preparation: {
      preflight_status: "ready",
      preview_request: { ticket_id: "ticket" },
      account_options: [{ platform: "longbridge", key: "paper", label: "Paper", broker_environment: "paper" }],
    },
  }, "longbridge:paper"), true);
  assert.equal(controller.view().draft.strategy, "kept");
});

test("decisions and account observations stay outside collapsed strategy settings", () => {
  assert.equal(accountsSource.includes("listDailyDecisions"), false);
  assert.equal(decisionsSource.includes("strategy-settings"), false);
  assert.equal(overviewSource.includes("monitoring-diagnostics"), false);
});

test("promotion rendering preserves candidate identity, target context and admin-only actions", () => {
  const listed = listDailyDecisions(sources({
    promotions: { value: { data_status: "ready", tickets: [{ ticket_id: "open", state: "awaiting_human", strategy_profile: "example" }] } },
  }));
  const item = listed.items[0];
  assert.equal(item.id, "promotion:open");
  assert.equal(item.reasons.length, 0);
  assert.equal(decisionActionState(item, { admin: false, busy: false, selectedAccountId: "ibkr:example" }).adoptEnabled, false);
  assert.equal(decisionActionState(item, { admin: true, busy: false, selectedAccountId: "ibkr:example" }).adoptEnabled, true);
});

test("hiding all platforms also hides account observations outside the settings form", () => {
  assert.match(appSource, /console_visible === false/);
});

test("paper application UI allows an explicit retry only after rejection", () => {
  assert.equal(applicationRetryAllowed(null), true);
  assert.equal(applicationRetryAllowed({ status: "submitted" }), false);
  assert.equal(applicationRetryAllowed({ status: "rejected" }), true);
  const preparation = {
    preflight_status: "ready",
    preview_request: {},
    account_options: [{ platform: "longbridge", key: "paper", label: "Paper", broker_environment: "paper" }],
  };
  assert.equal(paperApplicationReady({ application: { status: "rejected" }, application_preparation: preparation }, "longbridge:paper"), true);
  assert.equal(paperApplicationReady({ application: { status: "accepted" }, application_preparation: preparation }, "longbridge:paper"), false);
});

test("paper application submission refreshes before keeping an unknown result disabled", () => {
  assert.equal(applicationRetryAllowed({ status: "unknown" }), false);
  assert.equal(applicationRetryAllowed({ dispatch_state: "unknown" }), false);
  assert.equal(paperApplicationReady({
    application: { status: "unknown" },
    application_preparation: { preflight_status: "ready", preview_request: {}, account_options: [{ platform: "longbridge", key: "paper", label: "Paper" }] },
  }, "longbridge:paper"), false);
});

test("overview status maps fresh runtime evidence to the user-facing state", () => {
  assert.equal(presentAccountState(monitored({ health: "normal", activation: "enabled", reason: "monitoring_agrees" })).label, "正常");
  assert.equal(presentAccountState(monitored({ health: "abnormal", activation: "disabled", reason: "config_inconsistent" })).label, "异常");
  assert.equal(presentAccountState(monitored()).label, "—");
  assert.equal(activationFromProjection(null), "—");
  assert.equal(activationFromProjection(false), "—");
  assert.equal(activationFromProjection(monitored({ health: "unknown", activation: "disabled", reason: "configured_state" })), "—");
});

test("account business evidence remains unverified for monitored and disabled accounts", () => {
  for (const projection of [
    monitored({ health: "normal", activation: "enabled", reason: "monitoring_agrees" }),
    monitored({ health: "abnormal", activation: "enabled", reason: "retained_attention" }),
    monitored({ health: "normal", activation: "disabled", reason: "monitoring_agrees" }),
  ]) {
    assert.equal(presentAccountState(projection).detail.includes("已全面核实"), false);
    assert.equal(presentAccountState(projection).detail.includes("已验证业务"), false);
  }
});

test("overview keeps saved settings separate from actual state", () => {
  const savedDisabled = __test.projectRuntimeAccountState({
    freshness: { data_status: "ready" },
    target: { target: { configured_state: "disabled" }, monitoring: {}, disposition: {} },
  });
  assert.equal(presentAccountState(savedDisabled).label, "—");
  assert.equal(activationFromProjection(savedDisabled), "—");
  assert.equal(accountMatchesStatusFilter("normal", savedDisabled), false);
});

test("overview filters preserve unknown and search only the chosen scope", () => {
  assert.equal(accountMatchesStatusFilter("all", monitored()), true);
  assert.equal(accountMatchesStatusFilter("normal", monitored()), false);
  assert.equal(accountMatchesStatusFilter("abnormal", monitored()), true);
  assert.equal(accountMatchesStatusFilter("paused", monitored({ health: "normal", activation: "disabled", reason: "monitoring_agrees" })), true);
  assert.equal(accountMatchesStatusFilter("normal", monitored({ health: "normal", activation: "enabled", reason: "monitoring_agrees" })), true);
  assert.match(overviewSource, /accountId === "all"/);
});

for (const view of ["overview", "accounts", "research"]) test(`workspace navigation isolates ${view} from the other jobs`, () => {
  const page = pageFromWorkspace(view);
  assert.equal(page === "overview", view === "overview");
  assert.equal(page === "accounts", view === "accounts");
  assert.equal(page === "strategy", view === "research");
  assert.match(appSource, /setPageAndRoute/);
});

test("viewing an account does not expand editing or change the configured switch", () => {
  const controller = createAccountSettingsController();
  const op = controller.select({ platform: "binance", key: "default" });
  assert.equal(controller.applyRead(op, settingsPayload({ platform: "binance", key: "default", runtime_target_enabled: true })), true);
  assert.equal(controller.view().draft.strategyTouched, false);
  assert.equal(controller.startSave("draft"), null);
  assert.equal(controller.view().draft.floorTouched, false);
  assert.equal(controller.view().draft.clearFloor, false);
  assert.match(accountsSource, /current-strategy/);
  assert.match(accountsSource, /待应用策略/);
  assert.doesNotMatch(accountsSource, /暂不能修改/);
});

test("unverified promotion records are separated by evidence, not by test-like names", () => {
  const listed = listDailyDecisions(sources({
    promotions: { value: { data_status: "ready", tickets: [
      { ticket_id: "synthetic-profile", state: "awaiting_human", shadow_evidence_kind: "paired_forward_observation", source_check_required: true },
      { ticket_id: "soxl_soxx_trend_income", state: "awaiting_human", source_check_required: true },
    ] } },
  }));
  assert.equal(listed.items.length, 0);
  assert.equal(promotionSuggestion({ strategy_profile: "synthetic-profile", shadow_evidence_kind: "paired_forward_observation" }, "zh"), null);
});
