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
    export const totals = (language, totals) => render(language, CurrencyTotals, { totals });
    export const freshness = (language, counts) => render(language, FreshnessSummary, { counts });
    export const assets = language => render(language, AssetsCard, { scope: 'all', range: 'ALL', epoch: 0 });
    export const overview = language => render(language, AssetKpi, { state: globalThis.__currencyState });
    export const summary = language => render(language, SummaryCards, { scope: 'all', range: 'ALL', epoch: 0 });`, resolveDir: root },
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
      assert.ok(html.includes(language === "zh" ? "不换汇" : "without FX conversion"));
      assert.doesNotMatch(html, /reason\.|state\.|perf\./);
      if (language === "en") assert.doesNotMatch(html, /[\u4e00-\u9fff]/);
    }
    for (const render of [ui.assets, ui.overview]) {
      globalThis.__currencyState = { phase: "ready", data: { ...blocks.assets, status: "unavailable", unavailable_reason: "stored_records_unreadable", curve_status: "unavailable", curve_unavailable_reason: "stored_records_unreadable" } };
      assert.doesNotMatch(render(language), /123|456/, "failed reads cannot expose retained balances as current");
    }
    const partial = ui.totals(language, [{ ...blocks.assets.per_currency[0], status: "partial", unavailable_reason: "valuation_date_mismatch" }]);
    assert.ok(partial.includes(language === "zh" ? "已观测小计" : "observed subtotal"));
    assert.ok(partial.includes(language === "zh" ? "估值日期不同" : "valuation dates differ"));
    const fresh = ui.freshness(language, { fresh: 1, stale: 1, unknown: 1, threshold_hours: 36 });
    assert.ok(fresh.includes(language === "zh" ? "新鲜 1 · 偏旧 1 · 未知 1" : "fresh 1 · stale 1 · unknown 1"));
    globalThis.__currencyState = { phase: "ready", data: blocks.summary };
    const missing = ui.summary(language);
    assert.ok(missing.includes(language === "zh" ? "缺少完整出入金记录" : "Complete cash-flow records are missing"));
    globalThis.__currencyState.data = { ...blocks.summary, per_currency: [{ ...blocks.summary.per_currency[0], max_drawdown: { percent: 20, peak_date: "2026-10-14", trough_date: "2026-10-15", unavailable_reason: null } }] };
    const computed = ui.summary(language);
    assert.match(computed, /20\.00%/);
    assert.match(computed, /10\/14|14\/10|2026/);
  }
} finally {
  delete globalThis.__currencyState;
  await rm(directory, { recursive: true, force: true });
}
console.log("console_currency_totals_ui_validation: PASS (real overview/assets/summary, zh/en, separate currencies, partial coverage, freshness counts, reasoned/computed drawdown)");
