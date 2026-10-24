import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { performanceBlocks } from "../web/strategy-switch-console/application/console_api/performance.js";

// Real API aggregation and React components; only the read hook uses synthetic data.
const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const bundle = await build({
  stdin: { contents: `import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { I18nProvider } from './src/i18n';
    import { AssetsCard } from './src/pages/performance/AssetsCard';
    import { AreaChart } from './src/charts/AreaChart';
    const render = (language, component, props) => renderToStaticMarkup(h(I18nProvider, { language }, h(component, props)));
    export const assets = (language, data) => {
      globalThis.__assetHistoryState = { phase: 'ready', data };
      try { return render(language, AssetsCard, { scope: 'all', range: 'ALL', epoch: 0 }); }
      finally { delete globalThis.__assetHistoryState; }
    };
    export const area = points => render('en', AreaChart, { points, currency: 'USD', ariaLabel: 'Synthetic assets' });`, resolveDir: root },
  bundle: true, platform: "node", format: "cjs", write: false, jsx: "automatic", loader: { ".css": "empty" },
  define: { "import.meta.env": JSON.stringify({ VITE_QSL_DISPLAY_NAMES_JSON: JSON.stringify({ accounts: { synthetic: {
    "synthetic-a": { zh: "合成账户甲", en: "Synthetic Alpha" },
    "synthetic-b": { zh: "合成账户乙", en: "Synthetic Beta" },
  } } }) }) },
  plugins: [{ name: "synthetic-read", setup(b) {
    b.onLoad({ filter: /\/lib\/hooks\.ts$/ }, () => ({ contents: "export const useApi = () => globalThis.__assetHistoryState;", loader: "js" }));
  } }],
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const ui = module.exports;
const point = (day, value) => ({ date: `2026-01-${String(day).padStart(2, "0")}`, value, externalFlow: null });
const history = (alias, points) => ({ id: `synthetic:${alias}:USD`, currency: "USD", points });
const input = {
  accounts: [1000, 2000].map((value, i) => ({ platform: "synthetic", account_key: `synthetic-${i ? "b" : "a"}`,
    observation_date: "2026-01-08", observed_finished_at: "2026-01-08T12:00:00Z",
    balances: [{ currency: "USD", net_assets: String(value) }],
  })),
  histories: [history("synthetic-a", [point(1, 100), point(2, 101), point(3, 102), point(6, 106), point(7, 107), point(8, 108)]),
    history("synthetic-b", [2, 3, 4, 5, 6, 7, 8].map(day => point(day, 200 + day)))],
  today: "2026-01-08", now: Date.parse("2026-01-08T13:00:00Z"), year: 2026, month: 1,
  historyMaxStalenessDays: 1,
};
const assets = performanceBlocks(input).assets;

test("P1: healthy current balances still show independent partial history in zh/en", () => {
  assert.equal(assets.status, "ok");
  assert.equal(assets.per_currency[0].status, "ok");
  assert.equal(assets.curve_status, "partial");
  for (const language of ["zh", "en"]) {
    const html = ui.assets(language, assets);
    assert.ok(html.includes(language === "zh" ? "部分历史数据未返回" : "Some history is unavailable"));
    assert.ok(html.includes(language === "zh"
      ? "部分账户缺少历史数据，曲线仅包含有数据的账户。"
      : "Some accounts lack history; the curve includes only accounts with data."));
    assert.equal((html.match(language === "zh" ? /个账户的历史数据不完整/g : /History is incomplete for/g) || []).length, 1,
      "the affected-account count is stated once");
    assert.equal((html.match(language === "zh" ? /部分账户缺少历史数据，曲线仅包含有数据的账户。/g : /Some accounts lack history; the curve includes only accounts with data\./g) || []).length, 1,
      "the coverage note is stated once");
    assert.ok(!html.includes(language === "zh" ? "合成账户甲" : "Synthetic Alpha"),
      "the notice aggregates accounts instead of naming them");
    assert.doesNotMatch(html, /前值填充|Forward-filled|不代表当日新估值|not a new valuation/i, "internal wording stays out of the default view");
    assert.doesNotMatch(html, /synthetic-a|synthetic-b|perf\.|reason\.|state\./);
    if (language === "en") assert.doesNotMatch(html, /[\u4e00-\u9fff]/);
    const { curve_coverage, history_per_currency, ...legacy } = assets;
    assert.ok(ui.assets(language, legacy).includes(language === "zh" ? "部分历史数据未返回" : "Some history is unavailable"), "curve_status alone must trigger the warning");
    const complete = performanceBlocks({ ...input, histories: [history("synthetic-a", [point(7, 107), point(8, 108)])] }).assets;
    assert.equal(complete.curve_status, "ok");
    assert.ok(!ui.assets(language, complete).includes(language === "zh" ? "部分历史数据未返回" : "Some history is unavailable"));
    assert.ok(ui.assets(language, { ...complete, curve_status: "partial" }).includes(language === "zh" ? "部分历史数据未返回" : "Some history is unavailable"), "independent curve status cannot be masked by healthy per-currency status");
    const truncated = { ...complete, curve_status: "partial", curve_coverage: { ...complete.curve_coverage, truncated: true } };
    assert.ok(ui.assets(language, truncated).includes(language === "zh" ? "部分历史数据未返回" : "Some history is unavailable"));
    const missingOnly = performanceBlocks({ ...input, histories: [history("synthetic-a", [point(7, 107), point(8, 108)]), history("synthetic-b", [])] }).assets;
    assert.equal(missingOnly.curve_coverage.forward_filled_points, 0);
    assert.ok(ui.assets(language, missingOnly).includes(language === "zh" ? "部分历史数据未返回" : "Some history is unavailable"));
    const mixed = performanceBlocks({ ...input, histories: [...input.histories, { id: "synthetic-wallet", currency: "USDT", points: [point(7, 500), point(8, 500)] }] }).assets;
    assert.match(ui.assets(language, mixed), language === "zh" ? /USD · 部分历史数据未返回/ : /USD · Some history is unavailable/);
    const unknown = { ...assets, points: assets.points.map(p => ({ ...p, missing_accounts: ["synthetic-raw-strategy-key"] })), history_per_currency: undefined };
    assert.doesNotMatch(ui.assets(language, unknown), /synthetic-raw-strategy-key/);
    const stale = performanceBlocks({ ...input, today: "2026-01-12" }).assets;
    assert.equal(stale.status, "ok");
    assert.equal(stale.curve_status, "stale");
    assert.ok(ui.assets(language, stale).includes(language === "zh" ? "历史数据可能不是最新" : "History may not be up to date"));
  }
});

test("P2: rendered fill follows stroke breaks at join, expiry and re-entry; singletons stay visible", () => {
  assert.deepEqual(assets.points.map(p => p.breakBefore), [false, true, false, false, true, true, false, false]);
  const check = points => {
    const html = ui.area(points);
    const paths = [...html.matchAll(/<path d="([^"]+)"[^>]*>/g)].map(m => m[1]);
    assert.equal(paths.length, points.length ? 2 : 0);
    if (!points.length) return;
    const lineSegments = paths[1].match(/M[^M]+/g);
    const areas = paths[0].match(/M[^M]+/g);
    assert.equal(areas.length, lineSegments.length, "fill must have exactly the stroke's segments");
    for (const [i, segment] of lineSegments.entries()) {
      const linePoints = [...segment.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(m => [m[1], m[2]]);
      const areaPoints = [...areas[i].matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(m => [m[1], m[2]]);
      assert.ok(areas[i].endsWith("Z"));
      assert.deepEqual(areaPoints.slice(1, -1), linePoints, "no filled polygon may bridge a membership break");
      assert.equal(areaPoints[0][0], linePoints[0][0]);
      assert.equal(areaPoints.at(-1)[0], linePoints.at(-1)[0]);
      if (linePoints.length === 1) {
        const circles = [...html.matchAll(/<circle cx="([^"]+)" cy="([^"]+)"/g)];
        assert.ok(circles.some(m => Math.abs(Number(m[1]) - Number(linePoints[0][0])) < 0.01 && Math.abs(Number(m[2]) - Number(linePoints[0][1])) < 0.01), "isolated observation needs a visible marker");
      }
    }
  };
  check(assets.points);
  check([point(1, 100)]);
  check([point(1, 100), { ...point(2, 200), breakBefore: true }]);
  check([point(1, 100), point(2, 110)]);
  check([]);
});
