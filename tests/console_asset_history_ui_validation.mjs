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
    assert.ok(html.includes('data-status="partial"'), "exact partial status remains a visible status");
    assert.match(html, /data-affected-count="[1-9][0-9]*"/, "affected coverage remains diagnostic");
    assert.match(html, /个账户的历史数据不完整|History is incomplete for/,
      "partial history states its affected account count");
    assert.ok(html.includes(language === "zh" ? "部分日期包含沿用的此前余额，这些余额并非当日观测。" : "Some dates include earlier balances; those balances were not observed on those dates."),
      "carried balances are distinguished from same-day observations");
    assert.ok(html.includes(language === "zh" ? "合成账户甲" : "Synthetic Alpha"), "account coverage exposes display names in an expandable detail");
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
    assert.ok(!ui.assets(language, missingOnly).includes(language === "zh" ? "部分日期包含沿用的此前余额" : "Some dates include earlier balances"),
      "missing history alone does not imply balances were carried");
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

test("P2: fill covers only runs of three or more points; sparse tails keep their line and markers", () => {
  assert.deepEqual(assets.points.map(p => p.breakBefore), [false, true, false, false, true, true, false, false]);
  const check = points => {
    const html = ui.area(points);
    const paths = [...html.matchAll(/<path d="([^"]*)"[^>]*>/g)].map(m => m[1]);
    assert.equal(paths.length, points.length ? 2 : 0);
    if (!points.length) return;
    const [area, line] = paths;
    const lineSegments = line.match(/M[^M]+/g) ?? [];
    const areaSegments = area.match(/M[^M]+/g) ?? [];
    const filled = lineSegments.filter(segment => [...segment.matchAll(/[ML]([\d.]+),([\d.]+)/g)].length >= 3);
    assert.equal(areaSegments.length, filled.length, "only a run of at least three real points gets a fill");
    for (const [i, segment] of filled.entries()) {
      const linePoints = [...segment.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(m => [m[1], m[2]]);
      const areaPoints = [...areaSegments[i].matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(m => [m[1], m[2]]);
      assert.ok(areaSegments[i].endsWith("Z"));
      assert.deepEqual(areaPoints.slice(1, -1), linePoints, "no filled polygon may bridge a membership break");
      assert.equal(areaPoints[0][0], linePoints[0][0]);
      assert.equal(areaPoints.at(-1)[0], linePoints.at(-1)[0]);
    }
    for (const segment of lineSegments) {
      const linePoints = [...segment.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map(m => [m[1], m[2]]);
      if (linePoints.length >= 3) continue;
      const circles = [...html.matchAll(/<circle cx="([^"]+)" cy="([^"]+)"/g)];
      for (const [x, y] of linePoints) {
        assert.ok(circles.some(m => Math.abs(Number(m[1]) - Number(x)) < 0.01 && Math.abs(Number(m[2]) - Number(y)) < 0.01), "each point in a sparse segment stays visible");
      }
    }
  };
  check(assets.points);
  check([point(1, 100)]);
  check([point(1, 100), { ...point(2, 200), breakBefore: true }]);
  const membership = ui.area([point(1, 100), { ...point(2, 200), membership_changed: true }]);
  const lines = [...membership.matchAll(/<path d="([^"]*)"[^>]*>/g)].map(m => m[1]);
  assert.equal((lines[1].match(/M/g) ?? []).length, 2, "account membership changes break the line without adding points");
  check([point(1, 100), point(2, 110)]);
  check([point(1, 100), point(2, 110), point(3, 120)]);
  check([]);
});
