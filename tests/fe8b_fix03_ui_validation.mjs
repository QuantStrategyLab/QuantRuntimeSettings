import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

import { accountExecutionEvidence, strategyTargetExecution } from "../web/strategy-switch-console/application/console_api/strategy_execution.js";

const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "fe8b-fix03-"));
try {
  const outfile = join(directory, "render.cjs");
  await build({
    stdin: { resolveDir: root, contents: `import { createElement as h } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { I18nProvider } from './src/i18n';
      import { AccountDirectoryContext, ScopeContext } from './src/app/context';
      import { AppShell } from './src/app/AppShell';
      import HealthPage from './src/pages/health/HealthPage';
      import StrategiesPage from './src/pages/strategies/StrategiesPage';
      import { AssetsCard } from './src/pages/performance/AssetsCard';
      import { AccountGroups } from './src/components/AccountGroups';
      const components = { shell: AppShell, health: HealthPage, strategies: StrategiesPage, assets: AssetsCard, groups: AccountGroups };
      export const render = (language, component, props = {}, config = null, state = { phase: 'loading' }) => {
        globalThis.__fix03State = state;
        return renderToStaticMarkup(h(I18nProvider, { language },
          h(AccountDirectoryContext.Provider, { value: config },
            h(ScopeContext.Provider, { value: { scope: 'longbridge:paper', options: [], setScope: () => {} } },
              h(components[component], props)))));
      };` },
    bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic",
    loader: { ".css": "empty" }, define: { "import.meta.env": "{}" },
    plugins: [{ name: "controlled-read", setup(builder) {
      builder.onLoad({ filter: /\/lib\/hooks\.ts$/ }, () => ({ contents: "export const useApi = () => ({ ...globalThis.__fix03State, reload: () => {} });", loader: "js" }));
    } }],
  });
  const ui = createRequire(import.meta.url)(outfile);
  const ready = data => ({ phase: "ready", data });
  const account = { platform: "longbridge", account_alias: "paper", execution_mode: "live", dry_run_only: false, live_status: "configured_live" };
  const configFor = environment => ({ accountOptions: { longbridge: [{ key: "paper", broker_environment: environment }] } });
  const summary = account => ({ status: "partial", as_of: null, strategies: [{ profile: "russell_top50_leader_rotation", domain: "us_equity", allowed_execution_modes: [], configured_accounts: [account], health_score: null, health_status: null, status: "not_connected", unavailable_reason: "strategy_health_not_connected" }] });

  test("health shell removes account selector while overview retains it; global explanation appears once", () => {
    for (const language of ["zh", "en"]) {
      for (const page of ["health", "overview"]) {
        const html = ui.render(language, "shell", { page, todoCount: null, onLogout: () => {}, children: "content" });
        assert.equal(html.includes('class="scope-switcher"'), page === "overview");
      }
      const health = ui.render(language, "health");
      const note = language === "zh" ? "本页展示全部平台与账户的运行状态。" : "This page shows runtime status for all platforms and accounts.";
      assert.equal(health.split(note).length - 1, 1);
    }
  });

  test("native-currency totals label amounts without completing partial or missing data", () => {
    const totals = [
      { currency: "USD", total: 123.45, status: "partial", account_count: 2, expected_account_count: 8, excluded_account_count: 6, as_of: null, unavailable_reason: "incomplete_account_coverage" },
      { currency: "USDT", total: null, status: "unknown", account_count: 0, expected_account_count: 1, as_of: null },
    ];
    const data = { status: "partial", currency: null, per_currency: totals, as_of: null, unavailable_reason: null, curve_status: "unavailable", curve_unavailable_reason: "no_cashflow_data", points: [] };
    const original = structuredClone(data);
    for (const language of ["zh", "en"]) {
      const html = ui.render(language, "assets", { scope: "all", range: "YTD", epoch: 0 }, null, ready(data));
      assert.ok(html.includes(language === "zh" ? "USD 资产小计" : "USD asset subtotal"));
      assert.ok(html.includes(language === "zh" ? "USDT 资产合计" : "USDT asset total"));
      assert.ok(html.includes("123.45"));
      assert.ok(html.includes("—"));
      assert.ok(html.includes(language === "zh" ? "部分账户未纳入合计" : "Some accounts are not included in the total"));
      assert.ok(html.includes(language === "zh" ? "合计含 2 个账户" : "Total includes 2 accounts"));
      assert.ok(html.includes(language === "zh" ? "缺少完整出入金记录" : "Complete cash-flow records are missing"));
      assert.ok(!html.includes("USDT 0"));
    }
    assert.deepEqual(data, original);
  });

  test("execution display requires explicit configuration, and old or conflicting inputs stay unknown", () => {
    for (const language of ["zh", "en"]) {
      const labels = language === "zh" ? { paper: "模拟", live: "实盘", dry_run: "演练", unknown: "执行模式未知" }
        : { paper: "Paper", live: "Live", dry_run: "Dry run", unknown: "Execution mode unknown" };
      const explicit = (environment, target) => ({ ...account, execution_evidence: accountExecutionEvidence(
        { broker_environment: environment }, { source: "RUNTIME_TARGET_JSON", strategy_execution: strategyTargetExecution(target) }) });
      const cases = [
        [explicit("paper", account), configFor("paper"), "paper"],
        [explicit("live", account), configFor("live"), "live"],
        [explicit("live", { execution_mode: "dry_run" }), configFor("live"), "dry_run"],
        [explicit("live", { execution_mode: "live", dry_run_only: true }), configFor("live"), "dry_run"],
        [explicit("live", { execution_mode: "paper" }), configFor("live"), "unknown"],
        [explicit(undefined, account), configFor("live"), "unknown"],
        [explicit("live", { execution_mode: "live" }), configFor("live"), "unknown"],
        [account, null, "unknown"], [account, configFor("paper"), "unknown"],
        [{ ...account, execution_mode: "paper", mode_source: "STRATEGY_PROFILE" }, configFor("paper"), "unknown"],
      ];
      for (const [row, config, expected] of cases) {
        const before = structuredClone(row);
        const html = ui.render(language, "strategies", {}, config, ready(summary(row)));
        assert.match(html, new RegExp(`class="strategy-execution-account"[\\s\\S]*?>${labels[expected]}<`));
        if (expected !== "live") assert.ok(!html.match(/class="strategy-execution-account"([\s\S]*?)<\/div>/)[1].includes('class="badge badge-warn"'));
        assert.deepEqual(row, before);
      }
      const paperConfig = configFor("paper");
      paperConfig.currentStrategies = { longbridge: { paper: { execution_evidence: explicit("paper", account).execution_evidence } } };
      const groups = ui.render(language, "groups", { accounts: [account], config: paperConfig, onSelect: () => {} });
      assert.match(groups, new RegExp(`>${labels.paper}<`, "i"));
      const missing = ui.render(language, "groups", { accounts: [account], config: { currentStrategies: { longbridge: { paper: { execution_mode: "live" } } } }, onSelect: () => {} });
      assert.ok(missing.includes(labels.unknown));
      assert.ok(!missing.includes(`>${labels.live}<`));
    }
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
