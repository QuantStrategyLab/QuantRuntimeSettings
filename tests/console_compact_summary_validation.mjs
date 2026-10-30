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
    coverage: { account_aliases: ["a"], fx: "not_applied" },
    twr_return_percent: null, amount: null, max_drawdown: { percent: null }, per_currency: [], excess_returns: [], best_day: null, worst_day: null };
  // A blank summary keeps the cards and shows an honest dash in each; the reason
  // is stated in one short visible line next to them. Suppressing the whole grid
  // would hide the fact that these metrics are unavailable rather than absent,
  // and would leave the page with no explanation once the chart is drawn.
  const compact = ui.render(blank, true);
  assert.match(compact, /perf-kpi-grid/);
  assert.match(compact, /组合指标不可计算/);
  // The reason must be readable text, not only a data-reason attribute or a title.
  assert.match(compact, /未进行汇率转换/);
  // Without an explicit fx=not_applied signal the copy must not claim anything
  // about FX conversion.
  assert.doesNotMatch(ui.render({ ...blank, coverage: { account_aliases: ["a"] } }, true), /汇率/);
  // A reason other than mixed_currency stays diagnostic and is not repeated as
  // body copy below the short state.
  const otherReason = ui.render({ ...blank, unavailable_reason: "snapshot_history_missing" }, true);
  assert.match(otherReason, /data-reason="snapshot_history_missing"/);
  assert.doesNotMatch(otherReason, /历史资产快照/);
  assert.match(compact, /state-short/);
  // No FX rate is inferred and no zero is filled in: six dashes, no fake numbers.
  assert.equal((compact.match(/kpi-empty-value/g) ?? []).length, 6);
  assert.doesNotMatch(compact, /0\.00%/);
  // The chart being available no longer hides the cards.
  assert.match(ui.render(blank, false), /perf-kpi-grid/);
  assert.match(ui.render(blank, false), /组合指标不可计算/);
  // Zero is a real value, never blankness: the generic reason only appears when
  // every field is genuinely absent.
  const blankNoReason = { ...blank, unavailable_reason: null };
  assert.match(ui.render(blankNoReason, true), /组合指标暂不可计算/);
  for (const data of [{ ...blank, twr_return_percent: 0 }, { ...blank, amount: 0 },
    { ...blank, max_drawdown: { percent: 0 } }, { ...blank, per_currency: [{ currency: "USD", max_drawdown: { percent: 0 } }] },
    { ...blank, excess_returns: [{ percentage_points: 0 }] }, { ...blank, best_day: { status: "ok", amount: 0 } }]) {
    const html = ui.render({ ...data, unavailable_reason: null }, true);
    assert.match(html, /perf-kpi-grid/);
    assert.doesNotMatch(html, /组合指标暂不可计算/);
  }
  assert.equal(ui.accountDailyPoints([{ date: "2026-01-01", value: 0, daily_return_percent: 0 }]).length, 1);
  assert.equal(ui.accountDailyPoints([{ date: "2026-01-01", value: 0, daily_return_percent: null }]).length, 0);
  console.log("console_compact_summary_validation: PASS");
} finally { await rm(directory, { recursive: true, force: true }); }
