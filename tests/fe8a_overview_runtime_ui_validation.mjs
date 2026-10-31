import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

test("runtime KPI renders real observed coverage and explicit empty/error states without changing the API total", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fe8a-runtime-ui-"));
  const outfile = join(directory, "render.cjs");
  const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
  try {
    await build({
      stdin: { resolveDir: root, contents: `import { createElement } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import { RunsKpi, AssetKpi, ReturnKpi, LastDayKpi, carryoverMonthForLatestDay } from './src/pages/overview/OverviewPage';
        import { I18nProvider } from './src/i18n';
        export { carryoverMonthForLatestDay };
        export const render = (language, state) => renderToStaticMarkup(
          createElement(I18nProvider, { language }, createElement(RunsKpi, { state })));
        export const renderAsset = (language, state) => renderToStaticMarkup(
          createElement(I18nProvider, { language }, createElement(AssetKpi, { state })));
        export const renderReturn = (language, state) => renderToStaticMarkup(
          createElement(I18nProvider, { language }, createElement(ReturnKpi, { state })));
        export const renderLastDay = (language, state, carryover, carryoverState) => renderToStaticMarkup(
          createElement(I18nProvider, { language },
            createElement(LastDayKpi, { state, carryover, carryoverState })));` },
      bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic",
      loader: { ".css": "empty" }, define: { "import.meta.env": "{}" },
      plugins: [{ name: "test-runtime-card", setup(builder) {
        builder.onLoad({ filter: /\/pages\/overview\/OverviewPage\.tsx$/ }, async args => ({
          contents: `${await readFile(args.path, "utf8")}\nexport { RunsKpi, AssetKpi, ReturnKpi, LastDayKpi };`, loader: "tsx",
        }));
      } }],
    });
    const ui = createRequire(import.meta.url)(outfile);
    const MIXED_REASON = {
      zh: "多币种无法合并为单一金额；按币种分别展示",
      en: "Mixed currencies cannot be combined into one amount; each currency is shown separately",
    };
    const DETAILS = { zh: "详情", en: "Details" };
    const AS_OF = { zh: "数据截至", en: "Data as of" };
    const UNAVAILABLE = { zh: "暂不可计算", en: "Unavailable" };
    const STALE = { zh: "数据偏旧", en: "Stale" };
    const ASSET_CHANGE = { zh: "资产变动", en: "Asset change" };
    const METHOD = { zh: "Modified Dietz（近似）", en: "Modified Dietz (approximate)" };
    // Collapsed <details> content is in SSR but not in the default card view.
    const outsideDetails = html => html.replace(/<details[\s\S]*?<\/details>/g, "");
    const detailsText = html => [...html.matchAll(/<details[\s\S]*?<\/details>/g)].map(match => match[0]).join("");
    const visibleText = html => outsideDetails(html).replace(/<[^>]*>/g, " ");
    const meta = { schema_version: "console_api.v1", scope: "all", range: "YTD", coverage: [] };
    const asOf = "2026-10-20T02:00:05Z";
    const data = { status: "partial", date: "2026-10-22", counts: { configured: 8, observed: 2, runs: null } };
    for (const language of ["zh", "en"]) {
      const html = ui.render(language, { phase: "ready", data });
      assert.ok(html.includes("2/8"));
      assert.ok(!html.includes("—"));
      assert.ok(html.includes(language === "zh" ? "今日有记录账户" : "Accounts with records today"),
        "the card names the count it shows: accounts with records, not runs");
      assert.equal(data.counts.runs, null);
      const conflict = ui.render(language, { phase: "ready", data: { ...data, accounts: [{ unavailable_reason: "runtime_daily_binding_conflict" }] } });
      assert.ok(conflict.includes(language === "zh" ? "运行记录存在多个账户绑定" : "Multiple run-record bindings match this account"));
      // A known denominator makes zero an effective zero: 0/8 accounts have records.
      const NO_RECORDS = { zh: "当前未观测到该业务日记录", en: "No records observed for this business day" };
      const NOT_CONNECTED = { zh: "运行记录源未接入", en: "The run-record source is not connected" };
      const BINDING_CONFLICT = { zh: "运行记录存在多个账户绑定", en: "Multiple run-record bindings match this account" };
      for (const account of [
        { status: "partial", unavailable_reason: "runtime_daily_incomplete", completeness: "incomplete" },
        { status: "stale", unavailable_reason: "runtime_daily_stale" },
        { status: "no_data", unavailable_reason: null },
        { status: "partial", unavailable_reason: null },
      ]) {
        const partial = ui.render(language, { phase: "ready", data: { ...data, accounts: [account] } });
        assert.ok(partial.includes("2/8"), "source completeness does not change observed coverage");
        assert.ok(!partial.includes(NOT_CONNECTED[language]),
          `${account.status}: partial coverage must not invent an unconnected source`);
        assert.ok(partial.includes(language === "zh" ? "部分" : "Partial"), "incomplete coverage remains visible");
      }
      const empty = ui.render(language, { phase: "ready", data: {
        ...data, counts: { ...data.counts, observed: 0 },
        accounts: [{ status: "not_connected", unavailable_reason: "runtime_daily_not_connected" }],
      } });
      assert.ok(empty.includes("0/8"), "zero observed accounts keep a real 0/N value");
      assert.ok(!empty.includes("—"), "a known zero is never replaced by an unknown dash");
      assert.ok(empty.includes(language === "zh" ? "纽约业务日" : "New York business day"),
        "the business day the count refers to stays next to it");
      assert.ok(empty.includes(NO_RECORDS[language]), "zero observations say what was observed, not that trading was absent");
      assert.ok(!empty.includes(language === "zh" ? "该业务日暂无记录" : "No records for this business day"),
        "the retired wording is gone");
      assert.ok(empty.includes(language === "zh" ? "部分" : "Partial"), "the partial source state is retained");
      assert.ok(empty.includes(NOT_CONNECTED[language]), "an unconnected run-record source stays named next to the zero");
      // The same zero keeps its wording when the reason is a binding conflict.
      const zeroConflict = ui.render(language, { phase: "ready", data: {
        ...data, counts: { ...data.counts, observed: 0 },
        accounts: [{ unavailable_reason: "runtime_daily_binding_conflict" }],
      } });
      assert.ok(zeroConflict.includes("0/8") && zeroConflict.includes(NO_RECORDS[language]),
        "a binding conflict does not change the observed count or its wording");
      assert.ok(zeroConflict.includes(BINDING_CONFLICT[language]), "the binding conflict reason stays visible");
      assert.ok(!zeroConflict.includes(NOT_CONNECTED[language]), "one source state is named, not two");
      // Only an unknowable denominator falls back to an unknown value.
      const unknownCounts = ui.render(language, { phase: "ready", data: { ...data, counts: { ...data.counts, configured: 0, observed: 0 } } });
      assert.ok(unknownCounts.includes("—"), "an unknowable denominator keeps a compact unknown value");
      assert.ok(unknownCounts.includes(language === "zh" ? "暂无数据" : "No data"));
      assert.ok(!unknownCounts.includes("0/0"), "an empty denominator is never rendered as a ratio");
      assert.ok(!unknownCounts.includes(NO_RECORDS[language]), "an unknown denominator claims no observation either");
      const failed = ui.render(language, { phase: "error", error: Error("synthetic_read_failed") });
      assert.ok(failed.includes(language === "zh" ? "读取失败" : "Read failed"));
      assert.ok(!failed.includes("0/8"));
      assert.ok(!failed.includes(NO_RECORDS[language]), "a failed read is not reported as zero observations");
      // A response-level read failure takes the same branch, never the zero copy.
      const failedData = ui.render(language, { phase: "ready", data: { ...data, status: "read_failed", counts: { ...data.counts, observed: 0 } } });
      assert.ok(failedData.includes(language === "zh" ? "读取失败" : "Read failed"));
      assert.ok(!failedData.includes("0/8") && !failedData.includes(NO_RECORDS[language]),
        "a read_failed payload shows the failure instead of an observed zero");
    }
    for (const language of ["zh", "en"]) {
      const summary = {
        ...meta, status: "ok", unavailable_reason: "mixed_currency", as_of: asOf, value_kind: "asset_change",
        twr_return_percent: null, amount: null, simple_weighted_return_percent: null,
        metric_reasons: { twr: "mixed_currency" },
        max_drawdown: { percent: null, peak_date: null, trough_date: null, unavailable_reason: "mixed_currency" },
        best_day: null, worst_day: null, excess_returns: [],
      };
      const mixedReturn = ui.renderReturn(language, { phase: "ready", data: summary });
      assert.ok(visibleText(mixedReturn).includes("—"), "uncomputable TWR keeps an honest blank");
      assert.ok(visibleText(mixedReturn).includes(UNAVAILABLE[language]), "default view keeps only the short status");
      assert.ok(visibleText(mixedReturn).includes(language === "zh" ? "多币种" : "Multiple currencies"), "mixed-currency state stays short and explicit");
      assert.ok(!mixedReturn.includes("<details"), "no audit details block remains");
      assert.ok(visibleText(mixedReturn).includes(AS_OF[language]), "the corresponding as-of time stays visible");
      assert.ok(!visibleText(mixedReturn).includes("0.00%"), "an unavailable return is never rendered as zero");

      const assets = {
        ...meta, status: "ok", unavailable_reason: "mixed_currency", as_of: asOf, value_kind: "asset_change",
        currency: "USD", points: [{ date: "2026-10-20", value: 123 }], per_currency: [],
      };
      const mixedAssets = ui.renderAsset(language, { phase: "ready", data: assets });
      assert.ok(visibleText(mixedAssets).includes("—") && visibleText(mixedAssets).includes(UNAVAILABLE[language]));
      assert.ok(visibleText(mixedAssets).includes(language === "zh" ? "多币种" : "Multiple currencies"), "the mixed-currency state stays short");
      assert.ok(!visibleText(mixedAssets).includes("123"), "an uncombinable total is never shown as a value");
      assert.ok(!mixedAssets.includes("<details"), "no audit details block remains");
      assert.ok(visibleText(mixedAssets).includes(AS_OF[language]));

      const calendar = {
        ...meta, status: "unavailable", unavailable_reason: "mixed_currency", as_of: asOf,
        value_kind: "asset_change", year: 2026, month: 10, cells: [],
      };
      const mixedDay = ui.renderLastDay(language, { phase: "ready", data: calendar });
      assert.ok(visibleText(mixedDay).includes("—") && visibleText(mixedDay).includes(UNAVAILABLE[language]));
      assert.ok(visibleText(mixedDay).includes(language === "zh" ? "多币种" : "Multiple currencies"), "the mixed-currency state stays short");
      assert.ok(!mixedDay.includes("<details"), "no audit details block remains");
      assert.ok(visibleText(mixedDay).includes(AS_OF[language]));

      const staleCalendar = {
        ...calendar, status: "stale", unavailable_reason: null,
        cells: [{ date: "2020-01-02", amount: 123, return_percent: null, currency: "USD", status: "ok",
          value_kind: "asset_change", unavailable_reason: null }],
      };
      const staleDay = ui.renderLastDay(language, { phase: "ready", data: staleCalendar });
      assert.ok(visibleText(staleDay).includes("123"), "stale data still shows its real value");
      assert.ok(visibleText(staleDay).includes(ASSET_CHANGE[language]), "the normal method label stays next to the value");
      assert.ok(staleDay.includes('data-status="stale"'), "stale stays available as a visible status");
      assert.ok(visibleText(staleDay).includes(AS_OF[language]), "stale as-of time stays visible once");
      assert.ok(!staleDay.includes("<details"), "no audit details block remains");

      const normalReturn = ui.renderReturn(language, { phase: "ready", data: {
        ...summary, unavailable_reason: null, twr_return_percent: 10, metric_reasons: { twr: null },
        cashflow_method: "modified_dietz", approximate: true,
      } });
      assert.ok(visibleText(normalReturn).includes("10.00%"), "a normal return keeps its value");
      assert.ok(visibleText(normalReturn).includes(METHOD[language]), "a normal return keeps its method label");
      assert.ok(!normalReturn.includes(`<summary>${DETAILS[language]}</summary>`), "normal values need no extra disclosure");
      assert.ok(visibleText(normalReturn).includes(AS_OF[language]), "a normal card keeps as-of visible");
    }

    /* ---------- latest daily change is not bounded by the browser's month ---------- */
    const dayCell = (date, amount, reason = null) => ({
      date, amount, return_percent: null, currency: "USD", status: amount === null ? "no_data" : "ok",
      value_kind: "asset_change", unavailable_reason: reason,
    });
    // Dates stay far in the past so no clock can make them future.
    const emptyMonth = {
      ...meta, status: "no_data", unavailable_reason: "snapshot_history_missing", as_of: "2020-01-31",
      value_kind: "asset_change", year: 2020, month: 2,
      cells: [dayCell("2020-02-01", null, "snapshot_missing"), dayCell("2020-02-02", null, "non_trading_weekend")],
    };
    const carriedMonth = {
      ...meta, status: "stale", unavailable_reason: null, as_of: "2020-01-31",
      value_kind: "asset_change", year: 2020, month: 1,
      cells: [dayCell("2020-01-30", 456), dayCell("2020-01-31", 789)],
    };
    assert.deepEqual(ui.carryoverMonthForLatestDay(emptyMonth), { year: 2020, month: 1 },
      "an empty request month resolves to the month that holds the latest observation");
    assert.equal(ui.carryoverMonthForLatestDay(carriedMonth), null,
      "a month that already has a value asks for nothing else");
    assert.equal(ui.carryoverMonthForLatestDay({ ...emptyMonth, month: 1, as_of: "2020-02-05" }), null,
      "a later month is never fetched to answer for an earlier one");
    assert.equal(ui.carryoverMonthForLatestDay({ ...emptyMonth, as_of: null }), null,
      "without a latest observation there is nothing to resolve");
    assert.equal(ui.carryoverMonthForLatestDay({ ...emptyMonth, month: null }), null,
      "the year view is not a month request and carries nothing over");
    const NO_DATA = { zh: "暂无数据", en: "No data" };
    for (const language of ["zh", "en"]) {
      const unresolved = ui.renderLastDay(language, { phase: "ready", data: emptyMonth, error: null });
      assert.ok(visibleText(unresolved).includes("—"), "an empty month keeps an honest blank");
      assert.ok(visibleText(unresolved).includes(NO_DATA[language]));
      assert.ok(!visibleText(unresolved).includes("789"), "no value is invented for the month that has none");

      const carried = ui.renderLastDay(language, { phase: "ready", data: emptyMonth, error: null },
        { year: 2020, month: 1 }, { phase: "ready", data: carriedMonth, error: null });
      assert.ok(visibleText(carried).includes("789"),
        "the latest provable daily change surfaces instead of an empty current month");
      assert.ok(visibleText(carried).includes(ASSET_CHANGE[language]), "the carried value keeps its method label");
      assert.ok(visibleText(carried).includes(AS_OF[language]), "the carried value states which day it covers");
      assert.ok(!visibleText(carried).includes("456"), "only the latest day is shown, not the whole month");
      assert.ok(!visibleText(carried).includes(NO_DATA[language]), "a resolved month is not reported as having no data");
      assert.ok(carried.includes('data-status="stale"'), "the cohort lag stays visible as a status on the carried month");

      const pending = ui.renderLastDay(language, { phase: "ready", data: emptyMonth, error: null },
        { year: 2020, month: 1 }, { phase: "loading", data: null, error: null });
      assert.ok(!visibleText(pending).includes(NO_DATA[language]),
        "a month being fetched never announces no data first");
      const failedCarry = ui.renderLastDay(language, { phase: "ready", data: emptyMonth, error: null },
        { year: 2020, month: 1 }, { phase: "error", data: null, error: Error("synthetic_read_failed") });
      assert.ok(visibleText(failedCarry).includes(NO_DATA[language]),
        "a failed follow-up falls back to the month that was asked for instead of claiming a read failure");
    }

    /* ---------- a weekend date is never called a business day ---------- */
    const WEEKEND = { zh: "纽约日期", en: "New York date" };
    const BUSINESS = { zh: "纽约业务日", en: "New York business day" };
    for (const language of ["zh", "en"]) {
      const weekendData = { ...data, date: "2020-01-31", market_session: "weekend",
        counts: { configured: 8, observed: 0, runs: null },
        accounts: [{ status: "no_data", unavailable_reason: "non_trading_weekend" }] };
      const weekend = ui.render(language, { phase: "ready", data: weekendData });
      assert.ok(weekend.includes("0/8"), "the weekend count itself is unchanged");
      assert.ok(weekend.includes(WEEKEND[language]), "the date next to the count is stated as a date");
      assert.ok(!weekend.includes(BUSINESS[language]), "a Saturday is never labelled a business day");
      assert.ok(weekend.includes(language === "zh" ? "非交易日" : "Non-trading day"), "the non-trading badge still carries the state");
      const tradingDay = ui.render(language, { phase: "ready", data: { ...weekendData, market_session: "trading_day" } });
      assert.ok(tradingDay.includes(BUSINESS[language]), "a trading day keeps the business-day wording");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
