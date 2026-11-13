import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";

// Resolve test-only dependencies from the Worker package, not the frontend.
const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const Ajv2020 = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats");
const schemaDir = new URL("../schemas/desk/", import.meta.url);
const fixtureDir = new URL("./fixtures/desk/", import.meta.url);
const load = (url) => JSON.parse(readFileSync(url, "utf8"));
const manifest = load(new URL("manifest.json", schemaDir));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
addFormats(ajv);
const schemas = new Map();
for (const file of readdirSync(schemaDir).filter((file) => file.endsWith(".json") && file !== "manifest.json")) {
  const schema = load(new URL(file, schemaDir));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema", file);
  schemas.set(file.slice(0, -5), schema);
  ajv.addSchema(schema);
}
const common = schemas.get("common");
const validate = (name, value) => {
  const schema = schemas.get(name);
  assert.ok(schema, `Missing schema: ${name}`);
  const check = ajv.getSchema(schema.$id);
  assert.ok(check(value), `${name}: ${ajv.errorsText(check.errors)}`);
};
const rejects = (name, value, message) => {
  assert.equal(ajv.getSchema(schemas.get(name).$id)(value), false, message);
};

// Pin the inventory as well as its scenarios, so deleting both a schema and its
// fixtures cannot silently reduce coverage. Paths refer to contract §2/§3.
const expected = [
  "error", "session", "ribbon", "overview", "readback", "readback-start",
  "readback-job", "switch-targets", "switch-strategies", "switch-preview",
  "switch-create", "switch-request", "reconcile", "runtime-stop", "runtime-resume",
  "accounts", "account-detail", "performance", "market-benchmark", "alerts",
  "alert-delivery", "logs", "credentials", "credential-maintenance",
  // N1 read projections (qsl.desk.*.v2); n1-common is a helper, not a response.
  "n1-ribbon", "n1-overview", "n1-accounts", "n1-switch-strategies", "n1-performance",
];
assert.deepEqual([...schemas.keys()].filter((name) => !["common", "n1-common"].includes(name)).sort(), expected.toSorted());
assert.deepEqual(manifest.map(({ name }) => name).sort(), expected.toSorted());
const expectedFiles = manifest.flatMap(({ name, scenarios, section, endpoints }) => {
  assert.ok(section && endpoints.length, `${name}: contract mapping required`);
  assert.ok(scenarios.includes("ok") && scenarios.includes("degraded"), `${name}: scenarios required`);
  return scenarios.map((scenario) => `${name}.${scenario}.json`);
});
assert.deepEqual(readdirSync(fixtureDir).sort(), expectedFiles.toSorted(), "No missing or unvalidated fixtures");

// Object schemas must close their keys, including map objects (patternProperties).
// An allOf refinement only narrows an already closed object. Read.value is the
// reusable, unconstrained generic payload; endpoint Read payloads narrow it.
function assertClosed(schema, path = "schema") {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object" && !path.endsWith(".allOf.1")) {
    assert.equal(schema.additionalProperties, false, `${path}: open object`);
  }
  for (const [key, child] of Object.entries(schema)) {
    if (child && typeof child === "object") assertClosed(child, `${path}.${key}`);
  }
}
for (const [name, schema] of schemas) assertClosed(schema, name);

let objectChecks = 0;
function rejectExtraKeys(name, fixture, node = fixture) {
  if (Array.isArray(node)) {
    for (const item of node) rejectExtraKeys(name, fixture, item);
  } else if (node && typeof node === "object") {
    node.contract_unexpected_field = true;
    rejects(name, fixture, `${name}: undeclared field accepted`);
    delete node.contract_unexpected_field;
    objectChecks += 1;
    for (const value of Object.values(node)) rejectExtraKeys(name, fixture, value);
  }
}
for (const file of expectedFiles) {
  const name = file.split(".")[0];
  const fixture = load(new URL(file, fixtureDir));
  validate(name, fixture);
  rejectExtraKeys(name, fixture);
}

const instant = "2030-01-07T12:00:00Z";
const readCheck = ajv.compile({ $ref: `${common.$id}#/$defs/Read` });
for (const value of [null, { status: "unknown" }, { status: "known", value: "1.00" },
  { status: "stale", value: "1.00", observed_at: instant },
  { status: "unknown", reason: "not_a_reason" },
  { status: "unknown", reason: "read_failed", value: 0 },
  { status: "known", value: "1.00", observed_at: "2030-01-07T12:00:00+00:00" },
  { status: "known", value: "1.00", observed_at: "2030-02-30T12:00:00Z" }]) {
  assert.equal(readCheck(value), false, "Invalid Read accepted");
}
for (const value of [
  { status: "known", value: { arbitrary_payload: true }, observed_at: instant },
  { status: "stale", value: "1.00", observed_at: instant, age_seconds: 42 },
  { status: "unknown", reason: "read_failed", observed_at: null },
]) assert.ok(readCheck(value), "Valid Read rejected");
const enums = {
  ReadReason: ["never_read", "read_failed", "source_unavailable", "identity_unverified", "not_supported"],
  RuntimeState: ["running", "stopped", "unknown"],
  PreflightState: ["pass", "warn", "block", "unknown"],
  SwitchState: ["scheduled", "dispatched", "applying", "readback_pending", "verified", "mismatch", "unknown", "failed"],
};
for (const [name, values] of Object.entries(enums)) {
  assert.deepEqual(common.$defs[name].enum, values, `${name}: contract enum drift`);
  const check = ajv.compile({ $ref: `${common.$id}#/$defs/${name}` });
  for (const value of values) assert.ok(check(value));
  assert.equal(check("invented_state"), false);
}

const fixture = (name, scenario = "ok") => load(new URL(`${name}.${scenario}.json`, fixtureDir));
const overview = fixture("overview");
overview.totals.nav = 1234.5;
rejects("overview", overview, "Money must be a decimal string");
overview.totals.nav = "1e3";
rejects("overview", overview, "Scientific notation is not a decimal string");
const account = fixture("account-detail");
account.mode = null;
rejects("account-detail", account, "A Read cannot be bare null");
account.mode = { status: "known", value: "live" };
rejects("account-detail", account, "Nested known Read requires observed_at");
const readback = fixture("readback");
readback.fields.find(({ key }) => key === "reserved_cash_ratio").platform.value = 0.12;
rejects("readback", readback, "Setting ratio must be a decimal string");
const performance = fixture("performance");
performance.monthly.rows[0].months.pop();
rejects("performance", performance, "Monthly rows require exactly 12 entries");
const strategyPerformance = fixture("performance");
strategyPerformance.scope = "strategy";
rejects("performance", strategyPerformance, "Strategy scope requires per-target equity curves");
strategyPerformance.equity_by_target = { "ibkr/tqqq": strategyPerformance.equity };
validate("performance", strategyPerformance);
for (const phase of ["unknown", "not_due", "30", "7", "1", "expired"]) {
  const required = ["30", "7", "1", "expired"].includes(phase);
  for (const name of ["credentials", "accounts"]) {
    const response = fixture(name);
    const credential = name === "credentials" ? response.items[0] : response.brokers[0].credential;
    Object.assign(credential, { phase, requires_action: required });
    validate(name, response);
    credential.requires_action = !required;
    rejects(name, response, `${name}: requires_action must match phase ${phase}`);
  }
}
for (const state of enums.SwitchState) {
  const request = fixture("switch-request");
  request.state = state;
  request.terminal = ["verified", "mismatch", "unknown", "failed"].includes(state);
  validate("switch-request", request);
  request.terminal = !request.terminal;
  rejects("switch-request", request, "terminal must match state");
}

// Coordinator defaults are fixture policy, not permission to connect any route.
for (const scenario of ["ok", "degraded"]) {
  const preview = fixture("switch-preview", scenario);
  const noOrders = preview.preflight.find(({ id }) => id === "no_open_orders");
  assert.equal(noOrders.state, "unknown");
  assert.equal(noOrders.required, true);
  assert.equal(preview.blocking_count, preview.preflight.filter(({ state, required }) => state === "block" || (required && state === "unknown")).length);
  assert.equal(preview.confirm.allowed, false);
  for (const value of Object.values(preview.estimates)) assert.deepEqual(value, { status: "unknown", reason: "not_supported" });
  for (const target of fixture("switch-targets", scenario).targets) assert.equal(target.switchable.allowed, false);
  for (const action of Object.values(fixture("readback", scenario).actions)) assert.equal(action.allowed, false);
  assert.equal(fixture("logs", scenario).retention.days, 90);
  for (const row of fixture("credentials", scenario).items) {
    assert.equal(row.requires_action, ["30", "7", "1", "expired"].includes(row.phase));
    if (row.platform !== "ibkr") assert.equal(row.expiry.status, "unknown");
  }
  for (const row of fixture("account-detail", scenario).holdings.rows || []) {
    if (row.symbol !== "CASH") {
      assert.deepEqual(row.last_price, { status: "unknown", reason: "not_supported" });
      assert.deepEqual(row.day_change_ratio, { status: "unknown", reason: "not_supported" });
    }
  }
}
// ---------------------------------------------------------------- N1 local Read/coverage invariants
const n1Common = schemas.get("n1-common");
const n1Read = ajv.compile({ $ref: `${n1Common.$id}#/$defs/Read` });
const cover = (state, included = 1, total = 1, reasons = []) => ({ state, included, total, reasons });
for (const value of [
  { status: "known", value: 0, observed_at: instant, coverage: cover("complete") },
  { status: "known", value: [], observed_at: instant, coverage: cover("verified_empty", 0, 0) },
  { status: "stale", value: 1, observed_at: instant, age_seconds: 5, coverage: cover("complete") },
  { status: "partial", value: { done: 1, expected: null }, observed_at: instant, coverage: cover("partial", 1, null, ["coverage_incomplete"]) },
  { status: "unknown", reason: "mixed_currency", coverage: cover("unavailable", 0, null, ["mixed_currency"]) },
  { status: "unknown", reason: "not_supported", observed_at: null, coverage: cover("unavailable", 0, 3) },
]) assert.ok(n1Read(value), `valid N1 Read rejected: ${ajv.errorsText(n1Read.errors)}`);
for (const [value, message] of [
  [{ status: "unknown", reason: "read_failed", value: 0, coverage: cover("unavailable", 0, null) }, "unknown carries no value"],
  [{ status: "known", value: 3, observed_at: instant, coverage: cover("partial", 1, 2) }, "known needs evidenced coverage"],
  [{ status: "partial", value: [], observed_at: instant, coverage: cover("complete") }, "partial needs partial coverage"],
  [{ status: "known", value: 1, observed_at: "2030-01-07T12:00:00", coverage: cover("complete") }, "time zone required"],
  [{ status: "known", value: 1, observed_at: instant }, "coverage required"],
  [{ status: "unknown", reason: "invented", coverage: cover("unavailable", 0, null) }, "fixed reason codes"],
  [{ status: "unknown", reason: "read_failed", coverage: cover("verified_empty", 0, 0) }, "failure is never verified empty"],
  [{ status: "known", value: 1, observed_at: instant, coverage: { ...cover("complete"), total: "1" } }, "integer totals"],
]) assert.equal(n1Read(value), false, message);
const n1 = (name, scenario = "ok") => load(new URL(`n1-${name}.${scenario}.json`, fixtureDir));
const ribbonN1 = n1("ribbon");
ribbonN1.alert_badge = { status: "known", value: { open_count: 0, critical_count: 0 }, observed_at: instant, coverage: cover("complete") };
validate("n1-ribbon", ribbonN1); // A future alerts store may report a real zero; the fixtures must not.
for (const scenario of ["ok", "degraded", "partial", "empty"]) {
  assert.equal(n1("ribbon", scenario).alert_badge.status, "unknown", "N1 alert badge is unknown/not_supported");
  assert.equal(n1("ribbon", scenario).console_state.mode.reason, "not_supported", "N1 global mode is unknown/not_supported");
  assert.equal(n1("ribbon", scenario).date_basis, "utc_day");
}
const overviewN1 = n1("overview");
overviewN1.totals.runs_today = { ...overviewN1.totals.runs_today, status: "known", coverage: cover("complete", 2, 2) };
rejects("n1-overview", overviewN1, "a known runs_today cannot hide a null member");
const perfN1 = n1("performance");
perfN1.scope = "strategy";
rejects("n1-performance", perfN1, "N1 performance is scope=all only");
const fingerprint = n1("switch-strategies");
fingerprint.catalog_revision.value.value = "1.0.0";
rejects("n1-switch-strategies", fingerprint, "catalog_revision is a sha256 projection fingerprint");
const v1Ribbon = fixture("ribbon");
rejects("n1-ribbon", v1Ribbon, "a v1 payload is not a v2 projection");

console.log(`Desk contract validation passed: ${expected.length} responses, ${expectedFiles.length} fixtures, ${objectChecks} closed objects and negative contract checks`);

// Exercise the real delivery route and validate its additive v1 evidence.
await import("./desk_delivery_read_validation.mjs");
