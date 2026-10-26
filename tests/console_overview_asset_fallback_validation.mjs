import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Synthetic states only. When returns cannot be drawn (the mixed-currency case),
// the overview trend may show the real per-currency asset balance that the same
// assets read already returned — never a blended, rebased or TWR-labelled series.
const frontend = fileURLToPath(new URL("../web/strategy-switch-console/frontend/", import.meta.url));
const require = createRequire(join(frontend, "package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { buildSync } = require("esbuild");
const bundled = buildSync({
  stdin: {
    contents: 'export { TrendCard, assetBalanceHistories, selectAssetHistory } from "./pages/overview/OverviewPage"; export { LanguageContext } from "./i18n"; export { PrefsContext } from "./app/context";',
    resolveDir: join(frontend, "src"),
    loader: "tsx",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  // The page imports its stylesheet; the test only needs the component module.
  loader: { ".css": "empty" },
  define: { "import.meta.env": "{}" },
  external: ["react", "react-dom", "react/jsx-runtime"],
  write: false,
  logLevel: "silent",
}).outputFiles[0].text;
const component = { exports: {} };
new Function("require", "module", "exports", bundled)(require, component, component.exports);
const { TrendCard, assetBalanceHistories, selectAssetHistory, LanguageContext, PrefsContext } = component.exports;

const ready = data => ({ phase: "ready", data, error: null, reload() {} });
const loading = { phase: "loading", data: null, error: null, reload() {} };
const failed = { phase: "error", data: null, error: new Error("read_failed"), reload() {} };

const usdPoints = [
  { date: "2026-10-01", value: 1000 },
  { date: "2026-10-02", value: 1100, breakBefore: true },
  { date: "2026-10-05", value: 1090, partial: true },
];
const usdtPoints = [
  { date: "2026-10-01", value: 500 },
  { date: "2026-10-02", value: 520 },
];
const history = (currency, status, points, patch = {}) => ({
  currency, as_of: "2026-10-05T00:00:00Z", coverage: { omitted_dates: 0 },
  status, unavailable_reason: null, points, ...patch,
});
// All-account scope with both currencies: returns are unavailable, but the assets
// payload carries independent USD and USDT balances from the same request.
const mixedAssets = {
  status: "unavailable", unavailable_reason: "mixed_currency",
  curve_status: "unavailable", curve_unavailable_reason: "mixed_currency",
  currency: null, as_of: null, points: [],
  per_currency: [{ currency: "USD" }, { currency: "USDT" }],
  history_per_currency: [
    history("USD", "partial", usdPoints),
    history("USDT", "ok", usdtPoints),
  ],
};
const returnsUnavailable = {
  status: "unavailable", unavailable_reason: "mixed_currency", as_of: null,
  return_kind: "twr", points: [], aligned_start: null, benchmarks: [],
};

// Each currency stays its own raw balance series: no summation, FX conversion,
// rebasing to 100, or reuse of the other currency's points.
const histories = assetBalanceHistories(mixedAssets);
assert.deepEqual(histories.map(item => item.currency), ["USD", "USDT"], "one series per currency");
assert.deepEqual(histories[0].points.map(point => point.value), [1000, 1100, 1090]);
assert.deepEqual(histories[1].points.map(point => point.value), [500, 520]);
assert.equal(histories[0].points[1].breakBefore, true, "backend gap flags survive the fallback");
assert.equal(histories[0].status, "partial");
assert.equal(histories[0].partial, true, "a partial point keeps its partial semantics");
assert.ok(!histories.some(item => item.points.some(point => point.value === 1500 || point.value === 1620)),
  "USD and USDT are never added together");
assert.equal(selectAssetHistory(histories, "USDT").currency, "USDT", "the switch selects one currency only");
assert.deepEqual(selectAssetHistory(histories, "USDT").points.map(point => point.value), [500, 520]);
assert.equal(selectAssetHistory(histories, null).currency, "USD", "no selection falls back to the first real currency");
assert.equal(selectAssetHistory(histories, "EUR").currency, "USD", "a vanished selection never blanks the curve");
assert.equal(selectAssetHistory([], "USD"), null);

// Loading, read failures, unrenderable statuses and non-finite points never
// qualify as a curve. Mixed currency never borrows the unmerged top-level points.
assert.deepEqual(assetBalanceHistories(null), []);
for (const status of ["unavailable", "no_data", "not_connected", "read_failed"]) {
  assert.deepEqual(assetBalanceHistories({
    ...mixedAssets,
    history_per_currency: [history("USD", status, usdPoints), history("USDT", "ok", usdtPoints)],
  }).map(item => item.currency), ["USDT"], `${status} history stays out`);
}
assert.deepEqual(assetBalanceHistories({
  ...mixedAssets,
  history_per_currency: [history("USD", "ok", [{ date: "2026-10-01", value: Number.NaN }])],
}), [], "a non-finite balance is not a curve");
assert.deepEqual(assetBalanceHistories({
  ...mixedAssets,
  history_per_currency: [history("USD", "ok", [...usdPoints, { date: "2026-10-06", value: Number.POSITIVE_INFINITY }])],
})[0].points.map(point => point.value), [1000, 1100, 1090], "invalid points are dropped, valid ones kept");

// A non-finite point between two real ones is an unknown balance, never a bridge:
// the next drawn point must break, while its own flags and every real value stay.
const gappedPoints = [
  { date: "2026-10-01", value: 1000, membership_changed: true },
  { date: "2026-10-02", value: Number.NaN, breakBefore: true },
  { date: "2026-10-03", value: Number.POSITIVE_INFINITY },
  { date: "2026-10-04", value: 1200, partial: true },
];
const gappedInput = gappedPoints.map(point => ({ ...point }));
const gapped = assetBalanceHistories({
  ...mixedAssets,
  history_per_currency: [history("USD", "ok", gappedPoints)],
})[0];
assert.deepEqual(gapped.points.map(point => point.value), [1000, 1200],
  "dropped unknowns leave the real points untouched");
assert.equal(gapped.points[0].breakBefore, undefined, "no break is invented where nothing was dropped");
assert.equal(gapped.points[0].membership_changed, true, "real flags on a kept point survive");
assert.equal(gapped.points[1].breakBefore, true, "a dropped point breaks the line before the next real point");
assert.equal(gapped.points[1].partial, true, "the surviving point keeps its own state");
assert.equal(gapped.partial, true);
assert.deepEqual(gappedPoints, gappedInput, "the response points are never mutated in place");

// Leading and trailing unknowns are handled as ordinary points: dropped, with the
// real points left in order and untouched.
const edges = assetBalanceHistories({
  ...mixedAssets,
  history_per_currency: [history("USD", "ok", [
    { date: "2026-10-01", value: Number.NaN },
    { date: "2026-10-02", value: 1000 },
    { date: "2026-10-03", value: Number.NEGATIVE_INFINITY },
  ])],
})[0];
assert.deepEqual(edges.points.map(point => point.value), [1000],
  "head and tail unknowns leave the real point alone");
assert.equal(edges.points[0].breakBefore, true, "a dropped head still marks a break on the first drawn point");

assert.deepEqual(assetBalanceHistories({
  ...mixedAssets, history_per_currency: undefined, currency: "USD", points: usdPoints,
}), [], "mixed currency never becomes one unmerged top-level series");

// A single-currency payload without history_per_currency still uses the curve fields.
const singleData = {
  status: "ok", unavailable_reason: null, curve_status: "ok", curve_unavailable_reason: null,
  currency: "USD", as_of: "2026-10-02T00:00:00Z", points: usdPoints,
  curve_coverage: { omitted_dates: 0 },
};
const single = assetBalanceHistories(singleData);
assert.equal(single.length, 1);
assert.equal(single[0].currency, "USD");
assert.equal(single[0].status, "ok");
assert.deepEqual(assetBalanceHistories({ ...singleData, currency: null }), [],
  "an unlabelled balance is never guessed into a currency");

const render = (props, { language = "zh", hideAmounts = false } = {}) => {
  const card = React.createElement(LanguageContext.Provider, { value: language },
    React.createElement(TrendCard, props));
  if (!hideAmounts) return renderToStaticMarkup(card);
  return renderToStaticMarkup(React.createElement(PrefsContext.Provider, {
    value: { prefs: { hideAmounts: true }, resolvedTheme: "light", setPrefs() {} },
  }, card));
};

// Fallback: an asset-balance area chart, one currency at a time, with a real
// navigation entry. The card is no longer a role="button", so the currency
// buttons cannot sit inside a button or inherit its click/keydown.
const fallback = render({ returns: ready(returnsUnavailable), assets: ready(mixedAssets) });
assert.match(fallback, /aria-label="资产余额"/);
assert.doesNotMatch(fallback, /aria-label="收益走势"/);
assert.doesNotMatch(fallback, /时间加权|TWR/, "asset balances are never labelled as TWR");
assert.match(fallback, /role="group"/);
assert.match(fallback, /aria-label="币种"/);
assert.match(fallback, /aria-pressed="true">USD</);
assert.match(fallback, /aria-pressed="false">USDT</);
assert.equal((fallback.match(/<button/g) || []).length, 3, "one real link plus two currency buttons");
assert.doesNotMatch(fallback, /role="button"/, "the card is not a button wrapping other buttons");
assert.match(fallback, /打开收益分析/);
assert.match(fallback, /hidden="" data-status="partial"/, "partial valuation keeps its exact hidden diagnostic");
assert.match(fallback, /USD [\d,]+\.\d{2}/, "the fallback axis carries balances, not percentages");
assert.doesNotMatch(fallback, /%/, "an asset balance is never drawn as a return");
assert.match(fallback, /Z\s*M/, "a real gap stays a gap instead of being bridged");

const stale = render({
  returns: ready(returnsUnavailable),
  assets: ready({ ...mixedAssets, history_per_currency: [history("USD", "stale", usdPoints), history("USDT", "ok", usdtPoints)] }),
});
assert.match(stale, /aria-label="资产余额"/);
assert.match(stale, /hidden="" data-status="stale"/, "stale asset history keeps its exact hidden diagnostic");

const privacy = render({ returns: ready(returnsUnavailable), assets: ready(mixedAssets) }, { hideAmounts: true });
assert.match(privacy, /•••/);
assert.doesNotMatch(privacy, /USD [\d,]+\.\d{2}/, "hidden amounts never leak into axis ticks");

const english = render({ returns: ready(returnsUnavailable), assets: ready(mixedAssets) }, { language: "en" });
assert.match(english, /aria-label="Asset balance"/);
assert.match(english, /aria-label="Currency"/);
assert.match(english, /Open performance/);
assert.match(english, /hidden="" data-status="partial"/, "English retains the same hidden partial diagnostic");

// A drawable return trend wins: the fallback must not replace a qualified curve.
const returnsOk = {
  status: "ok", unavailable_reason: null, as_of: "2026-10-02T00:00:00Z",
  return_kind: "twr", points: [{ date: "2026-10-01", value: 0 }, { date: "2026-10-02", value: 2.5 }],
  aligned_start: "2026-10-01", benchmarks: [],
};
const trend = render({ returns: ready(returnsOk), assets: ready(mixedAssets) });
assert.match(trend, /aria-label="收益走势"/);
assert.doesNotMatch(trend, /aria-label="资产余额"/);
assert.doesNotMatch(trend, /aria-label="币种"/);
assert.equal((trend.match(/<button/g) || []).length, 2, "one real link plus the chart legend, no currency switch");

// Nothing real to draw stays a quiet empty state; pending and failed reads are
// never presented as a normal curve or as an empty result.
const quiet = render({
  returns: ready(returnsUnavailable),
  assets: ready({ ...mixedAssets, history_per_currency: [], points: [] }),
});
assert.doesNotMatch(quiet, /class="chart"/);
assert.match(quiet, /empty-state/);
assert.match(quiet, /暂不可计算/);

for (const [label, props] of [
  ["returns loading", { returns: loading, assets: ready(mixedAssets) }],
  ["assets loading", { returns: ready(returnsUnavailable), assets: loading }],
]) {
  const html = render(props);
  assert.doesNotMatch(html, /class="chart"/, `${label} is not drawn as data`);
  assert.doesNotMatch(html, /aria-label="资产余额"/, `${label} is not presented as a balance`);
  assert.match(html, /skeleton/);
}
for (const [label, props] of [
  ["returns read failed", { returns: failed, assets: ready(mixedAssets) }],
  ["assets read failed", { returns: ready(returnsUnavailable), assets: failed }],
]) {
  const html = render(props);
  assert.doesNotMatch(html, /class="chart"/, `${label} is not drawn as data`);
  assert.match(html, /error-state/);
  assert.match(html, /retry|重试/);
}

console.log("console_overview_asset_fallback_validation: PASS (returns stay first; mixed-currency overview shows real USD/USDT asset balances separately, no sum/FX/rebase/TWR label; partial/stale/gap/privacy preserved; card is not a nested button; empty/loading/read_failed stay honest; synthetic only)");
