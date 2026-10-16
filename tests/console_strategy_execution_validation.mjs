import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { strategySummary } from "../web/strategy-switch-console/application/console_api/operations.js";
import { strategyTargetExecution } from "../web/strategy-switch-console/application/console_api/strategy_execution.js";

// Synthetic configuration, never a runtime observation or authorization.
const account = { platform: "binance", key: "synthetic-legacy" };
const profile = { profile: "synthetic-rotation", domain: "crypto",
  allowed_execution_modes: ["paper", "dry_run"],
  live_continuity: { eligible: true, allowed_platforms: ["binance"] } };
const deps = { profiles: async () => [profile],
  health: async () => Response.json({ data_status: "unavailable", strategies: [] }) };
const request = new Request("https://console.example/api/strategies/summary");
const summarize = async (current, policy = profile) => {
  const body = await strategySummary(request, {}, { ...deps, profiles: async () => [policy] }, [account], {
    binance: { [account.key]: { strategy_profile: profile.profile, ...current } },
  });
  assert.equal(body.no_order, true);
  assert.equal(body.execution_authority_granted, false);
  assert.deepEqual(body.strategies[0].allowed_execution_modes, ["paper", "dry_run"]);
  return body.strategies[0].configured_accounts[0];
};
const live = { source: "RUNTIME_TARGET_JSON", execution_mode: "live", dry_run_only: false,
  strategy_execution: { execution_mode: "live", dry_run_only: false,
    continuation_reason: "legacy_live_continuation" } };
assert.deepEqual(strategyTargetExecution({ execution_mode: "live", dry_run_only: false,
  live_continuity: { baseline_kind: "legacy_authorized", state: "RECONCILE_ONLY", baseline_id: "private-not-to-export" } }),
live.strategy_execution, "a frozen reconciliation state describes configuration, never effective runtime permission");
assert.equal(strategyTargetExecution({ dry_run_only: false }).execution_mode, "unknown");
assert.equal(strategyTargetExecution({ execution_mode: "live", dry_run_only: "false" }).dry_run_only, null);
assert.equal(strategyTargetExecution({ execution_mode: "live", dry_run_only: true,
  live_continuity: { baseline_kind: "legacy_authorized" } }).continuation_reason, null);
const actual = await summarize(live);
assert.equal(actual.execution_mode, "live", "the card must preserve real-money exposure even when catalog live is blocked");
assert.equal(actual.live_status, "configured_live");
assert.equal(actual.continuation_reason, "legacy_live_continuation");
assert.equal(actual.mode_source, "RUNTIME_TARGET_JSON");
assert.equal(actual.runtime_observation_status, "unknown", "configuration is not proof of a current live run");
for (const [current, mode, status] of [
  [{ execution_mode: "paper", dry_run_only: false }, "paper", "not_live"],
  [{ execution_mode: "dry_run" }, "dry_run", "not_live"],
  [{ execution_mode: "live", dry_run_only: true }, "dry_run", "not_live"],
  [{ dry_run_only: true }, "dry_run", "not_live"],
  [{}, "unknown", "unknown"],
  [{ dry_run_only: false }, "unknown", "unknown"],
  [{ execution_mode: "invalid" }, "unknown", "unknown"],
  [{ execution_mode: "live" }, "live", "unknown"],
]) {
  const result = await summarize(current);
  assert.equal(result.execution_mode, mode);
  assert.equal(result.live_status, status);
  assert.equal(result.continuation_reason, null);
}
assert.equal((await summarize({ execution_mode: "live", dry_run_only: false })).continuation_reason, null,
  "catalog eligibility and a live target alone do not prove a legacy baseline");
assert.equal((await summarize(live, { ...profile, live_continuity: { eligible: false } })).continuation_reason, null);
assert.equal((await summarize(live, { ...profile, live_continuity: { eligible: true, allowed_platforms: ["other"] } })).continuation_reason, null);

// Render the actual card and dictionaries, including compatibility with old responses.
const directory = await mkdtemp(join(tmpdir(), "strategy-execution-"));
try {
  const outfile = join(directory, "render.cjs");
  await build({ stdin: { contents: `import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { StrategyCard } from './src/pages/strategies/StrategiesPage';
    import { I18nProvider } from './src/i18n';
    import { AccountDirectoryContext } from './src/app/context';
    export const render = (language, strategy) => renderToStaticMarkup(h(I18nProvider, { language },
      h(AccountDirectoryContext.Provider, { value: { strategyProfiles: [{ profile: 'synthetic-rotation',
        label_zh: '合成轮动策略', label_en: 'Synthetic rotation' }] } },
      h(StrategyCard, { strategy, summaryAsOf: null }))));`,
    resolveDir: new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname },
    bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", loader: { ".css": "empty" },
    define: { "import.meta.env": "{}" }, plugins: [{ name: "expose-card", setup(b) {
      b.onLoad({ filter: /\/StrategiesPage\.tsx$/ }, async ({ path }) => ({
        contents: await readFile(path, "utf8") + "\nexport { StrategyCard };", loader: "tsx" }));
    } }],
  });
  const ui = createRequire(import.meta.url)(outfile);
  const card = configured => ({ ...profile, configured_accounts: [configured], health_status: null,
    health_score: null, status: "not_connected", unavailable_reason: "strategy_health_not_connected" });
  for (const [language, labels] of [
    ["zh", ["实盘 · 沿用既有账户", "真实资金", "最近运行及成交状态未验证", "执行模式未知", "演练 · 不下单", "模拟"]],
    ["en", ["Live · legacy account continuation", "real money", "recent runs and fills are unverified", "Execution mode unknown", "Dry run · no orders", "Paper"]],
  ]) {
    const html = ui.render(language, card(actual));
    for (const text of labels.slice(0, 3)) assert.ok(html.includes(text), text);
    assert.match(html, /badge-warn/, "live exposure is prominent before expanding details");
    assert.doesNotMatch(html, /synthetic-rotation|strategies\.execution\./, "display names and translated copy only");
    const unknown = ui.render(language, card({ account_alias: account.key, platform: account.platform }));
    assert.ok(unknown.includes(labels[3]), "old or incomplete responses must not silently say paper");
    assert.ok(!unknown.includes(labels[0]));
    const dry = ui.render(language, card(await summarize({ execution_mode: "live", dry_run_only: true })));
    assert.ok(dry.includes(labels[4]));
    assert.ok(!dry.includes(labels[1]));
    const paper = ui.render(language, card(await summarize({ execution_mode: "paper", dry_run_only: false })));
    assert.ok(paper.includes(labels[5]));
    assert.ok(!paper.includes(labels[0]));
  }
} finally { await rm(directory, { recursive: true, force: true }); }
console.log("console_strategy_execution_validation: PASS");
