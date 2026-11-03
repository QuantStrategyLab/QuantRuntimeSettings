// Desk performance page: benchmark adapter, stats, selection storage, honest states and rendered panel.
// Synthetic inputs only (fake dates and prices).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import * as B from "../web/strategy-switch-console/frontend/src/desk/performance/benchmarks.ts";
import { formatPct, formatPts } from "../web/strategy-switch-console/frontend/src/desk/performance/perfFormat.ts";
import { DESK_MESSAGES } from "../web/strategy-switch-console/frontend/src/desk/i18n/index.ts";
import { benchmarkResponse, PERF_DATES } from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/performance.ts";
import { createDeskApi } from "../web/strategy-switch-console/frontend/src/desk/api/endpoints.ts";

const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const src = path => readFileSync(`${root}src/${path}`, "utf8");
const W = { start: "2026-01-02", end: "2026-03-27" };

const series = (symbol, id, over = {}) => ({
  id, symbol, label_en: symbol, label_zh: symbol, status: "available", unavailable_reason: null,
  base_date: W.start, last_date: W.end,
  points: [{ date: "2026-01-02", cumulative_return_ratio: 0 }, { date: "2026-02-02", cumulative_return_ratio: 0.1 }, { date: "2026-03-27", cumulative_return_ratio: 0.2 }],
  ...over,
});
const body = (list, over = {}) => ({ ok: true, schema_version: "qsl.performance_benchmarks.v1", status: "available", window: W, return_basis: "etf_close_price_return", currency: "USD", series: list, ...over });
const four = () => [series("SPY", "sp500"), series("QQQ", "nasdaq100"), series("IWM", "russell2000"), series("DIA", "djia")];
const DEFAULT = ["spx", "ndx", "rut", "dji"];

// 1. Adapter: four served series are full; extras absent from the response stay unavailable (never zero).
let model = B.parseBenchmarks(body(four()), W);
for (const key of B.MAIN_KEYS) assert.equal(model.series[key].coverage, "full", key);
for (const key of B.EXTRA_KEYS) { assert.equal(model.series[key].coverage, "unavailable", key); assert.deepEqual(model.series[key].points, []); }
assert.equal(model.returnBasis, "etf_close_price_return");

// 2. Extras are matched by symbol from a fixed allow-list; unknown symbols are ignored.
model = B.parseBenchmarks(body([...four(), series("SOXX", "sox"), series("URTH", "msci_world"), series("EEM", "msci_em"), series("ZZZZ", "evil")]), W);
for (const key of B.BENCH_KEYS) assert.equal(model.series[key].coverage, "full", key);
assert.equal(Object.keys(model.series).length, 7);
assert.equal(model.series.sox.points.length, 3);
model = B.parseBenchmarks(body([series("SPY", "nasdaq100")]), W);
assert.equal(model.series.spx.coverage, "unavailable", "known symbol under another id is not trusted");
model = B.parseBenchmarks(body([series("SPY", "sp500"), series("SPY", "sp500")]), W);
assert.equal(model.series.spx.coverage, "unavailable", "duplicate symbol");

// 3. Fail closed on the envelope and on each series.
const noOk = body(four()); delete noOk.ok;
const noStatus = body(four()); delete noStatus.status;
const badEnvelopes = {
  error_envelope: body(four(), { ok: false, error: "performance_benchmark_unavailable" }),
  ok_not_boolean_true: body(four(), { ok: "true" }),
  missing_ok: noOk,
  status_unavailable: body(four(), { status: "unavailable" }),
  status_unknown: body(four(), { status: "unknown" }),
  status_missing: noStatus,
};
for (const [name, raw] of Object.entries(badEnvelopes)) assert.equal(B.parseBenchmarks(raw, W), null, `envelope rejected: ${name}`);
assert.notEqual(B.parseBenchmarks(body(four(), { status: "partial" }), W), null, "partial envelope still accepted");
assert.equal(B.parseBenchmarks(null, W), null);
assert.equal(B.parseBenchmarks(body(four(), { schema_version: "other" }), W), null);
assert.equal(B.parseBenchmarks(body(four(), { window: { start: "2026-01-03", end: W.end } }), W), null, "other window");
assert.equal(B.parseBenchmarks(body(four(), { return_basis: "" }), W), null);
const bad = over => B.parseBenchmarks(body([series("SPY", "sp500", over)]), W).series.spx;
assert.equal(bad({ status: "unavailable", points: [], base_date: null, last_date: null }).coverage, "unavailable");
assert.equal(bad({ points: [] }).coverage, "unavailable", "available without points is not zeros");
assert.equal(bad({ points: [{ date: "2026-01-02", cumulative_return_ratio: 0.01 }, { date: "2026-03-27", cumulative_return_ratio: 0.2 }] }).coverage, "unavailable", "first value must be 0");
assert.equal(bad({ points: [{ date: "2026-01-02", cumulative_return_ratio: 0 }, { date: "2026-03-27", cumulative_return_ratio: "0.2" }] }).coverage, "unavailable");
assert.equal(bad({ points: [{ date: "2026-01-02", cumulative_return_ratio: 0 }, { date: "2026-01-02", cumulative_return_ratio: 0.1 }, { date: "2026-03-27", cumulative_return_ratio: 0.2 }] }).coverage, "unavailable", "duplicate date");
assert.equal(bad({ points: [{ date: "2026-01-02", cumulative_return_ratio: 0 }, { date: "2026-03-27", cumulative_return_ratio: -1 }] }).coverage, "unavailable");
assert.equal(bad({ points: [{ date: "2026-01-02", cumulative_return_ratio: 0 }, { date: "2026-02-30", cumulative_return_ratio: 0.1 }, { date: "2026-03-27", cumulative_return_ratio: 0.2 }] }).coverage, "unavailable", "impossible date");
const late = bad({ status: "partial", base_date: "2026-02-02", points: [{ date: "2026-02-02", cumulative_return_ratio: 0 }, { date: "2026-03-27", cumulative_return_ratio: 0.2 }] });
assert.equal(late.coverage, "partial"); assert.deepEqual(late.points, []); assert.equal(late.baseDate, "2026-02-02");
assert.equal(bad({ last_date: "2026-03-20" }).coverage, "partial", "anchors differing from the strategy window are not full");

// 4. Stats formulas.
const pts = [["2026-01-01", 0], ["2026-04-01", 0.5], ["2026-07-01", 0.2], ["2026-10-01", 0.8]].map(([date, value]) => ({ date, value }));
const stats = B.computeStats(pts);
assert.equal(stats.ret, 0.8);
assert.ok(Math.abs(stats.maxDrawdown - (1.2 / 1.5 - 1)) < 1e-12, "(1.2/1.5)-1 = -20%");
const days = (Date.parse("2026-10-01") - Date.parse("2026-01-01")) / 86400000;
assert.ok(Math.abs(stats.cagr - (1.8 ** (365.25 / days) - 1)) < 1e-12);
assert.equal(B.computeStats([{ date: "2026-01-01", value: 0 }, { date: "2026-01-10", value: 0.05 }]).cagr, null, "window < 30 days has no CAGR");
assert.deepEqual(B.computeStats([{ date: "2026-01-01", value: 0 }]), { ret: null, cagr: null, maxDrawdown: null });
assert.equal(B.computeStats([{ date: "2026-01-01", value: 0 }, { date: "2026-06-01", value: -1 }]).ret, null);
assert.ok(Math.abs(B.excessPts(0.6, 0.4) - 20) < 1e-9);
assert.equal(B.excessPts(null, 0.4), null);
assert.equal(B.excessPts(0.6, null), null);
assert.equal(B.cagrGapPts({ ret: 1, cagr: 0.173, maxDrawdown: 0 }, null), null);
assert.ok(Math.abs(B.cagrGapPts({ ret: 1, cagr: 0.173, maxDrawdown: 0 }, { ret: 0, cagr: 0.138, maxDrawdown: 0 }) - 3.5) < 1e-9);

// 5. Portfolio curve and gaps.
const curve = B.portfolioCurve(["2026-01-02", "2026-01-05", "2026-01-06"], ["100", "110", "99"], []);
assert.deepEqual(curve.points.map(p => Math.round(p.value * 1e6) / 1e6), [0, 0.1, -0.01]);
assert.equal(B.portfolioCurve(["2026-01-02"], ["100"]), null);
assert.equal(B.portfolioCurve(["2026-01-02", "2026-01-05"], ["100"]), null, "length mismatch");
assert.equal(B.portfolioCurve(["2026-01-05", "2026-01-02"], ["100", "101"]), null, "unsorted");
assert.equal(B.portfolioCurve(["2026-01-02", "2026-01-05"], ["0", "101"]), null);
assert.equal(B.portfolioCurve(["2026-01-02", "2026-01-05"], [100, 101]), null, "numbers are not decimal strings");
const daily = [...Array(10)].map((_, i) => ({ date: `2026-01-${String(i + 5).padStart(2, "0")}`, value: i / 100 }));
assert.deepEqual(B.segments(daily), [[0, 9]]);
assert.equal(B.segments([...daily.slice(0, 4), ...daily.slice(9)]).length, 2, "a >5 day hole breaks a daily line");
assert.equal(B.segments([{ date: "2026-01-01", value: 0 }, { date: "2026-01-03", value: 0 }, { date: "2026-01-05", value: 0 }], ["2026-01-02"]).length, 2, "listed gap date breaks the line");
assert.equal(B.segments(PERF_DATES.map((date, value) => ({ date, value }))).length, 1, "weekly data is not shredded");
assert.equal(B.valueAt(daily, "2026-01-06"), 0.01);
assert.equal(B.valueAt(daily, "2026-01-04"), null, "absent date is absent, no carry-forward");

// 6. y axis recomputes from visible lines only.
const big = [{ date: "2026-01-01", value: 0 }, { date: "2026-02-01", value: 0.9 }];
const small = [{ date: "2026-01-01", value: 0 }, { date: "2026-02-01", value: 0.1 }];
assert.ok(B.yAxis([big, small]).max >= 0.9);
assert.ok(B.yAxis([small]).max < 0.2, "hiding the big line shrinks the domain");
assert.ok(B.yAxis([]).ticks.includes(0));
const nudged = B.nudgeLabels([100, 101, 102, 300], 16, 10, 400);
assert.ok(nudged[1] - nudged[0] >= 16 && nudged[2] - nudged[1] >= 16 && nudged[3] === 300);

// 7. Selection persistence: default, round trip, corrupt, unknown keys, all off, storage failures.
const store = initial => { const m = new Map(initial === undefined ? [] : [[B.PERF_BENCH_STORAGE_KEY, initial]]); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };
assert.deepEqual(B.loadSelection(store()), DEFAULT, "default: main four on, extras off");
assert.deepEqual(B.loadSelection(store("not json")), DEFAULT);
assert.deepEqual(B.loadSelection(store('{"a":1}')), DEFAULT);
assert.deepEqual(B.loadSelection(store('["spx","bogus",7,"sox"]')), ["spx", "sox"], "unknown keys ignored, extras restored");
assert.deepEqual(B.loadSelection(store("[]")), [], "all off is allowed");
const s = store(); B.saveSelection(["em", "spx"], s); assert.equal(s.m.get("meridian.perf.benchmarks"), '["spx","em"]');
assert.doesNotThrow(() => B.saveSelection(["spx"], { getItem() { return null; }, setItem() { throw new Error("quota"); } }));
assert.deepEqual(B.loadSelection({ getItem() { throw new Error("blocked"); }, setItem() {} }), DEFAULT);
assert.deepEqual(B.loadSelection(null), DEFAULT);

// 8. Formatting never prints a missing value as zero.
assert.equal(formatPct(null), "—"); assert.equal(formatPct(NaN), "—"); assert.equal(formatPts(null), "—");
assert.equal(formatPct(-0.0889), "−8.9%"); assert.equal(formatPct(0.612), "+61.2%"); assert.equal(formatPct(0.0001), "0.0%"); assert.equal(formatPts(-7.64), "−7.6");

// 9. Mock fixture mirrors the merged API: only four ETFs, parses against the strategy window.
const win = { start: PERF_DATES[0], end: PERF_DATES[PERF_DATES.length - 1] };
const mock = B.parseBenchmarks(benchmarkResponse(win.start, win.end), win);
for (const key of B.MAIN_KEYS) assert.equal(mock.series[key].coverage, "full", key);
for (const key of B.EXTRA_KEYS) assert.equal(mock.series[key].coverage, "unavailable", key);
const degraded = B.parseBenchmarks(benchmarkResponse(win.start, win.end, "degraded"), win);
assert.equal(degraded.series.rut.coverage, "partial"); assert.equal(degraded.series.dji.coverage, "unavailable");

// 10. API wiring: live path uses the actual window; a fetch error rejects (page shows unavailable).
const calls = [];
const api = createDeskApi({ forcedScenario: null, delayMs: 0, fetchJson: async path => { calls.push(path); throw new Error("503"); } });
await assert.rejects(api.benchmarks(W, "live", null));
assert.deepEqual(calls, ["/api/market-benchmark/performance?start=2026-01-02&end=2026-03-27"]);
await assert.rejects(api.benchmarks(W, "mock", "fail"));
assert.equal(calls.length, 1, "mock never calls the network");

// 11. Copy parity for the new keys and token-only styling, light and dark.
const zh = DESK_MESSAGES.zh, en = DESK_MESSAGES.en;
const perfKeys = Object.keys(zh).filter(k => k.startsWith("perf."));
assert.ok(perfKeys.length >= 30);
for (const k of perfKeys) assert.ok(zh[k].trim() && en[k].trim(), k);
for (const [key, proxy] of [["sox", "SOXX"], ["world", "URTH"], ["em", "EEM"]]) {
  assert.ok(en[`perf.bench.${key}`].includes(proxy) && zh[`perf.bench.${key}`].includes(proxy), `${key} names its ETF proxy`);
}
assert.match(zh["perf.kpi.vs_spx"], /较标普 500 \{d\} 个百分点/); assert.equal(en["perf.kpi.vs_spx"], "{d} pts vs S&P 500");
const blocks = src("app/tokens.css").split(/\[data-theme=["']?dark["']?\]/);
for (const token of ["--mrd-p", ...B.BENCH_KEYS.map(k => B.BENCH_META[k].token)]) {
  assert.ok(blocks[0].includes(`${token}:`) && blocks[1].includes(`${token}:`), `${token} defined in light and dark`);
}
assert.equal(new Set(B.BENCH_KEYS.map(k => B.BENCH_META[k].token)).size, 7, "distinct token per series");
assert.equal(new Set(B.BENCH_KEYS.map(k => B.BENCH_META[k].dash)).size, 7, "distinct dash per series");
for (const file of ["desk/styles/desk.css", "desk/performance/perfStyles.ts", "desk/performance/BenchmarkChart.tsx", "desk/performance/BenchmarkPanel.tsx"]) {
  assert.equal((src(file).match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) || []).length, 0, `no raw colours in ${file}`);
}

// 12. Rendered panel (server render with fake data).
const directory = await mkdtemp(join(tmpdir(), "desk-bench-ui-"));
try {
  const outfile = join(directory, "render.cjs");
  await build({ stdin: { resolveDir: root, contents: `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { BenchmarkPanel } from './src/desk/performance/BenchmarkPanel';
    import { deskTranslate } from './src/desk/i18n';
    import { computeStats, parseBenchmarks, portfolioCurve } from './src/desk/performance/benchmarks.ts';
    export const render = (language, raw, selection, phase = 'ready') => {
      const dates = ['2026-01-02', '2026-02-02', '2026-03-27'];
      const curve = portfolioCurve(dates, ['100', '125', '150']);
      const window = { start: dates[0], end: dates[2] };
      const model = raw ? parseBenchmarks(raw, window) : null;
      const benchmarks = phase === 'failed' || !model ? { phase: 'failed' } : { phase: 'ready', model };
      return renderToStaticMarkup(h(BenchmarkPanel, { t: (k, p) => deskTranslate(language, k, p), language, portfolio: curve,
        portfolioStats: computeStats(curve.points), window, benchmarks, initialSelection: selection }));
    };
  ` }, bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", logLevel: "silent" });
  const { render } = createRequire(import.meta.url)(outfile);
  const lineIds = html => [...html.matchAll(/<g data-series="(\w+)" style=/g)].map(m => m[1]);
  const row = (html, key) => html.match(new RegExp(`<tr[^>]*data-series="${key}"[\\s\\S]*?</tr>`))[0];
  const plain = html => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

  let html = render("en", body(four()), DEFAULT);
  assert.deepEqual(lineIds(html), ["pf", "spx", "ndx", "rut", "dji"]);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /id="mrd-bench-extras"[^>]*display:none[^>]*hidden=""/, "more benchmarks hidden by default");
  for (const key of DEFAULT) assert.match(html, new RegExp(`<button[^>]*aria-pressed="true"[^>]*data-series="${key}"`));
  assert.match(html, /<button[^>]*aria-pressed="false"[^>]*data-series="sox"/);
  assert.ok(!/<tr[^>]*data-series="sox"/.test(html), "extras rows not listed while collapsed");
  assert.match(plain(html), /pts vs S&amp;P 500/);
  assert.match(plain(html), /unadjusted close price return, dividends not reinvested · as of 27 Mar 2026/);
  assert.match(plain(row(html, "spx")), /\+20\.0%/);
  assert.match(plain(row(html, "spx")), /\+30\.0 pts/, "excess = 50% - 20%");

  html = render("en", body(four()), ["ndx"]);
  assert.deepEqual(lineIds(html), ["pf", "ndx"]);
  assert.match(row(html, "spx"), /data-hidden="true"/); assert.match(plain(row(html, "spx")), /hidden/);
  assert.ok(!html.includes('data-series="spx" x='), "no end label for a hidden series");
  assert.deepEqual(lineIds(render("zh", body(four()), [])), ["pf"], "all off leaves the portfolio alone");

  html = render("en", body(four()), ["spx", "sox", "em"]);
  assert.match(html, /aria-expanded="true"/, "disclosure auto-opens when an extra is on");
  assert.ok(!/id="mrd-bench-extras"[^>]*hidden=""/.test(html));
  assert.deepEqual(lineIds(html), ["pf", "spx"], "extras the API does not serve draw no line");
  assert.match(plain(row(html, "sox")), /Data unavailable/);
  assert.match(plain(row(html, "sox")), /SOX \(via SOXX\).*— — — —/);
  assert.ok(row(html, "sox").includes('data-sign="none"'));
  assert.match(plain(html), /These are ETF price-return proxies, not the indices themselves\./);
  html = render("zh", body([...four(), series("SOXX", "sox")]), ["sox"]);
  assert.deepEqual(lineIds(html), ["pf", "sox"], "a served extra draws like the main four");
  assert.match(plain(row(html, "sox")), /费城半导体指数（SOXX 代理）/);

  html = render("en", body([series("SPY", "sp500"), series("IWM", "russell2000", { status: "partial", base_date: "2026-02-02", points: [] }), series("DIA", "djia", { status: "unavailable", base_date: null, last_date: null, points: [], unavailable_reason: "benchmark_history_missing" })]), DEFAULT);
  assert.deepEqual(lineIds(html), ["pf", "spx"]);
  assert.match(plain(row(html, "rut")), /From 2 Feb 2026 — — — —/);
  assert.match(plain(row(html, "dji")), /Data unavailable — — — —/);
  assert.match(plain(row(html, "ndx")), /Data unavailable/, "series missing from the response");
  assert.ok(!/data-sign="(pos|neg|zero)"/.test(row(html, "rut") + row(html, "dji")));
  assert.match(plain(render("zh", body([series("IWM", "russell2000", { status: "partial", base_date: "2026-02-02", points: [] })]), ["rut"])), /自 2026-02-02 起/);

  for (const failed of [render("en", null, ["spx", "ndx"], "failed"), render("en", body(four(), { schema_version: "x" }), ["spx", "ndx"])]) {
    assert.deepEqual(lineIds(failed), ["pf"]);
    assert.match(plain(failed), /Benchmark data could not be loaded\. The portfolio is shown alone\./);
    assert.match(plain(failed), /S&amp;P 500 comparison unavailable/);
    assert.match(plain(failed), /No benchmark has data for this window\./);
    assert.ok(!/data-sign="(pos|neg|zero)"/.test(failed));
  }
  for (const [name, raw] of Object.entries(badEnvelopes)) {
    const html = render("en", raw, DEFAULT);
    assert.deepEqual(lineIds(html), ["pf"], `rendered: no benchmark line for ${name}`);
    assert.ok(!/data-sign="(pos|neg|zero)"/.test(row(html, "spx")), `rendered: no SPY stats for ${name}`);
    assert.match(plain(html), /Benchmark data could not be loaded\. The portfolio is shown alone\./, name);
  }
  assert.deepEqual(lineIds(render("en", body(four(), { status: "partial" }), DEFAULT)).includes("spx"), true, "valid partial envelope still renders");
} finally { await rm(directory, { recursive: true, force: true }); }

console.log("console desk benchmarks validation passed");
