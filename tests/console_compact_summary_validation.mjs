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
    export const renderLang = (language, data, chartAvailable) => renderToStaticMarkup(h(I18nProvider, { language }, h(SummaryCards, { scope: 'all', state: { phase: 'ready', data, reload() {} }, chartAvailable })));
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
  // ---- per-currency drawdown: a missing figure carries no method label ----
  const DIETZ = { zh: "Modified Dietz（近似）", en: "Modified Dietz (approximate)" };
  const UNAVAILABLE = { zh: "暂不可计算", en: "Unavailable" };
  // The existing reason copy for the two codes a missing per-currency drawdown
  // actually carries; the raw code stays in data-reason either way.
  const NO_CASHFLOW = {
    zh: "缺少完整出入金记录，无法计算 TWR 及其回撤。",
    en: "Complete cash-flow records are missing; TWR and its drawdown cannot be calculated.",
  };
  const SHORT_HISTORY = {
    zh: "至少需要两条有效估值记录。",
    en: "At least two valid valuation records are required.",
  };
  // Every row carries real method metadata, so a label can only appear when the
  // value it describes actually exists.
  const METHOD = { cashflow_method: "modified_dietz", approximate: true };
  const row = (currency, max_drawdown) => ({ currency, total: null, account_count: 0, expected_account_count: 0,
    as_of: null, stale: null, status: "ok", unavailable_reason: null, ...METHOD, max_drawdown });
  const dd = (percent, reason = null) => ({ percent, peak_date: null, trough_date: null, unavailable_reason: reason });
  const withRows = rows => ({ ...blank, unavailable_reason: null, per_currency: rows });
  const count = (html, needle) => (html.match(new RegExp(needle, "g")) ?? []).length;

  for (const language of ["zh", "en"]) {
    // Every row missing: each keeps its own dash and reason, and no row claims a
    // return method it never used.
    const allMissing = ui.renderLang(language, withRows([
      row("USD", dd(null, "no_cashflow_data")),
      row("HKD", dd(null, "insufficient_history")),
    ]), true);
    assert.equal(count(allMissing, "Modified Dietz"), 0, `${language}: no method label without a value`);
    assert.ok(allMissing.includes('data-state="no_cashflow_data"') && allMissing.includes('data-state="insufficient_history"'),
      `${language}: each missing drawdown keeps its own diagnostic state`);
    assert.ok(allMissing.includes('data-reason="no_cashflow_data"'), `${language}: the raw code stays diagnostic`);
    assert.equal(count(allMissing, NO_CASHFLOW[language]), 1,
      `${language}: the missing row states its own reason instead of a method label`);
    assert.equal(count(allMissing, SHORT_HISTORY[language]), 1,
      `${language}: each row keeps its distinct reason`);
    assert.ok(!allMissing.includes("→"), `${language}: a missing figure invents no peak/trough dates`);

    // Partly missing: only the row with a value carries the approximate label.
    const partial = ui.renderLang(language, withRows([
      row("USD", dd(null, "insufficient_history")),
      row("USDT", dd(0, null)),
    ]), true);
    assert.equal(count(partial, "Modified Dietz"), 1, `${language}: the method label belongs only to the valued row`);
    assert.ok(partial.indexOf(DIETZ[language]) > partial.indexOf("USDT"),
      `${language}: the approximate label sits on the row that has a value`);
    assert.ok(partial.includes("0.00%"), `${language}: a real zero drawdown stays 0.00%`);
    assert.ok(partial.indexOf(SHORT_HISTORY[language]) < partial.indexOf("USDT"),
      `${language}: the missing row states its reason, not a value`);

    // A zero is a value: it keeps both the figure and the method label.
    const zero = ui.renderLang(language, withRows([row("USD", dd(0, null))]), true);
    assert.ok(zero.includes("0.00%"), `${language}: zero is never blanked out`);
    assert.equal(count(zero, "Modified Dietz"), 1, `${language}: a zero drawdown keeps its method label`);

    // A valid approximation keeps its figure, its label and its sign.
    const approx = ui.renderLang(language, withRows([row("USD", dd(12.5, null))]), true);
    assert.ok(approx.includes("-12.50%"), `${language}: a drawdown keeps two decimals and its sign`);
    assert.equal(count(approx, "Modified Dietz"), 1, `${language}: a valid approximation keeps its label`);

    // Missing without a reason: the short state stands in, still no method label.
    const noReason = ui.renderLang(language, withRows([row("USD", dd(null, null))]), true);
    assert.equal(count(noReason, "Modified Dietz"), 0, `${language}: no label without a value or a reason`);
    assert.ok(noReason.includes(UNAVAILABLE[language]), `${language}: a missing reason falls back to the short state`);
  }

  assert.equal(ui.accountDailyPoints([{ date: "2026-01-01", value: 0, daily_return_percent: 0 }]).length, 1);
  assert.equal(ui.accountDailyPoints([{ date: "2026-01-01", value: 0, daily_return_percent: null }]).length, 0);
  console.log("console_compact_summary_validation: PASS");
} finally { await rm(directory, { recursive: true, force: true }); }
