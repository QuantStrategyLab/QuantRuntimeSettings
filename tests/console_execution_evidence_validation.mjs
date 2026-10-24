import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { accountExecutionEvidence, strategyTargetExecution } from "../web/strategy-switch-console/application/console_api/strategy_execution.js";
import { strategySummary } from "../web/strategy-switch-console/application/console_api/operations.js";
import { __test } from "../web/strategy-switch-console/worker.js";

const observedAt = "2026-10-22T22:00:00Z";
const current = target => ({ source: "RUNTIME_TARGET_JSON", strategy_execution: strategyTargetExecution(target) });
const live = current({ execution_mode: "live", dry_run_only: false });

test("explicit configuration and broker evidence, without runtime authority", () => {
  for (const [environment, target, value] of [
    ["live", live, "live"], ["paper", live, "paper"],
    ["paper", current({ execution_mode: "paper" }), "paper"],
    ["live", current({ execution_mode: "dry_run" }), "dry_run"],
    ["live", current({ execution_mode: "live", dry_run_only: true }), "dry_run"],
  ]) {
    const evidence = accountExecutionEvidence({ broker_environment: environment }, target, { observedAt });
    assert.equal(evidence.value, value);
    assert.equal(evidence.status, "confirmed");
    assert.equal(evidence.observed_at, observedAt);
    assert.equal(evidence.runtime_observation_status, "unknown");
    assert.equal(evidence.configuration_source, "RUNTIME_TARGET_JSON");
  }
});

test("missing, inconsistent and alias-only evidence never becomes a definite mode", () => {
  for (const [option, target, reason] of [
    [{ key: "live", label: "实盘", default_execution_mode: "live" }, live, "broker_environment_missing"],
    [{ broker_environment: "live" }, { source: "STRATEGY_PROFILE", execution_mode: "paper" }, "execution_config_missing"],
    [{ broker_environment: "live" }, current({ execution_mode: "live" }), "dry_run_flag_missing"],
    [{ broker_environment: "live" }, current({ execution_mode: "paper" }), "environment_conflict"],
    [{ broker_environment: "live" }, current({ execution_mode: "sandbox" }), "execution_config_missing"],
  ]) {
    const before = structuredClone({ option, target });
    const result = accountExecutionEvidence(option, target);
    assert.equal(result.value, "unknown");
    assert.ok(result.reason_codes.includes(reason));
    assert.equal(result.observed_at, null);
    assert.deepEqual({ option, target }, before);
  }
});

test("reader failures, missing reader, old alias inference and pagination failures remain unknown", async () => {
  const originalFetch = globalThis.fetch;
  const options = { longbridge: [{ key: "paper", target_name: "paper", broker_environment: "paper" }] };
  try {
    const missing = await __test.loadCurrentStrategies(options, {});
    assert.equal(missing.longbridge.paper.execution_evidence.status, "not_connected");
    for (const status of [403, 500]) {
      globalThis.fetch = async () => Response.json({ message: "private upstream body" }, { status });
      const result = await __test.loadCurrentStrategies(options, { RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic" });
      const evidence = result.longbridge.paper.execution_evidence;
      assert.equal(evidence.value, "unknown");
      assert.equal(evidence.status, status === 403 ? "permission_denied" : "read_failed");
      assert.ok(evidence.observed_at);
      assert.ok(!JSON.stringify(result).includes("private upstream body"));
    }
    globalThis.fetch = async url => String(url).includes("page=2")
      ? Response.json({}, { status: 500 })
      : Response.json({ variables: [{ name: "RUNTIME_TARGET_JSON", value: JSON.stringify({ execution_mode: "live", dry_run_only: false }) }] }, { headers: { Link: '<https://api.github.com/ignored>; rel="next"' } });
    const failedPage = await __test.loadCurrentStrategies(options, { RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic" });
    assert.equal(failedPage.longbridge.paper.execution_evidence.status, "read_failed");
    assert.equal(failedPage.longbridge.paper.execution_evidence.execution_mode, null);
    globalThis.fetch = async () => Response.json({ variables: [{ name: "STRATEGY_PROFILE", value: "synthetic" }] });
    const legacy = await __test.loadCurrentStrategies(options, { RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic" });
    assert.equal(legacy.longbridge.paper.execution_mode, "paper", "legacy interface retained");
    assert.equal(legacy.longbridge.paper.execution_evidence.value, "unknown", "new display ignores alias inference");
  } finally { globalThis.fetch = originalFetch; }
});

test("summary keeps configuration check time distinct from health time and authority", async () => {
  const evidence = accountExecutionEvidence({ broker_environment: "live" }, live, { observedAt });
  const body = await strategySummary(new Request("https://console.example/api/strategies/summary"), {}, {
    profiles: async () => [{ profile: "synthetic", domain: "us_equity" }],
    health: async () => Response.json({ data_status: "ready", computed_at: "2026-10-23T00:00:00Z", strategies: [] }),
  }, [{ platform: "ibkr", key: "synthetic" }], { ibkr: { synthetic: { ...live, strategy_profile: "synthetic", execution_evidence: evidence } } });
  assert.deepEqual(body.strategies[0].configured_accounts[0].execution_evidence, evidence);
  assert.notEqual(body.as_of, evidence.observed_at);
  assert.equal(body.execution_authority_granted, false);
  assert.equal(body.no_order, true);
});

test("real bilingual account group renders reasons, source and read time", async () => {
  const directory = await mkdtemp(join(tmpdir(), "execution-evidence-"));
  try {
    const outfile = join(directory, "ui.cjs");
    await build({ stdin: { contents: `import { createElement as h } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { AccountGroups } from './src/components/AccountGroups';
      import { ExecutionEvidence } from './src/components/ExecutionEvidence';
      import { I18nProvider } from './src/i18n';
      export const render = (language, evidence) => renderToStaticMarkup(h(I18nProvider, { language },
        h(AccountGroups, { accounts: [{ platform: 'ibkr', account_alias: 'synthetic', pending_draft_count: 0, pending_decision_count: null, last_change_at: null }],
          config: { currentStrategies: { ibkr: { synthetic: { execution_evidence: evidence } } } }, onSelect() {} })));
      export const renderEvidence = (language, evidence) => renderToStaticMarkup(h(I18nProvider, { language }, h(ExecutionEvidence, { evidence })));`,
      resolveDir: new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname },
      bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", define: { "import.meta.env": "{}" }, loader: { ".css": "empty" },
    });
    const ui = createRequire(import.meta.url)(outfile);
    const outsideDetails = html => html.replace(/<details[\s\S]*?<\/details>/g, "");
    const detailsText = html => [...html.matchAll(/<details[\s\S]*?<\/details>/g)].map(match => match[0]).join("");
    const visibleText = html => outsideDetails(html).replace(/<[^>]*>/g, " ");
    for (const [language, unknown, failed, missing] of [
      ["zh", "执行模式未知", "配置读取失败", "账户目录缺少明确的券商环境"],
      ["en", "Execution mode unknown", "Configuration read failed", "Account directory has no explicit broker environment"],
    ]) {
      const unknownEvidence = accountExecutionEvidence({}, live, { observedAt });
      const markup = ui.render(language, unknownEvidence);
      assert.ok(markup.includes(unknown)); assert.ok(markup.includes(missing));
      assert.ok(!markup.includes("badge-warn"));
      assert.ok(ui.render(language, accountExecutionEvidence({}, {}, { status: "read_failed", observedAt })).includes(failed));
      assert.ok(ui.render(language, undefined).includes(unknown));
      const unknownMarkup = ui.renderEvidence(language, unknownEvidence);
      assert.match(unknownMarkup, /badge-unknown/);
      assert.ok(visibleText(unknownMarkup).includes(unknown), "the unknown badge stays visible");
      assert.ok(!visibleText(unknownMarkup).includes(missing), "the long unknown reason is not default body copy");
      assert.ok(detailsText(unknownMarkup).includes(missing), "the long unknown reason stays in data notes");
      const unknownEnvironment = language === "zh" ? "券商环境：未知" : "Broker environment: Unknown";
      assert.ok(!visibleText(unknownMarkup).includes(unknownEnvironment), "unknown broker environment is not default body copy");
      assert.ok(detailsText(unknownMarkup).includes(unknownEnvironment), "unknown broker environment stays in data notes");
      const configOnly = language === "zh" ? "仅说明已读取的配置，当前运行及成交状态未验证。"
        : "Describes the configuration read; current runs and fills are unverified.";
      assert.ok(!visibleText(unknownMarkup).includes(configOnly), "configuration-only caveat stays in details");
      assert.ok(detailsText(unknownMarkup).includes(configOnly));
      assert.ok(detailsText(unknownMarkup).includes(language === "zh" ? "运行目标配置" : "Runtime target configuration"),
        "the configuration source stays in data notes");
      const definite = ui.renderEvidence(language, accountExecutionEvidence({ broker_environment: "live" }, live, { observedAt }));
      assert.match(definite, /badge-warn/);
      assert.ok(visibleText(definite).includes(language === "zh" ? "券商环境：实盘" : "Broker environment: Live"),
        "a known broker environment stays visible");
      assert.ok(definite.includes("2026"));
      assert.match(definite, /\d{2}:\d{2}/);
      assert.match(definite, /GMT/);
      assert.match(definite, new RegExp(`datetime="${observedAt}"`, "i"));
      assert.ok(detailsText(definite).includes(language === "zh" ? "运行目标配置" : "Runtime target configuration"),
        "the known configuration source stays reachable");
      assert.ok(detailsText(definite).includes(configOnly), "the configuration-only caveat stays reachable");
      assert.ok(!definite.includes("RUNTIME_TARGET_JSON"));
      assert.ok(!markup.includes("accounts.execution."));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
