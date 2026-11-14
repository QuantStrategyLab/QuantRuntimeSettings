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
import { ribbonTape } from "../web/strategy-switch-console/application/desk/ribbon.js";
import { formatAge, formatUtcDayLabel } from "../web/strategy-switch-console/frontend/src/desk/format.ts";

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
// Switch strategies is an N1 read too: a live v1 catalog is a contract mismatch.
for (const scenario of SCENARIOS) {
  reply = golden("switch-strategies", scenario);
  const result = await live.switchStrategies(reply.target_id);
  assert.deepEqual([result.source, result.scenario], ["live", null]);
  assert.deepEqual(result.data, reply, `switchStrategies.${scenario}: live v2 passes through unchanged`);
}
reply = forTarget("schwab/core", "ok");
await assert.rejects(live.switchStrategies("schwab/core"), DeskContractError, "a live v1 catalog is never read as N1");
const defaultLive = createDeskApi({ forcedScenario: null, delayMs: 0, fetchJson: async () => clone(reply) });
reply = golden("switch-strategies", "ok");
assert.equal((await defaultLive.switchStrategies(reply.target_id)).source, "live", "the default sources read the projection");

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

// The five N1 areas read their projections by default; alerts and logs stay fixtures.
for (const endpoint of ["ribbon", "overview", "accounts", "switchStrategies", "performance"]) assert.equal(DESK_SOURCES[endpoint], "live");
for (const endpoint of ["alerts", "logs"]) assert.equal(DESK_SOURCES[endpoint], "mock");

// 4. Reading helpers: unknown is null, partial is a subset, an unknown total is "?".
assert.equal(readValue(golden("ribbon", "ok").alert_badge), null, "unknown badge has no value, not 0");
assert.equal(coverageText({ state: "partial", included: 1, total: null, reasons: [] }), "1/?");
assert.equal(n1ReasonKey("mixed_currency"), "read.reason.mixed_currency");
assert.equal(n1ReasonKey("brand_new_reason"), "read.reason.other");
for (const key of ["read.reason.coverage_incomplete", "read.reason.mixed_currency", "read.reason.time_basis_unavailable", "n1.partial",
  "nav.alert_badge_unknown", "mode.unknown_chip", "overview.runs.partial", "overview.runs.source_day", "overview.needs.partial",
  "overview.needs.unavailable", "overview.book.unknown", "overview.book.run_unknown", "overview.curve.unknown", "overview.headline.unread", "accounts.brokers.unknown",
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
      export { portfolioStatsFor, PerformanceView, loadBenchmarks, benchmarkReadAllowed, shownBenchmarkState } from "./desk/pages/PerformancePage";
      export { Dock } from "./desk/shell/Dock";
      export { TopBar, utcWhen } from "./desk/shell/TopBar";
      export { DeskShell } from "./desk/shell/DeskShell";
      export { catalogEntries, entryCounts, filterEntries, catalogRevisionText } from "./desk/pages/StrategiesPage";
    `,
  },
  bundle: true, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent",
  loader: { ".css": "empty" },
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
  write: false,
}).outputFiles[0].text;
const desk = { exports: {} };
new Function("require", "module", "exports", compiled)(require, desk, desk.exports);
const { OverviewView, BrokersView, portfolioStatsFor, PerformanceView, loadBenchmarks, benchmarkReadAllowed, shownBenchmarkState,
  Dock, TopBar, utcWhen, DeskShell, catalogEntries, entryCounts, filterEntries, catalogRevisionText } = desk.exports;
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

  // A per-account last run that could not be read is never "no run today".
  const unreadRun = golden("overview", "ok");
  unreadRun.book.value[0].last_run = { status: "unknown", reason: "read_failed", observed_at: null, coverage: cover("unavailable", 0, 1, ["read_failed"]) };
  assert.ok(isN1Overview(unreadRun));
  const unreadRunHtml = view(unreadRun);
  assert.ok(unreadRunHtml.includes(t("overview.book.run_unknown", { reason: t("read.reason.read_failed") })), "unknown last run names its reason");
  assert.equal(unreadRunHtml.includes(t("overview.book.no_run")), false, "an unknown last run never says 'no run'");
  const noRun = golden("overview", "ok");
  noRun.book.value[0].last_run = { status: "known", value: null, observed_at: at, coverage: cover("complete") };
  assert.ok(view(noRun).includes(t("overview.book.no_run")), "a verified absence may say 'no run'");
  const bareRun = golden("overview", "ok"); bareRun.book.value[0].last_run = null;
  assert.equal(isN1Overview(bareRun), false, "a bare null last run is rejected: it must be a read");
  // An incomplete stored record: the latest finished run is a verified subset, never the whole day.
  const partRun = golden("overview", "ok");
  partRun.book.value[0].last_run = { status: "partial", value: { at: "2030-01-08T14:32:00Z", outcome: "no_op" }, observed_at: at, coverage: cover("partial", 0, 1, ["coverage_incomplete"]) };
  assert.ok(isN1Overview(partRun) && schemaOk("overview", partRun));
  const partRunHtml = view(partRun);
  assert.ok(partRunHtml.includes(t("n1.partial", { coverage: "0/1" })), "a partial last run names its coverage");
  assert.ok(partRunHtml.includes("14:32"), "the verified run time is shown");
  assert.equal(partRunHtml.includes(t("overview.book.run_unknown", { reason: t("read.reason.coverage_incomplete") })), false);
  const partNone = golden("overview", "ok");
  partNone.book.value[0].last_run = { ...partRun.book.value[0].last_run, value: null };
  const partNoneHtml = view(partNone);
  assert.ok(partNoneHtml.includes(`${t("read.unknown_mark")} · ${t("n1.partial", { coverage: "0/1" })}`), "a partial read without a run is '?', not 'no run'");
  assert.equal(partNoneHtml.includes(t("overview.book.no_run")), false, "a partial read never says 'no run'");
  const staleRun = golden("overview", "ok");
  staleRun.book.value[0].last_run = { status: "stale", value: { at: "2030-01-07T14:32:00Z", outcome: "no_op" }, observed_at: at, age_seconds: 90000, coverage: cover("complete") };
  assert.ok(isN1Overview(staleRun));
  assert.ok(view(staleRun).includes(t("read.stale", { age: "@" }).split("@")[0]), "a stale last run is marked stale");
  // The 30-day sparkline is drawn from the stored net-asset series the payload carries.
  const spark = golden("overview", "ok");
  spark.book.value[0].sparkline_30d = { points: ["1000", "1010", "1020"], dates_from: "2030-01-03", dates_to: "2030-01-07", gap_dates: ["2030-01-05", "2030-01-06"] };
  assert.ok(isN1Overview(spark) && schemaOk("overview", spark));
  const sparkHtml = view(spark);
  assert.ok(sparkHtml.includes('class="mrd-ov-spark"'), "a stored series is drawn");
  assert.ok(sparkHtml.includes(t("overview.book.spark", { target: spark.book.value[0].target_id })));

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
  // The stale banner carries the oldest age the payload reports, never a blank age.
  const staleBrokers = golden("accounts", "ok");
  staleBrokers.brokers.value[0].data_freshness = { data_status: "stale", age_seconds: 1_300_000 };
  const staleBrokersHtml = brokers(staleBrokers);
  assert.ok(staleBrokersHtml.includes(t("states.stale", { age: "@" }).split("@")[0]), "stale brokers raise the banner");
  assert.equal(staleBrokersHtml.includes(t("states.stale", { age: "—" })), false, "a reported age is not dropped");
  const unavailableBrokers = golden("accounts", "ok");
  unavailableBrokers.brokers.value[0].data_freshness = { data_status: "unavailable", age_seconds: null };
  assert.ok(brokers(unavailableBrokers).includes(t("states.stale", { age: "—" })), "no age is invented for an unavailable broker");
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

// S2 corrections: presentation of existing reads (#4/F2/F3), Performance metadata (F4) and the
// next scheduled run chip (#6 option 1a). Both languages; light and dark shell.
const tapeEntry = (index, at) => ({ id: `firstrade/target0#run-${index}`, at, target_id: "firstrade/target0", label: `Run${index}`, kind: "runtime_run",
  outcome: "no_op", outcome_detail: null, state: "done", source_business_date: "2030-01-08", source_timezone: "America/New_York" });
const sixRuns = ["13:01", "13:12", "13:23", "13:34", "13:45", "13:56"].map((hm, index) => tapeEntry(index, `2030-01-08T${hm}:00Z`));
// Six stored runs: the oldest and newest whole seconds each have a later fractional instant.
const fractionRun = (id, started_at, extra = {}) => ({ id, started_at, finished_at: "2030-01-08T13:59:00Z", activity: "no_signal", errors_present: false, ...extra });
const fractionRuns = [fractionRun("old-fraction", "2030-01-08T13:01:00.500Z"), fractionRun("old-whole", "2030-01-08T13:01:00Z", { errors_present: true }),
  fractionRun("mid-1", "2030-01-08T13:23:00Z"), fractionRun("mid-2", "2030-01-08T13:34:00Z"),
  fractionRun("new-fraction", "2030-01-08T13:56:00.500Z", { activity: "filled" }), fractionRun("new-whole", "2030-01-08T13:56:00Z")];
const ribbonWith = tape => { const data = golden("ribbon", "ok"); data.tape = tape; return { state: "ready", data }; };
const nextRead = (status, due_at = "2030-01-08T19:30:00Z", extra = {}) => ({ status, value: { target_id: "firstrade/target1", kind: "scheduled_run", due_at },
  observed_at: at, coverage: status === "partial" ? cover("partial", 1, 2, ["coverage_incomplete"]) : cover("complete", 2, 2), ...extra });
for (const language of ["zh", "en"]) {
  const t = (key, params) => deskTranslate(language, key, params);
  const view = (data, ribbon) => render(h(OverviewView, { data, source: "live", ribbon, t, language, narrow: false }));
  const ok = golden("overview", "ok");
  // F2: newest five, newest first; the oldest of six is not shown.
  const sixTape = { status: "known", value: sixRuns, observed_at: at, coverage: cover("complete", 1, 1) };
  assert.ok(isN1Ribbon(ribbonWith(sixTape).data));
  const six = view(ok, ribbonWith(sixTape));
  assert.equal(six.includes("Run0"), false, "the oldest of six runs is not a recent signal");
  for (let index = 1; index < 6; index += 1) assert.ok(six.includes(`Run${index}`), `run ${index} shown`);
  assert.ok(six.indexOf("13:56") < six.indexOf("13:12"), "newest first");
  // F2 across a fractional-second boundary, from the projected tape: chronological, never lexical.
  const fractionTape = ribbonTape({ days: [{ date: "2030-01-07", summary: { accounts: [{ platform: "firstrade", account_alias: "fake-0", status: "ok",
    completeness: "complete", as_of: "2030-01-08T14:00:00Z", runs: fractionRuns }] } }],
    accounts: [{ platform: "firstrade", key: "fake-0", target_id: "firstrade/target0" }], date: "2030-01-08", readAt: Date.parse(at) }).tape;
  const fractionHtml = view(ok, ribbonWith(fractionTape));
  assert.equal(fractionHtml.includes('data-outcome="error"'), false, "the whole-second oldest run is the one left out");
  assert.ok(fractionHtml.indexOf('data-outcome="filled"') < fractionHtml.indexOf('data-outcome="no_op"'), "the later fractional run leads");
  // F2: a loading ribbon is not an empty signal list.
  const loading = view(ok, { state: "loading" });
  assert.ok(loading.includes(t("overview.signals.loading")), "loading is named");
  assert.equal(loading.includes(t("overview.signals.empty")), false, "loading is never 'no signals'");
  assert.equal(view(ok, { state: "failed" }).includes(t("overview.signals.empty")), false, "a failed ribbon is never 'no signals'");
  // #4: a populated partial or stale list keeps its qualification.
  const partialTape = { status: "partial", value: sixRuns.slice(0, 2), observed_at: at, coverage: cover("partial", 1, 2, ["coverage_incomplete"]) };
  const partialHtml = view(ok, ribbonWith(partialTape));
  assert.ok(partialHtml.includes("Run1") && partialHtml.includes(t("n1.partial", { coverage: "1/2" })), "partial list keeps its coverage");
  const staleTape = { status: "stale", value: sixRuns.slice(0, 2), observed_at: at, age_seconds: 7200, coverage: cover("complete", 1, 1) };
  const staleHtml = view(ok, ribbonWith(staleTape));
  assert.ok(staleHtml.includes("Run1") && staleHtml.includes('data-read="stale"'), "stale list keeps its staleness");
  assert.ok(staleHtml.includes(t("read.stale", { age: "@" }).split("@")[0]), "stale list names its age");
  const knownHtml = view(ok, ribbonWith(sixTape));
  assert.equal(knownHtml.includes(t("n1.partial", { coverage: "1/1" })), false, "a complete list carries no partial note");
  // F3: a stale NAV is displayed with its stale label and age, never as a current figure.
  const staleNav = golden("overview", "ok");
  staleNav.book.value[0].nav = { status: "stale", currency: "USD", amount: "1000", usd: "1000", observed_at: "2030-01-06T15:00:00Z", age_seconds: 172800 };
  staleNav.freshness = { data_status: "stale", age_seconds: 172800 };
  assert.ok(isN1Overview(staleNav) && schemaOk("overview", staleNav));
  const staleNavHtml = view(staleNav, ribbonWith(sixTape));
  assert.ok(staleNavHtml.includes(t("overview.book.nav_stale", { age: "@" }).split("@")[0]), "stale NAV is labelled");
  assert.ok(staleNavHtml.includes('class="mrd-ov-book-nav" data-read="stale"'), "the figure itself is marked stale");
  assert.ok(staleNavHtml.includes(t("states.stale", { age: "@" }).split("@")[0]) && !staleNavHtml.includes(t("states.stale", { age: "—" })), "all-stale age is shown, not dropped");
  assert.equal(view(ok, ribbonWith(sixTape)).includes(t("overview.book.nav_stale", { age: "@" }).split("@")[0]), false, "a known NAV has no stale label");

  // F4: Performance minimum-set metadata renders even when the curve is unavailable.
  const perfView = (data, source = "live", benchmarks = { phase: "not_requested" }) => render(h(PerformanceView, {
    perf: { state: "ready", result: { data, source, scenario: null } }, benchmarks, t, language, narrow: false }));
  const unknownPerf = golden("performance", "ok");
  const perfHtml = perfView(unknownPerf);
  assert.ok(perfHtml.includes(t("perf.portfolio_unknown", { reason: t(n1ReasonKey(unknownPerf.equity.reason)) })));
  assert.ok(perfHtml.includes(t("perf.meta.window", { range: "6M", from: "2029-07-08" })), "requested window");
  assert.ok(perfHtml.includes(t("perf.meta.first_date", { date: "2030-01-02" })), "first stored date");
  assert.ok(perfHtml.includes(t("perf.history.truncated", { range: "6M", date: "2030-01-02" })), "truncation note");
  assert.ok(perfHtml.includes(t("perf.meta.basis", { basis: t("basis.nav_change_unadjusted") })), "portfolio return basis");
  for (const target of ["firstrade/target0", "firstrade/target1"]) {
    assert.ok(perfHtml.includes(t("perf.meta.basis_target", { target, basis: t("basis.nav_change_unadjusted") })), `per-target basis ${target}`);
  }
  const fullHistory = golden("performance", "ok"); fullHistory.history.truncated_by = null;
  assert.ok(isN1Performance(fullHistory));
  const fullHtml = perfView(fullHistory);
  assert.equal(fullHtml.includes("data-truncated"), false, "no truncation note for a complete window");
  assert.ok(fullHtml.includes(t("perf.meta.first_date", { date: "2030-01-02" })), "first date still shown");
  const allHistory = golden("performance", "empty");
  assert.ok(perfView(allHistory).includes(t("perf.meta.window_all", { range: allHistory.range })), "an open window is named");
  if (language === "en") assert.doesNotMatch(text(perfHtml), /[一-鿿]/, "the English performance page shows no Chinese copy");

  // #6/1a: the next-run chip in the shared bar, all states, both themes, hidden behind the lock.
  for (const theme of ["light", "dark"]) {
    const bar = { page: "overview", t, language, theme, gateway: { kind: "read", read: { status: "unknown", reason: "not_supported" } },
      nowIso: at, serverClock: true, mock: null, freshness: { kind: "read", data_status: "ready", age_seconds: 60 }, onLanguage: () => {}, onTheme: () => {} };
    const chip = read => render(h(TopBar, { ...bar, nextRun: read }));
    const known = chip(nextRead("known"));
    assert.ok(known.includes(t("next_run.known", { time: "19:30", target: "firstrade/target1" })) && known.includes('data-next-run="known"'));
    const part = chip(nextRead("partial"));
    assert.ok(part.includes(t("next_run.partial", { time: "19:30", target: "firstrade/target1", coverage: "1/2" })), "partial names itself");
    assert.equal(part.includes(t("next_run.known", { time: "19:30", target: "firstrade/target1" })), false, "partial is never the global next run");
    const old = chip(nextRead("stale", "2030-01-08T19:30:00Z", { age_seconds: 7200 }));
    assert.ok(old.includes('data-next-run="stale"') && old.includes(t("next_run.stale", { time: "19:30", target: "firstrade/target1", age: "@" }).split("@")[0]));
    const past = chip(nextRead("known", "2030-01-08T14:59:00Z"));
    assert.ok(past.includes(t("next_run.unknown")) && past.includes('data-next-run="unknown"'), "a time already past is not upcoming");
    const unknownChip = chip({ status: "unknown", reason: "source_unavailable", observed_at: null, coverage: cover("unavailable", 0, null, ["source_unavailable"]) });
    assert.ok(unknownChip.includes(t("next_run.unknown")), "unknown is '?', never 'no run'");
    assert.ok(chip({ ...nextRead("known"), value: null }).includes(t("next_run.unknown")), "a null value never proves no future run");
    assert.equal(render(h(TopBar, bar)).includes("data-next-run"), false, "no chip without a ribbon read");
    const shell = (lock) => render(h(DeskShell, { ...bar, alertCount: null, alertUnknown: true, nextRun: nextRead("known"), lock, onNavigate: () => {}, children: null }));
    assert.ok(shell(null).includes('data-next-run="known"'), "the shell passes the read through");
    assert.equal(shell({ crumb: "access.title", chip: "access.chip.login" }).includes("data-next-run"), false, "no next run behind the lock");
  }
  // S2 completion #5: a next run on another UTC day than the viewer's carries its UTC date;
  // coverage and stale age stay. Exact midnight, cross-date and a DST switch day.
  {
    const dayOf = iso => formatUtcDayLabel(iso, language);
    const bar = { page: "overview", t, language, theme: "light", gateway: { kind: "read", read: { status: "unknown", reason: "not_supported" } },
      serverClock: true, mock: null, onLanguage: () => {}, onTheme: () => {} };
    const chipAt = (read, nowIso) => render(h(TopBar, { ...bar, nowIso, nextRun: read }));
    const target = "firstrade/target1";
    const tomorrow = chipAt(nextRead("known", "2030-01-09T00:30:00Z"), "2030-01-08T23:00:00Z");
    assert.ok(tomorrow.includes(t("next_run.known", { time: `${dayOf("2030-01-09T00:30:00Z")} 00:30`, target })), "a next UTC day run is dated");
    assert.ok(chipAt(nextRead("known", "2030-01-09T00:00:00Z"), "2030-01-08T23:59:59Z").includes(t("next_run.known", { time: `${dayOf("2030-01-09T00:00:00Z")} 00:00`, target })),
      "one second before UTC midnight, a midnight run is tomorrow's");
    assert.ok(chipAt(nextRead("known", "2030-01-09T00:00:01Z"), "2030-01-09T00:00:00Z").includes(t("next_run.known", { time: "00:00", target })), "at UTC midnight it is today's");
    assert.ok(chipAt(nextRead("known"), at).includes(t("next_run.known", { time: "19:30", target })), "same UTC day: time only");
    const partTomorrow = chipAt(nextRead("partial", "2030-01-09T00:30:00Z"), "2030-01-08T23:00:00Z");
    assert.ok(partTomorrow.includes(t("next_run.partial", { time: `${dayOf("2030-01-09T00:30:00Z")} 00:30`, target, coverage: "1/2" })), "partial keeps its coverage");
    const staleTomorrow = chipAt(nextRead("stale", "2030-01-09T00:30:00Z", { age_seconds: 7200 }), "2030-01-08T23:00:00Z");
    assert.ok(staleTomorrow.includes(t("next_run.stale", { time: `${dayOf("2030-01-09T00:30:00Z")} 00:30`, target, age: formatAge(7200, language) })), "stale keeps its age");
    // 2030-03-10 is the NY DST switch day; the label is UTC and moves with nothing but the UTC date.
    assert.ok(chipAt(nextRead("known", "2030-03-10T07:30:00Z"), "2030-03-10T06:59:00Z").includes(t("next_run.known", { time: "07:30", target })));
    assert.ok(chipAt(nextRead("known", "2030-03-11T03:30:00Z"), "2030-03-10T23:30:00Z").includes(t("next_run.known", { time: `${dayOf("2030-03-11T00:00:00Z")} 03:30`, target })));
    assert.deepEqual(utcWhen("2030-01-09T00:30:00Z", "2030-01-08T23:00:00Z", language), `${dayOf("2030-01-09T00:30:00Z")} 00:30`);
    assert.equal(utcWhen("2030-01-09T00:30", "2030-01-08T23:00:00Z", language), null, "a malformed instant is not formatted");
  }
  for (const key of ["overview.signals.loading", "overview.book.nav_stale", "perf.meta.window", "perf.meta.window_all", "perf.meta.first_date",
    "perf.meta.basis", "perf.meta.basis_target", "perf.bench.contained", "next_run.known", "next_run.stale", "next_run.partial", "next_run.unknown", "next_run.title"]) {
    assert.ok(DESK_MESSAGES[language][key], `missing ${language} ${key}`);
  }
}

// F5: the live N1 path never reads the non-approved benchmark source, even with a qualified curve.
{
  let benchmarkCalls = 0;
  const outbound = [];
  const spy = { benchmarks: async () => { benchmarkCalls += 1; throw Error("benchmark read attempted"); } };
  const qualified = golden("performance", "ok");
  qualified.equity = { status: "known", value: { dates: ["2030-01-02", "2030-01-03", "2030-01-06"], portfolio_indexed: ["100", "101", "102"],
    drawdown_ratio: ["0", "0", "0"], gap_dates: [], gap_semantics: "break_before_observation" }, observed_at: at, coverage: cover("complete", 2, 2) };
  assert.ok(isN1Performance(qualified) && schemaOk("performance", qualified), "a synthetic qualified curve");
  const window = { start: "2030-01-02", end: "2030-01-06" };
  assert.equal(benchmarkReadAllowed("live"), false);
  assert.deepEqual(await loadBenchmarks(spy, { data: qualified, source: "live", scenario: null }, window), { phase: "not_requested" },
    "an unrequested live read is not_requested, never failed");
  assert.equal(benchmarkCalls, 0, "no api.benchmarks() call on the live path");
  // Through the real API object: a live benchmark read would hit /api/market-benchmark/performance.
  const liveApi = createDeskApi({ forcedScenario: null, delayMs: 0, sources: liveSources, fetchJson: async url => { outbound.push(url); throw Error("no network"); } });
  await loadBenchmarks(liveApi, { data: qualified, source: "live", scenario: null }, window);
  assert.deepEqual(outbound, [], "no request to the benchmark route");
  // Fixture pages keep their synthetic comparison.
  assert.equal(benchmarkReadAllowed("mock"), true);
  await loadBenchmarks(spy, { data: qualified, source: "mock", scenario: "ok" }, window);
  assert.equal(benchmarkCalls, 1, "mock keeps the fixture benchmark read");
  const tEn = (key, params) => deskTranslate("en", key, params);
  const perfSrc = readFileSync(new URL("../web/strategy-switch-console/frontend/src/desk/pages/PerformancePage.tsx", import.meta.url), "utf8");
  const liveView = benchmarks => render(h(PerformanceView, { perf: { state: "ready", result: { data: qualified, source: "live", scenario: null } },
    benchmarks, t: tEn, language: "en", narrow: false }));
  const liveCurve = liveView({ phase: "not_requested" });
  assert.ok(liveCurve.includes(tEn("perf.bench.contained")), "the live page says the comparison is not read");
  // Item 3: the live page never claims a benchmark load or failure it did not attempt, whatever state it holds.
  for (const held of [{ phase: "not_requested" }, { phase: "loading" }, { phase: "failed" }]) {
    const html = liveView(held);
    assert.ok(html.includes('data-benchmark-phase="not_requested"'), `live ${held.phase}: shown as not_requested`);
    assert.equal(html.match(/data-benchmark="contained"/g)?.length, 1, `live ${held.phase}: the contained copy once`);
    assert.equal(html.includes(tEn("perf.fetch_failed")), false, `live ${held.phase}: no fetch-failed copy`);
    assert.equal(html.includes('data-benchmark-phase="loading"'), false, `live ${held.phase}: no loading phase`);
  }
  assert.deepEqual(shownBenchmarkState("live", { phase: "loading" }), { phase: "not_requested" });
  assert.deepEqual(shownBenchmarkState("mock", { phase: "not_requested" }), { phase: "loading" }, "an allowed read is loading until it settles");
  assert.deepEqual(shownBenchmarkState("mock", { phase: "failed" }), { phase: "failed" }, "a real mock failure stays failed");
  const mockView = benchmarks => render(h(PerformanceView, { perf: { state: "ready", result: { data: qualified, source: "mock", scenario: "ok" } },
    benchmarks, t: tEn, language: "en", narrow: false }));
  assert.ok(mockView({ phase: "loading" }).includes('data-benchmark-phase="loading"'), "a mock read in flight is loading");
  assert.equal(mockView({ phase: "loading" }).includes('data-benchmark="contained"'), false, "a mock page is not contained");
  assert.ok(mockView({ phase: "failed" }).includes(tEn("perf.fetch_failed")), "a mock read failure keeps its copy");
  assert.match(perfSrc, /useState<BenchmarkState>\(\{ phase: "not_requested" \}\)/, "the page starts not_requested");
  assert.ok(liveCurve.includes(tEn("perf.meta.first_date", { date: qualified.history.first_date })), "metadata with a curve too");
  assert.equal(perfSrc.match(/api\.benchmarks\(/g)?.length, 1, "the only benchmark call sits behind benchmarkReadAllowed");

  // Logs keeps the read status beside its headline (tests/console_desk_phase8_validation.mjs), and the
  // headline itself must stay true for a partial earliest candidate: never "the next run".
  for (const language of ["zh", "en"]) {
    const copy = DESK_MESSAGES[language]["logs.runs.next"];
    assert.match(copy, language === "en" ? /^Earliest observed scheduled run / : /^已观测到的最早计划运行 /, `${language}: Logs next-run copy is qualified`);
  }
}

// Performance KPIs: backend reads only, no computed fallback; CAGR has no N1 source.
assert.deepEqual(portfolioStatsFor(golden("performance", "ok")), { ret: null, cagr: null, maxDrawdown: null });
const knownPerf = golden("performance", "ok");
knownPerf.risk.return_ratio = { status: "known", value: "0.12", observed_at: at, coverage: cover("complete") };
knownPerf.risk.max_drawdown_ratio = { status: "partial", value: "-0.05", observed_at: at, coverage: cover("partial", 1, 2, ["insufficient_history"]) };
assert.deepEqual(portfolioStatsFor(knownPerf), { ret: 0.12, cagr: null, maxDrawdown: null }, "a partial window metric is not the requested window");

// Strategies page: an unknown eligibility is shown, but never eligible, counted or selectable.
const tEn = (key, params) => deskTranslate("en", key, params);
const partialCatalog = catalogEntries(golden("switch-strategies", "partial").strategies.value);
assert.equal(partialCatalog.length, 4, "every projected row is kept");
assert.deepEqual(partialCatalog.filter(entry => entry.option === null).map(entry => entry.row.profile), ["fake_dca"]);
assert.deepEqual(entryCounts(partialCatalog), { all: 4, eligible: 1, paper: 1, blocked: 1 }, "unknown rows only count toward all");
assert.deepEqual(filterEntries(partialCatalog, "eligible").map(entry => entry.row.profile), ["fake_growth"]);
assert.equal(filterEntries(partialCatalog, "all").length, 4, "an unknown row is never dropped from the full list");
assert.equal(filterEntries(partialCatalog, "blocked").some(entry => entry.option === null), false, "unknown is not blocked either");
const okCatalog = golden("switch-strategies", "ok");
assert.equal(catalogRevisionText(okCatalog.catalog_revision, tEn), okCatalog.catalog_revision.value.value.slice(0, 12), "fingerprint prefix");
assert.equal(catalogRevisionText(golden("switch-strategies", "partial").catalog_revision, tEn), tEn("read.unknown"), "no revision for an incomplete catalog");
assert.deepEqual(entryCounts(catalogEntries(golden("switch-strategies", "empty").strategies.value)), { all: 0, eligible: 0, paper: 0, blocked: 0 });

// Source checks for wiring that has no pure export.
const src = path => readFileSync(new URL(`../web/strategy-switch-console/frontend/src/desk/${path}`, import.meta.url), "utf8");
const app = src("DeskApp.tsx");
assert.match(app, /\{ kind: "read", \.\.\.ribbon\.result\.data\.freshness \}/, "freshness comes from the stored observations");
assert.doesNotMatch(app, /generated_at/, "generated_at never drives data freshness");
assert.doesNotMatch(src("pages/PerformancePage.tsx"), /computeStats/, "no UI-side metric fallback");
assert.match(src("pages/LogsPage.tsx"), /api\.logs\(\)/, "logs keep their existing (fixture) read");
assert.doesNotMatch(src("api/endpoints.ts"), /\/api\/desk\/logs"\s*,\s*isN1/, "logs are not an N1 read");

console.log("console_desk_n1_validation: PASS (5 areas × 4 golden payloads: schema = guard = render; strict live v2, mock-only v1 normalisation, unknown/partial never zero; fake data only)");
