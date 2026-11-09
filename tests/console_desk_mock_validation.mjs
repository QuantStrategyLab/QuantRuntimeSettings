// Desk (Meridian) mock layer: fixtures match schemas/desk (BE-0), guards accept them and reject
// corrupted shapes, and the live/mock switch behaves. Synthetic data only.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import * as session from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/session.ts";
import * as ribbon from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/ribbon.ts";
import * as overview from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/overview.ts";
import * as accounts from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/accounts.ts";
import * as credentials from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/credentials.ts";
import * as switchTargets from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/switchTargets.ts";
import * as switchStrategies from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/switchStrategies.ts";
import { days } from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/shared.ts";
import {
  isAccounts, isCredentials, isOverview, isRead, isRibbon, isSession, isSwitchStrategies, isSwitchTargets,
} from "../web/strategy-switch-console/frontend/src/desk/api/guards.ts";
import { MOCK_FAILURE, loadMock, resolveMockScenario } from "../web/strategy-switch-console/frontend/src/desk/api/mock.ts";
import { DESK_PAGE_ENDPOINTS, DESK_SHELL_ENDPOINTS, DESK_SOURCES, DeskContractError, createDeskApi, fixtureExposure } from "../web/strategy-switch-console/frontend/src/desk/api/endpoints.ts";
import { HttpError } from "../web/strategy-switch-console/frontend/src/api/client.ts";

// 1. Fixtures validate against the BE-0 JSON schemas (Ajv comes from the Worker package, as in desk_contract_validation).
const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const Ajv2020 = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats");
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
addFormats(ajv);
const schemaDir = new URL("../schemas/desk/", import.meta.url);
const ids = {};
for (const file of readdirSync(schemaDir).filter(f => f.endsWith(".json") && f !== "manifest.json")) {
  const schema = JSON.parse(readFileSync(new URL(file, schemaDir), "utf8"));
  ajv.addSchema(schema);
  ids[file.slice(0, -5)] = schema.$id;
}
const validate = (name, value, label) => {
  const check = ajv.getSchema(ids[name]);
  assert.ok(check(value), `${label}: ${ajv.errorsText(check.errors)}`);
};
const fixtures = { session, ribbon, overview };
for (const [name, module] of Object.entries(fixtures)) {
  for (const scenario of ["ok", "degraded"]) validate(name, module[scenario], `${name}.${scenario}`);
}
const schemaFixtures = [
  ["accounts", accounts],
  ["switch-targets", switchTargets],
  ["switch-strategies", switchStrategies],
];
for (const [schemaName, module] of schemaFixtures) {
  for (const scenario of ["ok", "degraded", "empty"]) validate(schemaName, module[scenario], `${schemaName}.${scenario}`);
}
validate("error", MOCK_FAILURE, "fail scenario body");

// 2. Guards accept every fixture and reject shapes the UI must not render.
for (const scenario of ["ok", "degraded"]) {
  assert.ok(isSession(session[scenario]), `session.${scenario}`);
  assert.ok(isRibbon(ribbon[scenario]), `ribbon.${scenario}`);
  assert.ok(isOverview(overview[scenario]), `overview.${scenario}`);
  assert.ok(isAccounts(accounts[scenario]), `accounts.${scenario}`);
  assert.ok(isCredentials(credentials[scenario]), `credentials.${scenario}`);
  assert.ok(isSwitchTargets(switchTargets[scenario]), `switchTargets.${scenario}`);
  assert.ok(isSwitchStrategies(switchStrategies[scenario]), `switchStrategies.${scenario}`);
}
for (const scenario of ["empty"]) {
  assert.ok(isAccounts(accounts[scenario]), `accounts.${scenario}`);
  assert.ok(isCredentials(credentials[scenario]), `credentials.${scenario}`);
  assert.ok(isSwitchTargets(switchTargets[scenario]), `switchTargets.${scenario}`);
  assert.ok(isSwitchStrategies(switchStrategies[scenario]), `switchStrategies.${scenario}`);
}
const clone = value => structuredClone(value);
assert.equal(isRead({ status: "unknown", reason: "read_failed", value: "0" }), false, "unknown never carries a value");
assert.equal(isRead({ status: "known", value: "x" }), false, "known needs observed_at");
assert.equal(isRead({ status: "unknown", reason: "made_up" }), false, "reason enum");
assert.equal(isRead({ status: "stale", value: 1, observed_at: "2026-11-02T14:00:00Z" }), false, "stale needs age");
assert.equal(isRead({ status: "known", value: "stopped", observed_at: "2026-11-02T14:00:00Z" }, v => v === "running"), false, "value guard");
let bad = clone(overview.ok); bad.totals.nav = 1189800; assert.equal(isOverview(bad), false, "money must be a decimal string");
bad = clone(overview.ok); bad.book[0].runtime = { status: "unknown", reason: "read_failed", value: "stopped" }; assert.equal(isOverview(bad), false, "unknown runtime cannot claim stopped");
bad = clone(overview.ok); bad.needs_you = Array(6).fill(overview.ok.needs_you[0]); assert.equal(isOverview(bad), false, "needs_you max 5");
bad = clone(overview.ok); bad.equity_curve.portfolio.indexed.pop(); assert.equal(isOverview(bad), false, "curve arrays align");
bad = clone(overview.ok); bad.schema_version = "qsl.desk.overview.v2"; assert.equal(isOverview(bad), false, "schema version pinned");
bad = clone(ribbon.ok); bad.console_state.gateways = { status: "unknown", reason: "read_failed", value: "down" }; assert.equal(isRibbon(bad), false, "unknown gateway is not down");
bad = clone(session.ok); delete bad.server_time; assert.equal(isSession(bad), false, "session needs server_time");

// Calendar-invalid times must fail at every trusted live/mock boundary.
for (const invalid of [
  "2026-99-99T99:99:99Z", "2026-02-29T12:00:00Z", "2026-04-31T12:00:00Z",
  "2026-01-00T12:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T00:60:00Z",
  "2026-01-01T00:00:60Z", "2026-01-01T00:00:00.Z", "2026-01-01T00:00:00+00:00",
]) {
  for (const status of ["known", "stale", "unknown"]) {
    const read = status === "unknown" ? { status, reason: "read_failed", observed_at: invalid }
      : { status, value: "all_reachable", observed_at: invalid, age_seconds: 1 };
    assert.equal(isRead(read), false, `${status} rejects calendar-invalid time`);
  }
  const badSession = clone(session.ok); badSession.server_time = invalid;
  assert.equal(isSession(badSession), false, "session rejects impossible server time");
  const badRibbon = clone(ribbon.ok); badRibbon.generated_at = invalid;
  assert.equal(isRibbon(badRibbon), false, "envelope rejects impossible generation time");
  badRibbon.generated_at = ribbon.ok.generated_at;
  badRibbon.console_state.gateways.observed_at = invalid;
  assert.equal(isRibbon(badRibbon), false, "gateway rejects impossible observation time");
  const live = createDeskApi({ forcedScenario: null, sources: { ribbon: "live" }, delayMs: 0, fetchJson: async () => badRibbon });
  await assert.rejects(live.ribbon(), DeskContractError, "live endpoint rejects malformed time");
}
for (const valid of ["2024-02-29T23:59:59Z", "2000-02-29T00:00:00.123456Z", "2026-12-31T23:59:59.001Z"]) {
  assert.equal(isRead({ status: "known", value: 1, observed_at: valid }), true, "valid UTC calendar time");
}

for (const invalid of ["24:00", "12:60", "99:99", "1:30"]) {
  const badClock = clone(ribbon.ok); badClock.sessions[0].open_utc = invalid;
  assert.equal(isRibbon(badClock), false, "market clock rejects impossible UTC time");
}

// Invalid calendar/time fields must fail at every trusted timestamp boundary.
for (const at of ["2026-99-99T99:99:99Z", "2026-02-29T12:00:00Z", "2026-04-31T00:00:00Z",
  "2026-01-00T00:00:00Z", "2026-00-01T00:00:00Z", "2026-11-02T24:00:00Z",
  "2026-11-02T12:60:00Z", "2026-11-02T12:00:60Z", "2026-11-02T12:00:00+00:00"]) {
  assert.equal(isSession({ ...session.ok, server_time: at }), false, "invalid session time");
  for (const status of ["known", "stale"]) {
    const read = { status, value: "all_reachable", observed_at: at, age_seconds: 1 };
    assert.equal(isRead(read), false, "invalid observation time");
    const payload = clone(ribbon.ok); payload.console_state.gateways = read;
    const api = createDeskApi({ forcedScenario: null, delayMs: 0, sources: { ribbon: "live" }, fetchJson: async () => payload });
    await assert.rejects(api.ribbon(), DeskContractError);
  }
  assert.equal(isRibbon({ ...ribbon.ok, generated_at: at }), false, "invalid envelope time");
}
for (const at of ["2024-02-29T23:59:59Z", "2026-11-02T00:00:00.123456Z", "0099-01-01T00:00:00Z"]) {
  assert.ok(isRead({ status: "known", value: 1, observed_at: at }), "valid leap/fractional/early-year time");
}

// 3. Fixtures are internally consistent and synthetic.
const cents = text => BigInt(text.replace(".", ""));
const usd = overview.ok.book.reduce((sum, row) => sum + cents(row.nav.usd), 0n);
assert.equal(usd, cents(overview.ok.totals.nav), "ok totals equal the sum of book USD");
const dayChange = overview.ok.book.reduce((sum, row) => sum + cents(row.day_change.amount), 0n);
assert.equal(dayChange, cents(overview.ok.totals.day_change.amount), "day change adds up");
const included = overview.degraded.book.filter(row => row.nav.status === "known" && row.nav.usd !== null);
assert.equal(included.length, overview.degraded.totals.coverage.included, "partial coverage counts included accounts");
assert.equal(included.reduce((sum, row) => sum + cents(row.nav.usd), 0n), cents(overview.degraded.totals.nav), "partial total is not silent");
for (const scenario of ["ok", "degraded"]) for (const row of overview[scenario].book) {
  const spark = row.sparkline_30d;
  if (spark.points.length) {
    const span = days(spark.dates_from, Math.round((Date.parse(spark.dates_to) - Date.parse(spark.dates_from)) / 86400000) + 1);
    assert.equal(spark.points.length, span.length - spark.gap_dates.length, `${row.target_id}: points = days − gaps`);
    for (const gap of spark.gap_dates) assert.ok(span.includes(gap), `${row.target_id}: gap inside range`);
  } else {
    assert.equal(spark.dates_from, null, "no history has no dates");
  }
  assert.match(row.account_ref, /^[A-Z]{1,2}•••000[1-6]$/, "fake masked refs only");
  assert.equal(row.account_ref.slice(-4), row.account_suffix);
}
for (const scenario of ["ok", "degraded"]) {
  for (const broker of accounts[scenario].brokers) {
    for (const target of broker.targets) assert.match(target.account_ref, /^[A-Z]{1,2}•••000[1-6]$/, "fake masked refs only");
  }
  for (const target of switchTargets[scenario].targets) assert.match(target.account_ref, /^[A-Z]{1,2}•••000[1-6]$/, "fake masked refs only");
  for (const item of credentials[scenario].items) {
    assert.notEqual(item.phase, "14", "the desk reminder enum has no 14");
    assert.ok(["unknown", "not_due", "30", "7", "1", "expired"].includes(item.phase), `credential phase ${item.phase}`);
  }
}
const allFixtures = { session, ribbon, overview, accounts, credentials, switchTargets, switchStrategies };
// The offered runbook is public product documentation, never account data.
// Exempt only this exact URL and only in the runbook field; keep all other host checks.
const publicRunbook = "https://github.com/QuantStrategyLab/QuantRuntimeSettings/blob/main/docs/credential-maintenance.zh-CN.md";
const fixtureText = fixtures => JSON.stringify(fixtures, (key, value) => key === "runbook" && value === publicRunbook ? "repository-runbook" : value);
const text = fixtureText(allFixtures);
for (const fixtures of [
  { runbook: "https://private.example.invalid/runbook" },
  { runbook: `${publicRunbook}?account=fake-account` },
  { credential_host: publicRunbook },
  { login: "fake@example.invalid" },
]) assert.match(fixtureText(fixtures), /@|https?:\/\/(?!example)/, "all non-runbook hosts and emails remain rejected");
assert.doesNotMatch(text, /@|https?:\/\/(?!example)/, "no emails or real hosts");
const coreText = JSON.stringify({ session, ribbon, overview });
for (const match of coreText.matchAll(/"(\d{4}-\d{2}-\d{2})T/g)) assert.ok(match[1] >= "2026-09-01" && match[1] <= "2026-11-03", `synthetic time ${match[1]}`);
// Expiry fixtures may sit in the future; they are still synthetic.
const extraText = JSON.stringify({ accounts, credentials, switchTargets, switchStrategies });
for (const match of extraText.matchAll(/"(\d{4}-\d{2}-\d{2})T/g)) assert.ok(match[1] >= "2026-09-01" && match[1] <= "2026-12-31", `synthetic time ${match[1]}`);

// 4. Mock switch: ?mock= beats storage; 0/unknown values turn it off.
assert.equal(resolveMockScenario("", null), null);
assert.equal(resolveMockScenario("?mock=1", null), "ok");
assert.equal(resolveMockScenario("?mock=degraded", "fail"), "degraded");
assert.equal(resolveMockScenario("?mock=0", "ok"), null);
assert.equal(resolveMockScenario("?page=overview", "fail"), "fail");
assert.equal(resolveMockScenario("?mock=<script>", null), null);

// 5. Endpoint sources: session, credentials and the switch target list are live;
//    the rest stay mock until their backend lands.
assert.deepEqual(DESK_SOURCES, {
  session: "live", ribbon: "mock", overview: "mock", accounts: "mock", credentials: "live",
  switchTargets: "live", switchStrategies: "mock", performance: "mock",
  alerts: "mock", alertDelivery: "mock", logs: "mock",
});
const calls = [];
const fetchJson = async path => {
  calls.push(path);
  if (path === "/api/desk/credentials") return structuredClone(credentials.ok);
  if (path === "/api/desk/switch/targets") return structuredClone(switchTargets.ok);
  return structuredClone(session.ok);
};
const api = createDeskApi({ forcedScenario: null, delayMs: 0, fetchJson });
const s = await api.session();
assert.deepEqual([s.source, s.scenario, calls], ["live", null, ["/api/session"]]);
const r = await api.ribbon("2026-11-02");
assert.deepEqual([r.source, r.scenario], ["mock", "ok"]);
const acc = await api.accounts();
assert.deepEqual([acc.source, acc.scenario], ["mock", "ok"]);
assert.equal(acc.data.brokers.length, 5);
const cred = await api.credentials();
assert.deepEqual([cred.source, cred.scenario, calls], ["live", null, ["/api/session", "/api/desk/credentials"]]);
assert.ok(cred.data.items.some(item => item.phase === "7"), "fixture covers the 7-day phase");
const st = await api.switchTargets();
assert.deepEqual([st.source, st.scenario], ["live", null]);
assert.equal(st.data.targets[0].target_id, "ibkr/tqqq");
const sc = await api.switchStrategies("schwab/core");
assert.deepEqual([sc.source, sc.scenario], ["mock", "ok"]);
assert.equal(sc.data.target_id, "schwab/core");
assert.equal(sc.data.domain, "us_equity");
assert.equal(calls.length, 3, "mock endpoints never hit the network; only live sources do");
r.data.tape.length = 0;
assert.ok((await api.ribbon()).data.tape.length > 0, "mock responses are copies");
const forced = createDeskApi({ forcedScenario: "degraded", delayMs: 0, fetchJson });
assert.equal((await forced.session()).source, "mock");
assert.equal((await forced.overview()).data.totals.status, "partial");
calls.length = 0;
assert.equal((await forced.credentials()).source, "mock", "a forced scenario overrides the live sources");
assert.equal((await forced.switchTargets()).source, "mock", "a forced scenario overrides the target list too");
assert.equal(calls.length, 0, "a forced scenario never hits the network");
const failing = createDeskApi({ forcedScenario: "fail", delayMs: 0, fetchJson });
await assert.rejects(failing.overview(), error => error instanceof HttpError && error.status === 503 && error.payload.error === "store_unavailable");
await assert.rejects(failing.switchStrategies("ibkr/tqqq"), HttpError);
const allLive = createDeskApi({ forcedScenario: null, delayMs: 0, sources: { session: "live", ribbon: "live", overview: "live" },
  fetchJson: async path => { calls.push(path); return path.startsWith("/api/desk/ribbon") ? { ok: true } : structuredClone(overview.ok); } });
await assert.rejects(allLive.ribbon("2026-11-02&x=1"), error => error instanceof DeskContractError && error.endpoint === "ribbon", "a bad live shape is rejected");
assert.equal(calls.at(-1), "/api/desk/ribbon", "a malformed date is dropped, not passed through");
assert.equal((await allLive.overview()).source, "live");
await assert.rejects(loadMock("overview", "fail", 0), HttpError);

// 7. A page's fixture chip follows every endpoint it renders, not just the two
//    global reads. A page mixing live reads and fixtures must never look real.
assert.deepEqual(Object.keys(DESK_PAGE_ENDPOINTS).sort(),
  ["accounts", "alerts", "logs", "overview", "performance", "switch"]);
for (const [page, endpoints] of Object.entries(DESK_PAGE_ENDPOINTS)) {
  assert.ok(endpoints.length > 0, `${page} declares its data sources`);
  for (const endpoint of endpoints) assert.ok(endpoint in DESK_SOURCES, `${page}: ${endpoint} is a real endpoint`);
}
assert.equal(fixtureExposure("accounts", null), "partial", "accounts fixture + live credentials");
assert.equal(fixtureExposure("switch", null), "partial", "live targets + fixture catalog");
for (const page of ["overview", "alerts", "logs", "performance"]) {
  assert.equal(fixtureExposure(page, null), "all", `${page} is still fixture-backed`);
}
for (const scenario of ["ok", "degraded", "fail"]) {
  assert.equal(fixtureExposure("accounts", scenario), "all", "?mock= forces every endpoint");
}
// The shell chrome (gateway chip, alert badge) renders the global ribbon read on
// every page, so a page only looks fully live once that read is live too.
assert.deepEqual([...DESK_SHELL_ENDPOINTS], ["ribbon"]);
const originalSources = { ...DESK_SOURCES };
DESK_SOURCES.accounts = "live";
assert.equal(fixtureExposure("accounts", null), "partial", "a fixture ribbon in the shell keeps the chip");
DESK_SOURCES.performance = "live";
assert.equal(fixtureExposure("performance", null), "partial", "single-endpoint page with a fixture shell");
// When a backend lands, flipping its source must retire the chip for that page.
DESK_SOURCES.ribbon = "live";
assert.equal(fixtureExposure("accounts", null), "none");
assert.equal(fixtureExposure("performance", null), "none");
assert.equal(fixtureExposure("overview", null), "partial", "overview fixture with a live ribbon");
Object.assign(DESK_SOURCES, originalSources);

// Each fixture-backed page names the fixtures it renders, in both dictionaries.
const pageLabels = [
  ["LogsPage.tsx", /mock\.badge/],
  ["AlertsPage.tsx", /delivery\.state === "ready"[\s\S]*mock\.badge/],
  ["StrategiesPage.tsx", /catalogMock[\s\S]*catalog_mock_note/],
];
for (const [file, pattern] of pageLabels) {
  const source = readFileSync(new URL(`../web/strategy-switch-console/frontend/src/desk/pages/${file}`, import.meta.url), "utf8");
  assert.match(source, pattern, `${file} keeps an explicit fixture label`);
}
for (const file of ["zh-CN.ts", "en.ts"]) {
  const messages = readFileSync(new URL(`../web/strategy-switch-console/frontend/src/desk/i18n/${file}`, import.meta.url), "utf8");
  for (const key of ["mock.badge_partial", "mock.title_partial", "strategies.catalog_mock_note"]) {
    assert.ok(messages.includes(`"${key}"`), `${file} has ${key}`);
  }
}

console.log("console_desk_mock_validation: PASS (session/ribbon/overview/accounts/credentials/switch fixtures vs schemas/desk, guards, totals, gaps, mock switch, per-page fixture exposure; synthetic only)");
