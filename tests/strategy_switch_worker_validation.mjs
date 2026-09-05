import { githubVariableListMock } from './helpers/github_variable_list_mock.mjs';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import worker, { __test } from "../web/strategy-switch-console/worker.js";
import { DEFAULT_ACCOUNT_OPTIONS, RUNTIME_CATALOG_PROJECTION, PLATFORM_META } from "../web/strategy-switch-console/config.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexHtml = [
  readFileSync(resolve(root, "web/strategy-switch-console/index.html"), "utf8"),
  readFileSync(resolve(root, "web/strategy-switch-console/app.css"), "utf8"),
  readFileSync(resolve(root, "web/strategy-switch-console/app.js"), "utf8"),
].join("\n");
const bundledStrategyProfiles = JSON.parse(
  readFileSync(resolve(root, "web/strategy-switch-console/strategy-profiles.example.json"), "utf8"),
);
const m0ResearchDashboardSchema = JSON.parse(
  readFileSync(resolve(root, "schemas/qsl-m0-research-dashboard.v1.schema.json"), "utf8"),
);
const m0ResearchPublisherEnvelopeSchema = JSON.parse(
  readFileSync(resolve(root, "schemas/qsl-m0-research-publisher-envelope.v1.schema.json"), "utf8"),
);
assert.equal(m0ResearchDashboardSchema.properties.schema_version.const, "qsl_m0_research_dashboard.v1");
assert.equal(m0ResearchDashboardSchema.additionalProperties, false);
assert.deepEqual(
  m0ResearchDashboardSchema.required,
  ["schema_version", "source_ledger_sha256", "source_generated_at", "source_computed_at", "viewed_at", "data_status", "summary", "subjects", "policy", "errors"],
);
assert.equal(m0ResearchPublisherEnvelopeSchema["x-qsl-canonical-utf8-max-bytes"], 256 * 1024);

function buildQrsCanonicalM0PublisherBody(sourceSnapshotPath) {
  // The fixture is a minimized, unchanged QAR #66 emitted source snapshot.
  // Execute QRS #309/#310's real offline builder and return its exact sorted-
  // key canonical UTF-8 request body, rather than duplicating it in JS.
  const publisherCode = [
    "import hashlib,json,sys",
    "sys.path.insert(0, sys.argv[2])",
    "from build_m0_research_publisher_envelope import build_m0_research_publisher_envelope, canonical_envelope_body",
    "raw=open(sys.argv[1], 'rb').read()",
    "source=json.loads(raw)",
    "envelope=build_m0_research_publisher_envelope(source_snapshot=source, source_artifact={'repository':'QuantStrategyLab/QuantAdvisorResearch','revision':'9e06f248fb60d1c995426e66468cb18454612e9b','run_id':'qar66-fixture-run','artifact_id':'QAR66:source/snapshot','sha256':hashlib.sha256(raw).hexdigest()}, producer_repository='QuantStrategyLab/QuantRuntimeSettings', producer_revision='451b11d0bf6ba2632ca2227c850e7236a40d12e5', now=source['generated_at'])",
    "sys.stdout.buffer.write(canonical_envelope_body(envelope))",
  ].join("; ");
  const result = spawnSync(
    "python3",
    ["-c", publisherCode, sourceSnapshotPath, resolve(root, "python/scripts")],
    { cwd: root, encoding: "buffer" },
  );
  assert.equal(result.status, 0, Buffer.from(result.stderr || "").toString("utf8"));
  return Buffer.from(result.stdout);
}
assert.ok(__test.currentStrategiesTimeoutMs >= 8000);
const renderPlatformsBody = indexHtml.match(/function renderPlatforms\(\) \{([\s\S]*?)\n    \}/)?.[1] || "";
assert.ok(!renderPlatformsBody.includes("syncStrategyForAccount("));
assert.equal(indexHtml.includes(".innerHTML"), false);
assert.ok(indexHtml.includes('<body class="app-loading operator-console">'));
assert.ok(indexHtml.includes('id="boot-screen"'));
assert.ok(indexHtml.includes('id="app-shell"'));
assert.equal(indexHtml.includes('runtime-authority-status'), false);
assert.equal(indexHtml.includes('runtime-authority-notice'), false);
assert.equal(indexHtml.includes('P0–P6'), false);
assert.equal(indexHtml.includes('GitHub OAuth 保护'), false);
assert.equal(indexHtml.includes('Worker 端触发'), false);
assert.equal(indexHtml.includes('令牌保留在服务端'), false);
assert.equal(indexHtml.includes('id="control-plane-view-button"'), false);
assert.equal(indexHtml.includes('id="health-view-button"'), false);
assert.match(indexHtml, /<details class="health-view advanced-workspace" id="health-view" hidden>/);
assert.ok(indexHtml.includes('id="control-plane-view"'));
assert.ok(indexHtml.includes('id="control-plane-list"'));
assert.ok(indexHtml.includes('id="m0-research-notice"'));
assert.ok(indexHtml.includes('id="m0-research-list"'));
assert.match(indexHtml, /<details class="diagnostic-details">\s*<summary data-i18n="diagnosticDetails">/);
assert.match(indexHtml, /<div class="diagnostic-section">\s*<h3 data-i18n="m0ResearchBoard">/);
assert.ok(indexHtml.includes('function renderM0Research()'));
assert.ok(indexHtml.includes('requestJson("/api/m0-research")'));
assert.ok(indexHtml.includes('const M0_RESEARCH_DISPLAY_LIMIT = 100;'));
assert.ok(indexHtml.includes('entries.slice(0, M0_RESEARCH_DISPLAY_LIMIT)'));
assert.ok(indexHtml.includes('id="adaptive-selection-list"'));
assert.ok(indexHtml.includes('id="adaptive-selection-notice"'));
assert.ok(indexHtml.includes('id="account-overview"'));
assert.ok(indexHtml.includes('id="plan-check-authority"'));
assert.ok(indexHtml.includes('class="diagnostic-details"'));
assert.ok(indexHtml.includes('id="control-plane-queue"'));
assert.ok(indexHtml.includes('data-health-filter="attention"'));
assert.ok(indexHtml.includes('function hasLiveStrategyOption('));
assert.ok(indexHtml.includes('function supportedExecutionModesForPlatform('));
assert.ok(indexHtml.includes('button.disabled = !supportedModes.includes(button.dataset.mode)'));
assert.ok(indexHtml.includes('function renderPlanReadiness()'));
assert.ok(indexHtml.includes('id="execution-evidence-list"'));
assert.ok(indexHtml.includes('id="execution-evidence-notice"'));
assert.ok(indexHtml.includes('id="reconciliation-recovery-list"'));
assert.ok(indexHtml.includes('id="reconciliation-recovery-notice"'));
assert.ok(indexHtml.includes('requestJson("/api/reconciliation-recovery")'));
assert.ok(indexHtml.includes('data-reconciliation-recovery-confirm'));
assert.equal(indexHtml.includes('P0_CONTROL_PLANE_NOT_RUNTIME_WIRED'), false);
assert.equal(indexHtml.includes('window.__QSL_RUNTIME_AUTHORITY_STATUS__'), false);
assert.equal(indexHtml.includes('execution_metadata_is_runtime_authority'), false);
assert.equal(indexHtml.includes('P1–P3 non-live 数据获取仍需独立、精确的契约'), false);
assert.ok(indexHtml.includes('requestJson("/api/execution-evidence")'));
assert.ok(indexHtml.includes('requestJson("/api/adaptive-selection")'));
assert.equal(indexHtml.includes('missing_current_promotion_evidence_and_human_acceptance'), false);
assert.ok(indexHtml.includes('missing_current_promotion_evidence_and_preauthorized_autonomy_policy'));
assert.ok(indexHtml.includes(".switch-surface.summary-hidden"));
assert.ok(indexHtml.includes('summaryPanel.hidden = !showSummary'));
assert.ok(indexHtml.includes('switchSurface.classList.toggle("summary-hidden", !showSummary)'));
assert.equal(indexHtml.match(/Generated by inject_platform_config\.py/g)?.length, 1);
assert.ok(indexHtml.includes('<script src="/bootstrap-config.js"></script>'));
assert.ok(indexHtml.includes('<script src="/boot-recovery.js"></script>'));
assert.ok(indexHtml.includes('/app.js?v=operator-console-v3'));
assert.ok(indexHtml.includes('/app.css?v=operator-console-v3'));
assert.equal(indexHtml.includes('<script id="platform-config">'), false);
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
assert.equal(indexHtml.includes('id="ibit-zscore-exit-mode-select"'), false);
assert.ok(indexHtml.includes('id="income-layer-start-usd-input"'));
assert.ok(indexHtml.includes('incomeLayerStartUsd: "收入层起始金额"'));
assert.ok(indexHtml.includes('incomeLayerStartUsd: "Income layer start amount"'));
assert.ok(indexHtml.includes('incomeLayerStartUsdVariable = "INCOME_LAYER_START_USD"'));
assert.ok(indexHtml.includes("fallbackIncomeLayerDefaults"));
assert.ok(indexHtml.includes("incomeLayerDefaultsFromProfileItem"));
assert.ok(indexHtml.includes('id="option-overlay-mode-select"'));
assert.ok(indexHtml.includes('optionOverlayMode: "期权层状态"'));
assert.ok(indexHtml.includes('optionOverlayMode: "Option layer"'));
assert.ok(indexHtml.includes("optionOverlayDefaultsFromProfileItem"));
assert.ok(indexHtml.includes('id="cash-only-execution-mode-select"'));
assert.ok(indexHtml.includes('class="form-section execution-cash-policy-section"'));
assert.ok(indexHtml.includes('function reconcileExecutionCashPolicy('));
assert.ok(indexHtml.includes("window.__PLATFORM_META__"));
assert.equal(PLATFORM_META.qmt.label, "QMT");
assert.ok(indexHtml.includes('cn_industry_etf_rotation'));
assert.ok(indexHtml.includes('id="income-layer-section"'));
assert.ok(indexHtml.includes('id="option-overlay-section"'));
assert.equal(indexHtml.includes('id="margin-policy-stack"'), false);
assert.equal(indexHtml.includes('id="reserve-policy-stack"'), false);
assert.equal(indexHtml.includes('id="reserve-amounts-row"'), false);
assert.ok(indexHtml.includes('id="min-reserve-block"'));
assert.ok(indexHtml.includes('id="reserve-ratio-block"'));
assert.ok(indexHtml.includes("cash_only_execution_mode: item.cash_only_execution_mode"));
assert.ok(indexHtml.includes("function incomeLayerFieldsConfigured("));
assert.ok(indexHtml.includes("function effectiveIncomeLayerForAccount("));
assert.ok(indexHtml.includes('class="summary-list" id="summary-list" role="list"'));
assert.ok(indexHtml.includes('labelNode.className = "summary-label"'));
assert.equal(indexHtml.includes("noChangesNote"), false);
assert.equal(indexHtml.match(/class="form-section dca-section"/g)?.length, 1);
assert.ok(indexHtml.includes('qmtDryRunOnlyNote'));
assert.ok(indexHtml.includes('optionOverlayDefaultSimple: "开启"'));
assert.ok(indexHtml.includes('cashOnlyExecutionDefault: "仅用现金"'));
assert.match(indexHtml, /function platformCashOnlyExecutionDefault\(\) \{\s+return true;/);
assert.ok(indexHtml.includes("function effectiveOptionOverlayForAccount("));
assert.ok(indexHtml.includes("selectedAccount(platform)?.option_overlay_mode"));
assert.ok(indexHtml.includes("function effectiveCashOnlyExecutionForAccount("));
assert.ok(indexHtml.includes('cashOnlyExecutionValueYes: "是"'));
assert.ok(indexHtml.includes('cashOnlyExecutionMode: "Allow margin"'));
assert.ok(indexHtml.includes('el("cash-only-execution-mode-select").addEventListener("change"'));
assert.ok(indexHtml.includes("function pendingCashOnlyExecution("));
assert.ok(indexHtml.includes('!platformSupportsMarginPolicy(platform) || mode === "current"'));
assert.ok(indexHtml.includes("function syncCashOnlyExecutionForAccount("));
assert.equal(indexHtml.includes('id="option-growth-overlay'), false);
assert.equal(indexHtml.includes('id="option-income-overlay'), false);
assert.ok(indexHtml.includes('id="dca-mode-select"'));
assert.ok(indexHtml.includes('id="dca-base-investment-usd-input"'));
assert.ok(indexHtml.includes('dcaMode: "定投模式"'));
assert.ok(indexHtml.includes('dcaModeFixed: "定额定投"'));
assert.ok(indexHtml.includes('dcaModeSmart: "智能定投"'));
assert.ok(indexHtml.includes('dcaMode: "DCA mode"'));
assert.ok(indexHtml.includes('dcaProfileDefaults'));
assert.ok(indexHtml.includes('el("income-layer-mode-select").addEventListener("change"'));
assert.ok(indexHtml.includes('el("income-layer-start-usd-input").addEventListener("input"'));
assert.ok(indexHtml.includes('el("income-layer-max-ratio-input").addEventListener("input"'));
assert.ok(indexHtml.includes('el("dca-mode-select").addEventListener("change"'));
assert.ok(indexHtml.includes('el("dca-base-investment-usd-input").addEventListener("input"'));
assert.ok(
	  indexHtml.includes('"label_zh": "纳指100 / 标普500 定投"') ||
	  indexHtml.includes('"label_zh": "纳指标普定投"'),
	);
assert.ok(indexHtml.includes('class="form-section income-layer-section"'));
assert.ok(indexHtml.includes('class="form-section dca-section"'));
assert.ok(indexHtml.includes('class="control-block reserve-policy-block policy-block"'));
assert.ok(indexHtml.includes('"profile": "ibit_smart_dca"'));
for (const profile of bundledStrategyProfiles) {
  assert.ok(indexHtml.includes(`"profile": ${JSON.stringify(profile.profile)}`), `fallback missing ${profile.profile}`);
  assert.ok(indexHtml.includes(`"label_en": ${JSON.stringify(profile.label_en)}`), `fallback English label mismatch for ${profile.profile}`);
  assert.ok(indexHtml.includes(`"label_zh": ${JSON.stringify(profile.label_zh)}`), `fallback Chinese label mismatch for ${profile.profile}`);
}
assert.ok(indexHtml.includes('localStrategyLabels'));
assert.ok(indexHtml.includes('function strategyLabelSet('));
assert.ok(indexHtml.includes('function strategyDisplayMetaText('));
assert.ok(indexHtml.includes('function strategyChoiceLabel('));
assert.ok(indexHtml.includes('function strategyCanSwitchLive('));
assert.ok(indexHtml.includes("account-block"));
assert.ok(indexHtml.includes("strategy-block"));
assert.ok(indexHtml.includes("white-space: pre-line"));
assert.ok(indexHtml.includes(".form-section {"));
assert.ok(indexHtml.includes(".form-section + .form-section"));
assert.ok(indexHtml.includes("grid-template-columns: repeat(2, minmax(0, 1fr));"));
assert.ok(indexHtml.includes("grid-column: 1 / -1;"));
assert.ok(indexHtml.includes('reservePolicyNone'));
assert.ok(indexHtml.includes('reservePolicyRatio'));
assert.ok(indexHtml.includes('reservePolicyFloor'));
assert.ok(indexHtml.includes('reservePolicyMax'));
assert.ok(indexHtml.includes('pluginModeNone'));
assert.ok(indexHtml.includes('const pluginModes = ["none"]'));
assert.ok(indexHtml.includes('runtimeTargetMode: "平台开关"'));
assert.ok(indexHtml.includes('runtimeTargetEnabled: "启用"'));
assert.ok(indexHtml.includes('runtimeTargetDisabled: "禁用"'));
assert.ok(indexHtml.includes('runtimeTargetMode: "Account status"'));
assert.ok(indexHtml.includes('runtimeTargetEnabled: "Enabled"'));
assert.ok(indexHtml.includes('runtimeTargetDisabled: "Disabled"'));
assert.ok(indexHtml.includes("function runtimeTargetStateForAccount("));
assert.ok(indexHtml.includes(".summary-status.disabled"));
assert.ok(indexHtml.includes('pluginMode: "插件状态"'));
assert.ok(indexHtml.includes('pluginModeNone: "不挂载旧插件"'));
assert.ok(indexHtml.includes('pluginMode: "Plugin status"'));
assert.equal(indexHtml.includes('pluginModeAuto'), false);
assert.equal(indexHtml.includes('id="ibit-zscore-exit-mode-select"'), false);
assert.equal(indexHtml.includes("ibitZscoreExit"), false);
assert.equal(indexHtml.includes("ibit_zscore_exit_mode"), false);
assert.ok(indexHtml.includes('reservedCashDefault'));
assert.ok(indexHtml.includes('dryRun: "模拟运行"'));
assert.ok(indexHtml.includes('dryRun: "Simulated run"'));
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
assert.equal(indexHtml.includes('placeholder="150"'), false);
assert.equal(indexHtml.includes('placeholder="0.03"'), false);
assert.equal(indexHtml.includes("ibkr-primary"), false);
assert.equal(indexHtml.includes("longbridge-quant-sg-service"), false);
assert.equal(indexHtml.includes('account_selector: "SG"'), false);
assert.match(indexHtml, /body\.app-loading \.shell\s*\{\s*display: none;/);

const servedPageResponse = await worker.fetch(new Request("https://switch.example/"), {});
const servedHtml = await servedPageResponse.text();
assert.equal(servedPageResponse.status, 200);
assert.ok(servedHtml.includes('<script src="/bootstrap-config.js"></script>'));
assert.equal(servedHtml.includes('<script id="platform-config">'), false);
assert.equal(servedHtml.includes("ibkr-primary"), false);
assert.equal(servedHtml.includes("longbridge-quant-sg-service"), false);
assert.equal(servedHtml.includes('account_selector: "SG"'), false);

const bootstrapConfigResponse = await worker.fetch(new Request("https://switch.example/bootstrap-config.js"), {});
const bootstrapConfigJs = await bootstrapConfigResponse.text();
assert.equal(bootstrapConfigResponse.status, 200);
assert.equal(bootstrapConfigResponse.headers.get("Content-Type"), "application/javascript; charset=utf-8");
assert.equal(bootstrapConfigResponse.headers.get("X-Content-Type-Options"), "nosniff");
assert.ok(bootstrapConfigJs.includes("window.__PLATFORM_CONFIG__"));
assert.ok(bootstrapConfigJs.includes("window.__PLATFORM_META__"));
assert.ok(bootstrapConfigJs.includes("window.__PLATFORM_REPOSITORIES__"));
assert.ok(bootstrapConfigJs.includes("window.__DEFAULT_STRATEGY_PROFILES__"));
assert.equal(bootstrapConfigJs.includes("window.__QSL_RUNTIME_AUTHORITY_STATUS__"), false);
assert.equal(bootstrapConfigJs.includes("ibkr-primary"), false);
assert.equal(bootstrapConfigJs.includes("longbridge-quant-sg-service"), false);
assert.equal(bootstrapConfigJs.includes('account_selector: "SG"'), false);

const servedAppResponse = await worker.fetch(new Request("https://switch.example/app.js"), {});
const servedAppJs = await servedAppResponse.text();
assert.equal(servedAppResponse.status, 200);
assert.equal(servedAppResponse.headers.get("Cache-Control"), "no-store");
assert.ok(servedAppJs.includes("function hasPrivateConfig()"));
assert.equal(servedAppJs.includes("ibitZscoreExit"), false);
assert.equal(servedAppJs.includes("ibit_zscore_exit_mode"), false);
assert.equal(servedAppJs.includes("ibkr-primary"), false);
assert.equal(servedAppJs.includes("longbridge-quant-sg-service"), false);
assert.equal(servedAppJs.includes('account_selector: "SG"'), false);

const servedCssResponse = await worker.fetch(new Request("https://switch.example/app.css"), {});
assert.equal(servedCssResponse.status, 200);
assert.equal(servedCssResponse.headers.get("Cache-Control"), "no-store");

const bootRecoveryResponse = await worker.fetch(new Request("https://switch.example/boot-recovery.js"), {});
const bootRecoveryJs = await bootRecoveryResponse.text();
assert.equal(bootRecoveryResponse.status, 200);
assert.equal(bootRecoveryResponse.headers.get("Cache-Control"), "no-store");
assert.ok(bootRecoveryJs.includes("document.body.classList.remove('app-loading')"));
assert.ok(bootRecoveryJs.includes("login.hidden = false"));

const publicConfigResponse = await worker.fetch(new Request("https://switch.example/api/config"), {});
assert.equal(publicConfigResponse.status, 200);
const publicConfig = await publicConfigResponse.json();
assert.equal(publicConfig.accountOptions, null);
assert.ok(publicConfig.platformMeta?.longbridge?.label === "LongBridge");

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

const unauthorizedProfileSyncResponse = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-strategy-profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }),
  { STRATEGY_SWITCH_SYNC_TOKEN: "test-sync-token" },
);
assert.equal(unauthorizedProfileSyncResponse.status, 401);
assert.match((await unauthorizedProfileSyncResponse.json()).error, /internal sync token is invalid/);

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
      lifecycle_stage: "live_enabled",
      can_switch_live: true,
      allowed_execution_modes: ["live", "dry_run"],
      income_layer_enabled: true,
      income_layer_start_usd: "250000",
      income_layer_max_ratio: "0.55",
      income_layer_allocations: { SCHD: 0.3, DGRO: 0.2, SGOV: 0.4, SPYI: 0.08, QQQI: 0.02 },
      option_overlay_enabled: true,
      option_overlay_live_gate: "promotion_required",
      option_overlay_live_status: "research_only",
      latest_evidence_status: "live_allowed",
      plugin_gate_status: "live_allowed",
      option_growth_overlay_enabled: true,
      option_growth_overlay_recipe: "tqqq_leaps_growth_v1",
      option_growth_overlay_start_usd: "250000",
      option_growth_overlay_nav_budget_ratio: "0.03",
      option_income_overlay_enabled: false,
    },
    {
      profile: "hk_low_vol_dividend_quality_snapshot",
      label: "HK Low-Vol Dividend Quality Snapshot",
      domain: "hk_equity",
      runtime_enabled: true,
      lifecycle_stage: "live_enabled",
      can_switch_live: true,
      allowed_execution_modes: ["live", "dry_run"],
    },
    {
      profile: "legacy_continuity_profile",
      label: "Legacy continuity profile",
      domain: "us_equity",
      runtime_enabled: false,
      lifecycle_stage: "research_active",
      can_switch_live: false,
      allowed_execution_modes: ["dry_run"],
      blocked_live_reason: "candidate_gate_remains_closed",
      live_continuity: {
        eligible: true,
        allowed_platforms: ["ibkr"],
      },
    },
    {
      profile: "us_equity_combo_leveraged",
      label: "US Alpha Combo",
      domain: "us_equity",
      runtime_enabled: true,
      lifecycle_stage: "research",
      can_switch_live: false,
      allowed_execution_modes: ["dry_run"],
      blocked_live_reason: "promotion_required",
      latest_evidence_status: "research_only",
      plugin_gate_status: "blocked",
    },
    {
      profile: "nasdaq_sp500_smart_dca",
      label: "Nasdaq 100 / S&P 500 DCA",
      label_zh: "纳指100 / 标普500 定投",
      domain: "us_equity",
      runtime_enabled: true,
    },
    {
      profile: "legacy_shadow_profile",
      label: "Legacy Shadow",
      domain: "us_equity",
      runtime_enabled: false,
      lifecycle_stage: "shadow_candidate",
      can_switch_live: false,
      allowed_execution_modes: ["dry_run"],
    },
    {
      profile: "legacy_live_profile",
      label: "Legacy Live",
      domain: "us_equity",
      runtime_enabled: true,
      lifecycle_stage: "runtime_enabled",
      can_switch_live: true,
      allowed_execution_modes: ["live", "dry_run"],
    },
  ],
  "test_strategy_profiles",
);
assert.equal(strategyProfiles[0].label_en, "TQQQ Growth Income");
assert.equal(strategyProfiles[0].label_zh, "TQQQ 增长收益");
assert.equal(strategyProfiles[0].lifecycle_stage, "live_enabled");
assert.equal(strategyProfiles[0].can_switch_live, true);
assert.deepEqual(strategyProfiles[0].allowed_execution_modes, ["live", "dry_run"]);
assert.equal(strategyProfiles[0].income_layer_enabled, true);
assert.equal(strategyProfiles[0].income_layer_start_usd, "250000");
assert.equal(strategyProfiles[0].income_layer_max_ratio, "0.55");
assert.deepEqual(strategyProfiles[0].income_layer_allocations, {
  SCHD: 0.3,
  DGRO: 0.2,
  SGOV: 0.4,
  SPYI: 0.08,
  QQQI: 0.02,
});
assert.equal(strategyProfiles[0].option_overlay_enabled, true);
assert.equal(strategyProfiles[0].option_overlay_live_gate, "promotion_required");
assert.equal(strategyProfiles[0].option_overlay_live_status, "research_only");
assert.equal(strategyProfiles[0].option_growth_overlay_enabled, true);
assert.equal(strategyProfiles[0].option_growth_overlay_recipe, "tqqq_leaps_growth_v1");
assert.equal(strategyProfiles[0].option_growth_overlay_start_usd, "250000");
assert.equal(strategyProfiles[0].option_growth_overlay_nav_budget_ratio, "0.03");
assert.equal(strategyProfiles[0].option_income_overlay_enabled, false);
assert.equal(strategyProfiles[0].latest_evidence_status, "live_allowed");
assert.equal(strategyProfiles[0].plugin_gate_status, "live_allowed");
const legacyContinuityProfile = strategyProfiles.find((item) => item.profile === "legacy_continuity_profile");
assert.deepEqual(legacyContinuityProfile.live_continuity, { eligible: true, allowed_platforms: ["ibkr"] });
assert.equal(strategyProfiles[3].lifecycle_stage, "research_active");
assert.equal(strategyProfiles[3].can_switch_live, false);
assert.deepEqual(strategyProfiles[3].allowed_execution_modes, ["dry_run"]);
assert.equal(strategyProfiles[3].blocked_live_reason, "promotion_required");
assert.equal(strategyProfiles[3].latest_evidence_status, "research_only");
assert.equal(strategyProfiles[3].plugin_gate_status, "blocked");
assert.equal(strategyProfiles[4].dca_enabled, true);
assert.equal(strategyProfiles[4].dca_default_mode, "fixed");
assert.equal(strategyProfiles[4].dca_default_base_investment_usd, "1000");
assert.equal(strategyProfiles[5].lifecycle_stage, "shadow_active");
assert.equal(strategyProfiles[6].lifecycle_stage, "live_enabled");

assert.doesNotThrow(() =>
  __test.assertStrategyAllowedForAccount(
    { platform: "longbridge", strategy_profile: "tqqq_growth_income", execution_mode: "live" },
    DEFAULT_ACCOUNT_OPTIONS.longbridge[0],
    strategyProfiles,
  ),
);
assert.throws(
  () =>
    __test.assertStrategyAllowedForAccount(
      { platform: "longbridge", strategy_profile: "us_equity_combo_leveraged", execution_mode: "live" },
      DEFAULT_ACCOUNT_OPTIONS.longbridge[0],
      strategyProfiles,
    ),
  /not live-enabled/,
);
assert.throws(
  () =>
    __test.assertStrategyAllowedForAccount(
      { platform: "longbridge", strategy_profile: "nasdaq_sp500_smart_dca", execution_mode: "live" },
      DEFAULT_ACCOUNT_OPTIONS.longbridge[0],
      strategyProfiles,
    ),
  /not live-enabled/,
);
assert.doesNotThrow(() =>
  __test.assertStrategyAllowedForAccount(
    { platform: "longbridge", strategy_profile: "us_equity_combo_leveraged", execution_mode: "dry_run" },
    DEFAULT_ACCOUNT_OPTIONS.longbridge[0],
    strategyProfiles,
  ),
);

const accountOptions = __test.normalizeAccountOptionsPayload(
  {
    longbridge: [
      {
        key: "hk",
        label: "hk",
        target_name: "hk",
        account_selector: "HK",
        cash_currency: "HKD",
      },
      {
        key: "sg",
        label: "sg",
        target_name: "sg",
        account_selector: "SG",
        plugin_mode: "auto",
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
const defaultAccountOptions = __test.normalizeAccountOptionsPayload(DEFAULT_ACCOUNT_OPTIONS, "default_account_options");
assert.equal(defaultAccountOptions.qmt[0].cash_currency, "CNY");
for (const platformOptions of Object.values(DEFAULT_ACCOUNT_OPTIONS)) {
  for (const option of platformOptions) {
    assert.equal("reserved_cash_ratio" in option, false);
    assert.equal("min_reserved_cash_usd" in option, false);
  }
}

const accountOptionsWithCashOnlyMode = __test.normalizeAccountOptionsPayload(
  {
    longbridge: [
      {
        key: "sg",
        label: "sg",
        target_name: "sg",
        cash_only_execution_mode: "enabled",
      },
    ],
  },
  "test_account_options",
);
assert.equal(accountOptionsWithCashOnlyMode.longbridge[0].cash_only_execution_mode, "enabled");

const accountOptionsWithOptionOverlayMode = __test.normalizeAccountOptionsPayload(
  {
    ibkr: [
      {
        key: "ibkr-primary",
        label: "ibkr-primary",
        target_name: "ibkr-primary",
        option_overlay_mode: "disabled",
      },
    ],
  },
  "test_account_options",
);
assert.equal(accountOptionsWithOptionOverlayMode.ibkr[0].option_overlay_mode, "disabled");

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
      option_overlay_mode: "current",
      cash_only_execution_mode: "current",
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

const legacyContinuityKv = new Map([
  ["account_options", JSON.stringify(accountOptions)],
  ["strategy_profiles", JSON.stringify(strategyProfiles)],
]);
const legacyContinuityEnv = {
  STRATEGY_SWITCH_SYNC_TOKEN: "test-sync-token",
  STRATEGY_SWITCH_CONFIG: {
    get: async (key) => legacyContinuityKv.get(key) || null,
    put: async (key, value) => legacyContinuityKv.set(key, value),
  },
};
const legacyContinuityPayload = {
  platform: "ibkr",
  target_name: "legacy-ibkr-route",
  account_selector: "LEGACY_IBKR",
  deployment_selector: "legacy-ibkr-route",
  account_scope: "legacy-ibkr-route",
  service_name: "interactive-brokers-legacy-ibkr-route-service",
  strategy_profile: "legacy_continuity_profile",
  execution_mode: "live",
  live_continuity_state: "RECONCILE_ONLY",
  live_continuity_baseline_id: "legacy-ibkr-lkg-20260830",
  live_continuity_captured_at: "2026-08-30",
  variable_scope: "default",
  plugin_mode: "current",
  option_overlay_mode: "current",
  cash_only_execution_mode: "current",
};
const legacyContinuitySyncResponse = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-account-default", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-sync-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(legacyContinuityPayload),
  }),
  legacyContinuityEnv,
);
assert.equal(legacyContinuitySyncResponse.status, 200);
const legacyContinuitySyncBody = await legacyContinuitySyncResponse.json();
assert.equal(legacyContinuitySyncBody.ok, true);
assert.equal(legacyContinuitySyncBody.legacy_continuity_account_registered, true);
const registeredLegacyAccount = JSON.parse(legacyContinuityKv.get("account_options")).ibkr.find(
  (option) => option.target_name === "legacy-ibkr-route",
);
assert.equal(registeredLegacyAccount.service_name, "interactive-brokers-legacy-ibkr-route-service");
assert.deepEqual(registeredLegacyAccount.supported_domains, ["us_equity"]);
assert.equal("plugin_mode" in registeredLegacyAccount, false);
const repeatedLegacyContinuitySyncResponse = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-account-default", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-sync-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(legacyContinuityPayload),
  }),
  legacyContinuityEnv,
);
assert.equal(repeatedLegacyContinuitySyncResponse.status, 200);
assert.equal((await repeatedLegacyContinuitySyncResponse.json()).legacy_continuity_account_registered, false);
assert.equal(
  JSON.parse(legacyContinuityKv.get("account_options")).ibkr.filter(
    (option) => option.target_name === "legacy-ibkr-route",
  ).length,
  1,
);
const duplicateAliasResponse = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-account-default", {
    method: "POST",
    headers: { Authorization: "Bearer test-sync-token", "Content-Type": "application/json" },
    body: JSON.stringify({ ...legacyContinuityPayload, target_name: "another-legacy-alias" }),
  }), legacyContinuityEnv,
);
assert.equal(duplicateAliasResponse.status, 400);
assert.equal(JSON.parse(legacyContinuityKv.get("account_options")).ibkr.some(
  (option) => option.target_name === "another-legacy-alias",
), false);
const normalizedLegacyContinuityInputs = __test.normalizeSwitchInputs(legacyContinuityPayload);
assert.doesNotThrow(() =>
  __test.assertStrategyAllowedForAccount(
    normalizedLegacyContinuityInputs,
    registeredLegacyAccount,
    strategyProfiles,
  ),
);
assert.throws(
  () =>
    __test.assertStrategyAllowedForAccount(
      { ...normalizedLegacyContinuityInputs, live_continuity_state: "NONE" },
      registeredLegacyAccount,
      strategyProfiles,
    ),
  /not live-enabled/,
);

const kvUnboundProfileSyncResponse = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-strategy-profiles", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-sync-token",
      "Content-Type": "application/json",
    },
    body: "{}",
  }),
  { STRATEGY_SWITCH_SYNC_TOKEN: "test-sync-token" },
);
assert.equal(kvUnboundProfileSyncResponse.status, 200);
const kvUnboundProfileSyncBody = await kvUnboundProfileSyncResponse.json();
assert.equal(kvUnboundProfileSyncBody.ok, true);
assert.equal(kvUnboundProfileSyncBody.strategy_profiles_sync.reason, "kv_not_bound");
assert.equal(kvUnboundProfileSyncBody.strategy_profiles_sync.skipped, true);

const profileKvWrites = new Map();
const profileSyncResponse = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-strategy-profiles", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-sync-token",
      "Content-Type": "application/json",
    },
    body: "{}",
  }),
  {
    STRATEGY_SWITCH_SYNC_TOKEN: "test-sync-token",
    STRATEGY_SWITCH_CONFIG: {
      get: async (key) => (key === "strategy_profiles" ? JSON.stringify([{ profile: "stale" }]) : null),
      put: async (key, value) => profileKvWrites.set(key, value),
    },
  },
);
assert.equal(profileSyncResponse.status, 200);
const profileSyncBody = await profileSyncResponse.json();
assert.equal(profileSyncBody.ok, true);
assert.equal(profileSyncBody.strategy_profiles_sync.synced, true);
assert.equal(profileSyncBody.strategy_profiles_sync.changed, true);
assert.ok(JSON.parse(profileKvWrites.get("strategy_profiles")).some((item) => item.profile === "ibit_smart_dca"));

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
  option_overlay_mode: "enabled",
});
assert.equal(normalizedReservedCashInputs.reserved_cash_ratio, "0.03");
assert.equal(normalizedReservedCashInputs.min_reserved_cash_usd, "150");
assert.equal(normalizedReservedCashInputs.income_layer_start_usd, "250000");
assert.equal(normalizedReservedCashInputs.income_layer_max_ratio, "0.55");
assert.equal(normalizedReservedCashInputs.option_overlay_mode, "enabled");
const normalizedCashOnlyInputs = __test.normalizeSwitchInputs({
  platform: "ibkr",
  target_name: "ibkr-primary",
  strategy_profile: "tqqq_growth_income",
  execution_mode: "live",
  cash_only_execution_mode: "disabled",
});
assert.equal(normalizedCashOnlyInputs.cash_only_execution_mode, undefined);
assert.deepEqual(JSON.parse(normalizedCashOnlyInputs.extra_variables_json), {
  cash_only_execution_mode: "disabled",
});
assert.equal("cash_only_execution_mode" in normalizedCashOnlyInputs, false);

const workflowYaml = readFileSync(resolve(root, ".github/workflows/manual-strategy-switch.yml"), "utf8");
assert.ok(workflowYaml.includes('"live_continuity_state": continuity.get("state", "NONE")'));
assert.ok(workflowYaml.includes('payload["live_continuity_baseline_id"]'));
assert.ok(workflowYaml.includes('"cash_only_execution_mode": "current"'));
assert.ok(workflowYaml.includes('Legacy continuity recovery is intentionally unavailable from this workflow.'));
const workflowInputs = [...workflowYaml.matchAll(/^      ([A-Za-z0-9_]+):\n        description:/gm)].map((match) => match[1]);
const dispatchInputs = __test.normalizeSwitchInputs({
  platform: "ibkr",
  target_name: "ibkr-primary",
  strategy_profile: "tqqq_growth_income",
  execution_mode: "live",
  cash_only_execution_mode: "enabled",
  apply: "true",
  trigger_platform_sync: "true",
  confirm_apply: "APPLY_AND_SYNC",
});
for (const key of Object.keys(dispatchInputs)) {
  assert.ok(workflowInputs.includes(key), `workflow input missing for dispatch field: ${key}`);
}
const directLegacyRecoveryEnv = {
  SESSION_SECRET: "direct-legacy-recovery-session",
  ALLOWED_GITHUB_LOGINS: "recovery-admin",
  RUNTIME_SETTINGS_DISPATCH_TOKEN: "dispatch-token",
};
const directLegacyRecoveryCookie = await __test.makeSession("recovery-admin", [], directLegacyRecoveryEnv);
const directLegacyRecoveryAttempt = await worker.fetch(
  new Request("https://switch.example/api/switch", {
    method: "POST",
    headers: {
      Cookie: `qsl_switch_session=${directLegacyRecoveryCookie}`,
      Origin: "https://switch.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      platform: "ibkr",
      target_name: "legacy_ibkr_route",
      strategy_profile: "soxl_soxx_trend_income",
      execution_mode: "live",
      live_continuity_state: "RECONCILE_ONLY",
      live_continuity_baseline_id: "legacy-ibkr-lkg-20260830",
      live_continuity_captured_at: "2026-08-30",
      variable_scope: "default",
      plugin_mode: "current",
      option_overlay_mode: "current",
      cash_only_execution_mode: "current",
      apply: true,
      trigger_platform_sync: true,
      confirm_apply: "APPLY_AND_SYNC",
    }),
  }),
  directLegacyRecoveryEnv,
);
assert.equal(directLegacyRecoveryAttempt.status, 409);
const normalizedPluginInputs = __test.normalizeSwitchInputs({
  platform: "ibkr",
  target_name: "ibkr-primary",
  strategy_profile: "tqqq_growth_income",
  execution_mode: "live",
  plugin_mode: "none",
});
assert.equal(normalizedPluginInputs.plugin_mode, "none");
const normalizedLegacyAutoPluginInputs = __test.normalizeSwitchInputs({
  platform: "ibkr",
  target_name: "ibkr-primary",
  strategy_profile: "tqqq_growth_income",
  execution_mode: "live",
  plugin_mode: "auto",
});
assert.equal(normalizedLegacyAutoPluginInputs.plugin_mode, "none");
const normalizedCurrentPluginInputs = __test.normalizeSwitchInputs({
  platform: "ibkr",
  target_name: "ibkr-primary",
  strategy_profile: "tqqq_growth_income",
  execution_mode: "live",
  plugin_mode: "current",
});
assert.equal(normalizedCurrentPluginInputs.plugin_mode, "current");
assert.throws(
  () => __test.normalizeSwitchInputs({
    platform: "ibkr",
    target_name: "ibkr-primary",
    strategy_profile: "tqqq_growth_income",
    execution_mode: "live",
    plugin_mode: "custom",
  }),
  /plugin_mode is invalid/,
);
assert.throws(
  () => __test.normalizeSwitchInputs({
    platform: "ibkr",
    target_name: "ibkr-primary",
    strategy_profile: "tqqq_growth_income",
    execution_mode: "live",
    custom_plugin_mounts_json: "[]",
  }),
  /legacy custom plugin mounts are retired/,
);
const normalizedDcaInputs = __test.normalizeSwitchInputs({
  platform: "firstrade",
  target_name: "default",
  strategy_profile: "nasdaq_sp500_smart_dca",
  execution_mode: "live",
  plugin_mode: "auto",
  dca_mode: "smart",
  dca_base_investment_usd: "500",
});
assert.equal(normalizedDcaInputs.dca_mode, undefined);
assert.equal(normalizedDcaInputs.dca_base_investment_usd, undefined);
assert.deepEqual(JSON.parse(normalizedDcaInputs.extra_variables_json), {
  dca_mode: "smart",
  dca_base_investment_usd: "500",
  cash_only_execution_mode: "enabled",
});
const normalizedIbkrDcaInputs = __test.normalizeSwitchInputs({
  platform: "ibkr",
  target_name: "ibkr-primary",
  strategy_profile: "nasdaq_sp500_smart_dca",
  execution_mode: "live",
  plugin_mode: "auto",
  dca_mode: "smart",
  dca_base_investment_usd: "500",
});
assert.deepEqual(JSON.parse(normalizedIbkrDcaInputs.extra_variables_json), {
  dca_mode: "smart",
  dca_base_investment_usd: "500",
  cash_only_execution_mode: "enabled",
});
const normalizedDcaJsonInputs = __test.normalizeSwitchInputs({
  platform: "firstrade",
  target_name: "default",
  strategy_profile: "nasdaq_sp500_smart_dca",
  execution_mode: "live",
  plugin_mode: "auto",
  extra_variables_json: JSON.stringify({
    dca_mode: "smart",
    dca_base_investment_usd: "500",
  }),
});
assert.deepEqual(JSON.parse(normalizedDcaJsonInputs.extra_variables_json), {
  dca_mode: "smart",
  dca_base_investment_usd: "500",
  cash_only_execution_mode: "enabled",
});
const normalizedIbitSmartDcaInputs = __test.normalizeSwitchInputs({
  platform: "firstrade",
  target_name: "default",
  strategy_profile: "ibit_smart_dca",
  execution_mode: "live",
  plugin_mode: "auto",
  dca_mode: "smart",
  dca_base_investment_usd: "500",
  ibit_zscore_exit_mode: "live",
});
assert.deepEqual(JSON.parse(normalizedIbitSmartDcaInputs.extra_variables_json), {
  dca_mode: "smart",
  dca_base_investment_usd: "500",
  cash_only_execution_mode: "enabled",
});
const normalizedIbkrIbitSmartDcaInputs = __test.normalizeSwitchInputs({
  platform: "ibkr",
  target_name: "ibit-primary",
  strategy_profile: "ibit_smart_dca",
  execution_mode: "live",
  plugin_mode: "auto",
  extra_variables_json: JSON.stringify({
    dca_mode: "smart",
    dca_base_investment_usd: "500",
    ibit_zscore_exit_mode: "live",
  }),
});
assert.deepEqual(JSON.parse(normalizedIbkrIbitSmartDcaInputs.extra_variables_json), {
  dca_mode: "smart",
  dca_base_investment_usd: "500",
  cash_only_execution_mode: "enabled",
});
const normalizedNonIbitLegacyZscoreInputs = __test.normalizeSwitchInputs({
  platform: "ibkr",
  target_name: "ibkr-primary",
  strategy_profile: "tqqq_growth_income",
  execution_mode: "live",
  extra_variables_json: JSON.stringify({ ibit_zscore_exit_mode: "live" }),
});
assert.deepEqual(JSON.parse(normalizedNonIbitLegacyZscoreInputs.extra_variables_json), {
  cash_only_execution_mode: "enabled",
});
assert.throws(
  () => __test.normalizeSwitchInputs({
    platform: "qmt",
    target_name: "industry_etf_dry_run",
    strategy_profile: "cn_industry_etf_rotation",
    execution_mode: "live",
  }),
  /qmt does not support live control execution/,
);
const normalizedQmtDryRunInputs = __test.normalizeSwitchInputs({
  platform: "qmt",
  target_name: "industry_etf_dry_run",
  strategy_profile: "cn_industry_etf_rotation",
  execution_mode: "paper",
});
assert.equal(normalizedQmtDryRunInputs.execution_mode, "dry_run");
assert.equal(
  __test.normalizeSwitchInputs({
    platform: "ibkr",
    target_name: "ibkr-dry-run",
    strategy_profile: "global_etf_rotation",
    execution_mode: "dry_run",
  }).execution_mode,
  "dry_run",
);
assert.throws(
  () => __test.normalizeSwitchInputs({
    platform: "ibkr",
    target_name: "ibkr-primary",
    strategy_profile: "tqqq_growth_income",
    dca_mode: "smart",
  }),
  /DCA settings are only supported/,
);
assert.throws(
  () => __test.normalizeSwitchInputs({
    platform: "firstrade",
    target_name: "default",
    strategy_profile: "nasdaq_sp500_smart_dca",
    dca_mode: "smart",
    dca_base_investment_usd: "0",
  }),
  /dca_base_investment_usd must be greater than 0/,
);
assert.throws(
  () => __test.normalizeSwitchInputs({
    platform: "ibkr",
    target_name: "ibkr-primary",
    strategy_profile: "tqqq_growth_income",
    extra_variables_json: JSON.stringify({ DCA_MODE: "smart" }),
  }),
  /control fields/,
);
assert.throws(
  () => __test.normalizeSwitchInputs({
    platform: "ibkr",
    target_name: "ibkr-primary",
    strategy_profile: "tqqq_growth_income",
    extra_variables_json: JSON.stringify({ option_growth_overlay_enabled: "true" }),
  }),
  /research-only/,
);
assert.throws(
  () => __test.normalizeSwitchInputs({
    platform: "ibkr",
    target_name: "ibkr-primary",
    strategy_profile: "tqqq_growth_income",
    extra_variables_json: JSON.stringify({ INCOME_THRESHOLD_USD: "250000" }),
  }),
  /research-only/,
);
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
assert.deepEqual(JSON.parse(normalizedReserveClearInputs.extra_variables_json), {
  IBKR_MIN_RESERVED_CASH_USD: "",
  IBKR_RESERVED_CASH_RATIO: "",
  cash_only_execution_mode: "enabled",
});
assert.throws(
  () => __test.normalizeSwitchInputs({
    platform: "ibkr",
    target_name: "ibkr-primary",
    strategy_profile: "tqqq_growth_income",
    extra_variables_json: JSON.stringify({ IBKR_CASH_ONLY_EXECUTION: "true" }),
  }),
  /cash_only_execution_mode instead of CASH_ONLY_EXECUTION/,
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
// default_strategy_profile update removed — only other fields may change
assert.equal(
  __test.accountOptionMatchesInputs(
    { target_name: "sg", variable_scope: "default" },
    {
      target_name: "sg",
      platform: "longbridge",
      variable_scope: "environment",
      github_environment: "longbridge-sg",
    },
  ),
  true,
);

assert.equal(
  __test.resolvedVariableScope("default", { platform: "longbridge", target_name: "sg" }),
  "environment",
);

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

const updatedOptionOverlayModeOptions = __test.updateAccountOptionsDefaultStrategy(
  accountOptions,
  {
    platform: "longbridge",
    target_name: "sg",
    account_selector: "SG",
    strategy_profile: "tqqq_growth_income",
    execution_mode: "live",
    variable_scope: "default",
    plugin_mode: "auto",
    option_overlay_mode: "disabled",
  },
);
assert.equal(updatedOptionOverlayModeOptions.changed, true);
assert.equal(updatedOptionOverlayModeOptions.options.longbridge[1].option_overlay_mode, "disabled");

const updatedCashOnlyModeOptions = __test.updateAccountOptionsDefaultStrategy(
  accountOptions,
  {
    platform: "longbridge",
    target_name: "sg",
    account_selector: "SG",
    strategy_profile: "tqqq_growth_income",
    execution_mode: "live",
    variable_scope: "default",
    plugin_mode: "auto",
    cash_only_execution_mode: "enabled",
  },
);
assert.equal(updatedCashOnlyModeOptions.changed, true);
assert.equal(updatedCashOnlyModeOptions.options.longbridge[1].cash_only_execution_mode, "enabled");

const updatedIbitZscoreModeOptions = __test.updateAccountOptionsDefaultStrategy(
  {
    ...accountOptions,
    ibkr: [
      {
        key: "ibit-primary",
        target_name: "ibit-primary",
        supported_domains: ["us_equity"],
        ibit_zscore_exit_mode: "live",
      },
    ],
  },
  {
    platform: "ibkr",
    target_name: "ibit-primary",
    strategy_profile: "ibit_smart_dca",
    execution_mode: "live",
    variable_scope: "repository",
    plugin_mode: "auto",
  },
);
assert.equal(updatedIbitZscoreModeOptions.changed, true);
assert.equal("ibit_zscore_exit_mode" in updatedIbitZscoreModeOptions.options.ibkr[0], false);

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
// default_strategy_profile is no longer persisted to KV after switch

const originalFetch = globalThis.fetch;
globalThis.fetch = githubVariableListMock(async (url) => {
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
  if (requestUrl.endsWith("/OPTION_OVERLAY_ENABLED")) {
    return new Response(JSON.stringify({ value: "true" }), {
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
  if (requestUrl.endsWith("/DCA_MODE")) {
    return new Response(JSON.stringify({ value: "smart" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.endsWith("/DCA_BASE_INVESTMENT_USD")) {
    return new Response(JSON.stringify({ value: "500" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.endsWith("/RUNTIME_TARGET_JSON")) {
    return new Response(JSON.stringify({
      value: JSON.stringify({
        platform_id: "schwab",
        strategy_profile: "nasdaq_sp500_smart_dca",
        dry_run_only: false,
        account_scope: "schwab",
        service_name: "charles-schwab-quant-service",
        execution_mode: "live",
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("", { status: 404 });
});
try {
  const currentStrategies = await __test.loadCurrentStrategies(
    { schwab: accountOptions.schwab },
    { RUNTIME_SETTINGS_DISPATCH_TOKEN: "test-token" },
  );
  assert.equal(currentStrategies.schwab.default.strategy_profile, "nasdaq_sp500_smart_dca");
  assert.equal(currentStrategies.schwab.default.execution_mode, "live");
  assert.equal(currentStrategies.schwab.default.min_reserved_cash_usd, "150");
  assert.equal(currentStrategies.schwab.default.reserved_cash_ratio, "0.03");
  assert.equal(currentStrategies.schwab.default.income_layer_start_usd, "150000");
  assert.equal(currentStrategies.schwab.default.income_layer_max_ratio, "0.95");
  assert.equal(currentStrategies.schwab.default.option_overlay_enabled, true);
  assert.equal(currentStrategies.schwab.default.runtime_target_enabled, false);
  assert.equal(currentStrategies.schwab.default.dca_mode, "smart");
  assert.equal(currentStrategies.schwab.default.dca_base_investment_usd, "500");
  assert.equal(currentStrategies.schwab.default.source, "RUNTIME_TARGET_JSON");
} finally {
  globalThis.fetch = originalFetch;
}

globalThis.fetch = githubVariableListMock(async (url) => {
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
  if (requestUrl.endsWith("/OPTION_OVERLAY_ENABLED")) {
    return new Response(JSON.stringify({ value: "true" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.endsWith("/RUNTIME_TARGET_ENABLED")) {
    return new Response(JSON.stringify({ value: "TRUE" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.endsWith("/DCA_MODE")) {
    return new Response(JSON.stringify({ value: "smart" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.endsWith("/DCA_BASE_INVESTMENT_USD")) {
    return new Response(JSON.stringify({ value: "500" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response("", { status: 404 });
});
try {
  const currentStrategies = await __test.loadCurrentStrategies(
    { schwab: accountOptions.schwab },
    { RUNTIME_SETTINGS_DISPATCH_TOKEN: "test-token" },
  );
  assert.equal(currentStrategies.schwab.default.runtime_target_enabled, true);
} finally {
  globalThis.fetch = originalFetch;
}

globalThis.fetch = githubVariableListMock(async (url) => {
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
            IBKR_CASH_ONLY_EXECUTION: "false",
            INCOME_LAYER_START_USD: "250000",
            INCOME_LAYER_MAX_RATIO: "0.55",
            OPTION_OVERLAY_ENABLED: "true",
            RUNTIME_TARGET_ENABLED: "false",
            DCA_MODE: "smart",
            DCA_BASE_INVESTMENT_USD: "700",
            IBIT_ZSCORE_EXIT_ENABLED: "true",
            IBIT_ZSCORE_EXIT_MODE: "live",
            runtime_target: {
              platform_id: "ibkr",
              strategy_profile: "ibit_smart_dca",
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
});
try {
  const currentStrategies = await __test.loadCurrentStrategies(
    { ibkr: accountOptions.ibkr },
    { RUNTIME_SETTINGS_DISPATCH_TOKEN: "test-token" },
  );
  assert.equal(currentStrategies.ibkr["ibkr-primary"].strategy_profile, "ibit_smart_dca");
  assert.equal(currentStrategies.ibkr["ibkr-primary"].min_reserved_cash_usd, "150");
  assert.equal(currentStrategies.ibkr["ibkr-primary"].reserved_cash_ratio, "0.03");
  assert.equal(currentStrategies.ibkr["ibkr-primary"].cash_only_execution, false);
  assert.equal(currentStrategies.ibkr["ibkr-primary"].income_layer_start_usd, "250000");
  assert.equal(currentStrategies.ibkr["ibkr-primary"].income_layer_max_ratio, "0.55");
  assert.equal(currentStrategies.ibkr["ibkr-primary"].option_overlay_enabled, true);
  assert.equal(currentStrategies.ibkr["ibkr-primary"].runtime_target_enabled, false);
  assert.equal(currentStrategies.ibkr["ibkr-primary"].dca_mode, "smart");
  assert.equal(currentStrategies.ibkr["ibkr-primary"].dca_base_investment_usd, "700");
  assert.equal("ibit_zscore_exit_mode" in currentStrategies.ibkr["ibkr-primary"], false);
  assert.equal(currentStrategies.ibkr["ibkr-primary"].source, "CLOUD_RUN_SERVICE_TARGETS_JSON");
} finally {
  globalThis.fetch = originalFetch;
}

globalThis.fetch = githubVariableListMock(async (url) => {
  const requestUrl = String(url);
  if (requestUrl.includes("/CharlesSchwabPlatform/actions/variables/CLOUD_RUN_SERVICE_TARGETS_JSON")) {
    return new Response(JSON.stringify({
      value: JSON.stringify({
        targets: [
          {
            service: "schwab-shared-a-service",
            ACCOUNT_GROUP: "shared-account",
            runtime_target: {
              platform_id: "schwab",
              strategy_profile: "global_etf_rotation",
              account_scope: "shared-account",
              service_name: "schwab-shared-a-service",
            },
          },
          {
            service: "schwab-shared-b-service",
            ACCOUNT_GROUP: "shared-account",
            runtime_target: {
              platform_id: "schwab",
              strategy_profile: "tqqq_growth_income",
              account_scope: "shared-account",
              service_name: "schwab-shared-b-service",
            },
          },
        ],
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (requestUrl.includes("/FirstradePlatform/actions/variables/CLOUD_RUN_SERVICE_TARGETS_JSON")) {
    return new Response(JSON.stringify({
      value: JSON.stringify([
        {
          service: "firstrade-shared-a-service",
          ACCOUNT_GROUP: "shared-account",
          runtime_target: {
            platform_id: "firstrade",
            strategy_profile: "nasdaq_sp500_smart_dca",
            account_scope: "shared-account",
            service_name: "firstrade-shared-a-service",
          },
        },
        {
          service: "firstrade-shared-b-service",
          ACCOUNT_GROUP: "shared-account",
          runtime_target: {
            platform_id: "firstrade",
            strategy_profile: "ibit_smart_dca",
            account_scope: "shared-account",
            service_name: "firstrade-shared-b-service",
          },
        },
      ]),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("", { status: 404 });
});
try {
  const currentStrategies = await __test.loadCurrentStrategies(
    {
      schwab: [
        {
          key: "shared-a",
          target_name: "shared-a",
          account_scope: "shared-account",
          service_name: "schwab-shared-a-service",
        },
        {
          key: "shared-b",
          target_name: "shared-b",
          account_scope: "shared-account",
          service_name: "schwab-shared-b-service",
        },
      ],
      firstrade: [
        {
          key: "shared-a",
          target_name: "shared-a",
          account_scope: "shared-account",
          service_name: "firstrade-shared-a-service",
        },
        {
          key: "shared-b",
          target_name: "shared-b",
          account_scope: "shared-account",
          service_name: "firstrade-shared-b-service",
        },
      ],
    },
    { RUNTIME_SETTINGS_DISPATCH_TOKEN: "test-token" },
  );
  assert.equal(currentStrategies.schwab["shared-a"].strategy_profile, "global_etf_rotation");
  assert.equal(currentStrategies.schwab["shared-b"].strategy_profile, "tqqq_growth_income");
  assert.equal(currentStrategies.firstrade["shared-a"].strategy_profile, "nasdaq_sp500_smart_dca");
  assert.equal(currentStrategies.firstrade["shared-b"].strategy_profile, "ibit_smart_dca");
  assert.equal(currentStrategies.schwab["shared-b"].source, "CLOUD_RUN_SERVICE_TARGETS_JSON");
  assert.equal(currentStrategies.firstrade["shared-b"].source, "CLOUD_RUN_SERVICE_TARGETS_JSON");
} finally {
  globalThis.fetch = originalFetch;
}

globalThis.fetch = githubVariableListMock(async (url) => {
  const requestUrl = String(url);
  if (requestUrl.endsWith("/CLOUD_RUN_SERVICE_TARGETS_JSON")) {
    return new Response(JSON.stringify({
      value: JSON.stringify([
        {
          service: "interactive-brokers-shared-a-service",
          ACCOUNT_GROUP: "demo-ibkr-tqqq",
          runtime_target: {
            platform_id: "ibkr",
            strategy_profile: "global_etf_rotation",
            account_scope: "demo-ibkr-tqqq",
            service_name: "interactive-brokers-shared-a-service",
          },
        },
        {
          service: "interactive-brokers-demo-ibkr-tqqq-service",
          ACCOUNT_GROUP: "demo-ibkr-tqqq",
          runtime_target: {
            platform_id: "ibkr",
            strategy_profile: "tqqq_growth_income",
            account_scope: "demo-ibkr-tqqq",
            service_name: "interactive-brokers-demo-ibkr-tqqq-service",
          },
        },
      ]),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("", { status: 404 });
});
try {
  const currentStrategies = await __test.loadCurrentStrategies(
    { ibkr: accountOptions.ibkr },
    { RUNTIME_SETTINGS_DISPATCH_TOKEN: "test-token" },
  );
  assert.equal(currentStrategies.ibkr["ibkr-primary"].strategy_profile, "tqqq_growth_income");
} finally {
  globalThis.fetch = originalFetch;
}

globalThis.fetch = githubVariableListMock(async (url) => {
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
});
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

globalThis.fetch = githubVariableListMock(async (url) => {
  const requestUrl = String(url);
  if (requestUrl.endsWith("/CLOUD_RUN_SERVICE_TARGETS_JSON")) {
    return new Response("", { status: 404 });
  }
  if (requestUrl.endsWith("/IBKR_CASH_ONLY_EXECUTION")) {
    return new Response(JSON.stringify({ value: "false" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response("", { status: 404 });
});
try {
  const currentStrategies = await __test.loadCurrentStrategies(
    { ibkr: accountOptions.ibkr },
    { RUNTIME_SETTINGS_DISPATCH_TOKEN: "test-token" },
  );
  assert.equal(currentStrategies.ibkr["ibkr-primary"].cash_only_execution, false);
  assert.equal(currentStrategies.ibkr["ibkr-primary"].source, "CASH_ONLY_EXECUTION_VARIABLE");
} finally {
  globalThis.fetch = originalFetch;
}

globalThis.fetch = githubVariableListMock(async (url) => {
  const requestUrl = String(url);
  if (requestUrl.includes("/LongBridgePlatform/actions/variables/CLOUD_RUN_SERVICE_TARGETS_JSON")) {
    return new Response(JSON.stringify({
      value: JSON.stringify({
        targets: [
          {
            service: "longbridge-quant-sg-service",
            strategy_profile: "russell_top50_leader_rotation",
            runtime_target: {
              platform_id: "longbridge",
              strategy_profile: "russell_top50_leader_rotation",
              account_scope: "SG",
              service_name: "longbridge-quant-sg-service",
              execution_mode: "live",
            },
          },
        ],
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (requestUrl.includes("/LongBridgePlatform/environments/longbridge-sg/variables/RUNTIME_TARGET_JSON")) {
    return new Response(JSON.stringify({
      value: JSON.stringify({
        platform_id: "longbridge",
        strategy_profile: "tqqq_growth_income",
        dry_run_only: false,
        account_scope: "SG",
        service_name: "longbridge-quant-sg-service",
        execution_mode: "live",
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (requestUrl.includes("/LongBridgePlatform/environments/longbridge-sg/variables/LONGBRIDGE_MIN_RESERVED_CASH_USD")) {
    return new Response(JSON.stringify({ value: "25" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.includes("/LongBridgePlatform/environments/longbridge-sg/variables/LONGBRIDGE_RESERVED_CASH_RATIO")) {
    return new Response(JSON.stringify({ value: "0.04" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.includes("/InteractiveBrokersPlatform/actions/variables/CLOUD_RUN_SERVICE_TARGETS_JSON")) {
    return new Response(JSON.stringify({
      value: JSON.stringify({
        targets: [
          {
            service: "interactive-brokers-demo-ibkr-tqqq-service",
            ACCOUNT_GROUP: "demo-ibkr-tqqq",
            IBKR_MIN_RESERVED_CASH_USD: "150",
            IBKR_RESERVED_CASH_RATIO: "0.03",
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
  if (requestUrl.includes("/CharlesSchwabPlatform/actions/variables/RUNTIME_TARGET_JSON")) {
    return new Response(JSON.stringify({
      value: JSON.stringify({
        platform_id: "schwab",
        strategy_profile: "soxl_soxx_trend_income",
        dry_run_only: false,
        account_scope: "default",
        service_name: "charles-schwab-quant-service",
        execution_mode: "live",
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (requestUrl.includes("/CharlesSchwabPlatform/actions/variables/SCHWAB_MIN_RESERVED_CASH_USD")) {
    return new Response(JSON.stringify({ value: "150" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.includes("/CharlesSchwabPlatform/actions/variables/SCHWAB_RESERVED_CASH_RATIO")) {
    return new Response(JSON.stringify({ value: "0.03" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.includes("/FirstradePlatform/actions/variables/RUNTIME_TARGET_JSON")) {
    return new Response(JSON.stringify({
      value: JSON.stringify({
        platform_id: "firstrade",
        strategy_profile: "ibit_smart_dca",
        dry_run_only: false,
        account_scope: "US",
        service_name: "firstrade-quant-service",
        execution_mode: "live",
      }),
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (requestUrl.includes("/FirstradePlatform/actions/variables/FIRSTRADE_MIN_RESERVED_CASH_USD")) {
    return new Response(JSON.stringify({ value: "50" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.includes("/FirstradePlatform/actions/variables/FIRSTRADE_RESERVED_CASH_RATIO")) {
    return new Response(JSON.stringify({ value: "0.02" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.includes("/FirstradePlatform/actions/variables/DCA_MODE")) {
    return new Response(JSON.stringify({ value: "fixed" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.includes("/FirstradePlatform/actions/variables/DCA_BASE_INVESTMENT_USD")) {
    return new Response(JSON.stringify({ value: "50" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (requestUrl.includes("/FirstradePlatform/actions/variables/IBIT_ZSCORE_EXIT_ENABLED")) {
    return new Response(JSON.stringify({ value: "true" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response("", { status: 404 });
});
try {
  const currentStrategies = await __test.loadCurrentStrategies(
    {
      longbridge: [accountOptions.longbridge[1]],
      ibkr: accountOptions.ibkr,
      schwab: accountOptions.schwab,
      firstrade: accountOptions.firstrade,
    },
    { RUNTIME_SETTINGS_DISPATCH_TOKEN: "test-token" },
  );
  assert.equal(currentStrategies.longbridge.sg.strategy_profile, "tqqq_growth_income");
  assert.equal(currentStrategies.longbridge.sg.min_reserved_cash_usd, "25");
  assert.equal(currentStrategies.longbridge.sg.reserved_cash_ratio, "0.04");
  assert.equal(currentStrategies.longbridge.sg.source, "RUNTIME_TARGET_JSON");
  assert.equal(currentStrategies.ibkr["ibkr-primary"].strategy_profile, "tqqq_growth_income");
  assert.equal(currentStrategies.ibkr["ibkr-primary"].min_reserved_cash_usd, "150");
  assert.equal(currentStrategies.ibkr["ibkr-primary"].reserved_cash_ratio, "0.03");
  assert.equal(currentStrategies.ibkr["ibkr-primary"].source, "CLOUD_RUN_SERVICE_TARGETS_JSON");
  assert.equal(currentStrategies.schwab.default.strategy_profile, "soxl_soxx_trend_income");
  assert.equal(currentStrategies.schwab.default.min_reserved_cash_usd, "150");
  assert.equal(currentStrategies.schwab.default.reserved_cash_ratio, "0.03");
  assert.equal(currentStrategies.firstrade.default.strategy_profile, "ibit_smart_dca");
  assert.equal(currentStrategies.firstrade.default.min_reserved_cash_usd, "50");
  assert.equal(currentStrategies.firstrade.default.reserved_cash_ratio, "0.02");
  assert.equal(currentStrategies.firstrade.default.dca_mode, "fixed");
  assert.equal(currentStrategies.firstrade.default.dca_base_investment_usd, "50");
  assert.equal("ibit_zscore_exit_mode" in currentStrategies.firstrade.default, false);
} finally {
  globalThis.fetch = originalFetch;
}

let scopedVariableRequests = 0;
globalThis.fetch = async (url) => {
  scopedVariableRequests += 1;
  assert.ok(new URL(url).pathname.endsWith("/actions/variables"));
  return Response.json({ total_count: 3, variables: [
    { name: "SCHWAB_MIN_RESERVED_CASH_USD", value: "150" },
    { name: "SCHWAB_RESERVED_CASH_RATIO", value: "0.03" },
    { name: "RUNTIME_TARGET_JSON", value: JSON.stringify({
      platform_id: "schwab", strategy_profile: "soxl_soxx_trend_income",
      dry_run_only: false, account_scope: "schwab",
      service_name: "charles-schwab-quant-service", execution_mode: "live",
    }) },
  ] });
};
try {
  const currentStrategies = await __test.loadCurrentStrategies(
    { schwab: accountOptions.schwab },
    { RUNTIME_SETTINGS_DISPATCH_TOKEN: "test-token" },
  );
  assert.equal(currentStrategies.schwab.default.min_reserved_cash_usd, "150");
  assert.equal(currentStrategies.schwab.default.reserved_cash_ratio, "0.03");
  assert.equal(currentStrategies.schwab.default.strategy_profile, "soxl_soxx_trend_income");
  assert.equal(scopedVariableRequests, 1);
} finally {
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

const healthStore = new Map();
const healthKv = {
  async get(key) { return healthStore.get(key) || null; },
  async put(key, value) { healthStore.set(key, value); },
};
const healthSyncValue = ["sync", "value"].join("-");
const sessionValue = ["session", "value"].join("-");
const sensitiveReviewKey = ["leaked", ["t", "o", "k", "e", "n"].join("")].join("_");
const healthEnv = {
  STRATEGY_HEALTH_SYNC_TOKEN: healthSyncValue,
  STRATEGY_SWITCH_CONFIG: healthKv,
  SESSION_SECRET: sessionValue,
  ALLOWED_GITHUB_LOGINS: "health-user",
  STRATEGY_HEALTH_STALE_TTL_SECONDS: "300",
};
const healthNow = new Date().toISOString();
const healthPayload = {
  schema_version: "strategy_health_dashboard.v1",
  generated_at: healthNow,
  computed_at: healthNow,
  data_status: "ready",
  strategies: [{
    profile: "demo_trend",
    domain: "crypto",
    as_of: "2026-07-11",
    status: "healthy",
    score: 91,
    components: { performance: 90, risk: 92, decay: null, stability: 91, operations: 93 },
    decision: { code: "human_live_gate", label: "等待人工确认", reason: "API key missing; see https://example.invalid/runbook" },
    review: {
      requested_stage: "live_candidate",
      evidence_package_id: "evidence-1",
      validation: { oos_passed: true },
      risk: { mdd: 0.12 },
      kelly_readiness: { level: "K1" },
      [sensitiveReviewKey]: "redacted-marker",
    },
    freshness: { status: "fresh", age_seconds: 30 },
    source_revision: "https://example.invalid/revisions/abc123",
  }],
  policy: { mode: "read_only", notice: "健康不等于已批准 live。" },
  errors: ["safe_notice", "not safe error"],
};
const sessionCookie = await __test.makeSession("health-user", [], healthEnv);
const healthCookieHeaders = { Cookie: `qsl_switch_session=${sessionCookie}` };

const unauthorizedHealthRead = await worker.fetch(
  new Request("https://switch.example/api/strategy-health"),
  healthEnv,
);
assert.equal(unauthorizedHealthRead.status, 401);

const wrongHealthToken = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-strategy-health", {
    method: "POST",
    headers: { Authorization: "Bearer other-value", "Content-Type": "application/json" },
    body: JSON.stringify(healthPayload),
  }),
  healthEnv,
);
assert.equal(wrongHealthToken.status, 401);

const oversizedHealthPayload = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-strategy-health", {
    method: "POST",
    headers: { Authorization: `Bearer ${healthSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify({ schema_version: "strategy_health_dashboard.v1", padding: "x".repeat(256 * 1024) }),
  }),
  healthEnv,
);
assert.equal(oversizedHealthPayload.status, 413);

const healthSync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-strategy-health", {
    method: "POST",
    headers: { Authorization: `Bearer ${healthSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(healthPayload),
  }),
  healthEnv,
);
assert.equal(healthSync.status, 200);
assert.equal((await healthSync.json()).strategy_count, 1);

const healthRead = await worker.fetch(
  new Request("https://switch.example/api/strategy-health", { headers: healthCookieHeaders }),
  healthEnv,
);
assert.equal(healthRead.status, 200);
const healthReadPayload = await healthRead.json();
assert.equal(healthReadPayload.data_status, "ready");
assert.equal(healthReadPayload.strategies[0].review[sensitiveReviewKey], undefined);
assert.match(healthReadPayload.strategies[0].decision.reason, /API key missing/);
assert.match(healthReadPayload.strategies[0].source_revision, /^https:\/\//);
assert.deepEqual(healthReadPayload.errors, ["safe_notice"]);
assert.ok(indexHtml.includes('id="health-count-critical"'));
assert.ok(indexHtml.includes('data-i18n="healthCritical"'));
assert.ok(indexHtml.includes('healthAttentionNotice'));
assert.ok(indexHtml.includes('formatAsOfDate('));
assert.ok(indexHtml.includes('m0ResearchBoard: "外部研究记录"'));

healthPayload.generated_at = new Date().toISOString();
healthPayload.computed_at = "2020-01-01T00:00:00.000Z";
await worker.fetch(
  new Request("https://switch.example/api/internal/sync-strategy-health", {
    method: "POST",
    headers: { Authorization: `Bearer ${healthSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(healthPayload),
  }),
  healthEnv,
);
const staleHealthRead = await worker.fetch(
  new Request("https://switch.example/api/strategy-health", { headers: healthCookieHeaders }),
  healthEnv,
);
assert.equal((await staleHealthRead.json()).data_status, "stale");

healthPayload.generated_at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
healthPayload.computed_at = healthPayload.generated_at;
healthPayload.data_status = "ready";
await worker.fetch(
  new Request("https://switch.example/api/internal/sync-strategy-health", {
    method: "POST",
    headers: { Authorization: `Bearer ${healthSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(healthPayload),
  }),
  healthEnv,
);
const futureHealthRead = await worker.fetch(
  new Request("https://switch.example/api/strategy-health", { headers: healthCookieHeaders }),
  healthEnv,
);
assert.equal((await futureHealthRead.json()).data_status, "stale");

healthPayload.data_status = "unavailable";
await worker.fetch(
  new Request("https://switch.example/api/internal/sync-strategy-health", {
    method: "POST",
    headers: { Authorization: `Bearer ${healthSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(healthPayload),
  }),
  healthEnv,
);
const unavailableHealthRead = await worker.fetch(
  new Request("https://switch.example/api/strategy-health", { headers: healthCookieHeaders }),
  healthEnv,
);
const unavailableHealthPayload = await unavailableHealthRead.json();
assert.equal(unavailableHealthPayload.data_status, "unavailable");
assert.equal(unavailableHealthPayload.summary.strategy_count, 0);
assert.deepEqual(unavailableHealthPayload.strategies, []);

const noKvHealthRead = await worker.fetch(
  new Request("https://switch.example/api/strategy-health", { headers: healthCookieHeaders }),
  { ...healthEnv, STRATEGY_SWITCH_CONFIG: undefined },
);
assert.equal(noKvHealthRead.status, 200);
const noKvPayload = await noKvHealthRead.json();
assert.equal(noKvPayload.data_status, "unavailable");
assert.equal(noKvPayload.summary.strategy_count, 0);

const unauthorizedRuntimeCatalogRead = await worker.fetch(
  new Request("https://switch.example/api/runtime-catalog"),
  healthEnv,
);
assert.equal(unauthorizedRuntimeCatalogRead.status, 401);
const runtimeCatalogRead = await worker.fetch(
  new Request("https://switch.example/api/runtime-catalog", { headers: healthCookieHeaders }),
  healthEnv,
);
assert.equal(runtimeCatalogRead.status, 200);
assert.deepEqual(await runtimeCatalogRead.json(), RUNTIME_CATALOG_PROJECTION);
assert.equal(RUNTIME_CATALOG_PROJECTION.data_status, "catalog_only");
assert.equal(RUNTIME_CATALOG_PROJECTION.policy.catalog_is_runtime_observation, false);
assert.equal(RUNTIME_CATALOG_PROJECTION.policy.catalog_can_authorize_promotion_or_trading, false);

const controlStore = new Map();
const controlKv = {
  async get(key) { return controlStore.get(key) || null; },
  async put(key, value) { controlStore.set(key, value); },
  async list({ prefix = "", limit = 1000 } = {}) {
    return {
      keys: [...controlStore.keys()]
        .filter((key) => key.startsWith(prefix))
        .slice(0, limit)
        .map((name) => ({ name })),
    };
  },
};
const controlSyncValue = ["control", "sync", "value"].join("-");
const controlEnv = {
  CONTROL_PLANE_SYNC_TOKEN: controlSyncValue,
  STRATEGY_SWITCH_CONFIG: controlKv,
  SESSION_SECRET: sessionValue,
  ALLOWED_GITHUB_LOGINS: "health-user",
  CONTROL_PLANE_STALE_TTL_SECONDS: "300",
};
const controlCookie = await __test.makeSession("health-user", [], controlEnv);
const controlCookieHeaders = { Cookie: `qsl_switch_session=${controlCookie}` };
const controlNow = new Date().toISOString();
const controlPayload = {
  schema_version: "qsl_control_plane_dashboard.v1",
  generated_at: controlNow,
  computed_at: controlNow,
  data_status: "ready",
  summary: { candidate_count: 99, deferred: 99, parked: 99, owner_decision_required: 99 },
  candidates: [{
    candidate_id: "tqqq_core_only_p2_v5",
    candidate_kind: "individual",
    domain: "us_equity",
    lifecycle: { stage: "P3", status: "deferred" },
    evidence: { p1_input_digest: "a".repeat(64), p2_config_digest: "b".repeat(64), p3_evidence_id: null, source_revision: "c".repeat(40) },
    recommendation: { code: "defer", reason: "token=should-not-appear" },
    freshness: { status: "fresh", age_seconds: 60 },
  }],
  policy: { p4_p5_automation: "not_configured", p6_owner_decision_required: true, notice: "live remains owner-decided" },
  errors: ["safe_notice"],
};

const unauthorizedControlRead = await worker.fetch(
  new Request("https://switch.example/api/control-plane"),
  controlEnv,
);
assert.equal(unauthorizedControlRead.status, 401);

const wrongControlToken = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-control-plane", {
    method: "POST",
    headers: { Authorization: "Bearer other-value", "Content-Type": "application/json" },
    body: JSON.stringify(controlPayload),
  }),
  controlEnv,
);
assert.equal(wrongControlToken.status, 401);

const oversizedControlPayload = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-control-plane", {
    method: "POST",
    headers: { Authorization: `Bearer ${controlSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify({ schema_version: "qsl_control_plane_dashboard.v1", padding: "x".repeat(256 * 1024) }),
  }),
  controlEnv,
);
assert.equal(oversizedControlPayload.status, 413);

const invalidP6Policy = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-control-plane", {
    method: "POST",
    headers: { Authorization: `Bearer ${controlSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...controlPayload, policy: { ...controlPayload.policy, p6_owner_decision_required: false } }),
  }),
  controlEnv,
);
assert.equal(invalidP6Policy.status, 400);

assert.throws(
  () => __test.normalizeControlPlaneSnapshot({
    ...controlPayload,
    candidates: [{
      ...controlPayload.candidates[0],
      lifecycle: { stage: "P6", status: "verified" },
      recommendation: { code: "none", reason: "must remain owner-decided" },
    }],
  }),
  /P6 must be an owner_live_decision/,
);

const controlSync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-control-plane", {
    method: "POST",
    headers: { Authorization: `Bearer ${controlSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(controlPayload),
  }),
  controlEnv,
);
assert.equal(controlSync.status, 200);
assert.equal((await controlSync.json()).candidate_count, 1);

const controlRead = await worker.fetch(
  new Request("https://switch.example/api/control-plane", { headers: controlCookieHeaders }),
  controlEnv,
);
assert.equal(controlRead.status, 200);
const controlReadPayload = await controlRead.json();
assert.equal(controlReadPayload.data_status, "ready");
assert.deepEqual(controlReadPayload.summary, { candidate_count: 1, deferred: 1, parked: 0, owner_decision_required: 0 });
assert.deepEqual(controlReadPayload.attention, {
  status: "attention_required",
  reason_codes: ["control_plane_candidate_deferred", "safe_notice"],
});
assert.equal(controlReadPayload.candidates[0].recommendation.reason, "没有可用的机器建议。");
assert.equal(controlReadPayload.policy.p6_owner_decision_required, true);
assert.ok(indexHtml.includes('requestJson("/api/control-plane")'));

controlPayload.computed_at = "2020-01-01T00:00:00.000Z";
await worker.fetch(
  new Request("https://switch.example/api/internal/sync-control-plane", {
    method: "POST",
    headers: { Authorization: `Bearer ${controlSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(controlPayload),
  }),
  controlEnv,
);
const staleControlRead = await worker.fetch(
  new Request("https://switch.example/api/control-plane", { headers: controlCookieHeaders }),
  controlEnv,
);
assert.equal((await staleControlRead.json()).data_status, "stale");

const weekendResearchSnapshot = {
  schema_version: "qsl_control_plane_source_snapshot.v1",
  source_id: "uesp.weekend_research",
  generated_at: "2026-08-29T09:21:00.000Z",
  computed_at: "2026-08-29T09:21:00.000Z",
  data_status: "ready",
  candidates: [],
  errors: [],
};
assert.equal(
  __test.controlPlaneResearchSnapshotFreshness(
    weekendResearchSnapshot,
    300,
    Date.parse("2026-08-31T16:40:00.000Z"),
  ).data_status,
  "ready",
);
assert.equal(
  __test.controlPlaneResearchSnapshotFreshness(
    weekendResearchSnapshot,
    300,
    Date.parse("2026-09-01T08:00:00.000Z"),
  ).data_status,
  "stale",
);

const controlSourcePayload = {
  schema_version: "qsl_control_plane_source_snapshot.v1",
  source_id: "uesp.tqqq_daily_research",
  generated_at: controlNow,
  computed_at: controlNow,
  data_status: "ready",
  candidates: [{
    ...controlPayload.candidates[0],
    lifecycle: { stage: "P3", status: "verified" },
    evidence: { ...controlPayload.candidates[0].evidence, p3_evidence_id: "d".repeat(64) },
    recommendation: { code: "keep_research", reason: "P3 evidence completed; research only" },
  }],
  errors: [],
};
const sourceSync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-control-plane-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${controlSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(controlSourcePayload),
  }),
  controlEnv,
);
assert.equal(sourceSync.status, 200);
assert.equal((await sourceSync.json()).source_id, "uesp.tqqq_daily_research");
const sourceControlRead = await worker.fetch(
  new Request("https://switch.example/api/control-plane", { headers: controlCookieHeaders }),
  controlEnv,
);
const sourceControlPayload = await sourceControlRead.json();
assert.equal(sourceControlPayload.data_status, "ready");
assert.deepEqual(sourceControlPayload.summary, { candidate_count: 1, deferred: 0, parked: 0, owner_decision_required: 0 });
assert.deepEqual(sourceControlPayload.attention, { status: "research_only", reason_codes: [] });
assert.equal(sourceControlPayload.candidates[0].candidate_id, "tqqq_core_only_p2_v5");

const adaptiveSelectionSyncValue = ["adaptive", "selection", "sync"].join("-");
const adaptiveSelectionEnv = { ...controlEnv, ADAPTIVE_SELECTION_SYNC_TOKEN: adaptiveSelectionSyncValue };
const adaptiveSelectionCookie = await __test.makeSession("health-user", [], adaptiveSelectionEnv);
const adaptiveSelectionCookieHeaders = { Cookie: `qsl_switch_session=${adaptiveSelectionCookie}` };
const adaptiveSelectionSourcePayload = {
  schema_version: "qsl.adaptive_selection_source_snapshot.v1",
  source_id: "uesp.us_equity_combo_shadow",
  generated_at: controlNow,
  computed_at: controlNow,
  data_status: "ready",
  decision: {
    schema: "qsl.selection_decision.v1",
    decision_id: "shadow-us-equity-combo-001",
    created_at: "2026-08-29T00:00:00+00:00",
    authority: "shadow_only",
    no_order: true,
    market_context: {
      schema: "qsl.market_context_snapshot.v1",
      as_of: "2026-08-28",
      domain: "us_equity",
      data_version: "trusted-prices-v1",
      data_freshness_days: 0,
      regime: "normal",
      regime_confidence: 0.9,
      factors: { momentum: 0.12 },
    },
    policy_id: "shadow-policy-v1",
    recommended_strategy_profile: "us_equity_combo",
    recommended_platform_id: "longbridge-paper",
    candidates: [{
      strategy_profile: "us_equity_combo",
      release_digest: `sha256:${"a".repeat(64)}`,
      selected_platform_id: "longbridge-paper",
      score: 0.42,
      risk_multiplier: 1,
      accepted: true,
      reasons: ["shadow_candidate_ranked"],
      proposed_weight: 0,
    }],
    input_digest: "b".repeat(64),
  },
  errors: [],
};
adaptiveSelectionSourcePayload.decision.decision_digest = await __test.calculateAdaptiveSelectionDecisionDigest(
  adaptiveSelectionSourcePayload.decision,
);
assert.equal(
  adaptiveSelectionSourcePayload.decision.decision_digest,
  "b5253cf3c2591b4ba0e7408fbdd3bb648b3813474ee6359d98dbdbb2556b8fe5",
);

const unauthorizedAdaptiveSelectionRead = await worker.fetch(
  new Request("https://switch.example/api/adaptive-selection"),
  adaptiveSelectionEnv,
);
assert.equal(unauthorizedAdaptiveSelectionRead.status, 401);
const wrongAdaptiveSelectionToken = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-adaptive-selection-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${controlSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(adaptiveSelectionSourcePayload),
  }),
  adaptiveSelectionEnv,
);
assert.equal(wrongAdaptiveSelectionToken.status, 401);
await assert.rejects(
  () => __test.normalizeAdaptiveSelectionSourceSnapshot({
    ...adaptiveSelectionSourcePayload,
    decision: {
      ...adaptiveSelectionSourcePayload.decision,
      candidates: [{ ...adaptiveSelectionSourcePayload.decision.candidates[0], proposed_weight: 0.01 }],
    },
  }),
  /proposed_weight must remain zero/,
);
const legacyUndigestedDecision = { ...adaptiveSelectionSourcePayload.decision };
delete legacyUndigestedDecision.decision_digest;
await assert.rejects(
  () => __test.normalizeAdaptiveSelectionSourceSnapshot({
    ...adaptiveSelectionSourcePayload,
    decision: legacyUndigestedDecision,
  }),
  /has invalid fields/,
);
await assert.rejects(
  () => __test.normalizeAdaptiveSelectionSourceSnapshot({
    ...adaptiveSelectionSourcePayload,
    decision: {
      ...adaptiveSelectionSourcePayload.decision,
      input_digest: "c".repeat(64),
    },
  }),
  /decision_digest mismatch/,
);
await assert.rejects(
  () => __test.normalizeAdaptiveSelectionSourceSnapshot({
    ...adaptiveSelectionSourcePayload,
    decision: {
      ...adaptiveSelectionSourcePayload.decision,
      decision_digest: "d".repeat(64),
    },
  }),
  /decision_digest mismatch/,
);
const adaptiveSelectionSync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-adaptive-selection-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${adaptiveSelectionSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(adaptiveSelectionSourcePayload),
  }),
  adaptiveSelectionEnv,
);
assert.equal(adaptiveSelectionSync.status, 200);
assert.equal((await adaptiveSelectionSync.json()).no_order, true);
const adaptiveSelectionRead = await worker.fetch(
  new Request("https://switch.example/api/adaptive-selection", { headers: adaptiveSelectionCookieHeaders }),
  adaptiveSelectionEnv,
);
assert.equal(adaptiveSelectionRead.status, 200);
const adaptiveSelectionPayload = await adaptiveSelectionRead.json();
assert.equal(adaptiveSelectionPayload.data_status, "ready");
assert.deepEqual(adaptiveSelectionPayload.summary, {
  source_count: 1, decision_count: 1, candidate_count: 1, recommended_count: 1, rejected_candidate_count: 0,
});
assert.equal(adaptiveSelectionPayload.policy.no_order, true);
assert.equal(adaptiveSelectionPayload.selections[0].decision.recommended_strategy_profile, "us_equity_combo");

const ownerDecisionStore = new Map();
const ownerDecisionKv = {
  async get(key) { return ownerDecisionStore.get(key) || null; },
  async put(key, value) { ownerDecisionStore.set(key, value); },
  async list({ prefix = "", limit = 1000 } = {}) {
    return {
      keys: [...ownerDecisionStore.keys()]
        .filter((key) => key.startsWith(prefix))
        .slice(0, limit)
        .map((name) => ({ name })),
    };
  },
};
const ownerDecisionEnv = {
  ...controlEnv,
  STRATEGY_SWITCH_CONFIG: ownerDecisionKv,
  ALLOWED_GITHUB_LOGINS: "owner-admin,owner-reader",
  STRATEGY_SWITCH_ADMIN_LOGINS: "owner-admin",
};
const ownerAdminCookie = await __test.makeSession("owner-admin", [], ownerDecisionEnv);
const ownerReaderCookie = await __test.makeSession("owner-reader", [], ownerDecisionEnv);
const ownerAdminHeaders = { Cookie: `qsl_switch_session=${ownerAdminCookie}` };
const ownerReaderHeaders = { Cookie: `qsl_switch_session=${ownerReaderCookie}` };
const ownerDecisionPayload = {
  ...controlPayload,
  generated_at: controlNow,
  computed_at: controlNow,
  candidates: [{
    ...controlPayload.candidates[0],
    candidate_id: "soxl_core_only_p2_v7",
    lifecycle: { stage: "P6", status: "owner_decision_required" },
    evidence: {
      p1_input_digest: "1".repeat(64),
      p2_config_digest: "2".repeat(64),
      p3_evidence_id: "3".repeat(64),
      source_revision: "4".repeat(40),
    },
    recommendation: { code: "owner_live_decision", reason: "P4/P5 evidence is current; owner decision required." },
    freshness: { status: "fresh", age_seconds: 0 },
  }],
};
const ownerDecisionSync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-control-plane", {
    method: "POST",
    headers: { Authorization: `Bearer ${controlSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(ownerDecisionPayload),
  }),
  ownerDecisionEnv,
);
assert.equal(ownerDecisionSync.status, 200);

const ownerDecisionQueue = await worker.fetch(
  new Request("https://switch.example/api/owner-decisions", { headers: ownerAdminHeaders }),
  ownerDecisionEnv,
);
assert.equal(ownerDecisionQueue.status, 200);
const ownerDecisionQueuePayload = await ownerDecisionQueue.json();
assert.equal(ownerDecisionQueuePayload.data_status, "ready");
assert.equal(ownerDecisionQueuePayload.candidates.length, 1);
assert.equal(ownerDecisionQueuePayload.candidates[0].intent, null);
assert.equal(ownerDecisionQueuePayload.policy.execution_authority_granted, false);
const ownerDecisionRequest = {
  candidate_id: "soxl_core_only_p2_v7",
  decision: "keep_parked",
  candidate_evidence_sha256: ownerDecisionQueuePayload.candidates[0].candidate_evidence_sha256,
};

const readerDecision = await worker.fetch(
  new Request("https://switch.example/api/owner-decisions", {
    method: "POST",
    headers: { ...ownerReaderHeaders, Origin: "https://switch.example", "Content-Type": "application/json" },
    body: JSON.stringify(ownerDecisionRequest),
  }),
  ownerDecisionEnv,
);
assert.equal(readerDecision.status, 403);

const ownerDecisionWrite = await worker.fetch(
  new Request("https://switch.example/api/owner-decisions", {
    method: "POST",
    headers: { ...ownerAdminHeaders, Origin: "https://switch.example", "Content-Type": "application/json" },
    body: JSON.stringify(ownerDecisionRequest),
  }),
  ownerDecisionEnv,
);
assert.equal(ownerDecisionWrite.status, 200);
const ownerDecisionWritePayload = await ownerDecisionWrite.json();
assert.equal(ownerDecisionWritePayload.intent.decision, "keep_parked");
assert.equal(ownerDecisionWritePayload.intent.no_order, true);
assert.equal(ownerDecisionWritePayload.intent.execution_authority_granted, false);
assert.ok(ownerDecisionStore.has("owner_decision_current:soxl_core_only_p2_v7"));
assert.ok(ownerDecisionStore.has(
  `owner_decision_intent:soxl_core_only_p2_v7:${ownerDecisionWritePayload.intent.decision_sha256}`,
));

const recordedOwnerDecisionQueue = await worker.fetch(
  new Request("https://switch.example/api/owner-decisions", { headers: ownerAdminHeaders }),
  ownerDecisionEnv,
);
const recordedOwnerDecisionPayload = await recordedOwnerDecisionQueue.json();
assert.equal(recordedOwnerDecisionPayload.candidates[0].intent.decision, "keep_parked");

const recoveryStore = new Map();
const recoveryKv = {
  async get(key) { return recoveryStore.get(key) || null; },
  async put(key, value) { recoveryStore.set(key, value); },
  async list({ prefix = "", limit = 1000 } = {}) {
    return {
      keys: [...recoveryStore.keys()]
        .filter((key) => key.startsWith(prefix))
        .slice(0, limit)
        .map((name) => ({ name })),
    };
  },
};
const recoverySyncValue = ["reconciliation", "recovery", "sync"].join("-");
const recoveryControllerValue = ["reconciliation", "recovery", "controller"].join("-");
const recoveryEnv = {
  SESSION_SECRET: "recovery-session-value",
  ALLOWED_GITHUB_LOGINS: "recovery-admin,recovery-reader",
  STRATEGY_SWITCH_ADMIN_LOGINS: "recovery-admin",
  RECONCILIATION_RECOVERY_SYNC_TOKEN: recoverySyncValue,
  RECONCILIATION_RECOVERY_CONTROLLER_TOKEN: recoveryControllerValue,
  STRATEGY_SWITCH_CONFIG: recoveryKv,
};
const recoveryAdminCookie = await __test.makeSession("recovery-admin", [], recoveryEnv);
const recoveryReaderCookie = await __test.makeSession("recovery-reader", [], recoveryEnv);
const recoveryAdminHeaders = { Cookie: `qsl_switch_session=${recoveryAdminCookie}` };
const recoveryReaderHeaders = { Cookie: `qsl_switch_session=${recoveryReaderCookie}` };
const recoveryNow = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const recoveryCandidateSha256 = "a".repeat(64);
const recoverySourcePayload = {
  schema_version: "qsl_reconciliation_recovery_source_snapshot.v1",
  source_id: "ibkr.legacy_recovery",
  generated_at: recoveryNow,
  computed_at: recoveryNow,
  data_status: "ready",
  recoveries: [{
    recovery_id: "ibkr_legacy_soxl_live",
    platform: "ibkr",
    strategy_profile: "soxl_soxx_trend_income",
    environment: "live",
    reconciliation_state: "RECONCILE_ONLY",
    readiness: "awaiting_human_confirmation",
    candidate_sha256: recoveryCandidateSha256,
    evidence_sample_count: 1,
    first_observed_at: recoveryNow,
    last_observed_at: recoveryNow,
    dual_review: {
      outcome: "unavailable",
      reviewer_count: 0,
      evidence_binding_sha256: recoveryCandidateSha256,
    },
    blocker_codes: [],
  }],
  errors: [],
};
assert.equal(
  __test.normalizeReconciliationRecoverySourceSnapshot(recoverySourcePayload)
    .recoveries[0].evidence_sample_count,
  1,
);
assert.throws(
  () => __test.normalizeReconciliationRecoverySourceSnapshot({
    ...recoverySourcePayload,
    recoveries: [{ ...recoverySourcePayload.recoveries[0], evidence_sample_count: 0 }],
  }),
  /requires at least one observation within a 15-minute window/,
);
assert.throws(
  () => __test.normalizeReconciliationRecoverySourceSnapshot({
    ...recoverySourcePayload,
    recoveries: [{
      ...recoverySourcePayload.recoveries[0],
      first_observed_at: new Date(Date.parse(recoveryNow) - 16 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    }],
  }),
  /requires at least one observation within a 15-minute window/,
);
assert.throws(
  () => __test.normalizeReconciliationRecoverySourceSnapshot({
    ...recoverySourcePayload,
    recoveries: [{ ...recoverySourcePayload.recoveries[0], blocker_codes: ["unresolved_reconciliation"] }],
  }),
  /requires at least one observation within a 15-minute window/,
);
const unauthorizedRecoveryRead = await worker.fetch(
  new Request("https://switch.example/api/reconciliation-recovery"),
  recoveryEnv,
);
assert.equal(unauthorizedRecoveryRead.status, 401);
const wrongRecoverySync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-reconciliation-recovery-source", {
    method: "POST",
    headers: { Authorization: "Bearer wrong-token", "Content-Type": "application/json" },
    body: JSON.stringify(recoverySourcePayload),
  }),
  recoveryEnv,
);
assert.equal(wrongRecoverySync.status, 401);
const invalidRecoverySync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-reconciliation-recovery-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${recoverySyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...recoverySourcePayload,
      recoveries: [{
        ...recoverySourcePayload.recoveries[0],
        dual_review: { ...recoverySourcePayload.recoveries[0].dual_review, evidence_binding_sha256: "b".repeat(64) },
      }],
    }),
  }),
  recoveryEnv,
);
assert.equal(invalidRecoverySync.status, 400);
const recoverySync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-reconciliation-recovery-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${recoverySyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(recoverySourcePayload),
  }),
  recoveryEnv,
);
assert.equal(recoverySync.status, 200);
const recoveryRead = await worker.fetch(
  new Request("https://switch.example/api/reconciliation-recovery", { headers: recoveryAdminHeaders }),
  recoveryEnv,
);
assert.equal(recoveryRead.status, 200);
const recoveryDashboard = await recoveryRead.json();
assert.equal(recoveryDashboard.data_status, "ready");
assert.deepEqual(recoveryDashboard.summary, {
  recovery_count: 1, awaiting_human_confirmation: 1, blocked: 0, confirmed: 0,
});
assert.equal(recoveryDashboard.policy.no_order, true);
assert.equal(recoveryDashboard.policy.execution_authority_granted, false);
assert.equal(recoveryDashboard.recoveries[0].recovery.dual_review.outcome, "unavailable");
const rejectedRecoveryCandidateSha256 = "d".repeat(64);
const rejectedRecoverySync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-reconciliation-recovery-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${recoverySyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...recoverySourcePayload,
      source_id: "ibkr.rejected_recovery",
      recoveries: [{
        ...recoverySourcePayload.recoveries[0],
        recovery_id: "ibkr_legacy_rejected",
        candidate_sha256: rejectedRecoveryCandidateSha256,
        dual_review: {
          outcome: "rejected",
          reviewer_count: 1,
          evidence_binding_sha256: rejectedRecoveryCandidateSha256,
        },
      }],
    }),
  }),
  recoveryEnv,
);
assert.equal(rejectedRecoverySync.status, 200);
const rejectedRecoveryRead = await worker.fetch(
  new Request("https://switch.example/api/reconciliation-recovery", { headers: recoveryAdminHeaders }),
  recoveryEnv,
);
const rejectedRecoveryDashboard = await rejectedRecoveryRead.json();
assert.equal(
  rejectedRecoveryDashboard.recoveries.find((entry) => entry.recovery.recovery_id === "ibkr_legacy_rejected")
    .recovery.dual_review.outcome,
  "rejected",
);
const recoveryConfirmationRequest = {
  recovery_id: "ibkr_legacy_soxl_live",
  candidate_sha256: recoveryCandidateSha256,
  dual_review_binding_sha256: recoveryCandidateSha256,
};
const wrongRecoveryControllerRead = await worker.fetch(
  new Request("https://switch.example/api/internal/reconciliation-recovery-confirmation?recovery_id=ibkr_legacy_soxl_live", {
    headers: { Authorization: "Bearer wrong-token" },
  }),
  recoveryEnv,
);
assert.equal(wrongRecoveryControllerRead.status, 401);
const unconfirmedRecoveryControllerRead = await worker.fetch(
  new Request("https://switch.example/api/internal/reconciliation-recovery-confirmation?recovery_id=ibkr_legacy_soxl_live", {
    headers: { Authorization: `Bearer ${recoveryControllerValue}` },
  }),
  recoveryEnv,
);
assert.equal(unconfirmedRecoveryControllerRead.status, 404);
const reusedRecoveryControllerToken = await worker.fetch(
  new Request("https://switch.example/api/internal/reconciliation-recovery-confirmation?recovery_id=ibkr_legacy_soxl_live", {
    headers: { Authorization: `Bearer ${recoverySyncValue}` },
  }),
  { ...recoveryEnv, RECONCILIATION_RECOVERY_CONTROLLER_TOKEN: recoverySyncValue },
);
assert.equal(reusedRecoveryControllerToken.status, 500);
const staleRecoveryCandidateSha256 = "c".repeat(64);
const staleRecoverySourcePayload = {
  ...recoverySourcePayload,
  source_id: "ibkr.stale_recovery",
  recoveries: [{
    ...recoverySourcePayload.recoveries[0],
    recovery_id: "ibkr_legacy_stale",
    candidate_sha256: staleRecoveryCandidateSha256,
    first_observed_at: new Date(Date.parse(recoveryNow) - 41 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    last_observed_at: new Date(Date.parse(recoveryNow) - 40 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    dual_review: {
      outcome: "approved",
      reviewer_count: 2,
      evidence_binding_sha256: staleRecoveryCandidateSha256,
    },
  }],
};
const staleRecoverySync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-reconciliation-recovery-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${recoverySyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(staleRecoverySourcePayload),
  }),
  recoveryEnv,
);
assert.equal(staleRecoverySync.status, 200);
const staleRecoveryRead = await worker.fetch(
  new Request("https://switch.example/api/reconciliation-recovery", { headers: recoveryAdminHeaders }),
  recoveryEnv,
);
const staleRecoveryDashboard = await staleRecoveryRead.json();
assert.equal(staleRecoveryDashboard.data_status, "stale");
const staleDashboardConfirmation = await worker.fetch(
  new Request("https://switch.example/api/reconciliation-recovery-confirmations", {
    method: "POST",
    headers: { ...recoveryAdminHeaders, Origin: "https://switch.example", "Content-Type": "application/json" },
    body: JSON.stringify(recoveryConfirmationRequest),
  }),
  recoveryEnv,
);
assert.equal(staleDashboardConfirmation.status, 409);
recoveryStore.delete("reconciliation_recovery_source:ibkr.stale_recovery");
const readerRecoveryConfirmation = await worker.fetch(
  new Request("https://switch.example/api/reconciliation-recovery-confirmations", {
    method: "POST",
    headers: { ...recoveryReaderHeaders, Origin: "https://switch.example", "Content-Type": "application/json" },
    body: JSON.stringify(recoveryConfirmationRequest),
  }),
  recoveryEnv,
);
assert.equal(readerRecoveryConfirmation.status, 403);
const recoveryConfirmation = await worker.fetch(
  new Request("https://switch.example/api/reconciliation-recovery-confirmations", {
    method: "POST",
    headers: { ...recoveryAdminHeaders, Origin: "https://switch.example", "Content-Type": "application/json" },
    body: JSON.stringify(recoveryConfirmationRequest),
  }),
  recoveryEnv,
);
assert.equal(recoveryConfirmation.status, 200);
const recoveryConfirmationPayload = await recoveryConfirmation.json();
assert.equal(recoveryConfirmationPayload.confirmation.no_order, true);
assert.equal(recoveryConfirmationPayload.confirmation.execution_authority_granted, false);
const rejectedRecoveryConfirmation = await worker.fetch(
  new Request("https://switch.example/api/reconciliation-recovery-confirmations", {
    method: "POST",
    headers: { ...recoveryAdminHeaders, Origin: "https://switch.example", "Content-Type": "application/json" },
    body: JSON.stringify({
      recovery_id: "ibkr_legacy_rejected",
      candidate_sha256: rejectedRecoveryCandidateSha256,
      dual_review_binding_sha256: rejectedRecoveryCandidateSha256,
    }),
  }),
  recoveryEnv,
);
assert.equal(rejectedRecoveryConfirmation.status, 200);
const rejectedRecoveryConfirmationPayload = await rejectedRecoveryConfirmation.json();
assert.equal(rejectedRecoveryConfirmationPayload.confirmation.no_order, true);
assert.equal(rejectedRecoveryConfirmationPayload.confirmation.execution_authority_granted, false);
assert.ok(recoveryStore.has("reconciliation_recovery_current:ibkr_legacy_soxl_live"));
assert.ok(recoveryStore.has(
  `reconciliation_recovery_confirmation:ibkr_legacy_soxl_live:${recoveryConfirmationPayload.confirmation.confirmation_sha256}`,
));
const confirmedRecoveryControllerRead = await worker.fetch(
  new Request("https://switch.example/api/internal/reconciliation-recovery-confirmation?recovery_id=ibkr_legacy_soxl_live", {
    headers: { Authorization: `Bearer ${recoveryControllerValue}` },
  }),
  recoveryEnv,
);
assert.equal(confirmedRecoveryControllerRead.status, 200);
const confirmedRecoveryControllerPayload = await confirmedRecoveryControllerRead.json();
assert.equal(confirmedRecoveryControllerPayload.schema_version, "qsl_reconciliation_recovery_controller_read.v1");
assert.equal(confirmedRecoveryControllerPayload.recovery.candidate_sha256, recoveryCandidateSha256);
assert.equal(confirmedRecoveryControllerPayload.confirmation.confirmation_sha256, recoveryConfirmationPayload.confirmation.confirmation_sha256);
assert.equal(confirmedRecoveryControllerPayload.policy.no_order, true);
assert.equal(confirmedRecoveryControllerPayload.policy.execution_authority_granted, false);
const recordedRecoveryRead = await worker.fetch(
  new Request("https://switch.example/api/reconciliation-recovery", { headers: recoveryAdminHeaders }),
  recoveryEnv,
);
const recordedRecoveryPayload = await recordedRecoveryRead.json();
assert.equal(recordedRecoveryPayload.summary.confirmed, 2);
assert.equal(recordedRecoveryPayload.summary.awaiting_human_confirmation, 0);
assert.equal(recordedRecoveryPayload.recoveries[0].confirmation.confirmed_by, "recovery-admin");

const riskProfileStore = new Map();
const riskProfileKv = {
  async get(key) { return riskProfileStore.get(key) || null; },
  async put(key, value) { riskProfileStore.set(key, value); },
};
const riskProfileEnv = {
  SESSION_SECRET: "risk-profile-session-value",
  ALLOWED_GITHUB_LOGINS: "risk-admin,risk-reader",
  STRATEGY_SWITCH_ADMIN_LOGINS: "risk-admin",
  STRATEGY_SWITCH_CONFIG: riskProfileKv,
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({
    longbridge: [{ key: "sg", label: "Singapore", target_name: "sg" }],
    schwab: [{ key: "default", label: "US", target_name: "default" }],
  }),
};
const riskAdminCookie = await __test.makeSession("risk-admin", [], riskProfileEnv);
const riskReaderCookie = await __test.makeSession("risk-reader", [], riskProfileEnv);
const riskAdminHeaders = { Cookie: `qsl_switch_session=${riskAdminCookie}` };
const riskReaderHeaders = { Cookie: `qsl_switch_session=${riskReaderCookie}` };

const initialRiskProfiles = await worker.fetch(
  new Request("https://switch.example/api/risk-profiles", { headers: riskAdminHeaders }),
  riskProfileEnv,
);
assert.equal(initialRiskProfiles.status, 200);
assert.deepEqual((await initialRiskProfiles.json()).bindings, []);

const riskProfileWrite = await worker.fetch(
  new Request("https://switch.example/api/risk-profiles", {
    method: "POST",
    headers: { ...riskAdminHeaders, Origin: "https://switch.example", "Content-Type": "application/json" },
    body: JSON.stringify({
      bindings: [{ platform: "longbridge", target_name: "sg", risk_preference: "BALANCED_COMPOUNDING" }],
    }),
  }),
  riskProfileEnv,
);
assert.equal(riskProfileWrite.status, 200);
const riskProfileWritePayload = await riskProfileWrite.json();
assert.equal(riskProfileWritePayload.no_order, true);
assert.equal(riskProfileWritePayload.execution_authority_granted, false);
assert.equal(riskProfileWritePayload.bindings[0].scope_id, "longbridge--sg");
assert.equal(riskProfileWritePayload.bindings[0].profile_selection.schema, "qsl.risk_profile_selection.v1");
assert.equal(riskProfileWritePayload.bindings[0].profile_selection.profile_id, "balanced_compounding_v1");
assert.equal(riskProfileWritePayload.bindings[0].profile_selection.risk_preference, "BALANCED_COMPOUNDING");
assert.match(riskProfileWritePayload.bindings[0].profile_selection.selection_sha256, /^[0-9a-f]{64}$/);
assert.match(riskProfileWritePayload.bindings[0].binding_sha256, /^[0-9a-f]{64}$/);
assert.equal(riskProfileStore.has("risk_profile_bindings"), true);
assert.equal((await worker.fetch(
  new Request("https://switch.example/api/risk-profiles", { headers: riskReaderHeaders }),
  riskProfileEnv,
)).status, 403);

const invalidRiskProfileTarget = await worker.fetch(
  new Request("https://switch.example/api/risk-profiles", {
    method: "POST",
    headers: { ...riskAdminHeaders, Origin: "https://switch.example", "Content-Type": "application/json" },
    body: JSON.stringify({
      bindings: [{ platform: "longbridge", target_name: "missing", risk_preference: "BALANCED_COMPOUNDING" }],
    }),
  }),
  riskProfileEnv,
);
assert.equal(invalidRiskProfileTarget.status, 400);
assert.match((await invalidRiskProfileTarget.json()).error, /not configured/);

const crossOriginRiskProfileWrite = await worker.fetch(
  new Request("https://switch.example/api/risk-profiles", {
    method: "POST",
    headers: { ...riskAdminHeaders, Origin: "https://evil.example", "Content-Type": "application/json" },
    body: JSON.stringify({ bindings: [] }),
  }),
  riskProfileEnv,
);
assert.equal(crossOriginRiskProfileWrite.status, 403);

const tamperedRiskRegistry = JSON.parse(riskProfileStore.get("risk_profile_bindings"));
tamperedRiskRegistry.bindings[0].profile_selection.risk_preference = "GROWTH_COMPOUNDING";
riskProfileStore.set("risk_profile_bindings", JSON.stringify(tamperedRiskRegistry));
const tamperedRiskProfileRead = await worker.fetch(
  new Request("https://switch.example/api/risk-profiles", { headers: riskAdminHeaders }),
  riskProfileEnv,
);
assert.equal(tamperedRiskProfileRead.status, 409);
assert.equal((await tamperedRiskProfileRead.json()).reason, "risk_profile_bindings_invalid");

const directRiskProfileBindings = await __test.buildRiskProfileBindings(
  { bindings: [{ platform: "schwab", target_name: "default", risk_preference: "CAPITAL_PRESERVATION" }] },
  JSON.parse(riskProfileEnv.STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON),
  "risk-admin",
);
assert.equal(directRiskProfileBindings[0].profile_selection.profile_id, "capital_preservation_v1");
assert.deepEqual(
  await __test.normalizeRiskProfileBindingRegistry({
    schema_version: "qsl.risk_profile_binding_registry.v1",
    bindings: directRiskProfileBindings,
  }),
  directRiskProfileBindings,
);

const staleDecision = await worker.fetch(
  new Request("https://switch.example/api/owner-decisions", {
    method: "POST",
    headers: { ...ownerAdminHeaders, Origin: "https://switch.example", "Content-Type": "application/json" },
    body: JSON.stringify({ ...ownerDecisionRequest, candidate_evidence_sha256: "0".repeat(64) }),
  }),
  ownerDecisionEnv,
);
assert.equal(staleDecision.status, 409);

const conflictingSourceSync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-control-plane-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${controlSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...controlSourcePayload, source_id: "uesp.conflicting_candidate" }),
  }),
  controlEnv,
);
assert.equal(conflictingSourceSync.status, 200);

const conflictingSourceRead = await worker.fetch(
  new Request("https://switch.example/api/control-plane", { headers: controlCookieHeaders }),
  controlEnv,
);
const conflictingSourcePayload = await conflictingSourceRead.json();
assert.equal(conflictingSourcePayload.summary.candidate_count, 0);
assert.ok(conflictingSourcePayload.errors.includes("control_plane_duplicate_candidate"));

const parkedSourceSync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-control-plane-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${controlSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...controlSourcePayload,
      source_id: "uesp.soxl_daily_research",
      candidates: [{
        ...controlSourcePayload.candidates[0],
        candidate_id: "soxl_soxx_trend_income",
        lifecycle: { stage: "P3", status: "parked" },
        evidence: { ...controlSourcePayload.candidates[0].evidence, p3_evidence_id: null },
        recommendation: { code: "park", reason: "P3 parked: runtime_internal_failure." },
      }],
      errors: ["p3_parked", "decision_data_projection_parked"],
    }),
  }),
  controlEnv,
);
assert.equal(parkedSourceSync.status, 200);
const parkedControlRead = await worker.fetch(
  new Request("https://switch.example/api/control-plane", { headers: controlCookieHeaders }),
  controlEnv,
);
const parkedControlPayload = await parkedControlRead.json();
assert.equal(parkedControlPayload.data_status, "ready");
assert.equal(parkedControlPayload.attention.status, "attention_required");
assert.deepEqual(parkedControlPayload.attention.reason_codes, [
  "control_plane_candidate_parked",
  "control_plane_duplicate_candidate",
  "decision_data_projection_parked",
  "p3_parked",
]);

const executionEvidenceSyncValue = ["execution", "evidence", "sync"].join("-");
const executionEvidenceEnv = { ...controlEnv, EXECUTION_EVIDENCE_SYNC_TOKEN: executionEvidenceSyncValue };
const executionEvidenceCookie = await __test.makeSession("health-user", [], executionEvidenceEnv);
const executionEvidenceCookieHeaders = { Cookie: `qsl_switch_session=${executionEvidenceCookie}` };
const executionEvidenceSourcePayload = {
  schema_version: "qsl_execution_evidence_source_snapshot.v1",
  source_id: "alpaca.tqqq_shadow_audit",
  generated_at: controlNow,
  computed_at: controlNow,
  data_status: "ready",
  deployments: [{
    deployment_id: "tqqq_core_only_p2_v5.alpaca.shadow",
    strategy: {
      candidate_id: "tqqq_core_only_p2_v5",
      candidate_kind: "individual",
      domain: "us_equity",
      strategy_revision: "a".repeat(40),
    },
    target: { platform: "alpaca", environment: "shadow" },
    capabilities: { shadow: "available", paper: "unavailable" },
    evidence: { strategy: "verified", target_data: "verified", target_execution: "verified" },
    recommendation: { code: "owner_limited_live_canary_decision", reason_code: "paper_not_supported" },
  }],
  errors: [],
};
const unauthorizedExecutionEvidenceRead = await worker.fetch(
  new Request("https://switch.example/api/execution-evidence"),
  executionEvidenceEnv,
);
assert.equal(unauthorizedExecutionEvidenceRead.status, 401);
const wrongExecutionEvidenceToken = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-execution-evidence-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${controlSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(executionEvidenceSourcePayload),
  }),
  executionEvidenceEnv,
);
assert.equal(wrongExecutionEvidenceToken.status, 401);
const invalidCanaryEvidence = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-execution-evidence-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${executionEvidenceSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...executionEvidenceSourcePayload,
      deployments: [{
        ...executionEvidenceSourcePayload.deployments[0],
        evidence: { ...executionEvidenceSourcePayload.deployments[0].evidence, target_execution: "pending" },
      }],
    }),
  }),
  executionEvidenceEnv,
);
assert.equal(invalidCanaryEvidence.status, 400);
const invalidPaperRecommendation = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-execution-evidence-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${executionEvidenceSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...executionEvidenceSourcePayload,
      deployments: [{
        ...executionEvidenceSourcePayload.deployments[0],
        recommendation: { code: "run_autonomous_paper", reason_code: "paper_execution_evidence_needed" },
      }],
    }),
  }),
  executionEvidenceEnv,
);
assert.equal(invalidPaperRecommendation.status, 400);
const executionEvidenceSync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-execution-evidence-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${executionEvidenceSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(executionEvidenceSourcePayload),
  }),
  executionEvidenceEnv,
);
assert.equal(executionEvidenceSync.status, 200);
assert.equal((await executionEvidenceSync.json()).deployment_count, 1);
const executionEvidenceRead = await worker.fetch(
  new Request("https://switch.example/api/execution-evidence", { headers: executionEvidenceCookieHeaders }),
  executionEvidenceEnv,
);
assert.equal(executionEvidenceRead.status, 200);
const executionEvidencePayload = await executionEvidenceRead.json();
assert.equal(executionEvidencePayload.data_status, "ready");
assert.deepEqual(executionEvidencePayload.summary, {
  deployment_count: 1, autonomous_shadow: 0, autonomous_paper: 0, owner_canary_decision: 1, parked: 0,
});
assert.equal(executionEvidencePayload.deployments[0].deployment.target.platform, "alpaca");
assert.equal(executionEvidencePayload.policy.execution_evidence_read_only, true);
assert.equal(executionEvidencePayload.policy.p6_owner_decision_required, true);
assert.equal(executionEvidencePayload.policy.limited_live_canary_active, false);

const executionReceiptObservedAt = controlNow.replace(/\.\d{3}Z$/, "Z");
const executionReceiptEvidenceSourcePayload = {
  schema_version: "qsl_execution_evidence_source_snapshot.v1",
  source_id: "longbridge.execution_receipt",
  generated_at: controlNow,
  computed_at: controlNow,
  data_status: "ready",
  deployments: [{
    deployment_id: "soxl_soxx_trend_income.longbridge.paper",
    strategy: {
      candidate_id: "soxl_soxx_trend_income",
      candidate_kind: "individual",
      domain: "us_equity",
      strategy_revision: "b".repeat(40),
    },
    target: { platform: "longbridge", environment: "paper" },
    capabilities: { shadow: "unknown", paper: "unknown" },
    evidence: { strategy: "verified", target_data: "pending", target_execution: "verified" },
    recommendation: { code: "parked", reason_code: "target_execution_receipt_observed" },
    execution_receipt: {
      outcome: "filled",
      broker_confirmation: "filled",
      observed_at: executionReceiptObservedAt,
    },
  }],
  errors: [],
};
const invalidExecutionReceiptEvidence = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-execution-evidence-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${executionEvidenceSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...executionReceiptEvidenceSourcePayload,
      deployments: [{
        ...executionReceiptEvidenceSourcePayload.deployments[0],
        execution_receipt: {
          ...executionReceiptEvidenceSourcePayload.deployments[0].execution_receipt,
          broker_confirmation: "not_observed",
        },
      }],
    }),
  }),
  executionEvidenceEnv,
);
assert.equal(invalidExecutionReceiptEvidence.status, 400);
const executionReceiptEvidenceSync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-execution-evidence-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${executionEvidenceSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(executionReceiptEvidenceSourcePayload),
  }),
  executionEvidenceEnv,
);
assert.equal(executionReceiptEvidenceSync.status, 200);
const executionReceiptEvidenceRead = await worker.fetch(
  new Request("https://switch.example/api/execution-evidence", { headers: executionEvidenceCookieHeaders }),
  executionEvidenceEnv,
);
const executionReceiptEvidencePayload = await executionReceiptEvidenceRead.json();
const receiptDeployment = executionReceiptEvidencePayload.deployments.find(
  (entry) => entry.deployment.deployment_id === "soxl_soxx_trend_income.longbridge.paper",
);
assert.deepEqual(receiptDeployment.deployment.execution_receipt, {
  outcome: "filled",
  broker_confirmation: "filled",
  observed_at: executionReceiptObservedAt,
});

const runtimeTargetLifecycleSourcePayload = {
  schema_version: "qsl_runtime_target_lifecycle_source_snapshot.v1",
  source_id: "longbridge.sg",
  generated_at: controlNow,
  computed_at: controlNow,
  data_status: "ready",
  targets: [{
    target_id: "longbridge.sg",
    target: { platform: "longbridge", configured_state: "disabled", execution_mode: "dry_run" },
    monitoring: { runtime_guard: "pass", execution_heartbeat: "not_applicable" },
    disposition: { code: "continue_disabled_validation", reason_code: "target_intentionally_disabled" },
    no_order: true,
  }, {
    target_id: "schwab.primary",
    target: { platform: "schwab", configured_state: "enabled", execution_mode: "live" },
    monitoring: { runtime_guard: "pass", execution_heartbeat: "pass" },
    disposition: { code: "continue_enabled_monitoring", reason_code: "none" },
    no_order: true,
  }, {
    target_id: "firstrade.primary",
    target: { platform: "firstrade", configured_state: "enabled", execution_mode: "live" },
    monitoring: { runtime_guard: "pass", execution_heartbeat: "not_due" },
    disposition: { code: "continue_enabled_monitoring", reason_code: "none" },
    no_order: true,
  }],
  errors: [],
};
const invalidDisabledTargetLifecycle = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-runtime-target-lifecycle-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${executionEvidenceSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...runtimeTargetLifecycleSourcePayload,
      targets: [{
        ...runtimeTargetLifecycleSourcePayload.targets[0],
        monitoring: { runtime_guard: "pass", execution_heartbeat: "pass" },
      }],
    }),
  }),
  executionEvidenceEnv,
);
assert.equal(invalidDisabledTargetLifecycle.status, 400);
const runtimeTargetLifecycleSync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-runtime-target-lifecycle-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${executionEvidenceSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(runtimeTargetLifecycleSourcePayload),
  }),
  executionEvidenceEnv,
);
assert.equal(runtimeTargetLifecycleSync.status, 200);
assert.equal((await runtimeTargetLifecycleSync.json()).target_count, 3);
const runtimeTargetLifecycleRead = await worker.fetch(
  new Request("https://switch.example/api/runtime-target-lifecycle", { headers: executionEvidenceCookieHeaders }),
  executionEvidenceEnv,
);
assert.equal(runtimeTargetLifecycleRead.status, 200);
const runtimeTargetLifecyclePayload = await runtimeTargetLifecycleRead.json();
assert.equal(runtimeTargetLifecyclePayload.data_status, "ready");
assert.deepEqual(runtimeTargetLifecyclePayload.summary, { target_count: 3, enabled: 2, disabled: 1, attention: 0 });
const disabledLifecycleTarget = runtimeTargetLifecyclePayload.targets.find((entry) => entry.target.target_id === "longbridge.sg");
assert.equal(disabledLifecycleTarget.target.disposition.code, "continue_disabled_validation");
assert.deepEqual(disabledLifecycleTarget.execution_observation, {
  code: "not_applicable",
  order_or_fill_evidence: "not_collected",
});
const monitoredLifecycleTarget = runtimeTargetLifecyclePayload.targets.find((entry) => entry.target.target_id === "schwab.primary");
assert.deepEqual(monitoredLifecycleTarget.execution_observation, {
  code: "monitoring_only",
  order_or_fill_evidence: "not_collected",
});
const notDueLifecycleTarget = runtimeTargetLifecyclePayload.targets.find((entry) => entry.target.target_id === "firstrade.primary");
assert.deepEqual(notDueLifecycleTarget.execution_observation, {
  code: "not_due",
  order_or_fill_evidence: "not_collected",
});
assert.equal(runtimeTargetLifecyclePayload.policy.no_order, true);
assert.equal(runtimeTargetLifecyclePayload.policy.execution_observation_read_only, true);
assert.equal(runtimeTargetLifecyclePayload.policy.order_or_fill_evidence, "not_collected");

const researchTaskSyncValue = ["research", "task", "sync"].join("-");
const researchTaskEnv = { ...controlEnv, RESEARCH_TASK_SYNC_TOKEN: researchTaskSyncValue };
const researchTaskCookie = await __test.makeSession("health-user", [], researchTaskEnv);
const researchTaskCookieHeaders = { Cookie: `qsl_switch_session=${researchTaskCookie}` };
const researchTask = {
  schema: "qsl.research_task.v1",
  task_id: "watcher-tqqq-core-only-p2-v5",
  created_at: "2026-08-20T00:00:00Z",
  digest_algorithm: "sha256",
  task_type: "strategy_diagnosis",
  target: {
    candidate_id: "tqqq_core_only_p2_v5",
    candidate_kind: "individual",
    domain: "us_equity",
    repository: "QuantStrategyLab/UsEquityStrategies",
    strategy_revision: "a".repeat(40),
  },
  evidence: {
    p1_input_digest: "b".repeat(64),
    p2_config_digest: "c".repeat(64),
    p3_evidence_id: "d".repeat(64),
    producer_revision: "e".repeat(40),
  },
  experiment: {
    objective: "diagnose_degradation",
    hypothesis: "Diagnose the verified degradation with one bounded offline comparison.",
    parameter_bounds_sha256: null,
    max_runs: 1,
    max_wall_seconds: 3600,
  },
  authority: { research_only: true, no_order: true, size_zero_required: true, p4_p5_p6_authorized: false },
  task_sha256: "",
};
researchTask.task_sha256 = await __test.calculateResearchTaskSha256(researchTask);
const researchTaskSourcePayload = {
  schema_version: "qsl_research_task_source_snapshot.v1",
  source_id: "aiaudit.strategy_optimization_watcher",
  generated_at: controlNow,
  computed_at: controlNow,
  data_status: "ready",
  tasks: [researchTask],
  errors: [],
};
const unauthorizedResearchTaskSync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-research-task-source", {
    method: "POST",
    headers: { Authorization: "Bearer invalid", "Content-Type": "application/json" },
    body: JSON.stringify(researchTaskSourcePayload),
  }),
  researchTaskEnv,
);
assert.equal(unauthorizedResearchTaskSync.status, 401);
const invalidResearchTaskSync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-research-task-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${researchTaskSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...researchTaskSourcePayload, tasks: [{ ...researchTask, authority: { ...researchTask.authority, no_order: false } }] }),
  }),
  researchTaskEnv,
);
assert.equal(invalidResearchTaskSync.status, 400);
const researchTaskSync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-research-task-source", {
    method: "POST",
    headers: { Authorization: `Bearer ${researchTaskSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(researchTaskSourcePayload),
  }),
  researchTaskEnv,
);
assert.equal(researchTaskSync.status, 200);
assert.equal((await researchTaskSync.json()).task_count, 1);
const researchTaskRead = await worker.fetch(
  new Request("https://switch.example/api/research-tasks", { headers: researchTaskCookieHeaders }),
  researchTaskEnv,
);
assert.equal(researchTaskRead.status, 200);
const researchTaskReadPayload = await researchTaskRead.json();
assert.equal(researchTaskReadPayload.data_status, "ready");
assert.equal(researchTaskReadPayload.summary.task_count, 1);
assert.equal(researchTaskReadPayload.tasks[0].task.task_id, researchTask.task_id);
assert.equal(researchTaskReadPayload.policy.no_order, true);
assert.ok(indexHtml.includes('requestJson("/api/research-tasks")'));

// M0 is a closed, read-only research ingress.  These assertions intentionally
// exercise only its transport/KV boundary: they must never imply a selector,
// strategy, platform, dispatch, runtime, or broker action.
const m0LedgerStore = new Map();
const m0LedgerPutOptions = [];
const m0LedgerKv = {
  async get(key) { return m0LedgerStore.get(key) || null; },
  async put(key, value, options) {
    m0LedgerStore.set(key, value);
    m0LedgerPutOptions.push({ key, options });
  },
};
const m0ResearchSyncValue = ["m0", "research", "sync"].join("-");
const m0ResearchEnv = {
  ...controlEnv,
  M0_RESEARCH_SYNC_TOKEN: m0ResearchSyncValue,
  STRATEGY_SWITCH_CONFIG: m0LedgerKv,
};
const m0ResearchCookie = await __test.makeSession("health-user", [], m0ResearchEnv);
const m0ResearchCookieHeaders = { Cookie: `qsl_switch_session=${m0ResearchCookie}` };
const m0RealDate = globalThis.Date;
const m0TestNow = m0RealDate.parse("2026-08-30T12:00:00Z");
globalThis.Date = class extends m0RealDate {
  constructor(...args) { super(...(args.length ? args : [m0TestNow])); }
  static now() { return m0TestNow; }
};
const m0Timestamp = (offsetMs) => new m0RealDate(m0TestNow + offsetMs).toISOString().replace(/\.\d{3}Z$/, "Z");
const m0GeneratedAt = m0Timestamp(-36 * 60 * 60 * 1000);
const m0ExpiryMs = 7 * 24 * 60 * 60 * 1000;
const m0ExpiresAt = new m0RealDate(m0RealDate.parse(m0GeneratedAt) + m0ExpiryMs).toISOString().replace(/\.\d{3}Z$/, "Z");
const m0ExpiredProjectionAt = new m0RealDate(m0RealDate.parse(m0ExpiresAt) + 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const m0RollbackGeneratedAt = m0Timestamp(-37 * 60 * 60 * 1000);
const m0RollbackExpiresAt = new m0RealDate(m0RealDate.parse(m0RollbackGeneratedAt) + m0ExpiryMs).toISOString().replace(/\.\d{3}Z$/, "Z");
const m0ResearchLedger = {
  schema_version: "qsl_m0_research_ledger.v1",
  generated_at: m0GeneratedAt,
  computed_at: m0GeneratedAt,
  data_status: "ready",
  summary: {
    subject_count: 1,
    observation_count: 1,
    fresh_observation_count: 1,
    stale_observation_count: 0,
    unknown_observation_count: 0,
    horizon_conflict_count: 0,
    historical_stale_horizon_drift_count: 0,
  },
  subjects: [{
    subject: { kind: "theme_context", identifier: "semiconductors" },
    observations: [{
      source_ids: ["quant-advisor-research"],
      source_report_digest: "a".repeat(64),
      source_entry_digest: "b".repeat(64),
      hypothesis_id: "m0-semiconductors-001",
      as_of: m0GeneratedAt.slice(0, 10),
      generated_at: m0GeneratedAt,
      expires_at: m0ExpiresAt,
      research_context: {
        state: "candidate",
        primary_horizon: "medium",
        suitable_horizons: ["medium", "long"],
        source_confidence: "medium",
        source_style: "mixed_research",
        theme_ids: ["semiconductors"],
      },
      freshness: { status: "fresh", age_seconds: 0 },
    }],
    horizon_conflict: { status: "none", primary_horizons: ["medium"] },
    historical_stale_horizon_drift: { status: "none", primary_horizons: [] },
  }],
  policy: {
    authority: "research_only",
    no_order: true,
    permitted_next_step: "research_validation_only",
    notice: "Read-only M0 research ledger; it cannot select, route, or execute a strategy.",
  },
  errors: [],
};
const m0ResearchLedgerSha = await __test.calculateM0ResearchLedgerSha256(m0ResearchLedger);
const m0ResearchEnvelope = {
  schema_version: "qsl_m0_research_publisher_envelope.v1",
  producer: {
    repository: "QuantStrategyLab/QuantRuntimeSettings",
    revision: "c".repeat(40),
  },
  source_artifact: {
    repository: "QuantStrategyLab/QuantAdvisorResearch",
    revision: "c".repeat(40),
    run_id: "123456789",
    artifact_id: "M0:Research/Ledger-v1",
    sha256: "f".repeat(64),
  },
  ledger_sha256: m0ResearchLedgerSha,
  ledger: m0ResearchLedger,
};
assert.ok(
  new TextEncoder().encode(JSON.stringify(m0ResearchEnvelope)).byteLength
    <= m0ResearchPublisherEnvelopeSchema["x-qsl-canonical-utf8-max-bytes"],
);
const unauthorizedM0ResearchRead = await worker.fetch(
  new Request("https://switch.example/api/m0-research"),
  m0ResearchEnv,
);
assert.equal(unauthorizedM0ResearchRead.status, 401);
const wrongM0ResearchToken = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-m0-research-ledger", {
    method: "POST",
    headers: { Authorization: "Bearer wrong", "Content-Type": "application/json" },
    body: JSON.stringify(m0ResearchEnvelope),
  }),
  m0ResearchEnv,
);
assert.equal(wrongM0ResearchToken.status, 401);
await assert.rejects(
  () => __test.normalizeM0ResearchLedgerTransport({ ...m0ResearchEnvelope, unexpected: true }),
  /has invalid fields/,
);
await assert.rejects(
  () => __test.normalizeM0ResearchLedgerTransport({ ...m0ResearchEnvelope, ledger_sha256: "d".repeat(64) }),
  /ledger_sha256 mismatch/,
);
const m0ResearchSync = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-m0-research-ledger", {
    method: "POST",
    headers: { Authorization: `Bearer ${m0ResearchSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(m0ResearchEnvelope),
  }),
  m0ResearchEnv,
);
assert.equal(m0ResearchSync.status, 200);
const m0ResearchSyncPayload = await m0ResearchSync.json();
assert.equal(m0ResearchSyncPayload.replayed, false);
assert.equal(m0ResearchSyncPayload.no_order, true);
assert.ok(m0LedgerStore.has("m0_research_ledger_current"));
assert.ok(m0LedgerStore.has(`m0_research_ledger_archive:${m0ResearchLedgerSha}`));
const storedM0ResearchCurrent = JSON.parse(m0LedgerStore.get("m0_research_ledger_current"));
assert.equal(
  Date.parse(storedM0ResearchCurrent.expires_at) - Date.parse(storedM0ResearchCurrent.stored_at),
  14 * 24 * 60 * 60 * 1000,
);
const m0ResearchLedgerWrites = m0LedgerPutOptions.filter((entry) => (
  entry.key === "m0_research_ledger_current" || entry.key.startsWith("m0_research_ledger_archive:")
));
assert.equal(m0ResearchLedgerWrites.length, 2);
assert.ok(m0ResearchLedgerWrites.every((entry) => entry.options?.expirationTtl === 14 * 24 * 60 * 60));
const m0ExactSourceReplay = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-m0-research-ledger", {
    method: "POST",
    headers: { Authorization: `Bearer ${m0ResearchSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(m0ResearchEnvelope),
  }),
  m0ResearchEnv,
);
assert.equal(m0ExactSourceReplay.status, 200);
const m0ExactSourceReplayPayload = await m0ExactSourceReplay.json();
assert.equal(m0ExactSourceReplayPayload.replayed, true);
assert.equal(m0ExactSourceReplayPayload.no_order, true);
assert.equal(m0LedgerPutOptions.filter((entry) => (
  entry.key === "m0_research_ledger_current" || entry.key.startsWith("m0_research_ledger_archive:")
)).length, 2);
const m0ResearchRead = await worker.fetch(
  new Request("https://switch.example/api/m0-research", { headers: m0ResearchCookieHeaders }),
  m0ResearchEnv,
);
assert.equal(m0ResearchRead.status, 200);
const m0ResearchPayload = await m0ResearchRead.json();
assert.equal(m0ResearchPayload.schema_version, "qsl_m0_research_dashboard.v1");
assert.equal(m0ResearchPayload.source_ledger_sha256, m0ResearchLedgerSha);
assert.equal(m0ResearchPayload.source_generated_at, m0ResearchLedger.generated_at);
assert.equal(m0ResearchPayload.source_computed_at, m0ResearchLedger.computed_at);
assert.match(m0ResearchPayload.viewed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
assert.equal(m0ResearchPayload.data_status, "ready");
assert.equal(m0ResearchPayload.policy.no_order, true);
assert.equal(m0ResearchPayload.subjects[0].subject.identifier, "semiconductors");
const qar66SourceSnapshotPath = resolve(root, "tests/fixtures/qar66-m0-research-source-snapshot.json");
const qrsCanonicalM0PublisherBody = buildQrsCanonicalM0PublisherBody(qar66SourceSnapshotPath);
assert.ok(qrsCanonicalM0PublisherBody.byteLength <= m0ResearchPublisherEnvelopeSchema["x-qsl-canonical-utf8-max-bytes"]);
const qrsCanonicalM0Envelope = JSON.parse(qrsCanonicalM0PublisherBody.toString("utf8"));
assert.deepEqual(
  Object.keys(qrsCanonicalM0Envelope.ledger.summary),
  [...Object.keys(qrsCanonicalM0Envelope.ledger.summary)].sort(),
);
await __test.normalizeM0ResearchLedgerTransport(qrsCanonicalM0Envelope);
const qrsCanonicalM0Post = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-m0-research-ledger", {
    method: "POST",
    headers: { Authorization: `Bearer ${m0ResearchSyncValue}`, "Content-Type": "application/json" },
    body: qrsCanonicalM0PublisherBody,
  }),
  m0ResearchEnv,
);
assert.equal(qrsCanonicalM0Post.status, 200);
assert.equal((await qrsCanonicalM0Post.json()).no_order, true);
const m0ExpiredReadProjection = __test.projectM0ResearchDashboardForRead(
  m0ResearchLedger,
  m0ResearchLedgerSha,
  new Date(m0ExpiredProjectionAt),
);
assert.equal(m0ExpiredReadProjection.schema_version, "qsl_m0_research_dashboard.v1");
assert.equal(m0ExpiredReadProjection.source_ledger_sha256, m0ResearchLedgerSha);
assert.equal(m0ExpiredReadProjection.source_generated_at, m0ResearchLedger.generated_at);
assert.equal(m0ExpiredReadProjection.source_computed_at, m0ResearchLedger.computed_at);
assert.equal(m0ExpiredReadProjection.viewed_at, m0ExpiredProjectionAt);
assert.equal(m0ExpiredReadProjection.data_status, "stale");
assert.deepEqual(m0ExpiredReadProjection.summary, {
  subject_count: 1,
  observation_count: 1,
  fresh_observation_count: 0,
  stale_observation_count: 1,
  unknown_observation_count: 0,
  horizon_conflict_count: 0,
  historical_stale_horizon_drift_count: 0,
});
assert.equal(m0ExpiredReadProjection.subjects[0].observations[0].freshness.status, "stale");
assert.equal(m0ResearchLedger.data_status, "ready");
assert.equal(m0ResearchLedger.subjects[0].observations[0].freshness.status, "fresh");
const m0ResearchReplay = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-m0-research-ledger", {
    method: "POST",
    headers: { Authorization: `Bearer ${m0ResearchSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify(m0ResearchEnvelope),
  }),
  m0ResearchEnv,
);
assert.equal(m0ResearchReplay.status, 409);
const m0RollbackLedger = structuredClone(m0ResearchLedger);
m0RollbackLedger.generated_at = m0RollbackGeneratedAt;
m0RollbackLedger.computed_at = m0RollbackGeneratedAt;
m0RollbackLedger.subjects[0].observations[0].as_of = m0RollbackGeneratedAt.slice(0, 10);
m0RollbackLedger.subjects[0].observations[0].generated_at = m0RollbackGeneratedAt;
m0RollbackLedger.subjects[0].observations[0].expires_at = m0RollbackExpiresAt;
const m0RollbackSha = await __test.calculateM0ResearchLedgerSha256(m0RollbackLedger);
const m0ResearchRollback = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-m0-research-ledger", {
    method: "POST",
    headers: { Authorization: `Bearer ${m0ResearchSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...m0ResearchEnvelope,
      ledger_sha256: m0RollbackSha,
      ledger: m0RollbackLedger,
      source_artifact: {
        ...m0ResearchEnvelope.source_artifact,
        run_id: "123456790",
        sha256: "e".repeat(64),
      },
    }),
  }),
  m0ResearchEnv,
);
assert.equal(m0ResearchRollback.status, 409);
const m0InvalidNewPayload = await worker.fetch(
  new Request("https://switch.example/api/internal/sync-m0-research-ledger", {
    method: "POST",
    headers: { Authorization: `Bearer ${m0ResearchSyncValue}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...m0ResearchEnvelope, ledger_sha256: "e".repeat(64) }),
  }),
  m0ResearchEnv,
);
assert.equal(m0InvalidNewPayload.status, 400);
const m0CurrentAfterInvalid = await worker.fetch(
  new Request("https://switch.example/api/m0-research", { headers: m0ResearchCookieHeaders }),
  m0ResearchEnv,
);
assert.equal((await m0CurrentAfterInvalid.json()).data_status, "ready");
m0LedgerStore.set("m0_research_ledger_current", "{not-json");
const m0DamagedCurrentRead = await worker.fetch(
  new Request("https://switch.example/api/m0-research", { headers: m0ResearchCookieHeaders }),
  m0ResearchEnv,
);
const m0DamagedCurrentPayload = await m0DamagedCurrentRead.json();
assert.equal(m0DamagedCurrentPayload.schema_version, "qsl_m0_research_dashboard.v1");
assert.equal(m0DamagedCurrentPayload.source_ledger_sha256, null);
assert.equal(m0DamagedCurrentPayload.source_generated_at, null);
assert.equal(m0DamagedCurrentPayload.source_computed_at, null);
assert.equal(m0DamagedCurrentPayload.data_status, "unavailable");
assert.deepEqual(m0DamagedCurrentPayload.subjects, []);
globalThis.Date = m0RealDate;
