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
        import { RunsKpi, AssetKpi, ReturnKpi, LastDayKpi } from './src/pages/overview/OverviewPage';
        import { I18nProvider } from './src/i18n';
        export const render = (language, state) => renderToStaticMarkup(
          createElement(I18nProvider, { language }, createElement(RunsKpi, { state })));
        export const renderAsset = (language, state) => renderToStaticMarkup(
          createElement(I18nProvider, { language }, createElement(AssetKpi, { state })));
        export const renderReturn = (language, state) => renderToStaticMarkup(
          createElement(I18nProvider, { language }, createElement(ReturnKpi, { state })));
        export const renderLastDay = (language, state) => renderToStaticMarkup(
          createElement(I18nProvider, { language }, createElement(LastDayKpi, { state })));` },
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
      assert.equal(data.counts.runs, null);
      const empty = ui.render(language, { phase: "ready", data: { ...data, counts: { ...data.counts, observed: 0 } } });
      assert.ok(empty.includes(language === "zh" ? "暂无数据" : "No data"));
      assert.ok(!empty.includes("0/8"));
      assert.ok(empty.includes("—"), "unknown run counts retain a compact empty value");
      const failed = ui.render(language, { phase: "error", error: Error("synthetic_read_failed") });
      assert.ok(failed.includes(language === "zh" ? "读取失败" : "Read failed"));
      assert.ok(!failed.includes("0/8"));
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
      assert.ok(!visibleText(mixedReturn).includes(MIXED_REASON[language]), "mixed-currency reason is not repeated in the default view");
      assert.ok(mixedReturn.includes(`<summary>${DETAILS[language]}</summary>`), "details control stays reachable");
      assert.ok(detailsText(mixedReturn).includes(MIXED_REASON[language]), "expanded details retain the original reason");
      assert.ok(detailsText(mixedReturn).includes(AS_OF[language]), "expanded details carry the corresponding as-of time");
      assert.ok(!visibleText(mixedReturn).includes("0.00%"), "an unavailable return is never rendered as zero");

      const assets = {
        ...meta, status: "ok", unavailable_reason: "mixed_currency", as_of: asOf, value_kind: "asset_change",
        currency: "USD", points: [{ date: "2026-10-20", value: 123 }], per_currency: [],
      };
      const mixedAssets = ui.renderAsset(language, { phase: "ready", data: assets });
      assert.ok(visibleText(mixedAssets).includes("—") && visibleText(mixedAssets).includes(UNAVAILABLE[language]));
      assert.ok(!visibleText(mixedAssets).includes(MIXED_REASON[language]));
      assert.ok(!visibleText(mixedAssets).includes("123"), "an uncombinable total is never shown as a value");
      assert.ok(detailsText(mixedAssets).includes(MIXED_REASON[language]));
      assert.ok(detailsText(mixedAssets).includes(AS_OF[language]));

      const calendar = {
        ...meta, status: "unavailable", unavailable_reason: "mixed_currency", as_of: asOf,
        value_kind: "asset_change", year: 2026, month: 10, cells: [],
      };
      const mixedDay = ui.renderLastDay(language, { phase: "ready", data: calendar });
      assert.ok(visibleText(mixedDay).includes("—") && visibleText(mixedDay).includes(UNAVAILABLE[language]));
      assert.ok(!visibleText(mixedDay).includes(MIXED_REASON[language]));
      assert.ok(detailsText(mixedDay).includes(MIXED_REASON[language]));
      assert.ok(detailsText(mixedDay).includes(AS_OF[language]));

      const staleCalendar = {
        ...calendar, status: "stale", unavailable_reason: null,
        cells: [{ date: "2020-01-02", amount: 123, return_percent: null, currency: "USD", status: "ok",
          value_kind: "asset_change", unavailable_reason: null }],
      };
      const staleDay = ui.renderLastDay(language, { phase: "ready", data: staleCalendar });
      assert.ok(visibleText(staleDay).includes("123"), "stale data still shows its real value");
      assert.ok(visibleText(staleDay).includes(ASSET_CHANGE[language]), "the normal method label stays next to the value");
      assert.ok(visibleText(staleDay).includes(STALE[language]), "stale stays visibly marked outside details");
      assert.ok(!visibleText(staleDay).includes(AS_OF[language]), "as-of moves out of the abnormal default view");
      assert.ok(detailsText(staleDay).includes(AS_OF[language]), "stale as-of remains reachable in details");

      const normalReturn = ui.renderReturn(language, { phase: "ready", data: {
        ...summary, unavailable_reason: null, twr_return_percent: 10, metric_reasons: { twr: null },
        cashflow_method: "modified_dietz", approximate: true,
      } });
      assert.ok(visibleText(normalReturn).includes("10.00%"), "a normal return keeps its value");
      assert.ok(visibleText(normalReturn).includes(METHOD[language]), "a normal return keeps its method label");
      assert.ok(!normalReturn.includes(`<summary>${DETAILS[language]}</summary>`), "normal values need no extra disclosure");
      assert.ok(visibleText(normalReturn).includes(AS_OF[language]), "a normal card keeps as-of visible");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
