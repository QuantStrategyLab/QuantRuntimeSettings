import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { mixedReturns } from "./fixtures/console-gaps.ts";

// Render the actual component and locale dictionaries; substitute only its I/O hook and chart sink.
const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "console-returns-"));
const outfile = join(directory, "render.cjs");
try {
  await build({ stdin: { contents: `import { createElement } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { ReturnsCard } from './src/pages/performance/ReturnsCard';
    import { ScopeContext } from './src/app/context';
    import { I18nProvider } from './src/i18n';
    export const render = (language, scope = 'all', options = []) => renderToStaticMarkup(createElement(I18nProvider, { language },
      createElement(ScopeContext.Provider, { value: { scope, options, setScope() {} } },
        createElement(ReturnsCard, { scope, range: 'ALL', epoch: 0 }))));`,
    resolveDir: root }, bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", define: { "import.meta.env": "{}" },
    plugins: [{ name: "controlled-read", setup(b) {
      b.onLoad({ filter: /\/lib\/hooks\.ts$/ }, () => ({ contents:
        "export const useApi = () => ({ phase: 'ready', data: globalThis.__gapReturns, reload() {} });", loader: "js" }));
      b.onLoad({ filter: /\/charts\/LineChart\.tsx$/ }, () => ({ contents:
        "export function LineChart(props) { globalThis.__gapCharts.push(props); return null; }", loader: "js" }));
      if (process.env.CONSOLE_RETURNS_BASELINE) b.onLoad({ filter: /\/ReturnsCard\.tsx$/ }, async () => ({
        contents: await readFile(process.env.CONSOLE_RETURNS_BASELINE, "utf8"), loader: "tsx" }));
    } }],
  });
  const { render } = createRequire(import.meta.url)(outfile);
  const ASSET_NOTE = {
    zh: "暂时无法计算收益，以下展示资产变化（%）。该变化包含出入金影响，不代表时间加权收益，也不与基准比较。",
    en: "Returns are unavailable; the chart shows asset change (%), including the effect of cash flows. It is not a time-weighted return and is not compared with benchmarks.",
  };
  const CRYPTO_NOTE = {
    zh: "加密账户按 7×24 交易，暂不与美股指数比较；BTC 基准数据尚未接入。",
    en: "Crypto accounts trade 24/7 and are not compared with US equity indices; BTC benchmark data is not available yet.",
  };
  const MIXED_NOTE = {
    zh: "当前范围同时包含加密与美股账户，暂不与单一市场指数比较；可切换到单个账户查看。",
    en: "This scope mixes crypto and US equity accounts, so no single market index applies. Open one account to compare benchmarks.",
  };
  const ASSET_CHANGE_KIND = {
    zh: "资产变化 · 含出入金影响",
    en: "Asset change · includes cash flows",
  };
  const outsideDetails = html => html.replace(/<details[\s\S]*?<\/details>/g, "");
  const detailsText = html => [...html.matchAll(/<details[\s\S]*?<\/details>/g)].map(match => match[0]).join("");
  const visibleText = html => outsideDetails(html).replace(/<[^>]*>/g, " ");
  const benchmarkLabels = {
    "标普500": "S&P 500", "纳斯达克100": "Nasdaq-100",
    "道琼斯工业平均指数": "Dow Jones Industrial Average", "罗素2000": "Russell 2000",
  };
  const benchmarkIds = Object.keys(benchmarkLabels);
  const benchmarkSeries = benchmarkIds.map(id => ({ id, points: mixedReturns.per_currency[1].points }));
  const twrPoints = mixedReturns.per_currency[1].points;
  const setReturns = value => { globalThis.__gapReturns = value; globalThis.__gapCharts = []; };

  for (const language of ["zh", "en"]) {
    // 1. Mixed-currency USDT entry: currency switch, asset change, no US-equity benchmarks.
    setReturns({ ...mixedReturns, per_currency: mixedReturns.per_currency.map(entry => ({ ...entry,
      benchmarks: entry.currency === "USDT" ? benchmarkSeries : entry.benchmarks })) });
    const html = render(language);
    assert.equal(globalThis.__gapCharts.length, 1, "one curve for the selected currency");
    assert.equal(globalThis.__gapCharts[0].series.length, 1, "crypto asset change never overlays US benchmarks");
    assert.equal(globalThis.__gapCharts[0].series[0].points.length, 7);
    assert.equal(globalThis.__gapCharts[0].series[0].label, language === "zh" ? "组合 · USDT" : "Portfolio · USDT",
      "legend uses the portfolio name and currency, not 本范围");
    assert.ok(html.includes(">USD</button>") && html.includes(">USDT</button>"), "currency switch renders both currencies");
    assert.ok(html.includes(language === "zh" ? 'aria-label="币种"' : 'aria-label="Currency"'), "currency switch is labelled");
    assert.ok(visibleText(html).includes(ASSET_CHANGE_KIND[language]), "unadjusted curve is visibly labelled as asset change");
    assert.ok(!html.includes(language === "zh" ? "时间加权收益率（TWR）" : "Time-weighted return (TWR)"));
    assert.ok(!visibleText(html).includes(language === "zh" ? "资产余额" : "Asset balance"),
      "an unadjusted percentage curve is never called a balance");
    assert.ok(!visibleText(html).includes(ASSET_NOTE[language]), "asset-change note is collapsed by default");
    assert.ok(!visibleText(html).includes(CRYPTO_NOTE[language]), "crypto explanation is collapsed by default");
    assert.ok(detailsText(html).includes(language === "zh" ? "包含出入金影响，不代表时间加权收益，也不与基准比较" : "including the effect of cash flows; it is not a time-weighted return and is not compared with benchmarks"), "method help retains the cash-flow and no-benchmark qualifications");
    assert.ok(!html.includes('class="state-details curve-notes"'), "ordinary diagnostic details do not occupy the chart");
    for (const label of Object.values(benchmarkLabels)) assert.ok(!html.includes(label), "no US index label for a crypto entry");
    assert.doesNotMatch(html, /perf-currency-block/);
    assert.doesNotMatch(html, /state\.|reason\.|perf\./);

    // 1b. The same asset-change curve under a mixed crypto/equity scope explains both limits in one disclosure.
    setReturns({ ...mixedReturns, status: "ok", unavailable_reason: null, per_currency: [], currency: "USD",
      return_kind: "unadjusted_asset_ratio", points: twrPoints, aligned_start: "2026-10-09", no_common_date: false,
      benchmarks: [], benchmark_availability: [] });
    const mixedAsset = render(language, "all", [
      { alias: "synthetic-crypto", platform: "binance", paper: false },
      { alias: "synthetic-equity", platform: "schwab", paper: false },
    ]);
    assert.equal(globalThis.__gapCharts.length, 1, "the asset-change chart still renders for a mixed scope");
    assert.ok(visibleText(mixedAsset).includes(ASSET_CHANGE_KIND[language]), "mixed-scope curve stays labelled asset change");
    assert.ok(!visibleText(mixedAsset).includes(ASSET_NOTE[language]));
    assert.ok(!visibleText(mixedAsset).includes(MIXED_NOTE[language]));
    assert.ok(detailsText(mixedAsset).includes(language === "zh" ? "不代表时间加权收益，也不与基准比较" : "it is not a time-weighted return and is not compared with benchmarks"), "the method explanation retains the unadjusted comparison limit");
    assert.equal((mixedAsset.match(/<details class="method-note">/g) || []).length, 1, "one user-facing method explanation remains");
    assert.ok(!mixedAsset.includes('class="state-details curve-notes"'));
    assert.ok(!visibleText(mixedAsset).includes(language === "zh" ? "时间加权收益率（TWR）" : "Time-weighted return (TWR)"),
      "an asset-change curve never poses as a return");

    // 2. Store failure cannot be bypassed by retained currency groups.
    setReturns({ ...mixedReturns, status: "unavailable", unavailable_reason: "stored_records_unreadable" });
    render(language);
    assert.equal(globalThis.__gapCharts.length, 0);
    setReturns({ ...mixedReturns, per_currency: [] });
    assert.doesNotMatch(render(language), /perf-currency-switch/);

    // 3. Qualified TWR in USD: one or two relevant US benchmarks are visible by default; the rest are opt-in.
    setReturns({ ...mixedReturns, status: "ok", unavailable_reason: null, per_currency: [], currency: "USD",
      return_kind: "twr", points: twrPoints, aligned_start: "2026-10-09", no_common_date: false, benchmarks: benchmarkSeries,
      benchmark_availability: benchmarkIds.map(id => ({ id, status: "ok", unavailable_reason: null, as_of: "2026-10-15" })) });
    const twrHtml = render(language);
    assert.equal(globalThis.__gapCharts[0].series.length, 5, "account plus four benchmark series");
    assert.deepEqual(globalThis.__gapCharts[0].defaultVisible, ["纳斯达克100", "标普500"],
      "US equity defaults to two relevant benchmarks; Dow/Russell stay opt-in");
    for (const series of globalThis.__gapCharts[0].series.slice(1))
      assert.equal(series.label, language === "zh" ? series.id : benchmarkLabels[series.id], "localize real benchmark ids without changing identity");
    assert.ok(twrHtml.includes(language === "zh" ? "时间加权收益率（TWR）" : "Time-weighted return (TWR)"));
    assert.ok(!twrHtml.includes(ASSET_CHANGE_KIND[language]), "a qualified TWR is not labelled as asset change");
    if (language === "en") assert.doesNotMatch(twrHtml, /[一-鿿]/);

    // 4. A missing default benchmark is reported honestly; the account curve still renders.
    setReturns({ ...mixedReturns, status: "partial", unavailable_reason: "external_cashflow_required", per_currency: [],
      currency: "USD", return_kind: "twr", points: twrPoints, aligned_start: "2026-10-09", no_common_date: false, benchmarks: [],
      benchmark_availability: [{ id: "标普500", status: "unavailable", unavailable_reason: "benchmark_history_unreadable", as_of: null }] });
    const disabled = render(language);
    assert.ok(disabled.includes(language === "zh" ? "标普500" : "S&amp;P 500"), "disabled benchmark labels use the same locale");
    assert.equal(globalThis.__gapCharts[0].series.length, 1);
    if (language === "en") assert.doesNotMatch(disabled, /[一-鿿]/);

    // 5. Crypto scope: even a qualified TWR is never compared with US equity indices.
    setReturns({ ...mixedReturns, status: "ok", unavailable_reason: null, per_currency: [], currency: "USDT",
      return_kind: "twr", points: twrPoints, aligned_start: "2026-10-09", no_common_date: false, benchmarks: benchmarkSeries,
      benchmark_availability: benchmarkIds.map(id => ({ id, status: "ok", unavailable_reason: null, as_of: "2026-10-15" })) });
    const cryptoTwr = render(language, "binance:main");
    assert.equal(globalThis.__gapCharts[0].series.length, 1, "crypto scope suppresses every US benchmark series");
    assert.ok(!visibleText(cryptoTwr).includes(CRYPTO_NOTE[language]), "benchmark-policy diagnostics do not occupy the curve");
    for (const label of Object.values(benchmarkLabels)) assert.ok(!cryptoTwr.includes(label));
    assert.doesNotMatch(cryptoTwr, /state\.|reason\.|perf\./);
  }
} finally {
  delete globalThis.__gapReturns;
  delete globalThis.__gapCharts;
  await rm(directory, { recursive: true, force: true });
}
console.log("console_returns_adapter_validation: PASS (zh/en, currency switch, asset-change labelling, crypto benchmark suppression, two US defaults, failed/empty groups)");
