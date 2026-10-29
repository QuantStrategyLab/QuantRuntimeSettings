import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { mixedReturns } from "./fixtures/console-gaps.ts";
import { syntheticAccountReturns } from "../web/strategy-switch-console/frontend/scripts/per-account-returns-fixture.mjs";

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
      createElement(ReturnsCard, { scope: 'all', range: 'ALL', epoch: 0, state: { phase: 'ready', data: globalThis.__gapReturns, reload() {} } })));`,
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
  for (const language of ["zh", "en"]) {
    const nativePoints = [
      { date: "2026-10-23", value: 1, daily_return_percent: 1, breakBefore: false },
      { date: "2026-10-27", value: -2, daily_return_percent: -2, breakBefore: true },
    ];
    globalThis.__gapReturns = { ...mixedReturns, status: "partial", unavailable_reason: "snapshot_history_missing",
      return_kind: "twr", currency: "USD", coverage: { account_aliases: ["synthetic"], native_daily_only: true },
      no_common_date: false, aligned_start: "2026-10-23", per_currency: [], points: nativePoints,
      benchmarks: [{ id: "标普500", points: nativePoints }], benchmark_availability: [] };
    globalThis.__gapCharts = [];
    const nativeGap = render(language);
    assert.equal(globalThis.__gapCharts.length, 1, "known daily values remain visible");
    assert.equal(globalThis.__gapCharts[0].mode, "daily", "daily-only response cannot be treated as cumulative");
    assert.equal(globalThis.__gapCharts[0].series.length, 1, "daily-only response has no benchmark comparison");
    assert.deepEqual(globalThis.__gapCharts[0].series[0].points, nativePoints);
    assert.match(nativeGap, /data-native-daily-only="true"/);
    assert.doesNotMatch(nativeGap, /perf-mode-toggle/);
    assert.ok(nativeGap.includes(language === "zh" ? "日收益率" : "Daily returns"));
    assert.ok(nativeGap.includes(language === "zh" ? "部分日期缺失，暂无法计算区间累计收益。" : "Some dates are missing, so the period return is unavailable."));
    assert.ok(nativeGap.includes(language === "zh" ? "每日收益来自券商，缺失日期留空。" : "Daily returns are reported by the broker; missing dates are left blank."));
    assert.doesNotMatch(nativeGap, language === "zh" ? /收益率 vs 基准/ : /Returns vs Benchmark/i);
    globalThis.__gapReturns = { ...globalThis.__gapReturns, coverage: { account_aliases: ["synthetic"] } };
    globalThis.__gapCharts = [];
    const continuous = render(language);
    assert.equal(globalThis.__gapCharts[0].mode, "cumulative", "ordinary partial responses preserve mode");
    assert.match(continuous, /perf-mode-toggle/);
    globalThis.__gapReturns = { ...mixedReturns, status: "partial", points: [], per_currency: [],
      per_account: structuredClone(syntheticAccountReturns) };
    globalThis.__gapCharts = [];
    const portfolio = render(language);
    assert.equal(globalThis.__gapCharts.length,2,"each qualified account's daily data remains visible without computing a portfolio");
    assert.ok(globalThis.__gapCharts.every(chart => chart.mode === "daily" && chart.series.length === 1));
    assert.equal(globalThis.__gapCharts[0].series[0].points[1].breakBefore,true);
    assert.equal(globalThis.__gapCharts[1].series[0].points[0].daily_return_percent,1);
    assert.ok(portfolio.includes(language === "zh" ? "各账户日收益率" : "Daily returns by account"));
    globalThis.__gapReturns.per_account[0].points = [
      {date:"2026-10-19",value:10,daily_return_percent:0},
      {date:"2026-10-20",value:10,daily_return_percent:null},
      {date:"2026-10-21",value:10,daily_return_percent:-1},
      {date:"2026-10-22",value:10,daily_return_percent:1},
      {date:"2026-10-22",value:10,daily_return_percent:2},
      {date:"2026-10-23",value:10,daily_return_percent:3},
    ];
    globalThis.__gapCharts = [];
    render(language);
    const safePoints = globalThis.__gapCharts[0].series[0].points;
    assert.deepEqual(safePoints.map(point => point.daily_return_percent), [0,-1,3]);
    assert.equal(safePoints[1].breakBefore,true);
    assert.equal(safePoints[2].breakBefore,true);

  }

} finally {
  delete globalThis.__gapReturns;
  delete globalThis.__gapCharts;
  await rm(directory, { recursive: true, force: true });
}
console.log("native_daily_gap_ui_validation: PASS");
