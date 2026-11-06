// Regression coverage for the actual embedded Worker and target-specific mock callers.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../web/strategy-switch-console/worker.js";
import { V2_ASSETS, V2_PAGE_HTML } from "../web/strategy-switch-console/v2_asset_map.js";
import { createDeskApi } from "../web/strategy-switch-console/frontend/src/desk/api/endpoints.ts";
import { catalogCounts, INITIAL_STRATEGY_FLOW, strategyFlowReducer } from "../web/strategy-switch-console/frontend/src/desk/strategies/model.ts";

const origin = "https://console.invalid";
test("Worker serves every clean-build resource with identical bytes", async () => {
  const dist = new URL("../web/strategy-switch-console/frontend/dist/", import.meta.url);
  const files = (await readdir(dist, { recursive: true, withFileTypes: true })).filter(f => f.isFile());
  const paths = [];
  for (const file of files) {
    const path = join(file.parentPath, file.name);
    const name = relative(fileURLToPath(dist), path);
    if (name === "index.html") continue;
    const route = `/v2/assets/${name.replace(/^assets\//, "")}`;
    paths.push(route);
    const response = await worker.fetch(new Request(origin + route), {});
    assert.equal(response.status, 200, `built resource must be embedded: ${route}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(path), route);
  }
  assert.deepEqual(paths.sort(), Object.keys(V2_ASSETS).sort(), "no stale embedded resources");
  const html = await readFile(new URL("index.html", dist), "utf8");
  assert.equal(V2_PAGE_HTML.replace(/<meta name="qsl-console-build" content="[a-f0-9]+" \/>\n  /, ""), html);
});

for (const scenario of ["ok", "degraded"]) {
  for (const [target, domain, profile, eligibility, modes, counts] of [
    ["binance/spot", "crypto", "crypto_btc_dca", "no_live", ["paper", "dry_run"], { all: 1, eligible: 0, paper: 1, blocked: 0 }],
    ["longbridge/hk", "hk_equity", "hk_global_etf_tactical_rotation", "blocked", ["dry_run"], { all: 1, eligible: 0, paper: 0, blocked: 1 }],
  ]) {
    test(`${scenario}: ${target} exposes only its domain and preserves research restrictions`, async () => {
      const api = createDeskApi({ forcedScenario: scenario, delayMs: 0,
        fetchJson: async () => { throw new Error("mock catalog must not fetch"); } });
      const { data } = await api.switchStrategies(target);
      assert.equal(data.target_id, target);
      assert.equal(data.domain, domain);
      assert.ok(data.strategies.length > 0);
      for (const entry of data.strategies) assert.equal(entry.domain, domain, "no US catalog inherited");
      const entry = data.strategies.find(entry => entry.profile === profile);
      assert.ok(entry, "existing target strategy is represented");
      assert.equal(entry.eligibility, eligibility);
      assert.deepEqual(entry.allowed_execution_modes, modes);
      assert.deepEqual(catalogCounts(data.strategies), counts);
      const state = strategyFlowReducer(INITIAL_STRATEGY_FLOW, { type: "select_target", targetId: target });
      assert.equal(strategyFlowReducer(state, { type: "select_strategy", ...entry }).step,
        eligibility === "blocked" ? "strategy" : "preview");
    });
  }
}

test("offered credential rotation links reach the existing Health route through the Worker", async () => {
  const api = createDeskApi({ forcedScenario: "ok", delayMs: 0 });
  const { data } = await api.credentials();
  const supported = data.items.filter(item => item.rotation.supported);
  assert.ok(supported.length > 0);
  for (const item of supported) {
    const url = new URL(item.rotation.route, origin);
    const response = await worker.fetch(new Request(url), {});
    assert.equal(response.status, 200, "offered route must be served");
    assert.equal(url.searchParams.get("page"), "health", "select the existing Health page");
    assert.equal(await response.text(), V2_PAGE_HTML);
  }
});

// Render the real component; hook stubs supply the deliberately stale read window.
const { createRequire } = await import("node:module");
const require = createRequire(new URL("../web/strategy-switch-console/frontend/package.json", import.meta.url));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { deskTranslator } = await import("../web/strategy-switch-console/frontend/src/desk/i18n/index.ts");
const overview = await import("../web/strategy-switch-console/frontend/src/desk/api/fixtures/overview.ts");
const compiled = (await require("esbuild").build({
  stdin: {
    resolveDir: fileURLToPath(new URL("../web/strategy-switch-console/frontend/src/", import.meta.url)),
    contents: 'export { NeedsYouCard } from "./desk/components/NeedsYouCard"; export { StrategiesPage } from "./desk/pages/StrategiesPage";',
    loader: "tsx",
  },
  bundle: true, platform: "node", format: "cjs", jsx: "automatic", write: false, logLevel: "silent",
  external: ["react", "react/jsx-runtime"],
  plugins: [{ name: "controlled-read-window", setup(build) {
    build.onLoad({ filter: /useDeskLoad\.ts$/ }, () => ({ contents: "export function useDeskLoad() { return globalThis.reads.shift(); }", loader: "ts" }));
    build.onLoad({ filter: /useNarrow\.ts$/ }, () => ({ contents: "export function useNarrow() { return false; }", loader: "ts" }));
  } }],
})).outputFiles[0].text;
function components(react = React, globals = {}) {
  const module = { exports: {} };
  new Function("require", "module", "exports", "globalThis", compiled)(
    name => name === "react" ? react : require(name), module, module.exports, globals,
  );
  return module.exports;
}

for (const [scenario, titles, actions] of [
  ["ok", ["平台回读与保存配置不一致", "Schwab refresh token 将在 1 天内到期", "回撤接近限制"], ["检查差异", "打开凭据", "查看策略"]],
  ["degraded", ["平台回读与保存配置不一致", "账户事实已过期 39 小时"], ["检查差异", "打开账户"]],
]) {
  test(`${scenario}: Needs-you titles, details and actions render in both languages`, () => {
    const { NeedsYouCard } = components();
    const items = overview[scenario].needs_you;
    for (const language of ["zh", "en"]) {
      for (const [i, item] of items.entries()) {
        const html = renderToStaticMarkup(React.createElement(NeedsYouCard, { items: [item], t: deskTranslator(language) }));
        if (language === "zh") {
          assert.ok(html.includes(titles[i]), "localized title");
          assert.ok(html.includes(actions[i]), "localized action");
          assert.match(html.match(/<p[^>]*>(.*?)<\/p>/s)?.[1] ?? "", /[\u4e00-\u9fff]/, "localized detail");
        } else {
          assert.match(html, /differs from saved config|expires within 1 day|Drawdown near limit|39 hours old/);
          assert.doesNotMatch(html, /needs_you\./, "no locale keys leak into English");
        }
        if (item.kind === "config_drift") assert.match(html, /enabled.*reserved_cash_ratio/, "field codes remain exact");
      }
    }
    const unknown = { ...items[0], id: "fake_future_item", title: "Future backend title", detail: "Future detail", action: { label: "Future action", route: "/accounts" } };
    const html = renderToStaticMarkup(React.createElement(NeedsYouCard, { items: [unknown], t: deskTranslator("zh") }));
    for (const value of [unknown.title, unknown.detail, unknown.action.label]) assert.ok(html.includes(value), "unknown backend copy survives");
  });
}

test("credential runbooks link to a tracked document on the served repository host", async () => {
  const { data } = await createDeskApi({ forcedScenario: "ok", delayMs: 0 }).credentials();
  const links = data.items.map(item => item.runbook).filter(Boolean);
  assert.ok(links.length > 0);
  for (const link of links) {
    const url = new URL(link, origin);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "github.com", "unserved console-relative docs are forbidden");
    const prefix = "/QuantStrategyLab/QuantRuntimeSettings/blob/main/";
    assert.ok(url.pathname.startsWith(prefix));
    assert.ok((await readFile(new URL(`../${decodeURIComponent(url.pathname.slice(prefix.length))}`, import.meta.url))).length > 0);
  }
});

for (const catalogTarget of ["ibkr/tqqq", "binance/spot"]) {
  test(`loaded ${catalogTarget} catalog cannot select an initial profile for a different current target`, async () => {
    const currentTarget = catalogTarget === "ibkr/tqqq" ? "binance/spot" : "ibkr/tqqq";
    const api = createDeskApi({ forcedScenario: "ok", delayMs: 0 });
    const catalog = await api.switchStrategies(catalogTarget);
    const profile = catalog.data.strategies.find(x => x.eligibility !== "blocked").profile;
    const effects = [], actions = [];
    const hooks = { ...React,
      useState: value => [typeof value === "function" ? value() : value, () => {}],
      useReducer: (_reducer, initial) => [{ ...initial, targetId: currentTarget, step: "strategy" }, action => actions.push(action)],
      useRef: value => ({ current: value }),
      useEffect: effect => effects.push(effect),
    };
    const globals = { reads: [
      { load: { state: "ready", result: await api.switchTargets() }, reload() {} },
      { load: { state: "ready", result: catalog }, reload() {} },
    ] };
    const { StrategiesPage } = components(hooks, globals);
    const tree = StrategiesPage({ api, t: deskTranslator("en"), language: "en", admin: true, initialTarget: currentTarget, initialProfile: profile });
    for (const effect of effects) effect();
    assert.equal(actions.some(action => action.type === "select_strategy"), false, "healthy prior catalog must not reapply a wrong-target profile");
    const html = renderToStaticMarkup(tree);
    assert.doesNotMatch(html, /data-profile=/, "old catalog cards cannot be selected during the read transition");
    // A matching fresh catalog still permits its normal initial selection.
    effects.length = 0;
    actions.length = 0;
    hooks.useReducer = (_reducer, initial) => [{ ...initial, targetId: catalogTarget, step: "strategy" }, action => actions.push(action)];
    globals.reads = [
      { load: { state: "ready", result: await api.switchTargets() }, reload() {} },
      { load: { state: "ready", result: catalog }, reload() {} },
    ];
    components(hooks, globals).StrategiesPage({ api, t: deskTranslator("en"), language: "en", admin: true, initialTarget: catalogTarget, initialProfile: profile });
    for (const effect of effects) effect();
    assert.equal(actions.filter(action => action.type === "select_strategy" && action.profile === profile).length, 1);
  });
}
