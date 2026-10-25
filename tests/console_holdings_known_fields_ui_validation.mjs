import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";

const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), "holdings-known-fields-ui-"));
try {
  const outfile = join(directory, "render.cjs");
  await build({
    stdin: { resolveDir: root, contents: `import { createElement as h } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { I18nProvider, translate } from './src/i18n';
      import { PrefsContext } from './src/app/context';
      import { DEFAULT_PREFERENCES } from './src/lib/prefs';
      import { HoldingsTab } from './src/pages/performance/PerformanceTabs';
      export { translate };
      export const render = (language, state, hideAmounts = false) => renderToStaticMarkup(
        h(I18nProvider, { language },
          h(PrefsContext.Provider, {
            value: { prefs: { ...DEFAULT_PREFERENCES, language, hideAmounts }, resolvedTheme: 'light', setPrefs: () => {} },
          }, h(HoldingsTab, { state: { reload: () => {}, ...state } }))));` },
    bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic",
    loader: { ".css": "empty" }, define: { "import.meta.env": "{}" },
    plugins: [{ name: "read-only-holdings-fixture", setup(b) {
      b.onLoad({ filter: /\/PerformanceTabs\.tsx$/ }, async ({ path }) => ({
        contents: await readFile(path, "utf8") + "\nexport { HoldingsTab };", loader: "tsx",
      }));
    } }],
  });
  const ui = createRequire(import.meta.url)(outfile);
  const ready = data => ({ phase: "ready", data, error: null });

  const cellText = html => html.replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ").trim();
  const tableRows = html => {
    const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
    return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(match =>
      [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => cellText(cell[1])));
  };
  // Column order mirrors HoldingsTab: account, symbol, quantity, market value, avg cost, unrealized P/L, status.
  const rowFor = (html, symbol) => {
    const row = tableRows(html).find(cells => cells[1] === symbol);
    assert.ok(row, `rendered row missing for ${symbol}`);
    return { quantity: row[2], market: row[3], avgCost: row[4], pnl: row[5], status: row[6], cells: row };
  };

  const account = { account_alias: "synth-example", platform: "ibkr", currency: "USD", coverage: "stocks_only" };
  const partialKnown = { ...account, symbol: "SYNTH_PARTIAL_KNOWN", quantity: 1200, market_value: 3456.78,
    avg_cost: null, unrealized_pnl: null, status: "partial", unavailable_reason: "avg_cost_missing" };
  const staleKnown = { ...account, symbol: "SYNTH_STALE_KNOWN", quantity: 42, market_value: 5000,
    avg_cost: 100, unrealized_pnl: 800, status: "stale", unavailable_reason: "positions_stale" };
  const readFailed = { ...account, symbol: "SYNTH_READ_FAILED", quantity: 987654, market_value: 987654.32,
    avg_cost: 987654.32, unrealized_pnl: 987654.32, status: "read_failed", unavailable_reason: "stored_records_unreadable" };
  const zero = { ...account, symbol: "SYNTH_ZERO", quantity: 0, market_value: 0, avg_cost: 0,
    unrealized_pnl: 0, status: "ok", unavailable_reason: null };
  const negative = { ...account, symbol: "SYNTH_NEGATIVE", quantity: -5, market_value: -250.25, avg_cost: 10,
    unrealized_pnl: -12.5, status: "ok", unavailable_reason: null };
  const missing = { ...account, symbol: "SYNTH_MISSING", quantity: null, market_value: null, avg_cost: null,
    unrealized_pnl: null, status: "partial", unavailable_reason: "position_value_missing" };

  const response = rows => ({
    schema_version: "console_api.v1",
    scope: "synth-example",
    range: "YTD",
    status: "partial",
    unavailable_reason: "positions_partial_coverage",
    as_of: "2026-10-20T20:00:00.000Z",
    value_kind: "pnl",
    coverage: { account_aliases: ["synth-example"] },
    freshness_summary: { fresh: 0, stale: 0, unknown: 1, threshold_hours: 48 },
    label_key: "performance.current_holdings_unrealized",
    rows,
  });

  test("a partial row keeps its known quantity and market value; only the missing fields stay unknown", () => {
    for (const language of ["zh", "en"]) {
      const data = response([partialKnown, staleKnown]);
      const before = structuredClone(data);
      const html = ui.render(language, ready(data));
      const partial = rowFor(html, partialKnown.symbol);
      assert.equal(partial.quantity, "1,200", "known quantity survives a partial row");
      assert.equal(partial.market, "USD 3,456.78", "known market value keeps its currency");
      assert.equal(partial.avgCost, "—", "a missing avg cost is unknown, not zero");
      assert.equal(partial.pnl, "—", "a missing unrealized P/L is unknown, not zero");
      assert.equal(partial.status, "", "data availability remains a hidden diagnostic rather than visible text");
      assert.ok(html.includes('data-status="partial"'), "exact source status stays available for debugging");
      assert.ok(!partial.cells.slice(2).some(text => text === "0.00"), "missing fields are never rendered as zero");

      const stale = rowFor(html, staleKnown.symbol);
      assert.equal(stale.quantity, "42");
      assert.equal(stale.market, "USD 5,000.00");
      assert.equal(stale.avgCost, "USD 100.00");
      assert.equal(stale.pnl, "+USD 800.00", "a positive unrealized P/L keeps its signed form");
      assert.equal(stale.status, "", "data availability remains a hidden diagnostic rather than visible text");
      assert.ok(html.includes('data-status="stale"'), "exact source status stays available for debugging");
      assert.deepEqual(data, before, "rendering must not complete or mutate the response");
    }
  });

  test("an unrenderable row hides every financial value even when numbers linger", () => {
    for (const language of ["zh", "en"]) {
      const data = response([readFailed, partialKnown]);
      const before = structuredClone(data);
      const html = ui.render(language, ready(data));
      const failed = rowFor(html, readFailed.symbol);
      assert.equal(failed.quantity, "—");
      assert.equal(failed.market, "—");
      assert.equal(failed.avgCost, "—");
      assert.equal(failed.pnl, "—");
      assert.equal(failed.status, "", "data availability remains a hidden diagnostic rather than visible text");
      assert.ok(html.includes('data-status="read_failed"'), "exact source status stays available for debugging");
      assert.ok(!html.includes("987,654"), "a read_failed row never leaks its residual values");
      assert.ok(!html.includes("987654.32"));
      assert.equal(rowFor(html, partialKnown.symbol).quantity, "1,200", "one failed row cannot hide another row's known values");
      assert.deepEqual(data, before);
    }
  });

  test("legal zero and negative values are rendered as values", () => {
    for (const language of ["zh", "en"]) {
      const html = ui.render(language, ready(response([zero, negative])));
      const zeros = rowFor(html, zero.symbol);
      assert.equal(zeros.quantity, "0");
      assert.equal(zeros.market, "USD 0.00");
      assert.equal(zeros.avgCost, "USD 0.00");
      assert.equal(zeros.pnl, "USD 0.00");
      assert.equal(zeros.status, "", "an ok row adds no status badge");

      const negatives = rowFor(html, negative.symbol);
      assert.equal(negatives.quantity, "-5");
      assert.match(negatives.market, /^-?USD -?250\.25$/);
      assert.equal(negatives.avgCost, "USD 10.00");
      assert.match(negatives.pnl, /^-USD 12\.50$/, "a negative P/L keeps its sign");
    }
  });

  test("null and non-finite fields stay unknown, and an unknown field is never zero", () => {
    for (const language of ["zh", "en"]) {
      const html = ui.render(language, ready(response([missing])));
      const row = rowFor(html, missing.symbol);
      assert.equal(row.quantity, "—");
      assert.equal(row.market, "—");
      assert.equal(row.avgCost, "—");
      assert.equal(row.pnl, "—");

      const nonFinite = { ...account, symbol: "SYNTH_NONFINITE", quantity: NaN, market_value: Infinity,
        avg_cost: -Infinity, unrealized_pnl: NaN, status: "partial", unavailable_reason: "position_value_missing" };
      const nonFiniteHtml = ui.render(language, ready(response([nonFinite])));
      const other = rowFor(nonFiniteHtml, nonFinite.symbol);
      assert.equal(other.quantity, "—");
      assert.equal(other.market, "—");
      assert.equal(other.avgCost, "—");
      assert.equal(other.pnl, "—");
      assert.ok(!nonFiniteHtml.includes("Infinity") && !nonFiniteHtml.includes("NaN"));
    }
  });

  test("hidden amounts preserve negative signs and unknown cells without exposing values", () => {
    for (const language of ["zh", "en"]) {
      const html = ui.render(language, ready(response([partialKnown, staleKnown, negative])), true);
      for (const [symbol, expected] of [
        [partialKnown.symbol, ["•••", "—", "—"]],
        [staleKnown.symbol, ["•••", "•••", "•••"]],
        [negative.symbol, ["−•••", "•••", "−•••"]],
      ]) {
        const row = rowFor(html, symbol);
        assert.deepEqual([row.market, row.avgCost, row.pnl], expected);
      }
      for (const amount of ["3,456.78", "5,000.00", "250.25", "800.00"]) {
        assert.ok(!html.includes(amount), `hidden amounts must not expose ${amount}`);
      }
    }
  });

  test("the existing single caption, sort controls and empty state are unchanged", () => {
    for (const language of ["zh", "en"]) {
      const html = ui.render(language, ready(response([partialKnown, staleKnown])));
      assert.equal(html.match(/class="card-note"/g)?.length, 1, "no extra explanation block is added");
      assert.ok(html.includes('aria-sort="descending"'), "the default market-value sort is kept");
      assert.ok(html.includes('class="table-sort"'));
      assert.ok(html.includes("<caption"));
      assert.equal(html.split("—").length - 1, 2, "only the two missing fields render as unknown");

      const unrenderable = ui.render(language, ready({ ...response([partialKnown]), status: "unavailable" }));
      assert.ok(!unrenderable.includes("<table"), "a non-renderable response still shows no holdings");
      assert.ok(!unrenderable.includes("1,200"));
    }
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
