import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { performanceBlocks } from "../web/strategy-switch-console/application/console_api/performance.js";
const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "console-currency-"));
try {
  const outfile = join(directory, "render.cjs");
  await build({ stdin: { contents: `import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { I18nProvider } from './src/i18n';
    import { CurrencyTotals, FreshnessSummary } from './src/components/CurrencyTotals';
    import { SummaryCards } from './src/pages/performance/SummaryCards';
    import { AssetsCard } from './src/pages/performance/AssetsCard';
    import { AssetKpi } from './src/pages/overview/OverviewPage';
    const render = (language, component, props) => renderToStaticMarkup(h(I18nProvider, { language }, h(component, props)));
    export const totals = (language, totals, freshness) => render(language, CurrencyTotals, { totals, freshness });
    export const freshness = (language, counts) => render(language, FreshnessSummary, { counts });
    export const assets = language => render(language, AssetsCard, { scope: 'all', range: 'ALL', epoch: 0 });
    export const overview = language => render(language, AssetKpi, { state: globalThis.__currencyState });
    export const summary = language => render(language, SummaryCards, { scope: 'all', state: globalThis.__currencyState });`, resolveDir: root },
    bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" },
    plugins: [{ name: "controlled-read", setup(b) {
      b.onLoad({ filter: /\/lib\/hooks\.ts$/ }, () => ({ contents: "export const useApi = () => globalThis.__currencyState;", loader: "js" }));
      b.onLoad({ filter: /\/pages\/overview\/OverviewPage\.tsx$/ }, async ({ path }) => ({ contents: await readFile(path, "utf8") + "\nexport { AssetKpi };", loader: "tsx" }));
    } }],
  });
  const ui = createRequire(import.meta.url)(outfile);
  const blocks = performanceBlocks({ accounts: [
    { platform: "synthetic", account_key: "alpha", observation_date: "2026-10-16", observed_finished_at: "2026-10-16T10:00:00Z", balances: [{ currency: "USD", net_assets: "123" }] },
    { platform: "synthetic", account_key: "wallet", observation_date: "2026-10-16", observed_finished_at: "2026-10-16T10:00:00Z", balances: [{ currency: "USDT", net_assets: "456" }] },
  ], histories: [{ id: "alpha", currency: "USD", points: [{ date: "2026-10-14", value: 100 }, { date: "2026-10-15", value: 80 }] }],
    today: "2026-10-16", year: 2026, month: 10, now: Date.parse("2026-10-16T12:00:00Z") });
  for (const language of ["zh", "en"]) {
    for (const render of [ui.assets, ui.overview]) {
      globalThis.__currencyState = { phase: "ready", data: blocks.assets };
      const html = render(language);
      assert.match(html, /USD/);
      assert.match(html, /USDT/);
      assert.match(html, /123/);
      assert.match(html, /456/);
      assert.doesNotMatch(html, /579/, "native amounts are never combined");
      assert.ok(html.includes(blocks.assets.per_currency[0].latest_as_of !== undefined
        ? language === "zh" ? "USD 最近已知余额合计" : "USD latest known balance total"
        : language === "zh" ? "USD 资产合计" : "USD asset total"));
      assert.ok(html.includes(blocks.assets.per_currency[1].latest_as_of !== undefined
        ? language === "zh" ? "USDT 最近已知余额合计" : "USDT latest known balance total"
        : language === "zh" ? "USDT 资产合计" : "USDT asset total"));
      assert.doesNotMatch(html, /已观测小计|Observed subtotal/, "internal subtotal wording is gone");
      assert.doesNotMatch(html, /reason\.|state\.|perf\./);
      if (language === "en") assert.doesNotMatch(html, /[\u4e00-\u9fff]/);
    }
    for (const render of [ui.assets, ui.overview]) {
      globalThis.__currencyState = { phase: "ready", data: { ...blocks.assets, status: "unavailable", unavailable_reason: "stored_records_unreadable", curve_status: "unavailable", curve_unavailable_reason: "stored_records_unreadable" } };
      assert.doesNotMatch(render(language), /123|456/, "failed reads cannot expose retained balances as current");
    }
    const { latest_as_of, ...legacyTotal } = blocks.assets.per_currency[0];
    const partialTotal = {
      ...legacyTotal, status: "partial", unavailable_reason: "valuation_date_mismatch",
      total: 123.45, account_count: 2, expected_account_count: 8, excluded_account_count: 6,
      as_of: "2026-10-16T10:00:00Z",
    };
    const partial = ui.totals(language, [partialTotal], { fresh: 1, stale: 7, unknown: 0, threshold_hours: 36 });
    assert.ok(partial.includes(language === "zh" ? "USD 资产小计" : "USD asset subtotal"), "partial coverage is explicitly labeled a subtotal");
    assert.ok(!partial.includes(language === "zh" ? "USD 资产合计" : "USD asset total"), "partial coverage cannot appear as a complete total");
    assert.ok(partial.includes(language === "zh" ? "已计入 2/8 个账户" : "Includes 2 of 8 accounts"), "coverage sits next to the subtotal");
    assert.ok(partial.includes('data-stale-count="7"'), "stale coverage remains available for diagnostics");
    assert.ok(!partial.includes(language === "zh" ? "部分账户数据待更新" : "Some account data may be out of date"), "no repeated stale sentence occupies the card");
    assert.ok(partial.includes("<details"), "account coverage can be inspected without exposing all details by default");
    assert.ok(partial.includes(language === "zh" ? "查看计入与排除的账户" : "View included and excluded accounts"));
    assert.ok(!partial.includes(language === "zh" ? "7 个账户" : "7 accounts"), "stale counts are not repeated");
    assert.ok(partial.includes('data-reason="valuation_date_mismatch"'), "the exact exclusion reason stays diagnostic");
    assert.ok(partial.includes('data-excluded-count="6"'), "excluded coverage is retained without another sentence");
    assert.ok(partial.includes("synthetic"), "the API-provided account coverage remains available");
    assert.match(partial, /2026|10\/16|16\/10/, "the source time stays visible");
    const fresh = ui.freshness(language, { fresh: 1, stale: 1, unknown: 1, threshold_hours: 36 });
    assert.match(fresh, /data-state="stale"[^>]*data-stale-count="1"/);
    assert.ok(fresh.replace(/<[^>]*>/g, "").length > 0, "stale availability stays visible");
    const freshZero = ui.freshness(language, { fresh: 2, stale: 0, unknown: 1, threshold_hours: 36 });
    assert.equal(freshZero, "", "freshness summary stays hidden when no account is stale");
    globalThis.__currencyState = { phase: "ready", data: blocks.summary };
    const missing = ui.summary(language);
    assert.ok(missing.includes('data-reason="no_cashflow_data"'), "the missing cash-flow reason stays diagnostic");
    globalThis.__currencyState.data = { ...blocks.summary, per_currency: [{ ...blocks.summary.per_currency[0], max_drawdown: { percent: 20, peak_date: "2026-10-14", trough_date: "2026-10-15", unavailable_reason: null } }] };
    const computed = ui.summary(language);
    assert.match(computed, /-20\.00%/, "drawdown is displayed as a loss, not a positive return");
    assert.match(computed, /10\/14|14\/10|2026/);
  }
} finally {
  delete globalThis.__currencyState;
  await rm(directory, { recursive: true, force: true });
}
console.log("console_currency_totals_ui_validation: PASS (real overview/assets/summary, zh/en, separate currencies, partial coverage, freshness counts, reasoned/computed drawdown)");
