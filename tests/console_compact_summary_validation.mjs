import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "compact-summary-"));
try {
  const outfile = join(directory, "render.cjs");
  await build({ stdin: { resolveDir: root, contents: `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { I18nProvider } from './src/i18n';
    import { SummaryCards } from './src/pages/performance/SummaryCards';
    import { accountDailyPoints } from './src/pages/performance/ReturnsCard';
    export { accountDailyPoints };
    export const render = (data, chartAvailable) => renderToStaticMarkup(h(I18nProvider, { language: 'zh' }, h(SummaryCards, { scope: 'all', state: { phase: 'ready', data, reload() {} }, chartAvailable })));
  ` }, bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, logLevel: "silent" });
  const ui = createRequire(import.meta.url)(outfile);
  const blank = { status: "unavailable", unavailable_reason: "mixed_currency", as_of: null, value_kind: "pnl", currency: null,
    twr_return_percent: null, amount: null, max_drawdown: { percent: null }, per_currency: [], excess_returns: [], best_day: null, worst_day: null };
  const compact = ui.render(blank, true);
  assert.doesNotMatch(compact, /perf-kpi-grid/);
  assert.match(compact, /组合指标暂不可计算/);
  assert.match(ui.render(blank, false), /perf-kpi-grid/);
  for (const data of [{ ...blank, twr_return_percent: 0 }, { ...blank, amount: 0 },
    { ...blank, max_drawdown: { percent: 0 } }, { ...blank, per_currency: [{ currency: "USD", max_drawdown: { percent: 0 } }] },
    { ...blank, excess_returns: [{ percentage_points: 0 }] }, { ...blank, best_day: { status: "ok", amount: 0 } }]) {
    assert.match(ui.render(data, true), /perf-kpi-grid/);
  }
  assert.equal(ui.accountDailyPoints([{ date: "2026-01-01", value: 0, daily_return_percent: 0 }]).length, 1);
  assert.equal(ui.accountDailyPoints([{ date: "2026-01-01", value: 0, daily_return_percent: null }]).length, 0);
  console.log("console_compact_summary_validation: PASS");
} finally { await rm(directory, { recursive: true, force: true }); }
