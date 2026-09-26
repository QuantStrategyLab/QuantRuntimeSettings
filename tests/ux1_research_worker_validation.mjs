import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import worker, { __test } from "../web/strategy-switch-console/worker.js";
import {
  UX1_STUDY,
  canonicalJson,
  defaultUx1Draft,
  ux1Fingerprint,
} from "../web/strategy-switch-console/ux1_research_contract.js";
import { parseUx1DemoArgs } from "../web/strategy-switch-console/ux1_local_demo.mjs";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const { Miniflare } = require(process.env.QRT_MINIFLARE_MODULE || "miniflare");

const reordered = defaultUx1Draft();
reordered.advanced_settings = Object.fromEntries(Object.entries(reordered.advanced_settings).reverse());
assert.equal(await ux1Fingerprint(defaultUx1Draft()), await ux1Fingerprint(reordered));
const custom = defaultUx1Draft();
custom.advanced_settings.plugin_mode = "none";
assert.notEqual(await ux1Fingerprint(defaultUx1Draft()), await ux1Fingerprint(custom));
assert.throws(() => parseUx1DemoArgs(["--interpreter", "python", "--adapter", "/tmp/adapter.py", "--raw-root", "/tmp/raw", "--r6-root", "/tmp/r6", "--materialized", "/tmp/r6.json"]), /demo_path_must_be_absolute/);
assert.throws(() => parseUx1DemoArgs(["--host", "0.0.0.0", "--interpreter", "/usr/bin/python3", "--adapter", "/tmp/adapter.py"]), /unknown_demo_argument/);

const legacy = { key: "existing", label: "Existing fixture", target_name: "existing", account_selector: "existing-account", deployment_selector: "existing-deployment", service_name: "existing-service", supported_domains: ["us_equity"] };
const bindings = {
  SESSION_SECRET: "synthetic-only-session-key",
  STRATEGY_SWITCH_ADMIN_LOGINS: "fixture-admin",
  ALLOWED_GITHUB_LOGINS: "fixture-reader,fixture-other,fixture-admin",
  RUNTIME_SETTINGS_DISPATCH_TOKEN: "synthetic-only-dispatch-token",
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
  assert.match(html, /data-ux1-default-view="guided"/);
  assert.match(html, /简易模式/);
  assert.match(html, /native_not_observed/);
  assert.match(html, /id="ux1-preview-button"/);
  assert.equal(html.includes('id="ux1-preview-button" disabled'), false);

  await mf.dispose();
  sink.calls = 0;
  mf = new Miniflare({
    ...baseOptions,
    serviceBindings: {
      UX1_RESEARCH_CALCULATOR: async (request) => {
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
  const intent = await call({ expected_revision: 4, fingerprint: ready.body.fingerprint }, { endpoint: "/api/ux1/intent" });
  const duplicate = await call({ expected_revision: 4, fingerprint: ready.body.fingerprint }, { endpoint: "/api/ux1/intent" });
  assert.equal(intent.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(duplicate.body.intent.receipt_id, intent.body.intent.receipt_id);
  assert.equal(duplicate.body.intent.executable, false);
  assert.equal(duplicate.body.intent.no_order, true);
  assert.equal((await call({ expected_revision: 3, fingerprint: ready.body.fingerprint }, { endpoint: "/api/ux1/intent" })).status, 409);
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
  console.log("ux1 research validation: PASS");
} finally {
  await mf.dispose();
  await rm(persist, { recursive: true, force: true });
}
