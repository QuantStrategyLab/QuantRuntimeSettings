// Desk F1: the alerts page's delivery panel reads GET /api/desk/alerts/delivery (#1108)
// through the console's real same-origin client, the published adapter and the frontend
// guard. Synthetic sessions and fake run numbers only; no network, send or account read.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

import { consoleApiResponse } from "../web/strategy-switch-console/application/console_api/routes.js";
import { RECEIPT_READ_ERROR_CODES } from "../web/strategy-switch-console/application/console_api/notification_receipts.js";
import { AccessError } from "../web/strategy-switch-console/frontend/src/api/client.ts";
import { DESK_SOURCES, DeskContractError, createDeskApi, fixtureExposure } from "../web/strategy-switch-console/frontend/src/desk/api/endpoints.ts";
import {
  DELIVERY_READ_REASONS, DELIVERY_READ_STATUSES, DELIVERY_SENDER_STATUSES, isAlertDelivery, isDeliverySource,
} from "../web/strategy-switch-console/frontend/src/desk/api/guards.ts";
import { alertsFixtureLabel, deliverySourceView } from "../web/strategy-switch-console/frontend/src/desk/alerts/model.ts";
import { ok as fixtureOk, degraded as fixtureDegraded } from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/alertDelivery.ts";
import { zh } from "../web/strategy-switch-console/frontend/src/desk/i18n/zh-CN.ts";
import { en } from "../web/strategy-switch-console/frontend/src/desk/i18n/en.ts";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const ajv = new Ajv({ strict: true, strictTypes: false });
require("ajv-formats")(ajv);
const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const schema = readJson("../schemas/desk/alert-delivery.json");
ajv.addSchema(readJson("../schemas/desk/common.json"));
const check = ajv.compile(schema);
const validate = (value, label) => assert.ok(check(value), `${label}: ${ajv.errorsText(check.errors)}`);
const clone = value => structuredClone(value);

// ---------------------------------------------------------------- real local read chain
// The browser client (getJson) → fetch → the Worker's console API router → the #1108
// adapter → the frontend guard. Only the session reader and the receipt source are fakes.
let invalidations = 0;
globalThis.window = { dispatchEvent: () => { invalidations += 1; return true; } };
let deps;
const requests = [];
globalThis.fetch = async (path, init) => {
  requests.push({ path, method: init.method, credentials: init.credentials });
  return consoleApiResponse(new Request(`https://console.invalid${path}`, { method: init.method }), {}, deps);
};
const baseDeps = {
  json: (body, status = 200) => Response.json(body, { status }),
  readSession: async () => ({ allowed: true }),
  accountOptions: () => { throw Error("must not read account state"); },
  command: () => { throw Error("must not write business state"); },
};
const withSource = source => ({ ...baseDeps, notificationReceipts: async () => source });
const live = createDeskApi({ forcedScenario: null, delayMs: 0 });

assert.equal(DESK_SOURCES.alertDelivery, "live", "only alertDelivery is wired live in F1");
for (const endpoint of ["ribbon", "overview", "accounts", "switchStrategies", "performance", "alerts", "logs"]) {
  assert.equal(DESK_SOURCES[endpoint], "mock", `${endpoint} stays a labelled mock`);
}

deps = withSource({ read_status: "partial", as_of: "2030-01-07T12:00:00Z", read_reason_codes: ["receipt_missing"], items: [
  { source_run_id: 11, source_run_attempt: 1, status: "delivered", delivered: true, dry_run: false, test_message: false, business_day: "2030-01-06" },
  { source_run_id: 12, source_run_attempt: 1, status: "receipt_missing", business_day: "2030-01-07" },
] });
const partial = await live.alertDelivery();
assert.deepEqual(requests.at(-1), { path: "/api/desk/alerts/delivery", method: "GET", credentials: "same-origin" });
assert.equal(partial.source, "live");
assert.equal(partial.scenario, null);
validate(partial.data, "live partial");
assert.equal(partial.data.last_delivery, null, "no recipients or send time are fabricated");
assert.equal(partial.data.digest, null, "no digest counts are fabricated");
assert.equal(partial.data.channel.status.status, "unknown");
const partialView = deliverySourceView(partial.data.source);
assert.equal(partialView.readKey, "alerts.delivery.read.partial");
assert.deepEqual(partialView.reasonKeys, ["alerts.delivery.reason.receipt_missing"]);
assert.deepEqual(partialView.rows.map(row => row.run), [{ id: 11, attempt: 1 }, { id: 12, attempt: 1 }], "rows stay independent");
assert.deepEqual(partialView.rows.map(row => row.acceptedKey), ["alerts.delivery.accepted.yes", "alerts.delivery.accepted.unknown"]);
assert.deepEqual(partialView.rows.map(row => row.receiverKey), ["alerts.delivery.receiver_unknown", "alerts.delivery.receiver_unknown"],
  "a delivered sender row is never shown as a receiver delivery");
assert.equal(partial.data.source.read_error_code, "unknown", "no top-level diagnostic supplied: explicit unknown fallback");
assert.equal(partialView.readErrorCode, "unknown");
assert.equal(partialView.readErrorShown, true, "a partial read shows its (unknown) source diagnostic");

// Source-level diagnostic through the same real chain, kept apart from row diagnostics.
deps = withSource({ read_status: "read_failed", read_reason_codes: ["notification_receipts_read_failed"],
  read_error_code: "run_listing_http_403", as_of: null,
  items: [{ source_run_id: 31, source_run_attempt: 1, status: "dry_run", dry_run: true, test_message: true,
    delivered: true, receiver_ack: "accepted", read_error_code: "artifact_listing_http_404" }] });
const diagnosed = await live.alertDelivery();
validate(diagnosed.data, "live source diagnostic");
assert.equal(diagnosed.source, "live");
assert.equal(diagnosed.data.source.read_status, "read_failed", "read_failed stays read_failed");
assert.equal(diagnosed.data.source.read_error_code, "run_listing_http_403");
assert.deepEqual(diagnosed.data.channel.status, { status: "unknown", reason: "read_failed" });
const diagnosedView = deliverySourceView(diagnosed.data.source);
assert.equal(diagnosedView.readErrorCode, "run_listing_http_403");
assert.equal(diagnosedView.readErrorShown, true);
assert.deepEqual(diagnosedView.rows.map(row => row.readErrorCode), ["artifact_listing_http_404"], "row codes stay per row");
assert.deepEqual([diagnosedView.rows[0].dryRun, diagnosedView.rows[0].testMessage], [true, true], "dry-run/test flags kept");
assert.equal(diagnosedView.rows[0].receiverKey, "alerts.delivery.receiver_unknown", "receiver ACK stays unknown");
for (const code of RECEIPT_READ_ERROR_CODES) {
  deps = withSource({ read_status: "read_failed", read_reason_codes: [], read_error_code: code, items: [] });
  const { data } = await live.alertDelivery();
  validate(data, `live ${code}`);
  assert.equal(deliverySourceView(data.source).readErrorCode, code, `${code} survives client→router→adapter→guard→model`);
}
for (const unsafe of [null, "", "FAKE_PRIVATE_PROVIDER_DETAIL", "run_listing_http_418", 403, { code: "run_listing_http_403" }]) {
  deps = withSource({ read_status: "read_failed", read_reason_codes: [], read_error_code: unsafe, items: [] });
  const { data } = await live.alertDelivery();
  validate(data, `unsafe ${String(unsafe)}`);
  assert.equal(data.source.read_error_code, "unknown", "untrusted top-level diagnostic falls back to unknown");
  assert.doesNotMatch(JSON.stringify(data), /FAKE_PRIVATE|_418/);
}
for (const read_status of ["no_data", "partial"]) {
  deps = withSource({ read_status, read_reason_codes: [], read_error_code: "run_listing_http_403", items: [] });
  const { data } = await live.alertDelivery();
  validate(data, `${read_status} with diagnostic`);
  assert.equal(data.source.read_status, read_status, `${read_status} is not rewritten as read_failed`);
  assert.equal(data.source.read_error_code, "run_listing_http_403");
}

// Unauthorized: the route answers 401 and the client invalidates its private session.
deps = { ...withSource({ read_status: "complete", read_reason_codes: [], items: [] }), readSession: async () => null };
const before = invalidations;
await assert.rejects(live.alertDelivery(), error => error instanceof AccessError && error.status === 401);
assert.equal(invalidations, before + 1, "401 invalidates the private session");

// Every unavailable read state stays honest: unknown channel, null summaries, no zero counts.
const states = [
  ["no_data", withSource({ read_status: "no_data", read_reason_codes: ["no_completed_workflow_runs"], as_of: null, items: [] }), "source_unavailable"],
  ["not_connected", { ...baseDeps }, "source_unavailable"],
  ["read_failed", { ...baseDeps, notificationReceipts: () => { throw Error("FAKE_PRIVATE_PROVIDER_DETAIL"); } }, "read_failed"],
  ["unknown", withSource({ read_status: "complete", read_reason_codes: [], items: "not-a-list" }), "not_supported"],
  ["complete", withSource({ read_status: "complete", read_reason_codes: [], as_of: "2030-01-07T12:00:00Z", items: [] }), "not_supported"],
];
for (const [expected, stateDeps, channelReason] of states) {
  deps = stateDeps;
  const { data, source } = await live.alertDelivery();
  validate(data, expected);
  assert.equal(source, "live");
  assert.equal(data.source.read_status, expected);
  assert.deepEqual(data.channel.status, { status: "unknown", reason: channelReason }, `${expected}: channel health is never inferred`);
  assert.equal(data.last_delivery, null);
  assert.equal(data.digest, null);
  assert.doesNotMatch(JSON.stringify(data), /FAKE_PRIVATE/);
  const view = deliverySourceView(data.source);
  assert.equal(view.readKey, `alerts.delivery.read.${expected}`);
  assert.equal(data.source.read_error_code, "unknown", `${expected}: no supplied diagnostic stays unknown`);
  assert.equal(view.readErrorShown, expected !== "complete", `${expected}: unknown diagnostic shown only for a non-complete read`);
  assert.equal(view.rows.length, 0, `${expected}: an empty read renders no rows, not a zero-success summary`);
}
deps = states[3][1];
assert.deepEqual((await live.alertDelivery()).data.source.read_reason_codes, ["invalid_notification_log"]);

// Stale evidence is kept verbatim: an expired receipt and old workflow metadata never become a fresh send.
deps = withSource({ read_status: "partial", read_reason_codes: ["receipt_expired"], as_of: "2030-01-07T12:00:00Z",
  items: [{ source_run_id: 7, source_run_attempt: 2, status: "receipt_expired", workflow_updated_at: "2000-01-01T00:00:00Z" }] });
const stale = await live.alertDelivery();
const staleRow = deliverySourceView(stale.data.source).rows[0];
assert.equal(staleRow.senderKey, "alerts.delivery.sender.receipt_expired");
assert.equal(staleRow.workflowUpdatedAt, "2000-01-01T00:00:00Z");
assert.equal(staleRow.acceptedKey, "alerts.delivery.accepted.unknown", "a null acceptance is unknown, not rejected");
assert.equal(stale.data.last_delivery, null);

// A malformed live body is rejected as a contract error, not rendered with defaults.
globalThis.fetch = async () => Response.json({ ...clone(partial.data), source: { ...clone(partial.data.source), read_status: "ok" } });
await assert.rejects(live.alertDelivery(), error => error instanceof DeskContractError && error.endpoint === "alertDelivery");

// ---------------------------------------------------------------- guard: fail closed on `source`
const base = clone(partial.data);
assert.ok(isAlertDelivery(base));
const { source: _drop, ...withoutSource } = base;
assert.ok(isAlertDelivery(withoutSource), "older bodies without source still validate");
const mutate = (label, edit) => {
  const body = clone(base);
  edit(body);
  assert.equal(isAlertDelivery(body), false, label);
  assert.equal(check(body), false, `${label} (schema agrees)`);
};
mutate("receiver ack other than unknown", body => { body.source.items[0].receiver_ack = "delivered"; });
mutate("unknown sender status", body => { body.source.items[0].sender_status = "received"; });
mutate("unknown read status", body => { body.source.read_status = "ok"; });
mutate("unknown reason code", body => { body.source.read_reason_codes = ["receiver_confirmed"]; });
mutate("duplicate reason codes", body => { body.source.read_reason_codes = ["receipt_missing", "receipt_missing"]; });
mutate("extra item field", body => { body.source.items[0].recipients = 3; });
mutate("missing item field", body => { delete body.source.items[0].receiver_ack; });
mutate("extra source field", body => { body.source.sent_at = "2030-01-07T12:00:00Z"; });
mutate("more than five items", body => { body.source.items = Array.from({ length: 6 }, () => clone(base.source.items[0])); });
mutate("non-positive run id", body => { body.source.items[0].source_run_id = 0; });
mutate("free-text read error", body => { body.source.items[0].read_error_code = "provider said: FAKE"; });
mutate("non-boolean acceptance", body => { body.source.items[0].sender_accepted = "yes"; });
mutate("impossible business day", body => { body.source.items[0].business_day = "2030-02-30"; });
mutate("null source", body => { body.source = null; });
mutate("missing source diagnostic", body => { delete body.source.read_error_code; });
mutate("null source diagnostic", body => { body.source.read_error_code = null; });
mutate("free-text source diagnostic", body => { body.source.read_error_code = "provider said: FAKE"; });
mutate("unallowlisted source diagnostic", body => { body.source.read_error_code = "run_listing_http_418"; });
mutate("non-string source diagnostic", body => { body.source.read_error_code = 403; });
mutate("unknown is not an item diagnostic", body => { body.source.items[0].read_error_code = "unknown"; });

// Guard enums are exactly the schema's enums (no silent drift between contract and UI).
const itemSchema = schema.properties.source.properties.items.items.properties;
assert.deepEqual([...DELIVERY_READ_STATUSES], schema.properties.source.properties.read_status.enum);
assert.deepEqual([...DELIVERY_READ_REASONS], schema.properties.source.properties.read_reason_codes.items.enum);
assert.deepEqual([...DELIVERY_SENDER_STATUSES], itemSchema.sender_status.enum);
for (const code of itemSchema.read_error_code.anyOf[0].enum) {
  const body = clone(base);
  body.source.items[0].read_error_code = code;
  assert.ok(isAlertDelivery(body) && check(body), `read error ${code} accepted`);
}
for (const code of ["run_listing_http_418", "sender_jobs_http_", "receipt_read_timeout_x"]) {
  assert.equal(isDeliverySource({ ...clone(base.source), items: [{ ...clone(base.source.items[0]), read_error_code: code }] }), false, code);
}
const sourceErrorEnum = schema.properties.source.properties.read_error_code.enum;
assert.deepEqual(itemSchema.read_error_code.anyOf[0].enum, [...RECEIPT_READ_ERROR_CODES], "item enum is the backend allowlist");
assert.deepEqual(sourceErrorEnum, [...itemSchema.read_error_code.anyOf[0].enum, "unknown"], "source enum adds only unknown");
for (const code of sourceErrorEnum) {
  const body = clone(base);
  body.source.read_error_code = code;
  assert.ok(isAlertDelivery(body) && check(body), `source read error ${code} accepted`);
}
for (const code of ["run_listing_http_418", "sender_jobs_http_", "receipt_read_timeout_x", "UNKNOWN", null]) {
  assert.equal(isDeliverySource({ ...clone(base.source), read_error_code: code }), false, `source ${code}`);
}

// ---------------------------------------------------------------- fixtures stay labelled
validate(fixtureOk, "fixture ok");
validate(fixtureDegraded, "fixture degraded");
for (const scenario of ["ok", "degraded"]) {
  const forced = createDeskApi({ forcedScenario: scenario, delayMs: 0, fetchJson: async () => { throw Error("forced mock must not fetch"); } });
  const result = await forced.alertDelivery();
  assert.deepEqual([result.source, result.scenario], ["mock", scenario]);
}
assert.ok(deliverySourceView(fixtureDegraded.source).rows.every(row => row.receiverKey === "alerts.delivery.receiver_unknown"));
assert.equal(fixtureDegraded.source.read_error_code, "unknown", "the fixture's partial read keeps the unknown source diagnostic");
assert.deepEqual(deliverySourceView(fixtureDegraded.source).rows.map(row => row.readErrorCode), [null, "public_receipt_missing", null],
  "fixture row diagnostics stay separate from the source diagnostic");
assert.equal(deliverySourceView(undefined), null, "a body without source renders the absent note");
assert.equal(fixtureExposure("alerts", null), "partial");
assert.equal(fixtureExposure("alerts", "ok"), "all");
assert.equal(alertsFixtureLabel(["mock", "live"]), "partial", "fixture alerts beside a live delivery read");
assert.equal(alertsFixtureLabel(["mock", null]), "all", "delivery still loading or failed: everything shown is a fixture");
assert.equal(alertsFixtureLabel(["mock", "mock"]), "all");
assert.equal(alertsFixtureLabel(["live", "live"]), "none");

// ---------------------------------------------------------------- copy: every rendered key in both languages
const keys = [
  ...DELIVERY_READ_STATUSES.map(status => `alerts.delivery.read.${status}`),
  ...DELIVERY_READ_REASONS.map(reason => `alerts.delivery.reason.${reason}`),
  ...DELIVERY_SENDER_STATUSES.map(status => `alerts.delivery.sender.${status}`),
  "alerts.delivery.accepted.yes", "alerts.delivery.accepted.no", "alerts.delivery.accepted.unknown",
  "alerts.delivery.receiver_unknown", "alerts.delivery.source.absent", "alerts.section.live", "alerts.section.mock",
  "alerts.note.sender", "mock.badge_partial", "mock.title_partial", "alerts.delivery.read_error", "alerts.delivery.unknown",
];
for (const key of keys) {
  assert.ok(typeof zh[key] === "string" && zh[key].length > 0, `zh-CN ${key}`);
  assert.ok(typeof en[key] === "string" && en[key].length > 0, `en ${key}`);
}
assert.doesNotMatch(en["alerts.delivery.sender.delivered"], /receiv|deliver(?:ed)? to/i, "sender copy never claims receipt");

// ---------------------------------------------------------------- page source rules
const page = readFileSync(new URL("../web/strategy-switch-console/frontend/src/desk/pages/AlertsPage.tsx", import.meta.url), "utf8");
assert.match(page, /mock\.badge_partial/, "a page mixing a live read with fixtures is labelled partial");
assert.doesNotMatch(page, /postJson|fetch\(|XMLHttpRequest|dangerouslySetInnerHTML/, "the page only reads through the desk api");
assert.doesNotMatch(page, /recipients \?\? 0|targets \?\? 0|runs \?\? 0/, "no zero-count defaults");
assert.match(page, /mrd-delivery-source-error[\s\S]*alerts\.delivery\.read_error/, "source diagnostic reuses the existing copy");
assert.match(page, /readErrorCode === "unknown" \? t\("alerts\.delivery\.unknown"\)/, "unknown renders as the unknown label");

console.log("console_desk_alert_delivery_validation: PASS (live client→router→adapter→guard chain, 401, partial/no_data/not_connected/read_failed/unknown/stale, source read_error_code allowlist + unknown fallback, fail-closed source guard, schema parity, fixture labels, zh-CN/en copy; synthetic only)");
