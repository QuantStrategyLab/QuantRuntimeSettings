// Desk (Meridian) phase 8: the alerts and logs pages, checked against the §3.17–§3.19
// schemas, their guards, the pure models behind the filters, and the source text of the
// two page components. Synthetic fixtures only; nothing here reads a real account.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { alertWhen, filterCounts, sortAlerts } from "../web/strategy-switch-console/frontend/src/desk/alerts/model.ts";
import { levelCounts, runSummary, tapeStateKey } from "../web/strategy-switch-console/frontend/src/desk/logs/model.ts";
import {
  isAlertDelivery, isAlerts, isLogs,
} from "../web/strategy-switch-console/frontend/src/desk/api/guards.ts";
import { DESK_SOURCES } from "../web/strategy-switch-console/frontend/src/desk/api/endpoints.ts";
import { ok as alertsOk, degraded as alertsDegraded } from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/alerts.ts";
import { ok as deliveryOk, degraded as deliveryDegraded } from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/alertDelivery.ts";
import { ok as logsOk, degraded as logsDegraded } from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/logs.ts";
import { ok as ribbonOk } from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/ribbon.ts";

const source = path => readFileSync(new URL(`../web/strategy-switch-console/frontend/src/desk/${path}`, import.meta.url), "utf8");
const clone = value => structuredClone(value);

// 1. Guards accept every shipped fixture: ok and degraded are both contract-valid.
for (const [name, fixture, guard] of [
  ["alerts.ok", alertsOk, isAlerts],
  ["alerts.degraded", alertsDegraded, isAlerts],
  ["alertDelivery.ok", deliveryOk, isAlertDelivery],
  ["alertDelivery.degraded", deliveryDegraded, isAlertDelivery],
  ["logs.ok", logsOk, isLogs],
  ["logs.degraded", logsDegraded, isLogs],
]) assert.ok(guard(fixture), name);

// 2. Guards reject shapes the UI would otherwise render with defaults.
const resolvedWithoutTime = clone(alertsOk);
resolvedWithoutTime.items.find(item => item.status === "resolved").resolved_at = null;
assert.equal(isAlerts(resolvedWithoutTime), false, "resolved without resolved_at");

const openWithTime = clone(alertsOk);
openWithTime.items.find(item => item.status === "open").resolved_at = "2026-11-02T15:00:00Z";
assert.equal(isAlerts(openWithTime), false, "open with resolved_at");

const unknownSeverity = clone(alertsOk);
unknownSeverity.items[0].severity = "emergency";
assert.equal(isAlerts(unknownSeverity), false, "unknown severity");

const shortRetention = clone(logsOk);
shortRetention.retention.days = 30;
assert.equal(isLogs(shortRetention), false, "retention is a contract constant");

const unknownLevel = clone(logsOk);
unknownLevel.items[0].level = "trace";
assert.equal(isLogs(unknownLevel), false, "unknown level");

const unredacted = clone(logsOk);
unredacted.redaction = "none";
assert.equal(isLogs(unredacted), false, "redaction must be applied");

const unknownChannel = clone(deliveryOk);
unknownChannel.channel.status = { status: "unknown", reason: "read_failed", observed_at: null };
assert.ok(isAlertDelivery(unknownChannel), "an unreadable channel is a valid unknown");
const badOutcome = clone(deliveryOk);
badOutcome.last_delivery.outcome = "skipped";
assert.equal(isAlertDelivery(badOutcome), false, "delivery outcome enum");

// 3. Ordering and counts: open before resolved, critical before warning, newest first.
const ordered = sortAlerts(alertsOk.items);
assert.deepEqual(ordered.map(item => item.status), ["open", "open", "open", "resolved", "resolved"]);
assert.deepEqual(ordered.slice(0, 3).map(item => item.severity), ["critical", "warning", "warning"]);
assert.notEqual(sortAlerts(alertsOk.items), alertsOk.items, "sort never mutates the response");

const counts = filterCounts(alertsOk.items);
assert.deepEqual(counts, { all: 5, critical: 1, warning: 2, info: 2 });
// The headline uses the response counts, so a partial read cannot overstate what is open.
assert.equal(alertsDegraded.counts.open, 1);
assert.equal(filterCounts(alertsDegraded.items).all, 1);

// 4. Time rendering: resolved shows its resolution, a single sighting shows one clock.
const resolved = alertsOk.items.find(item => item.status === "resolved");
assert.deepEqual(alertWhen(resolved), { kind: "resolved", first: "06:00", last: "06:00" });
const ranged = alertsOk.items.find(item => item.id === "alert_demo_0005");
assert.deepEqual(alertWhen(ranged), { kind: "range", first: "14:26", last: "14:31" });

// 5. Logs model: runs and drift come from the ribbon tape, levels from the tail.
assert.deepEqual(runSummary(ribbonOk.tape), { runs: 5, drift: 1 });
assert.deepEqual(runSummary([]), { runs: 0, drift: 0 });
assert.deepEqual(levelCounts(logsOk.items), { all: 11, error: 1, warn: 2, info: 7, debug: 1 });
assert.equal(tapeStateKey({ state: "done", outcome: "drift" }), "tape.outcome.drift");
assert.equal(tapeStateKey({ state: "scheduled", outcome: null }), "tape.state.scheduled");

// 6. Alerts and logs are still mock-sourced; delivery reads the #1108 sender-log route.
assert.equal(DESK_SOURCES.alerts, "mock");
assert.equal(DESK_SOURCES.alertDelivery, "live");
assert.equal(DESK_SOURCES.logs, "mock");

// 7. The desk routes both pages, and neither is a stub any more.
const app = source("DeskApp.tsx");
assert.match(app, /page === "alerts" \? <AlertsPage api=\{api\} t=\{t\} language=\{language\} \/>/);
assert.match(app, /page === "logs" \? <LogsPage api=\{api\} t=\{t\} language=\{language\} \/>/);
assert.match(app, /<PageStub page=\{page\} t=\{t\} \/>/, "the stub stays as the fallback for future pages");

// 8. Rendering rules: the log message is text, never HTML, and alerts only link out.
const logsPage = source("pages/LogsPage.tsx");
assert.doesNotMatch(logsPage, /dangerouslySetInnerHTML/, "log text is never injected as HTML");
assert.match(logsPage, /\{line\.message\}/, "the redacted message is rendered verbatim");
const alertsPage = source("pages/AlertsPage.tsx");
assert.match(alertsPage, /<a className="mrd-alert-action" href=\{item\.route\}/, "an alert action is a link, not a call");
for (const page of ["pages/AlertsPage.tsx", "pages/LogsPage.tsx"]) {
  assert.doesNotMatch(source(page), /postJson|fetch\(|XMLHttpRequest/, `${page} never writes`);
}

// 9. S2 completion #2: Logs keeps the whole next-run read (status, coverage, stored observation,
// stale age), expires a passed candidate on its local clock, dates times across UTC midnight,
// reads the ribbon once and never behind the lock. Synthetic ribbon payloads only.
{
  const { createRequire } = await import("node:module");
  const { join } = await import("node:path");
  const { deskTranslate, DESK_MESSAGES } = await import("../web/strategy-switch-console/frontend/src/desk/i18n/index.ts");
  const { formatAge, formatUtcDayLabel } = await import("../web/strategy-switch-console/frontend/src/desk/format.ts");
  const frontend = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
  const require = createRequire(join(frontend, "package.json"));
  const h = require("react").createElement;
  const render = element => require("react-dom/server").renderToStaticMarkup(element);
  const compiled = require("esbuild").buildSync({
    stdin: { resolveDir: join(frontend, "src"), loader: "tsx", contents: `export { LogsView, logsNextRun } from "./desk/pages/LogsPage";` },
    bundle: true, platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent", loader: { ".css": "empty" },
    external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"], write: false,
  }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(require, mod, mod.exports);
  const { LogsView, logsNextRun } = mod.exports;
  const ribbonGolden = JSON.parse(readFileSync(new URL("./fixtures/desk/n1-ribbon.ok.json", import.meta.url), "utf8"));
  const at = "2030-01-08T15:00:00Z";
  const cover = (state, included, total, reasons = []) => ({ state, included, total, reasons });
  const read = (status, due_at = "2030-01-08T19:30:00Z", extra = {}) => ({ status, value: { target_id: "firstrade/target1", kind: "scheduled_run", due_at },
    observed_at: "2030-01-08T14:30:00Z", coverage: status === "partial" ? cover("partial", 1, 2, ["coverage_incomplete"]) : cover("complete", 2, 2), ...extra });
  const staleRead = (due_at) => read("stale", due_at, { age_seconds: 7200 });
  const unknownRead = { status: "unknown", reason: "coverage_incomplete", observed_at: null, coverage: cover("unavailable", 0, null, ["coverage_incomplete"]) };

  for (const language of ["zh", "en"]) {
    const t = (key, params) => deskTranslate(language, key, params);
    const next = (value, nowIso = at) => logsNextRun(value, nowIso, t, language);
    const params = { time: "19:30", target: "firstrade/target1" };
    // Known: the qualified headline plus coverage and the stored observation instant.
    assert.deepEqual(next(read("known")), { state: "known", text: t("logs.runs.next", params),
      detail: t("logs.runs.next_known", { coverage: "2/2", observed: "14:30" }) });
    // Partial: coverage kept, never the overall next run.
    const partial = next(read("partial"));
    assert.deepEqual(partial, { state: "partial", text: t("logs.runs.next", params), detail: t("logs.runs.next_partial", { coverage: "1/2", observed: "14:30" }) });
    assert.ok(!partial.text.includes(t("next_run.known", params)), "a partial candidate is never 'the next run'");
    // Stale: its reported age is kept, not dropped or recomputed.
    assert.deepEqual(next(staleRead()), { state: "stale", text: t("logs.runs.next", params),
      detail: t("logs.runs.next_stale", { coverage: "2/2", observed: "14:30", age: formatAge(7200, language) }) });
    // Missing: unknown names its reason; a null value never proves that no run is due.
    assert.deepEqual(next(unknownRead), { state: "unknown", text: t("logs.runs.next_unknown", { reason: t("read.reason.coverage_incomplete") }), detail: null });
    assert.deepEqual(next({ ...read("known"), value: null }), { state: "missing", text: t("logs.runs.next_missing"), detail: null });
    // Expired locally: the same snapshot read turns passed at its due instant, never upcoming.
    for (const status of ["known", "partial", "stale"]) {
      const value = status === "stale" ? staleRead() : read(status);
      assert.equal(next(value, "2030-01-08T19:29:59Z").state, status, `${status}: one second before the due instant`);
      assert.deepEqual(next(value, "2030-01-08T19:30:00Z"), { state: "expired", text: t("logs.runs.next_expired", { time: "19:30" }), detail: null },
        `${status}: the due instant itself is no longer upcoming`);
    }
    // Across UTC midnight the date is shown, for the due time and the stored observation alike.
    const dayOf = iso => formatUtcDayLabel(iso, language);
    const late = next(read("known", "2030-01-09T00:30:00Z", { observed_at: "2030-01-07T23:59:00Z" }), "2030-01-08T23:00:00Z");
    assert.deepEqual(late, { state: "known", text: t("logs.runs.next", { time: `${dayOf("2030-01-09T00:00:00Z")} 00:30`, target: "firstrade/target1" }),
      detail: t("logs.runs.next_known", { coverage: "2/2", observed: `${dayOf("2030-01-07T00:00:00Z")} 23:59` }) });
    assert.ok(next(read("known", "2030-01-09T00:00:00Z"), "2030-01-08T23:59:59Z").text.includes(`${dayOf("2030-01-09T00:00:00Z")} 00:00`), "midnight: the next UTC day is dated");
    assert.ok(next(read("known", "2030-01-09T00:00:01Z"), "2030-01-09T00:00:00Z").text.includes(t("logs.runs.next", { ...params, time: "00:00" })), "same UTC day: time only");
    // DST: the NY clock change never moves a UTC label (2030-03-10 is the NY switch day).
    assert.ok(next(read("known", "2030-03-10T07:30:00Z", { observed_at: "2030-03-10T06:30:00Z" }), "2030-03-10T06:59:00Z").text
      .includes(t("logs.runs.next", { ...params, time: "07:30" })));

    // Render: the snapshot is named, the read is kept on the element, and tape times are dated across days.
    const ribbonWith = (next_run, tape = ribbonGolden.tape) => ({ state: "ready", result: { source: "live", scenario: null, data: { ...structuredClone(ribbonGolden), next_run, tape } } });
    const view = (ribbon, nowIso = at) => render(h(LogsView, { ribbon, logs: { state: "loading" }, level: "all", onLevel: () => {}, nowIso, t, language }));
    for (const [value, state] of [[read("known"), "known"], [read("partial"), "partial"], [staleRead(), "stale"], [unknownRead, "unknown"], [read("known", "2030-01-08T14:00:00Z"), "expired"]]) {
      const html = view(ribbonWith(value));
      assert.ok(html.includes(`data-next-run="${state}"`), `${language}: ${state} rendered`);
      assert.ok(html.includes(t("logs.runs.snapshot", { time: "15:00" })), "the one-time snapshot is named");
      if (language === "en") assert.doesNotMatch(html.replace(/<[^>]*>/g, " "), /[一-鿿]/, "the English Logs page shows no Chinese copy");
    }
    const tapeAt = "2030-01-08T13:56:00Z";
    const tape = { status: "known", observed_at: at, coverage: cover("complete", 1, 1), value: [{ id: "firstrade/target0#r", at: tapeAt, target_id: "firstrade/target0", label: "Firstrade",
      kind: "runtime_run", outcome: "no_op", outcome_detail: null, state: "done", source_business_date: "2030-01-08", source_timezone: "America/New_York" }] };
    assert.ok(view(ribbonWith(read("known"), tape)).includes('class="mrd-tape-time">13:56<'), "same UTC day: time only");
    assert.ok(view(ribbonWith(read("known", "2030-01-09T19:30:00Z"), tape), "2030-01-09T00:00:30Z").includes(`class="mrd-tape-time">${dayOf(tapeAt)} 13:56<`),
      "after UTC midnight the snapshot's tape keeps its date");
    for (const key of ["logs.runs.snapshot", "logs.runs.next_known", "logs.runs.next_partial", "logs.runs.next_stale", "logs.runs.next_expired",
      "logs.runs.next_unknown", "logs.runs.next_missing"]) assert.ok(DESK_MESSAGES[language][key], `missing ${language} ${key}`);
  }

  // Read and lock wiring: one ribbon read on open, a local tick that reads nothing, and no
  // Logs page at all behind the lock (the shell renders the access card instead).
  const logsSource = source("pages/LogsPage.tsx");
  assert.equal(logsSource.match(/api\.ribbon\(/g)?.length, 1, "Logs reads the ribbon once: no added or polled read");
  assert.match(logsSource, /window\.setInterval\(\(\) => setClientNow\(Date\.now\(\)\), LOCAL_TICK_MS\)/, "the only timer advances the local clock");
  assert.equal(logsSource.match(/setInterval/g)?.length, 1, "no polling timer");
  assert.match(app, /const content = access === "open" \? pageContent/, "pages, Logs included, mount only for an open session");
  assert.match(app, /: <AccessCard t=\{t\} kind=\{access\}/, "a locked shell renders the access card, never the Logs page");
}

console.log("console_desk_phase8_validation: PASS (alerts + logs guards, models, routes; synthetic only)");
