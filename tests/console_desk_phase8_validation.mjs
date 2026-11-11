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

console.log("console_desk_phase8_validation: PASS (alerts + logs guards, models, routes; synthetic only)");
