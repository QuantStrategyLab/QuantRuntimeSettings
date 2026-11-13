// Desk N1 frontend boundary (docs/desk-n1-read-projection-contract.md): one golden payload
// per area/scenario passes Ajv (schemas/desk/n1-*.json), the TS guard and the page render.
// Strict v2 only for live; v1 fixtures are normalised for source=mock only; unknown and
// partial never render as zero, "none" or "nothing to do". Fake data only.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  accountsFromMock, coverageText, isN1Accounts, isN1Overview, isN1Performance, isN1Read, isN1Ribbon,
  isN1SwitchStrategies, n1ReasonKey, overviewFromMock, performanceFromMock, readValue, ribbonFromMock,
  switchStrategiesFromMock,
} from "../web/strategy-switch-console/frontend/src/desk/api/n1.ts";
import { DESK_SOURCES, DeskContractError, createDeskApi } from "../web/strategy-switch-console/frontend/src/desk/api/endpoints.ts";
import * as v1Ribbon from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/ribbon.ts";
import * as v1Overview from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/overview.ts";
import * as v1Accounts from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/accounts.ts";
import * as v1Performance from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/performance.ts";
import { forTarget } from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/switchStrategies.ts";
import { DESK_MESSAGES, deskTranslate } from "../web/strategy-switch-console/frontend/src/desk/i18n/index.ts";

const workerRequire = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const ajv = new (workerRequire("ajv/dist/2020").default)({ strict: false, allErrors: true });
workerRequire("ajv-formats")(ajv);
const schemaDir = new URL("../schemas/desk/", import.meta.url);
for (const file of readdirSync(schemaDir).filter(file => file.endsWith(".json") && file !== "manifest.json")) {
  ajv.addSchema(JSON.parse(readFileSync(new URL(file, schemaDir), "utf8")));
}
const schemaOk = (name, value) => ajv.getSchema(`https://schemas.example.invalid/qsl/desk/n1-${name}.json`)(value);
const golden = (name, scenario) => JSON.parse(readFileSync(new URL(`./fixtures/desk/n1-${name}.${scenario}.json`, import.meta.url), "utf8"));
const clone = value => structuredClone(value);
const GUARDS = { ribbon: isN1Ribbon, overview: isN1Overview, accounts: isN1Accounts, "switch-strategies": isN1SwitchStrategies, performance: isN1Performance };
const SCENARIOS = ["ok", "degraded", "partial", "empty"];

// 1. Same golden payload: Ajv and the TS guard agree, including on rejection.
for (const [name, guard] of Object.entries(GUARDS)) {
  for (const scenario of SCENARIOS) {
    const payload = golden(name, scenario);
    assert.ok(schemaOk(name, payload), `${name}.${scenario}: schema`);
    assert.ok(guard(payload), `${name}.${scenario}: TS guard`);
    const mutations = [
      ["extra top-level field", value => { value.unexpected = true; }],
      ["wrong version", value => { value.schema_version = value.schema_version.replace(".v2", ".v1"); }],
      ["generated_at without a zone", value => { value.generated_at = value.generated_at.replace("Z", ""); }],
      ["open time basis", value => { value.time_basis.extra = 1; }],
    ];
    for (const [label, mutate] of mutations) {
      const bad = clone(payload); mutate(bad);
      assert.equal(guard(bad), false, `${name}.${scenario}: guard accepts ${label}`);
      assert.equal(schemaOk(name, bad), false, `${name}.${scenario}: schema accepts ${label}`);
    }
  }
}

// 2. The N1 Read itself.
const at = "2030-01-08T15:00:00Z";
const cover = (state, included = 1, total = 1, reasons = []) => ({ state, included, total, reasons });
assert.ok(isN1Read({ status: "known", value: 1, observed_at: at, coverage: cover("complete") }));
assert.ok(isN1Read({ status: "partial", value: { done: 2, expected: null }, observed_at: at, coverage: cover("partial", 2, null, ["not_supported"]) }));
assert.ok(isN1Read({ status: "unknown", reason: "mixed_currency", coverage: cover("unavailable", 0, null, ["mixed_currency"]) }));
for (const [value, message] of [
  [{ status: "unknown", reason: "read_failed", value: 0, coverage: cover("unavailable", 0, null) }, "unknown carries no value"],
  [{ status: "known", value: 3, observed_at: at, coverage: cover("partial", 1, 2) }, "known needs evidenced coverage"],
  [{ status: "partial", value: [], observed_at: at, coverage: cover("complete") }, "partial needs partial coverage"],
  [{ status: "known", value: 1, observed_at: "2030-01-08T15:00:00", coverage: cover("complete") }, "instant needs a zone"],
  [{ status: "known", value: 1, observed_at: at }, "coverage required"],
  [{ status: "unknown", reason: "read_failed", coverage: cover("verified_empty", 0, 0) }, "a failure is never verified empty"],
  [{ status: "known", value: 1, observed_at: at, coverage: cover("complete", 2, 1) }, "included cannot exceed total"],
]) assert.equal(isN1Read(value), false, message);

// Money stays a decimal string; a known count cannot hide an unknown member.
const money = golden("overview", "ok"); money.totals.nav = 2000;
assert.equal(isN1Overview(money), false, "numeric money rejected");
assert.equal(schemaOk("overview", money), false);
const runs = golden("overview", "ok");
runs.totals.runs_today = { ...runs.totals.runs_today, status: "known", coverage: cover("complete", 2, 2) };
assert.equal(isN1Overview(runs), false, "known runs_today with expected=null rejected");
assert.equal(schemaOk("overview", runs), false);
const fingerprint = golden("switch-strategies", "ok"); fingerprint.catalog_revision.value.value = "main";
assert.equal(isN1SwitchStrategies(fingerprint), false, "catalog_revision is a sha256 fingerprint, not a ref");
const nested = golden("accounts", "ok"); nested.brokers.value[0].config.drift_count.value = 0;
assert.equal(isN1Accounts(nested), false, "an unknown drift count cannot carry a zero");
const switchable = golden("switch-strategies", "ok"); switchable.switchable.allowed = true;
assert.equal(isN1SwitchStrategies(switchable), false, "config compatibility never makes a target switchable");

// 3. Live: strict v2 only. A v1 live body is a contract mismatch; v1 fixtures pass only as mocks.
const liveSources = { ...DESK_SOURCES, ribbon: "live", overview: "live", accounts: "live", switchStrategies: "live", performance: "live" };
let reply = null;
const live = createDeskApi({ forcedScenario: null, delayMs: 0, sources: liveSources, fetchJson: async () => clone(reply) });
for (const [method, v1, v2] of [
  ["ribbon", v1Ribbon.ok, golden("ribbon", "ok")], ["overview", v1Overview.ok, golden("overview", "ok")],
  ["accounts", v1Accounts.ok, golden("accounts", "ok")], ["performance", v1Performance.ok, golden("performance", "ok")],
]) {
  reply = v1;
  await assert.rejects(live[method](), error => error instanceof DeskContractError, `${method}: live v1 rejected`);
  reply = v2;
  const result = await live[method]();
  assert.deepEqual([result.source, result.scenario], ["live", null]);
  assert.deepEqual(result.data, v2, `${method}: live v2 passes through unchanged`);
}
// The strategies page keeps its v1 catalog client in this change (open item); the N1
// switch-strategies payload is pinned by the guard and the normalisation below.
reply = golden("switch-strategies", "ok");
await assert.rejects(live.switchStrategies("firstrade/target0"), DeskContractError, "the v1 client never reads a v2 body as v1");
assert.ok(isN1SwitchStrategies(reply));

// Mock: v1 fixtures normalise into valid N1 and keep their mock source label.
const forced = createDeskApi({ forcedScenario: "degraded", delayMs: 0, fetchJson: async () => { throw Error("mock must not fetch"); } });
for (const method of ["ribbon", "overview", "accounts", "performance"]) {
  const result = await forced[method]();
  assert.deepEqual([result.source, result.scenario], ["mock", "degraded"]);
}
for (const scenario of ["ok", "degraded"]) {
  for (const [name, normalise, fixture] of [
    ["ribbon", ribbonFromMock, v1Ribbon[scenario]], ["overview", overviewFromMock, v1Overview[scenario]],
    ["accounts", accountsFromMock, v1Accounts[scenario]], ["performance", performanceFromMock, v1Performance[scenario]],
    ["switch-strategies", switchStrategiesFromMock, forTarget("schwab/core", scenario)],
  ]) {
    const normalised = normalise(clone(fixture));
    assert.ok(GUARDS[name](normalised), `${name}.${scenario}: mock normalises to N1`);
    assert.ok(schemaOk(name, normalised), `${name}.${scenario}: normalised mock matches the schema`);
    assert.deepEqual(normalised.time_basis.source_domains, [{ source_key: "fixture", timezone: "UTC" }], "the fixture names itself");
  }
}

// Alerts and logs stay fixtures. The five N1 areas also keep their fixture label in this
// change: flipping their DESK_SOURCES entries is a separate step (projection contract, open item).
for (const endpoint of ["alerts", "logs"]) assert.equal(DESK_SOURCES[endpoint], "mock");

// 4. Reading helpers: unknown is null, partial is a subset, an unknown total is "?".
assert.equal(readValue(golden("ribbon", "ok").alert_badge), null, "unknown badge has no value, not 0");
assert.equal(coverageText({ state: "partial", included: 1, total: null, reasons: [] }), "1/?");
assert.equal(n1ReasonKey("mixed_currency"), "read.reason.mixed_currency");
assert.equal(n1ReasonKey("brand_new_reason"), "read.reason.other");
for (const key of ["read.reason.coverage_incomplete", "read.reason.mixed_currency", "read.reason.time_basis_unavailable", "n1.partial",
  "nav.alert_badge_unknown", "mode.unknown_chip", "overview.runs.partial", "overview.runs.source_day", "overview.needs.partial",
  "overview.needs.unavailable", "overview.book.unknown", "overview.curve.unknown", "overview.headline.unread", "accounts.brokers.unknown",
  "strategies.catalog.partial", "strategies.catalog.unknown", "strategies.card.eligibility_unknown", "perf.portfolio_unknown",
  "perf.history.truncated", "logs.runs.unknown", "logs.runs.partial", "logs.runs.utc_day"]) {
  for (const language of ["zh", "en"]) assert.ok(DESK_MESSAGES[language][key], `missing ${language} ${key}`);
}

// 5. Render the same golden payloads.
const frontend = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const require = createRequire(join(frontend, "package.json"));
const h = require("react").createElement;
const render = element => require("react-dom/server").renderToStaticMarkup(element);
const compiled = require("esbuild").buildSync({
  stdin: {
    resolveDir: join(frontend, "src"),
    loader: "tsx",
    contents: `
      export { OverviewView } from "./desk/pages/OverviewPage";
      export { BrokersView } from "./desk/pages/AccountsPage";
      export { portfolioStatsFor } from "./desk/pages/PerformancePage";
      export { Dock } from "./desk/shell/Dock";
      export { TopBar } from "./desk/shell/TopBar";
      export { DeskShell } from "./desk/shell/DeskShell";
    `,
  },
  bundle: true, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent",
  loader: { ".css": "empty" },
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
  write: false,
}).outputFiles[0].text;
const desk = { exports: {} };
new Function("require", "module", "exports", compiled)(require, desk, desk.exports);
const { OverviewView, BrokersView, portfolioStatsFor, Dock, TopBar, DeskShell } = desk.exports;
const text = html => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

for (const language of ["zh", "en"]) {
  const t = (key, params) => deskTranslate(language, key, params);
  const ribbon = { state: "ready", data: golden("ribbon", "ok") };
  const view = (data) => render(h(OverviewView, { data, source: "live", ribbon, t, language, narrow: false }));

  const ok = view(golden("overview", "ok"));
  assert.ok(ok.includes(t("overview.runs.partial", { done: 2, coverage: "2/2" })), "runs: done shown, expected unknown");
  assert.equal(ok.includes(t("overview.runs.progress", { done: 2, expected: 0 })), false, "no complete run ratio");
  assert.ok(ok.includes(t("overview.runs.source_day", { date: "2030-01-08", timezone: "America/New_York" })), "NY source business day named");
  assert.ok(ok.includes(t("overview.needs.partial")), "a partial to-do list says so");
  assert.equal(ok.includes(t("overview.needs.empty")), false, "partial is never 'nothing needs you'");
  assert.ok(ok.includes('data-tone="unknown"'), "drift unknown is marked");
  assert.equal(ok.includes(t("config.drift", { count: 0 })), false, "no healthy zero drift");
  const curveReason = golden("overview", "ok").equity_curve.reason;
  assert.ok(ok.includes(t("overview.curve.unknown", { reason: t(n1ReasonKey(curveReason)) })), "unknown curve names its reason");
  assert.equal(ok.includes("mrd-ov-curve-line"), false, "no curve drawn from an unknown read");
  assert.equal(ok.includes(t("mock.title")), false, "a live payload carries no fixture note");
  // Server to-do items carry dictionary keys, so both languages render their own copy.
  for (const key of ["overview.needs.credential.title", "overview.needs.credential.detail_known", "overview.needs.credential.action"]) {
    assert.ok(DESK_MESSAGES[language][key], `missing ${language} ${key}`);
    assert.ok(ok.includes(t(key)), `${language}: ${key} rendered`);
  }
  if (language === "en") assert.doesNotMatch(text(ok), /[\u4e00-\u9fff]/, "the English overview shows no Chinese copy");

  const degraded = view(golden("overview", "degraded"));
  assert.ok(degraded.includes(t("overview.needs.unavailable", { reason: t("read.reason.read_failed") })), "unknown to-do list is not empty");
  assert.ok(degraded.includes(t("states.partial_detail", { included: 0, total: 2 })));

  const unread = golden("overview", "ok");
  unread.book = { status: "unknown", reason: "read_failed", observed_at: null, coverage: cover("unavailable", 0, null, ["read_failed"]) };
  assert.ok(isN1Overview(unread));
  const unreadHtml = view(unread);
  assert.ok(unreadHtml.includes(t("overview.headline.unread")), "an unread book is not 'nothing running'");
  assert.equal(unreadHtml.includes(t("overview.headline.none")), false);
  assert.ok(unreadHtml.includes(t("overview.book.unknown", { reason: t("read.reason.read_failed") })));
  assert.equal(unreadHtml.includes(t("overview.book.empty")), false);

  const brokers = (data, source = "live") => render(h(BrokersView, { data, source, t, language, narrow: false, onManage: () => {} }));
  const accounts = brokers(golden("accounts", "ok"));
  assert.ok(accounts.includes(t("config.unknown")), "drift without readback is unknown");
  assert.equal(accounts.includes(t("config.synced")), false, "never synced without an identity-bound comparison");
  assert.ok(text(accounts).includes(`${t("read.unknown_mark")} · ${t("read.reason.not_supported")}`), "heartbeat/last order unknown with reason");
  assert.equal(accounts.includes(t("accounts.last_order.none")), false, "unknown orders are not 'no orders'");
  const failed = golden("accounts", "ok");
  failed.brokers = { status: "unknown", reason: "read_failed", observed_at: null, coverage: cover("unavailable", 0, null, ["read_failed"]) };
  const failedHtml = brokers(failed);
  assert.ok(failedHtml.includes(t("accounts.brokers.unknown", { reason: t("read.reason.read_failed") })));
  assert.equal(failedHtml.includes(t("accounts.brokers.empty")), false, "unreadable is not 'no brokers'");
  assert.ok(brokers(golden("accounts", "empty")).includes(t("accounts.brokers.empty")), "verified empty may say empty");
  assert.ok(brokers(accountsFromMock(clone(v1Accounts.ok)), "mock").includes(t("mock.title")), "mock keeps its label");

  // Shell: unknown badge is "?", never 0 or absent; unknown mode is named; the lock hides both.
  const dock = render(h(Dock, { page: "overview", t, alertCount: null, alertUnknown: true, onNavigate: () => {} }));
  assert.match(dock, /class="mrd-badge" data-unknown="true"[^>]*>\?<\/em>/);
  assert.equal(render(h(Dock, { page: "overview", t, alertCount: 0, onNavigate: () => {} })).includes("mrd-badge"), false, "old callers unchanged");
  const bar = { page: "overview", t, language, theme: "light", gateway: { kind: "read", read: { status: "unknown", reason: "not_supported" } },
    nowIso: at, serverClock: true, mock: null, freshness: { kind: "read", data_status: "ready", age_seconds: 60 }, onLanguage: () => {}, onTheme: () => {} };
  assert.ok(render(h(TopBar, { ...bar, modeUnknown: true })).includes(t("mode.unknown_chip")));
  assert.equal(render(h(TopBar, bar)).includes(t("mode.unknown_chip")), false, "the chip is opt-in");
  const locked = render(h(DeskShell, { ...bar, alertCount: null, alertUnknown: true, modeUnknown: true,
    lock: { crumb: "access.title", chip: "access.chip.login" }, onNavigate: () => {}, children: null }));
  assert.equal(locked.includes("mrd-badge"), false, "no badge behind the lock");
  assert.equal(locked.includes(t("mode.unknown_chip")), false, "no mode chip behind the lock");
}

// Performance KPIs: backend reads only, no computed fallback; CAGR has no N1 source.
assert.deepEqual(portfolioStatsFor(golden("performance", "ok")), { ret: null, cagr: null, maxDrawdown: null });
const knownPerf = golden("performance", "ok");
knownPerf.risk.return_ratio = { status: "known", value: "0.12", observed_at: at, coverage: cover("complete") };
knownPerf.risk.max_drawdown_ratio = { status: "partial", value: "-0.05", observed_at: at, coverage: cover("partial", 1, 2, ["insufficient_history"]) };
assert.deepEqual(portfolioStatsFor(knownPerf), { ret: 0.12, cagr: null, maxDrawdown: null }, "a partial window metric is not the requested window");

// Source checks for wiring that has no pure export.
const src = path => readFileSync(new URL(`../web/strategy-switch-console/frontend/src/desk/${path}`, import.meta.url), "utf8");
const app = src("DeskApp.tsx");
assert.match(app, /\{ kind: "read", \.\.\.ribbon\.result\.data\.freshness \}/, "freshness comes from the stored observations");
assert.doesNotMatch(app, /generated_at/, "generated_at never drives data freshness");
assert.doesNotMatch(src("pages/PerformancePage.tsx"), /computeStats/, "no UI-side metric fallback");
assert.match(src("pages/LogsPage.tsx"), /api\.logs\(\)/, "logs keep their existing (fixture) read");
assert.doesNotMatch(src("api/endpoints.ts"), /\/api\/desk\/logs"\s*,\s*isN1/, "logs are not an N1 read");

console.log("console_desk_n1_validation: PASS (5 areas × 4 golden payloads: schema = guard = render; strict live v2, mock-only v1 normalisation, unknown/partial never zero; fake data only)");
