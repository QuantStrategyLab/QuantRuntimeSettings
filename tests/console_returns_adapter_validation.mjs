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
    import { I18nProvider } from './src/i18n';
    export const render = language => renderToStaticMarkup(createElement(I18nProvider, { language },
      createElement(ReturnsCard, { scope: 'all', range: 'ALL', epoch: 0 })));`,
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
  const benchmarkLabels = {
    "标普500": "S&P 500", "纳斯达克100": "Nasdaq-100",
    "道琼斯工业平均指数": "Dow Jones Industrial Average", "罗素2000": "Russell 2000",
  };
  for (const language of ["zh", "en"]) {
    const benchmarks = Object.keys(benchmarkLabels).map(id => ({ id, points: mixedReturns.per_currency[1].points }));
    globalThis.__gapReturns = { ...mixedReturns, per_currency: mixedReturns.per_currency.map(entry => ({ ...entry,
      benchmarks: entry.currency === "USDT" ? benchmarks : entry.benchmarks })) };
    globalThis.__gapCharts = [];
    const html = render(language);
    assert.equal(globalThis.__gapCharts.length, 1, "a mixed-currency aggregate must not hide the valid USDT group");
    assert.equal(globalThis.__gapCharts[0].series[0].points.length, 7);
    for (const series of globalThis.__gapCharts[0].series.slice(1))
      assert.equal(series.label, language === "zh" ? series.id : benchmarkLabels[series.id], "localize real benchmark ids without changing identity");
    assert.match(html, /USD<\/h3>/);
    assert.match(html, /USDT<\/h3>/);
    assert.ok(html.includes(language === "zh" ? "非 TWR" : "not TWR"));
    assert.ok(!html.includes(language === "zh" ? "时间加权收益率（TWR）" : "Time-weighted return (TWR)"));
    assert.doesNotMatch(html, /state\.|reason\.|perf\./);
    globalThis.__gapReturns = { ...mixedReturns, status: "unavailable", unavailable_reason: "stored_records_unreadable" };
    globalThis.__gapCharts = [];
    render(language);
    assert.equal(globalThis.__gapCharts.length, 0, "a store failure cannot be bypassed by retained groups");
    globalThis.__gapReturns = { ...mixedReturns, per_currency: [] };
    assert.doesNotMatch(render(language), /perf-currency-block/);
    globalThis.__gapReturns = { ...mixedReturns, status: "partial", unavailable_reason: "external_cashflow_required",
      no_common_date: false, per_currency: [], points: mixedReturns.per_currency[1].points, benchmarks: [],
      benchmark_availability: [{ id: "标普500", status: "unavailable", unavailable_reason: "benchmark_history_unreadable" }] };
    const disabled = render(language);
    assert.ok(disabled.includes(language === "zh" ? "标普500" : "S&amp;P 500"), "disabled benchmark labels use the same locale");
    if (language === "en") assert.doesNotMatch(disabled, /[\u4e00-\u9fff]/);
  }
} finally {
  delete globalThis.__gapReturns;
  delete globalThis.__gapCharts;
  await rm(directory, { recursive: true, force: true });
}
console.log("console_returns_adapter_validation: PASS (zh/en, 7 USDT points, no TWR, failed/empty groups)");
