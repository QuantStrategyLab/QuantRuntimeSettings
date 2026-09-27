import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { __test } from "../web/strategy-switch-console/worker.js";
import { normalizeDisplayMode } from "../web/strategy-switch-console/frontend/src/theme.js";
import {
  UX1_STUDY,
  canonicalJson,
  defaultUx1Draft,
  ux1Fingerprint,
} from "../web/strategy-switch-console/ux1_research_contract.js";
import {
  ux1DemoTest,
  calculatorChildEnv,
  parseUx1DemoArgs,
  parseUx1OperatorConfig,
  runFixedCalculator,
  ux1CalculatorFetch,
} from "../web/strategy-switch-console/ux1_local_demo.mjs";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");

assert.ok(await ux1DemoTest.processExecutable(process.pid, "darwin"));
if (process.platform === "linux") {
  assert.equal(
    await ux1DemoTest.processExecutable(process.pid, "linux"),
    await readlink(`/proc/${process.pid}/exe`),
  );
}

const reordered = defaultUx1Draft();
reordered.advanced_settings = Object.fromEntries(Object.entries(reordered.advanced_settings).reverse());
assert.equal(await ux1Fingerprint(defaultUx1Draft()), await ux1Fingerprint(reordered));
const custom = defaultUx1Draft();
custom.advanced_settings.plugin_mode = "none";
assert.notEqual(await ux1Fingerprint(defaultUx1Draft()), await ux1Fingerprint(custom));
assert.throws(() => parseUx1DemoArgs(["--interpreter", "python", "--adapter", "/tmp/adapter.py", "--raw-root", "/tmp/raw", "--r6-root", "/tmp/r6", "--materialized", "/tmp/r6.json"]), /demo_path_must_be_absolute/);
assert.throws(() => parseUx1DemoArgs(["--host", "0.0.0.0", "--interpreter", "/usr/bin/python3", "--adapter", "/tmp/adapter.py"]), /unknown_demo_argument/);
assert.throws(() => parseUx1OperatorConfig({
  interpreter: "/usr/bin/python3",
  executable: "/tmp/adapter.py",
  input_roots: { raw: "/tmp/raw", r6: "/tmp/r6", materialized: "/tmp/r6.json" },
  state_root: "/tmp/state",
  host: "0.0.0.0",
}), /ux1_config_unknown_field/);
assert.throws(() => parseUx1OperatorConfig({
  interpreter: "python",
  executable: "/tmp/adapter.py",
  input_roots: { raw: "/tmp/raw", r6: "/tmp/r6", materialized: "/tmp/r6.json" },
  state_root: "/tmp/state",
}), /demo_path_must_be_absolute/);
const priorEpoch = __test.presentUx1Preview({
  status: "computed",
  decision_preview: { decision_date: "2023-03-29" },
  historical_execution_check: { trade_date: "2023-03-30" },
}, { UX1_RUNTIME_EPOCH: "11".repeat(16) });
assert.equal(priorEpoch.status, "stale");
assert.equal(priorEpoch.actionable, false);
assert.equal(priorEpoch.recompute_required, true);
assert.equal(priorEpoch.decision_preview.decision_date, "2023-03-29");
assert.equal(priorEpoch.historical_execution_check.trade_date, "2023-03-30");
const currentEpoch = __test.presentUx1Preview({
  status: "computed",
  runtime_epoch: "11".repeat(16),
  decision_preview: { decision_date: "2023-03-29" },
}, { UX1_RUNTIME_EPOCH: "11".repeat(16) });
assert.equal(currentEpoch.stale, undefined);
assert.equal(currentEpoch.status, "computed");

const legacy = { key: "existing", label: "Existing fixture", target_name: "existing", account_selector: "existing-account", deployment_selector: "existing-deployment", service_name: "existing-service", supported_domains: ["us_equity"] };
const expectedHashes = {
  r7_policy_sha256: "a".repeat(64), r8_policy_sha256: "b".repeat(64),
  capital_policy_sha256: "c".repeat(64), settlement_policy_sha256: "d".repeat(64),
  raw_manifest_sha256: "e".repeat(64), r6_manifest_sha256: "f".repeat(64),
  r6_materialized_file_sha256: "1".repeat(64),
};
const bindings = {
  SESSION_SECRET: "synthetic-only-session-key",
  STRATEGY_SWITCH_ADMIN_LOGINS: "fixture-admin",
  ALLOWED_GITHUB_LOGINS: "fixture-reader,fixture-other,fixture-admin",
  RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-only-dispatch-token",
  UX1_EXPECTED_EVIDENCE_HASHES: JSON.stringify(expectedHashes),
  STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ ibkr: [legacy] }),
  STRATEGY_SWITCH_STRATEGY_PROFILES_JSON: JSON.stringify([{ profile: "fixture-strategy", label: "Fixture strategy", domain: "us_equity", allowed_execution_modes: ["dry_run"], runtime_enabled: false }]),
};
const readerCookie = `qsl_switch_session=${await __test.makeSession("fixture-reader", [], bindings)}`;
const otherCookie = `qsl_switch_session=${await __test.makeSession("fixture-other", [], bindings)}`;
const adminCookie = `qsl_switch_session=${await __test.makeSession("fixture-admin", [], bindings)}`;
const outsiderCookie = `qsl_switch_session=${await __test.makeSession("fixture-outsider", [], bindings)}`;
const sink = { mode: "ok", calls: 0, bodies: [] };

function calculatorResult(request) {
  const { schema, ...business } = request;
  assert.equal(schema, "qsl.ux1.preview_request.v1");
  const fingerprint = createHash("sha256").update(canonicalJson(business)).digest("hex");
  const nested = (value) => ({ outer: { QQQM: value, BOXX: 0 }, tqqq: { TQQQ: 0 }, soxl: { SOXL: 0, SOXX: 0, BOXX: 0 } });
  const base = {
    schema: "qsl.ux1.preview_result.v1",
    status: "ok",
    request_fingerprint: fingerprint,
    advanced_settings: request.advanced_settings,
    research_only: true,
    no_order: true,
    execution_authority_granted: false,
    native_observed: false,
    paper_authorized: false,
    shadow_authorized: false,
    live_authorized: false,
    original_full_v2_mapped: false,
    original_full_v2_features_silently_disabled: false,
    advanced_null_asserts_original_full_v2_toggles: false,
    source_class: request.source_class,
    source_assurance: "synthetic_test_only",
    model_id: "paired_60_executable_one_session_log_v1",
    optimality_scope: "best_score_among_feasible_B0_B3_only",
    research_case_id: request.research_case_id,
    candidate_id: request.candidate_id,
    objective: request.objective,
    candidate_set_id: request.candidate_set_id,
    capital_variant: request.capital_variant,
    cost_bps: request.cost_bps,
    initial_research_nav_usd: 10000,
    development: true,
    strict_point_in_time_certified: false,
    limitations: ["synthetic_test_only"],
    r7_policy_sha256: "a".repeat(64),
    r8_policy_sha256: "b".repeat(64),
    capital_policy_id: "test_capital_policy_v1",
    capital_policy_sha256: "c".repeat(64),
    settlement_policy_id: "test_settlement_policy_v1",
    settlement_policy_sha256: "d".repeat(64),
    raw_manifest_sha256: "e".repeat(64),
    r6_manifest_sha256: "f".repeat(64),
    r6_materialized_file_sha256: "1".repeat(64),
    decision_preview: {
      decision_date: "2023-03-29",
      scenarios_observed_through: "2023-03-29",
      scenario_count: 60,
      selected_action: "B1",
      previous_action: "B0",
      previous_action_retained: true,
      scores: { B0: 0.01, B1: 0.02, B2: 0.005, B3: 0.004 },
      score_gain_over_previous_action: 0.01,
      tie_log_tolerance: 1e-8,
      no_advantage: false,
      member_budgets_usd: { tqqq: 250, soxl: 250 },
      asset_targets_usd: nested(100),
      outer_cash_target_usd: 100,
      curve_ratio: 0.03,
      wealth_reference_usd: 10000,
      aggregate_member_cap_usd: 300,
    },
    historical_execution_check: {
      trade_date: "2023-03-30",
      decision_date: "2023-03-29",
      feeds_back_into_decision: false,
      trade_shares: nested(2),
      fees_usd: nested(1.5),
      total_fees_usd: 1.5,
      settled_cash_usd: 8000,
      pending_sale_usd: 0,
      receivable_usd: 0,
      shortages: [],
      no_action: false,
    },
  };
  if (sink.mode === "poison") {
    base.optimality_scope = "global_optimum";
    base.execution_authority_granted = true;
    base.private_path = "PRIVATE_SENTINEL_PATH";
  }
  if (sink.mode === "conflate") base.decision_preview.trade_shares = nested(2);
  if (sink.mode === "wronghash") base.r7_policy_sha256 = "0".repeat(64);
  if (Object.values(request.advanced_settings).some((value) => value !== null)) {
    base.status = "unsupported_scope";
    base.reason_code = "unsupported_scope";
    base.reasons = Object.entries(request.advanced_settings).filter(([, value]) => value !== null).map(([key]) => `${key}_not_modeled_by_r8`);
    delete base.decision_preview;
    delete base.historical_execution_check;
    delete base.optimality_scope;
  }
  return base;
}

function draftBody(revision, overrides = {}) {
  const draft = defaultUx1Draft();
  if (Object.hasOwn(overrides, "objective")) draft.objective = overrides.objective;
  if (Object.hasOwn(overrides, "research_case_id")) draft.research_case_id = overrides.research_case_id;
  Object.assign(draft.advanced_settings, overrides.advanced_settings || {});
  return { expected_revision: revision, ...draft };
}

const persist = await mkdtemp(join(tmpdir(), "qrt-ux1-"));
let outbound = 0;
const baseOptions = {
  modules: true,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  scriptPath: fileURLToPath(new URL("../web/strategy-switch-console/worker.js", import.meta.url)),
  compatibilityDate: "2026-06-08",
  bindings,
  durableObjects: { STRATEGY_SWITCH_RUNTIME_INSTANCES: { className: "RuntimeInstances", useSQLite: true } },
  durableObjectsPersist: persist,
  outboundService: () => { outbound += 1; return new Response("offline only", { status: 503 }); },
};
let mf = new Miniflare(baseOptions);

async function call(body, { cookie = readerCookie, origin = "https://console.example", endpoint = "/api/ux1/draft", method = body ? "POST" : "GET" } = {}) {
  const response = await mf.dispatchFetch(`https://console.example${endpoint}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}), "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, text, body: text ? JSON.parse(text) : null };
}

function callWithin(body, options, timeoutMs) {
  let timer;
  const pending = call(body, options);
  pending.catch(() => {});
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("preview_deadline_exceeded")), timeoutMs);
    pending.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

try {
  assert.equal((await call(undefined, { cookie: "" })).status, 401);
  assert.equal((await call(undefined, { cookie: outsiderCookie })).status, 403);
  assert.equal((await call(draftBody(0), { origin: "" })).status, 403);
  assert.equal((await call(draftBody(0), { origin: "https://untrusted.example" })).status, 403);
  const initial = await call();
  assert.equal(initial.status, 200);
  assert.equal(initial.body.revision, 0);
  assert.equal(initial.body.draft.objective, UX1_STUDY.objective);
  assert.equal(initial.body.draft.advanced_settings.plugin_mode, null);
  assert.equal(initial.body.account_connection, "native_not_observed");
  assert.equal(initial.body.workflow_dispatched, false);
  assert.equal((await call(draftBody(0), { endpoint: "/api/ux1/preview" })).status, 400);
  assert.equal((await call({ expected_revision: 0 }, { endpoint: "/api/ux1/preview" })).status, 409);

  const saved = await call(draftBody(0));
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 1);
  const disconnected = await call({ expected_revision: 1 }, { endpoint: "/api/ux1/preview" });
  assert.equal(disconnected.status, 503);
  assert.equal(disconnected.body.error, "calculator_not_connected");
  assert.equal(disconnected.body.decision_preview, null);
  assert.equal(disconnected.body.historical_execution_check, null);
  assert.equal(disconnected.body.preview, null);
  assert.equal(disconnected.text.includes("wealth_reference"), false);
  const page = await mf.dispatchFetch("https://console.example/");
  const html = await page.text();
  assert.match(html, /<div id="root"><\/div>/, "root serves the React console shell");
  assert.match(html, /\/v2\/assets\/index-[\w-]+\.js/, "root shell loads the versioned React entry bundle");
  assert.doesNotMatch(html, /data-ux1-default-view|id="ux1-preview-button"/, "root no longer serves the legacy UX1 page markup");
  assert.equal(html.includes("fonts.googleapis.com"), false);
  assert.equal(html.includes("fonts.gstatic.com"), false);
  assert.equal(normalizeDisplayMode(null), "simple", "missing preference defaults to simple information mode");
  assert.equal(normalizeDisplayMode("invalid"), "simple", "invalid preference fails back to simple information mode");
  assert.equal(normalizeDisplayMode("professional"), "professional", "professional mode remains an explicit preference");
  const appSource = await readFile(new URL("../web/strategy-switch-console/frontend/src/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /normalizeDisplayMode\(safeGet\(DISPLAY_STORAGE_KEY\)\)/, "React app initializes its information mode from the defaulting normalizer");
  const csp = page.headers.get("Content-Security-Policy") || "";
  assert.match(csp, /style-src 'self'/);
  assert.equal(csp.includes("fonts.googleapis.com"), false);
  assert.equal(csp.includes("unsafe-eval"), false);

  await mf.dispose();
  sink.calls = 0;
  mf = new Miniflare({
    ...baseOptions,
    serviceBindings: {
      UX1_RESEARCH_CALCULATOR: async (request) => {
        if (sink.mode === "busy") {
          return new Response(JSON.stringify({ error: "calculator_busy" }), { status: 429, headers: { "content-type": "application/json" } });
        }
        const requestBody = await request.json();
        sink.calls += 1;
        sink.bodies.push(requestBody);
        return new Response(JSON.stringify(calculatorResult(requestBody)), { headers: { "content-type": "application/json" } });
      },
    },
  });
  const again = await call(draftBody(1));
  assert.equal(again.body.unchanged, true);
  assert.equal(again.body.revision, 1);
  const preview = await call({ expected_revision: 1 }, { endpoint: "/api/ux1/preview" });
  assert.equal(preview.status, 200);
  assert.equal(sink.calls, 1);
  assert.equal(sink.bodies[0].schema, "qsl.ux1.preview_request.v1");
  assert.equal(sink.bodies[0].path, undefined);
  assert.equal(sink.bodies[0].command, undefined);
  assert.equal(preview.body.preview.decision_preview.decision_date, "2023-03-29");
  assert.equal(preview.body.preview.decision_preview.previous_action_retained, true);
  assert.equal(preview.body.preview.decision_preview.trade_shares, undefined);
  assert.equal(preview.body.preview.historical_execution_check.trade_date, "2023-03-30");
  assert.equal(preview.body.preview.historical_execution_check.no_action, false);
  assert.equal(preview.body.preview.optimality_scope, "best_score_among_feasible_B0_B3_only");
  assert.equal(preview.body.preview.research_only, true);
  assert.equal(preview.body.preview.no_order, true);
  assert.equal(preview.body.workflow_dispatched, false);
  const repeat = await call(draftBody(1));
  assert.equal(repeat.body.unchanged, true);
  assert.equal(repeat.body.preview.fingerprint, preview.body.preview.fingerprint);

  const pluginDraft = draftBody(1, { advanced_settings: { plugin_mode: "none" } });
  const edited = await call(pluginDraft);
  assert.equal(edited.status, 200);
  assert.equal(edited.body.revision, 2);
  assert.equal(edited.body.preview, null);
  assert.equal(edited.body.draft.advanced_settings.plugin_mode, "none");
  assert.notEqual(edited.body.fingerprint, preview.body.fingerprint);
  assert.equal(edited.body.custom_draft, true);
  const customPreview = await call({ expected_revision: 2 }, { endpoint: "/api/ux1/preview" });
  assert.equal(customPreview.body.preview.status, "unsupported_scope");
  assert.equal(customPreview.body.preview.unsupported_reasons.some((item) => item.field === "plugin_mode"), true);
  assert.equal(customPreview.body.preview.decision_preview, null);
  assert.equal(sink.bodies.at(-1).advanced_settings.plugin_mode, "none");
  const kept = await call(draftBody(2, { advanced_settings: { plugin_mode: "none" } }));
  assert.equal(kept.body.unchanged, true);
  assert.equal(kept.body.draft.advanced_settings.plugin_mode, "none");
  const erased = draftBody(2);
  delete erased.advanced_settings.plugin_mode;
  assert.equal((await call(erased)).status, 400);

  const other = await call(undefined, { cookie: otherCookie });
  assert.equal(other.body.revision, 0);
  assert.equal(other.body.draft.advanced_settings.plugin_mode, null);

  for (const extra of [{ execution_mode: "live" }, { account_selector: "U1" }, { secret: "x" }, { url: "https://example.test" }, { path: "/tmp/private" }, { view_mode: "guided" }, { authority: true }]) {
    assert.equal((await call({ ...draftBody(2, { advanced_settings: { plugin_mode: "none" } }), ...extra })).status, 400);
  }
  assert.equal((await call(draftBody(2, { objective: "global_optimum", advanced_settings: { plugin_mode: "none" } }))).status, 200);
  const callsBeforeScope = sink.calls;
  const unsupported = await call({ expected_revision: 3 }, { endpoint: "/api/ux1/preview" });
  assert.equal(unsupported.body.preview.status, "unsupported_scope");
  assert.equal(unsupported.body.preview.decision_preview, null);
  assert.equal(unsupported.body.preview.optimality_scope, null);
  assert.equal(unsupported.body.study.source_class, "historical_development");
  assert.equal(sink.calls, callsBeforeScope);

  await call(draftBody(3));
  sink.mode = "poison";
  const poisoned = await call({ expected_revision: 4 }, { endpoint: "/api/ux1/preview" });
  assert.equal(poisoned.status, 502);
  assert.equal(poisoned.body.error, "calculator_result_rejected");
  assert.equal(poisoned.text.includes("global_optimum"), false);
  assert.equal(poisoned.text.includes("PRIVATE_SENTINEL_PATH"), false);
  sink.mode = "conflate";
  assert.equal((await call({ expected_revision: 4 }, { endpoint: "/api/ux1/preview" })).status, 502);
  sink.mode = "ok";
  const ready = await call({ expected_revision: 4 }, { endpoint: "/api/ux1/preview" });
  assert.equal(ready.status, 200);
  assert.equal(ready.body.preview.stale, undefined);
  assert.equal(ready.body.preview.decision_preview.decision_date, "2023-03-29");
  assert.equal(ready.body.preview.historical_execution_check.trade_date, "2023-03-30");
  assert.equal(ready.body.preview.decision_as_of, "2023-03-29");
  assert.equal(ready.body.preview.known_through, "2023-03-29");
  assert.equal(ready.body.preview.historical_execution_date, "2023-03-30");
  assert.match(ready.body.preview.calculated_at, /^\d{4}-\d\d-\d\dT/);
  sink.mode = "wronghash";
  const wrongHash = await call({ expected_revision: 4 }, { endpoint: "/api/ux1/preview" });
  assert.equal(wrongHash.status, 502);
  assert.equal(wrongHash.body.error, "calculator_result_rejected");
  assert.equal((await call()).body.preview, null);
  sink.mode = "ok";
  assert.equal((await call({ expected_revision: 4 }, { endpoint: "/api/ux1/preview" })).status, 200);
  sink.mode = "poison";
  const poisonedAfter = await call({ expected_revision: 4 }, { endpoint: "/api/ux1/preview" });
  assert.equal(poisonedAfter.status, 502);
  assert.equal(poisonedAfter.body.error, "calculator_result_rejected");
  const cleared = await call();
  assert.equal(cleared.body.preview, null);
  assert.equal(cleared.body.revision, ready.body.revision);
  assert.equal(cleared.body.fingerprint, ready.body.fingerprint);
  assert.equal(cleared.body.draft.objective, ready.body.draft.objective);
  sink.mode = "ok";
  const readyAgain = await call({ expected_revision: 4 }, { endpoint: "/api/ux1/preview" });
  assert.equal(readyAgain.status, 200);
  sink.mode = "busy";
  const busy = await call({ expected_revision: 4 }, { endpoint: "/api/ux1/preview" });
  assert.equal(busy.status, 429);
  assert.equal(busy.body.error, "calculator_busy");
  assert.equal(busy.body.preview, undefined);
  const keptPreview = await call();
  assert.equal(keptPreview.body.preview.decision_preview.decision_date, "2023-03-29");
  assert.equal(keptPreview.body.preview.stale, undefined);
  assert.equal(keptPreview.body.revision, ready.body.revision);
  sink.mode = "ok";
  const intent = await call({ expected_revision: 4, fingerprint: keptPreview.body.fingerprint }, { endpoint: "/api/ux1/intent" });
  const duplicate = await call({ expected_revision: 4, fingerprint: ready.body.fingerprint }, { endpoint: "/api/ux1/intent" });
  assert.equal(intent.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.intent.receipt_id, intent.body.intent.receipt_id);
  assert.equal(duplicate.body.intent.executable, false);
  assert.equal(duplicate.body.intent.no_order, true);
  assert.equal((await call({ expected_revision: 3, fingerprint: ready.body.fingerprint }, { endpoint: "/api/ux1/intent" })).status, 409);

  await mf.dispose();
  mf = new Miniflare({
    ...baseOptions,
    bindings: { ...bindings, UX1_RUNTIME_EPOCH: "22".repeat(16) },
    serviceBindings: {
      UX1_RESEARCH_CALCULATOR: async (request) => {
        if (sink.mode === "busy") {
          return new Response(JSON.stringify({ error: "calculator_busy" }), { status: 429, headers: { "content-type": "application/json" } });
        }
        if (sink.mode === "fat-busy") {
          return new Response(JSON.stringify({ error: "calculator_busy", pad: "x".repeat(70000) }), { status: 429, headers: { "content-type": "application/json" } });
        }
        if (sink.mode === "utf8-busy") {
          return new Response(JSON.stringify({ error: "calculator_busy", pad: "你".repeat(22000) }), { status: 429, headers: { "content-type": "application/json" } });
        }
        if (sink.mode === "stream-hang") {
          const payload = new TextEncoder().encode(JSON.stringify({ error: "calculator_busy", pad: "x".repeat(70000) }));
          return new Response(new ReadableStream({
            start(controller) {
              controller.enqueue(payload.subarray(0, 40000));
              controller.enqueue(payload.subarray(40000));
            },
            pull() {
              return new Promise(() => {});
            },
          }), { status: 429, headers: { "content-type": "application/json" } });
        }
        if (sink.mode === "hold-fail" && !sink.held) {
          sink.held = true;
          sink.markEntered();
          await sink.hold;
          return new Response(JSON.stringify({ error: "calculator_failed" }), { status: 500, headers: { "content-type": "application/json" } });
        }
        const requestBody = await request.json();
        sink.calls += 1;
        sink.bodies.push(requestBody);
        return new Response(JSON.stringify(calculatorResult(requestBody)), { headers: { "content-type": "application/json" } });
      },
    },
  });
  const restored = await call();
  assert.equal(restored.body.revision, 4);
  assert.equal(restored.body.fingerprint, keptPreview.body.fingerprint);
  assert.equal(restored.body.draft.research_case_id, keptPreview.body.draft.research_case_id);
  assert.equal(restored.body.preview.stale, true);
  assert.equal(restored.body.preview.actionable, false);
  assert.equal(restored.body.preview.recompute_required, true);
  assert.equal(restored.body.preview.decision_preview.decision_date, "2023-03-29");
  assert.equal(restored.body.preview.historical_execution_check.trade_date, "2023-03-30");
  assert.equal(restored.body.intent.receipt_id, intent.body.intent.receipt_id);
  assert.equal(restored.body.intent.no_order, true);
  const staleIntent = await call({ expected_revision: 4, fingerprint: keptPreview.body.fingerprint }, { endpoint: "/api/ux1/intent" });
  assert.equal(staleIntent.status, 409);
  assert.equal(staleIntent.body.error, "ux1_preview_stale");
  const stillIntent = await call();
  assert.equal(stillIntent.body.intent.receipt_id, intent.body.intent.receipt_id);
  assert.equal(stillIntent.body.revision, 4);
  const recomputed = await call({ expected_revision: 4 }, { endpoint: "/api/ux1/preview" });
  assert.equal(recomputed.status, 200);
  assert.equal(recomputed.body.preview.stale, undefined);
  assert.equal(recomputed.body.revision, 4);
  assert.equal(recomputed.body.intent.receipt_id, intent.body.intent.receipt_id);

  const fatProbe = JSON.stringify({ error: "calculator_busy", pad: "x".repeat(70000) });
  assert.equal(fatProbe.length > 65536, true);
  sink.mode = "fat-busy";
  const fatBusy = await call({ expected_revision: 4 }, { endpoint: "/api/ux1/preview" });
  assert.equal(fatBusy.status, 502);
  assert.equal(fatBusy.body.error, "calculator_failed");
  assert.equal(fatBusy.text.includes("calculator_busy"), false);
  assert.equal(fatBusy.text.length < 500, true);
  const afterFat = await call();
  assert.equal(afterFat.body.preview, null);
  assert.equal(afterFat.body.revision, 4);
  assert.equal(afterFat.body.fingerprint, recomputed.body.fingerprint);
  sink.mode = "ok";
  assert.equal((await call({ expected_revision: 4 }, { endpoint: "/api/ux1/preview" })).status, 200);

  const utf8Probe = JSON.stringify({ error: "calculator_busy", pad: "你".repeat(22000) });
  assert.equal(utf8Probe.length <= 65536, true);
  assert.equal(Buffer.byteLength(utf8Probe) > 65536, true);
  sink.mode = "utf8-busy";
  const utf8Busy = await call({ expected_revision: 4 }, { endpoint: "/api/ux1/preview" });
  assert.equal(utf8Busy.status, 502);
  assert.equal(utf8Busy.body.error, "calculator_failed");
  assert.equal(utf8Busy.text.includes("你"), false);
  const afterUtf8 = await call();
  assert.equal(afterUtf8.body.preview, null);
  assert.equal(afterUtf8.body.revision, 4);
  sink.mode = "ok";
  assert.equal((await call({ expected_revision: 4 }, { endpoint: "/api/ux1/preview" })).status, 200);

  sink.mode = "stream-hang";
  const streamed = await callWithin({ expected_revision: 4 }, { endpoint: "/api/ux1/preview" }, 2000);
  assert.equal(streamed.status, 502);
  assert.equal(streamed.body.error, "calculator_failed");
  const afterStream = await call();
  assert.equal(afterStream.body.preview, null);
  assert.equal(afterStream.body.revision, 4);
  sink.mode = "ok";
  const restoredPreview = await call({ expected_revision: 4 }, { endpoint: "/api/ux1/preview" });
  assert.equal(restoredPreview.status, 200);
  assert.equal(restoredPreview.body.preview.decision_preview.decision_date, "2023-03-29");
  assert.equal(restoredPreview.body.revision, 4);
  await mf.dispose();
  mf = new Miniflare({
    ...baseOptions,
    bindings: { ...bindings, UX1_RUNTIME_EPOCH: "33".repeat(16) },
  });
  const dropped = await call({ expected_revision: 4 }, { endpoint: "/api/ux1/preview" });
  assert.equal(dropped.status, 503);
  assert.equal(dropped.body.error, "calculator_not_connected");
  assert.equal(dropped.body.preview, null);
  assert.equal(dropped.body.recompute_required, true);
  assert.equal(dropped.text.includes("wealth_reference"), false);
  const afterDrop = await call();
  assert.equal(afterDrop.body.preview, null);
  assert.equal(afterDrop.body.revision, 4);
  assert.equal(afterDrop.body.fingerprint, keptPreview.body.fingerprint);
  assert.equal(afterDrop.body.intent.receipt_id, intent.body.intent.receipt_id);
  assert.equal(afterDrop.body.intent.executable, false);

  const concurrent = await Promise.all([
    call(draftBody(4, { advanced_settings: { plugin_mode: "current" } })),
    call(draftBody(4, { advanced_settings: { plugin_mode: "auto" } })),
  ]);
  assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);

  const instancesBefore = await call(undefined, { cookie: adminCookie, endpoint: "/api/admin/runtime-instances" });
  assert.equal(instancesBefore.body.initialized, false);
  const initialized = await call({ action: "initialize", expected_revision: 0, confirm: "IMPORT_EXISTING_CONFIG" }, { cookie: adminCookie, endpoint: "/api/admin/runtime-instances" });
  assert.equal(initialized.status, 200);
  const revision = initialized.body.revision;
  await call(draftBody((await call(undefined, { cookie: otherCookie })).body.revision, { advanced_settings: { income_layer_mode: "disabled" } }), { cookie: otherCookie });
  const instancesAfter = await call(undefined, { cookie: adminCookie, endpoint: "/api/admin/runtime-instances" });
  assert.equal(instancesAfter.body.revision, revision);
  assert.equal(instancesAfter.body.instances.length, initialized.body.instances.length);
  assert.equal(instancesAfter.body.instances.every((item) => item.kind !== "draft"), true);
  const stop = await call({}, { endpoint: "/api/runtime-stop" });
  assert.equal(stop.status, 400);
  assert.match(stop.body.error, /STOP_ONLY/);
  const switched = await call({ platform: "ibkr" }, { endpoint: "/api/switch" });
  assert.notEqual(switched.status, 404);
  assert.notEqual(switched.body.workflow_dispatched, true);
  const promotion = await call(undefined, { endpoint: "/api/research-promotion-tickets" });
  assert.notEqual(promotion.status, 404);
  assert.equal(outbound, 0);

  const app = await readFile(new URL("../web/strategy-switch-console/app.js", import.meta.url), "utf8");
  const viewMode = app.slice(app.indexOf("function setUx1ViewMode"), app.indexOf("function syncUx1DraftFromDom"));
  assert.equal(viewMode.includes("fetch("), false);
  assert.equal(viewMode.includes("/api/"), false);
  assert.match(viewMode, /qsl-ux1-view-mode/);
  assert.match(app, /qsl-ux1-view-mode"\) === "advanced" \? "advanced" : "guided"/);
  assert.match(app, /上一份方案已过期或计算失败/);

  assert.equal(__test.ux1CalculatorDeadlineMs, 30000);
  assert.equal(__test.ux1CalculatorMaxBytes, 65536);
  const workerSource = await readFile(new URL("../web/strategy-switch-console/worker.js", import.meta.url), "utf8");
  const previewFn = workerSource.slice(workerSource.indexOf("async function ux1PreviewPost"), workerSource.indexOf("async function ux1IntentPost"));
  assert.equal(previewFn.includes("readUx1CalculatorExchange(binding, canonicalJson(calculatorRequest))"), true);
  assert.equal(previewFn.includes("deadlineMs"), false);
  assert.equal(previewFn.includes("maxBytes"), false);
  assert.equal(previewFn.includes("content-length"), false);
  assert.equal(previewFn.includes("Content-Length"), false);
  assert.equal(previewFn.includes("calculatorResponse.text()"), false);

  const utf8Body = JSON.stringify({ error: "calculator_busy", pad: "你".repeat(22000) });
  assert.equal(utf8Body.length <= 65536, true);
  assert.equal(Buffer.byteLength(utf8Body) > 65536, true);
  let fetches = 0;
  await assert.rejects(() => __test.readUx1CalculatorExchange({
    fetch() {
      fetches += 1;
      return new Response(utf8Body, { status: 429, headers: { "content-type": "application/json", "content-length": "8" } });
    },
  }, "{}", { deadlineMs: 1000 }));
  assert.equal(fetches, 1);
  const exact = "x".repeat(65536);
  const exactRead = await __test.readUx1CalculatorExchange({
    fetch(url, init) {
      assert.equal(url, "https://ux1-research-calculator/preview");
      assert.equal(init.method, "POST");
      assert.equal(init.headers["content-type"], "application/json");
      assert.equal(init.body, "{}");
      return new Response(exact, { status: 200 });
    },
  }, "{}", { deadlineMs: 1000 });
  assert.equal(exactRead.status, 200);
  assert.equal(exactRead.text.length, 65536);
  await assert.rejects(() => __test.readUx1CalculatorExchange({
    fetch() { return new Response(`${exact}y`, { status: 200 }); },
  }, "{}", { deadlineMs: 1000 }));
  const split = await __test.readUx1CalculatorExchange({
    fetch() {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("a".repeat(30000)));
          controller.enqueue(new TextEncoder().encode("b".repeat(35536)));
          controller.close();
        },
      }), { status: 200, headers: { "content-length": "1" } });
    },
  }, "{}", { deadlineMs: 1000 });
  assert.equal(split.text.length, 65536);
  let cancelled = false;
  let aborted = false;
  const overStarted = Date.now();
  await assert.rejects(() => __test.readUx1CalculatorExchange({
    fetch(_url, init) {
      init.signal.addEventListener("abort", () => { aborted = true; });
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(40000));
          controller.enqueue(new Uint8Array(40000));
        },
        pull() { return new Promise(() => {}); },
        cancel() { cancelled = true; },
      }), { status: 429, headers: { "content-type": "application/json", "content-length": "1" } });
    },
  }, "{}", { deadlineMs: 1000 }));
  assert.equal(cancelled, true);
  assert.equal(aborted, true);
  assert.equal(Date.now() - overStarted < 500, true);
  const legal = await __test.readUx1CalculatorExchange({
    fetch() {
      return new Response(JSON.stringify({ error: "calculator_busy" }), {
        status: 429,
        headers: { "content-type": "application/json", "content-length": "999999" },
      });
    },
  }, "{}", { deadlineMs: 1000 });
  assert.equal(legal.status, 429);
  assert.equal(JSON.parse(legal.text).error, "calculator_busy");
  fetches = 0;
  aborted = false;
  const fetchHangStarted = Date.now();
  await assert.rejects(() => __test.readUx1CalculatorExchange({
    fetch(_url, init) {
      fetches += 1;
      init.signal.addEventListener("abort", () => { aborted = true; });
      return new Promise(() => {});
    },
  }, "{}", { deadlineMs: 80 }));
  assert.equal(fetches, 1);
  assert.equal(aborted, true);
  assert.equal(Date.now() - fetchHangStarted < 1000, true);
  cancelled = false;
  aborted = false;
  const bodyHangStarted = Date.now();
  await assert.rejects(() => __test.readUx1CalculatorExchange({
    fetch(_url, init) {
      init.signal.addEventListener("abort", () => { aborted = true; });
      return new Promise((resolve) => {
        setTimeout(() => resolve(new Response(new ReadableStream({
          pull() { return new Promise(() => {}); },
          cancel() { cancelled = true; },
        }), { status: 429, headers: { "content-length": "16" } })), 200);
      });
    },
  }, "{}", { deadlineMs: 300 }));
  assert.equal(cancelled, true);
  assert.equal(aborted, true);
  const bodyHangElapsed = Date.now() - bodyHangStarted;
  assert.equal(bodyHangElapsed < 500, true);

  function observeExchange(pending) {
    let timer;
    pending.catch(() => {});
    return new Promise((resolve) => {
      timer = setTimeout(() => resolve("still_pending_after_200ms"), 200);
      pending.then(() => resolve("resolved"), () => resolve("rejected")).finally(() => clearTimeout(timer));
    });
  }
  let abortSeen = false;
  const stuckOverLimit = __test.readUx1CalculatorExchange({
    fetch(_url, init) {
      init.signal.addEventListener("abort", () => { abortSeen = true; });
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(40)); },
        cancel() { return new Promise(() => {}); },
      }));
    },
  }, "{}", { maxBytes: 32, deadlineMs: 40 });
  assert.equal(await observeExchange(stuckOverLimit), "rejected");
  assert.equal(abortSeen, true);
  abortSeen = false;
  const stuckBodyTimeout = __test.readUx1CalculatorExchange({
    fetch(_url, init) {
      init.signal.addEventListener("abort", () => { abortSeen = true; });
      return new Response(new ReadableStream({
        pull() { return new Promise(() => {}); },
        cancel() { return new Promise(() => {}); },
      }));
    },
  }, "{}", { maxBytes: 65536, deadlineMs: 40 });
  assert.equal(await observeExchange(stuckBodyTimeout), "rejected");
  assert.equal(abortSeen, true);
  abortSeen = false;
  let lateCancelStarted = false;
  let releaseLateFetch;
  const lateFetchGate = new Promise((resolve) => { releaseLateFetch = resolve; });
  const ignoredAbort = __test.readUx1CalculatorExchange({
    fetch(_url, init) {
      init.signal.addEventListener("abort", () => { abortSeen = true; });
      return lateFetchGate.then(() => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(8)); },
        cancel() {
          lateCancelStarted = true;
          return new Promise(() => {});
        },
      }), { status: 200 }));
    },
  }, "{}", { maxBytes: 32, deadlineMs: 40 });
  assert.equal(await observeExchange(ignoredAbort), "rejected");
  assert.equal(abortSeen, true);
  assert.equal(lateCancelStarted, false);
  releaseLateFetch();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(lateCancelStarted, true);
  assert.equal(await ignoredAbort.then(() => "resolved", () => "rejected"), "rejected");

  await mf.dispose();
  sink.mode = "ok";
  sink.held = false;
  mf = new Miniflare({
    ...baseOptions,
    bindings: { ...bindings, UX1_RUNTIME_EPOCH: "44".repeat(16) },
    serviceBindings: {
      UX1_RESEARCH_CALCULATOR: async (request) => {
        if (sink.mode === "hold-fail" && !sink.held) {
          sink.held = true;
          sink.markEntered();
          await sink.hold;
          return new Response(JSON.stringify({ error: "calculator_failed" }), { status: 500, headers: { "content-type": "application/json" } });
        }
        const requestBody = await request.json();
        return new Response(JSON.stringify(calculatorResult(requestBody)), { headers: { "content-type": "application/json" } });
      },
    },
  });
  const beforeLate = await call();
  const lateRevision = beforeLate.body.revision;
  sink.mode = "ok";
  const seeded = await call({ expected_revision: lateRevision }, { endpoint: "/api/ux1/preview" });
  assert.equal(seeded.status, 200);
  assert.notEqual(seeded.body.preview, null);
  let releaseHold;
  sink.hold = new Promise((resolve) => { releaseHold = resolve; });
  let markEntered;
  const entered = new Promise((resolve) => { markEntered = resolve; });
  sink.markEntered = markEntered;
  sink.held = false;
  sink.mode = "hold-fail";
  const latePreview = call({ expected_revision: lateRevision }, { endpoint: "/api/ux1/preview" });
  latePreview.catch(() => {});
  await Promise.race([
    entered,
    new Promise((_, reject) => setTimeout(() => reject(new Error("calculator_not_entered")), 2000)),
  ]);
  const nextMode = beforeLate.body.draft.advanced_settings.plugin_mode === "current" ? "auto" : "current";
  const bumped = await call(draftBody(lateRevision, { advanced_settings: { plugin_mode: nextMode } }));
  assert.equal(bumped.status, 200);
  assert.equal(bumped.body.revision, lateRevision + 1);
  sink.mode = "ok";
  const newerPreview = await call({ expected_revision: lateRevision + 1 }, { endpoint: "/api/ux1/preview" });
  assert.equal(newerPreview.status, 200);
  assert.equal(newerPreview.body.preview.status, "unsupported_scope");
  releaseHold();
  const failedLate = await latePreview;
  assert.equal(failedLate.status, 502);
  assert.equal(failedLate.body.error, "calculator_failed");
  const afterLate = await call();
  assert.equal(afterLate.body.revision, lateRevision + 1);
  assert.equal(afterLate.body.draft.advanced_settings.plugin_mode, nextMode);
  assert.equal(afterLate.body.preview.status, "unsupported_scope");
  assert.equal(afterLate.body.fingerprint, newerPreview.body.fingerprint);

  const previousSentinel = process.env.BROKER_SECRET_SENTINEL;
  const previousPythonPath = process.env.PYTHONPATH;
  process.env.BROKER_SECRET_SENTINEL = "broker-sentinel-not-a-secret";
  process.env.PYTHONPATH = "/tmp/should-not-inherit";
  const calcRoot = await mkdtemp(join(tmpdir(), "qrt-ux1-calc-"));
  const demoRoot = await mkdtemp(join(tmpdir(), "qrt-ux1-demo-"));
  const bystander = spawn("sleep", ["30"], { shell: false, stdio: "ignore" });
  let demoChild = null;
  const demoPath = fileURLToPath(new URL("../web/strategy-switch-console/ux1_local_demo.mjs", import.meta.url));
  const configPath = join(demoRoot, "operator.json");
  try {
    const raw = join(calcRoot, "raw");
    const r6 = join(calcRoot, "r6");
    await mkdir(raw);
    await mkdir(r6);
    const materialized = join(calcRoot, "materialized.json");
    await writeFile(materialized, "{}\n");
    const writeScript = async (name, source) => {
      const file = join(calcRoot, name);
      await writeFile(file, source);
      return file;
    };
    const envScript = await writeScript("env.mjs", "let s='';process.stdin.on('data',(c)=>s+=c);process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({sentinel:process.env.BROKER_SECRET_SENTINEL||null,pythonpath:process.env.PYTHONPATH||null,raw:process.env.UX1_RAW_ROOT||null,bytes:s.length}));});\n");
    const calcArgs = {
      interpreter: process.execPath,
      executable: envScript,
      adapter: envScript,
      rawRoot: raw,
      r6Root: r6,
      materialized,
    };
    const childEnv = calculatorChildEnv(calcArgs);
    assert.equal(childEnv.BROKER_SECRET_SENTINEL, undefined);
    assert.equal(childEnv.PYTHONPATH, undefined);
    assert.equal(childEnv.UX1_RAW_ROOT, raw);
    const reportedResponse = await runFixedCalculator(calcArgs, "{\"schema\":\"qsl.ux1.preview_request.v1\"}");
    assert.equal(reportedResponse.status, 200);
    const reported = await reportedResponse.json();
    assert.equal(reported.sentinel, null);
    assert.equal(reported.pythonpath, null);
    assert.equal(reported.raw, raw);
    assert.equal(reported.bytes > 0, true);
    const failed = await runFixedCalculator({ ...calcArgs, executable: await writeScript("fail.mjs", "process.stdin.resume();process.stdin.on('end',()=>process.exit(2));\n"), adapter: envScript }, "{}");
    assert.equal(failed.status, 502);
    assert.equal((await failed.json()).error, "calculator_failed");
    const timedOut = await runFixedCalculator({ ...calcArgs, executable: await writeScript("hang.mjs", "process.stdin.resume();setInterval(()=>{},1000);\n"), adapter: envScript }, "{}", { timeoutMs: 200 });
    assert.equal(timedOut.status, 502);
    const bounded = await runFixedCalculator({ ...calcArgs, executable: await writeScript("big.mjs", "process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write('x'.repeat(70000));});\n"), adapter: envScript }, "{}", { maxBytes: 1024, timeoutMs: 2000 });
    assert.equal(bounded.status, 502);
    const slow = await writeScript("slow.mjs", "process.stdin.resume();process.stdin.on('end',()=>setTimeout(()=>process.stdout.write('{}'),300));\n");
    const fetchCalc = ux1CalculatorFetch({ ...calcArgs, executable: slow, adapter: slow }, { timeoutMs: 2000, maxConcurrent: 1 });
    const firstCalc = fetchCalc(new Request("https://calculator.test/preview", { method: "POST", body: "{}" }));
    const secondCalc = await fetchCalc(new Request("https://calculator.test/preview", { method: "POST", body: "{}" }));
    assert.equal(secondCalc.status, 429);
    assert.equal((await secondCalc.json()).error, "calculator_busy");
    assert.equal((await firstCalc).status, 200);

    const stateRoot = join(demoRoot, "state");
    const demoRaw = join(demoRoot, "raw");
    const demoR6 = join(demoRoot, "r6");
    await mkdir(stateRoot, { mode: 0o700 });
    await mkdir(demoRaw);
    await mkdir(demoR6);
    const demoMaterialized = join(demoRoot, "materialized.json");
    await writeFile(demoMaterialized, "{}\n");
    const demoExecutable = await writeFile(join(demoRoot, "calc.mjs"), "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('{}'));\n").then(() => join(demoRoot, "calc.mjs"));
    const port = 22000 + (process.pid % 20000);
    await writeFile(configPath, JSON.stringify({
      interpreter: process.execPath,
      executable: demoExecutable,
      input_roots: { raw: demoRaw, r6: demoR6, materialized: demoMaterialized },
      expected_hashes: expectedHashes,
      state_root: stateRoot,
      port,
      login: "ux1-local-operator",
    }));
    const runNode = (args) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { shell: false });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
    const startDemo = () => new Promise((resolve, reject) => {
      demoChild = spawn(process.execPath, [demoPath, "start", "--config", configPath], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      const timer = setTimeout(() => reject(new Error(`demo_start_timeout:${output}`)), 30000);
      demoChild.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes(`UX1 demo http://127.0.0.1:${port}`)) {
          clearTimeout(timer);
          resolve(output);
        }
      });
      demoChild.stderr.on("data", (chunk) => { output += chunk.toString(); });
      demoChild.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`demo_exited:${code}:${output}`));
      });
    });
    const demoFetch = async (pathname, sessionToken, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
        method: body ? "POST" : "GET",
        headers: {
          Cookie: `qsl_switch_session=${sessionToken}`,
          Origin: `http://127.0.0.1:${port}`,
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      return { status: response.status, text, body: text ? JSON.parse(text) : null };
    };
    const started = await startDemo();
    const token = await readFile(join(stateRoot, "session"), "utf8");
    assert.equal(started.includes(token), false);
    assert.equal((await stat(join(stateRoot, "session"))).mode & 0o777, 0o600);
    assert.equal((await stat(join(stateRoot, "durable"))).isDirectory(), true);
    const running = await runNode([demoPath, "status", "--config", configPath]);
    assert.equal(running.code, 0);
    assert.match(running.stdout, new RegExp(`status=running\\nlisten=http://127\\.0\\.0\\.1:${port}`));
    assert.equal(running.stdout.includes(token), false);
    assert.equal(running.stderr.includes(token), false);
    const duplicateStart = await runNode([demoPath, "start", "--config", configPath]);
    assert.equal(duplicateStart.code, 1);
    assert.match(duplicateStart.stderr, /already_running/);
    const saved = await demoFetch("/api/ux1/draft", token, { expected_revision: 0, ...defaultUx1Draft() });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.revision, 1);
    const stopped = await runNode([demoPath, "stop", "--config", configPath]);
    assert.equal(stopped.code, 0);
    assert.match(stopped.stdout, /status=stopped/);
    assert.equal(stopped.stdout.includes(token), false);
    assert.equal(bystander.exitCode, null);
    demoChild = null;
    const restarted = await startDemo();
    const tokenAgain = await readFile(join(stateRoot, "session"), "utf8");
    assert.notEqual(tokenAgain, token);
    assert.equal(restarted.includes(tokenAgain), false);
    assert.equal((await demoFetch("/api/ux1/draft", token)).status, 401);
    const reread = await demoFetch("/api/ux1/draft", tokenAgain);
    assert.equal(reread.status, 200);
    assert.equal(reread.body.revision, 1);
    assert.equal(reread.body.fingerprint, saved.body.fingerprint);
    assert.equal(reread.body.draft.advanced_settings.plugin_mode, null);
    assert.equal(reread.body.preview, null);
    assert.equal(reread.body.intent, null);
    const stoppedAgain = await runNode([demoPath, "stop", "--config", configPath]);
    assert.equal(stoppedAgain.code, 0);
    const after = await runNode([demoPath, "status", "--config", configPath]);
    assert.match(after.stdout, /status=stopped/);
    assert.equal(bystander.exitCode, null);
  } finally {
    if (previousSentinel === undefined) delete process.env.BROKER_SECRET_SENTINEL;
    else process.env.BROKER_SECRET_SENTINEL = previousSentinel;
    if (previousPythonPath === undefined) delete process.env.PYTHONPATH;
    else process.env.PYTHONPATH = previousPythonPath;
    try { await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [demoPath, "stop", "--config", configPath], { shell: false });
      child.on("error", reject);
      child.on("close", () => resolve());
    }); } catch { /* config may already be gone */ }
    if (bystander.exitCode === null) bystander.kill("SIGKILL");
    await rm(calcRoot, { recursive: true, force: true });
    await rm(demoRoot, { recursive: true, force: true });
  }
  console.log("ux1 research validation: PASS");
} finally {
  await mf.dispose();
  await rm(persist, { recursive: true, force: true });
}
