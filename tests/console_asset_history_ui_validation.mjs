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

test("P1: healthy balances keep one compact independent partial-history status in zh/en", () => {
  assert.equal(assets.status, "ok");
  assert.equal(assets.per_currency[0].status, "ok");
  assert.equal(assets.curve_status, "partial");
  const notice = (html, state) => new RegExp(`class="history-notice"[^>]*data-state="${state}"`).test(html);
  for (const language of ["zh", "en"]) {
    const html = ui.assets(language, assets);
    assert.ok(notice(html, "partial"), "healthy current balances cannot mask incomplete history");
    assert.ok(html.includes(language === "zh" ? "部分数据" : "Partial"), "a short visible state remains");
    assert.match(html, /data-affected-count="[1-9][0-9]*"/, "affected coverage remains diagnostic");
    assert.doesNotMatch(html, /部分账户缺少历史数据|Some accounts lack history|个账户的历史数据不完整|History is incomplete for/,
      "history diagnostics do not occupy the chart");
    assert.ok(!html.includes(language === "zh" ? "合成账户甲" : "Synthetic Alpha"));
    assert.doesNotMatch(html, /前值填充|Forward-filled|不代表当日新估值|not a new valuation/i);
    assert.doesNotMatch(html, /synthetic-a|synthetic-b|perf\.|reason\.|state\./);
    if (language === "en") assert.doesNotMatch(html, /[\u4e00-\u9fff]/);
    const { curve_coverage, history_per_currency, ...legacy } = assets;
    assert.ok(notice(ui.assets(language, legacy), "partial"), "curve_status alone still reports partial history");
    const complete = performanceBlocks({ ...input, histories: [history("synthetic-a", [point(7, 107), point(8, 108)])] }).assets;
    assert.equal(complete.curve_status, "ok");
    assert.ok(!ui.assets(language, complete).includes('class="history-notice"'));
    assert.ok(notice(ui.assets(language, { ...complete, curve_status: "partial" }), "partial"));
    const truncated = { ...complete, curve_status: "partial", curve_coverage: { ...complete.curve_coverage, truncated: true } };
    assert.ok(notice(ui.assets(language, truncated), "partial"));
    const missingOnly = performanceBlocks({ ...input, histories: [history("synthetic-a", [point(7, 107), point(8, 108)]), history("synthetic-b", [])] }).assets;
    assert.ok(notice(ui.assets(language, missingOnly), "partial"));
    const mixed = performanceBlocks({ ...input, histories: [...input.histories, { id: "synthetic-wallet", currency: "USDT", points: [point(7, 500), point(8, 500)] }] }).assets;
    assert.ok(notice(ui.assets(language, mixed), "partial"), "the selected currency keeps its partial history");
    const unknown = { ...assets, points: assets.points.map(p => ({ ...p, missing_accounts: ["synthetic-raw-strategy-key"] })), history_per_currency: undefined };
    assert.doesNotMatch(ui.assets(language, unknown), /synthetic-raw-strategy-key/);
    const stale = performanceBlocks({ ...input, today: "2026-01-12" }).assets;
    assert.equal(stale.status, "ok");
    assert.equal(stale.curve_status, "stale");
    assert.ok(notice(ui.assets(language, stale), "stale"));
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
