import assert from "node:assert/strict";
import fs from "node:fs";
import Ajv2020 from "../web/strategy-switch-console/node_modules/ajv/dist/2020.js";
import addFormats from "../web/strategy-switch-console/node_modules/ajv-formats/dist/index.js";

import * as runtimeReadbackMod from "../web/strategy-switch-console/application/console_api/runtime_readback.js";
import * as overviewMod from "../web/strategy-switch-console/application/desk/overview.js";
import * as ribbonMod from "../web/strategy-switch-console/application/desk/ribbon.js";
import * as readbackMod from "../web/strategy-switch-console/application/desk/readback.js";
import { deskResponse } from "../web/strategy-switch-console/application/desk/http.js";
import * as accountsMod from "../web/strategy-switch-console/application/desk/accounts.js";
import * as inboxMod from "../web/strategy-switch-console/application/console_api/inbox.js";
import { createReadOnlyStorage, createReadOnlyKv } from "./helpers/read_only_storage.mjs";

const FIXTURES_DIR = new URL("./fixtures/sa4/", import.meta.url);
const SCHEMAS_DIR = new URL("../schemas/desk/", import.meta.url);

function loadJson(url) {
  return JSON.parse(fs.readFileSync(url, "utf8"));
}

function createSchemaValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const file of fs.readdirSync(SCHEMAS_DIR)) {
    if (!file.endsWith(".json")) continue;
    const schema = loadJson(new URL(file, SCHEMAS_DIR));
    if (schema.$id) ajv.addSchema(schema, schema.$id);
  }
  return {
    assertValid(schemaFile, payload, label) {
      const schema = loadJson(new URL(schemaFile, SCHEMAS_DIR));
      const validate = ajv.getSchema(schema.$id) || ajv.compile(schema);
      const ok = validate(payload);
      assert.equal(ok, true, `${label} schema invalid (${schemaFile}): ${ajv.errorsText(validate.errors)}`);
    },
  };
}

function parseSelectedCase(argv) {
  const idx = argv.indexOf("--case");
  if (idx === -1) return null;
  const val = argv[idx + 1];
  if (!val) throw new Error("missing value after --case");
  return val;
}

async function runSaA15(validator) {
  const matrix = loadJson(new URL("sa4_8a_fleet_matrix.json", FIXTURES_DIR));
  const nowMs = Date.parse(matrix.now);

  // 1) Verify runtimeReadbackProjection exposes execution_mode, deployment_observed_at, ttl_seconds, semantics.
  const firstCase = matrix.cases.find(c => c.id === "all-same");
  const proj = runtimeReadbackMod.runtimeReadbackProjection(
    firstCase.accounts[0],
    firstCase.accounts,
    firstCase.snapshot,
    nowMs,
  );
  assert.equal(proj.data_status, "ready", "SA-A15 ready status");
  assert.equal(proj.execution_mode, "paper", "SA-A15 execution_mode exposed on ready projection");
  assert.equal(proj.deployment_observed_at, "2030-01-08T14:50:00Z", "SA-A15 deployment_observed_at exposed");
  assert.equal(proj.ttl_seconds, 3600, "SA-A15 ttl_seconds exposed");
  assert.deepEqual(proj.semantics, { monitoring_only: true, not_trading_or_books: true }, "SA-A15 monitoring semantics preserved");

  // Unbound / missing execution_mode must never fabricate a mode.
  const missingModeCase = matrix.cases.find(c => c.id === "missing-execution-mode");
  const missingModeProj = runtimeReadbackMod.runtimeReadbackProjection(
    missingModeCase.accounts[0],
    missingModeCase.accounts,
    missingModeCase.snapshot,
    nowMs,
  );
  assert.equal(missingModeProj.data_status, "ready", "existing omission behavior preserved");
  assert.equal(missingModeProj.execution_mode, null, "omitted execution_mode stays null, never inferred");

  // 2) Verify fleet_mode_summary across all 8 matrix cases.
  assert.equal(typeof overviewMod.projectFleetExecutionMode, "function", "projectFleetExecutionMode exported from desk/overview.js");
  assert.equal(typeof ribbonMod.projectFleetExecutionMode, "function", "projectFleetExecutionMode exported from desk/ribbon.js");

  for (const testCase of matrix.cases) {
    const summary = overviewMod.projectFleetExecutionMode({
      accounts: testCase.accounts,
      snapshot: testCase.snapshot,
      now: nowMs,
    });
    assert.equal(summary.status, testCase.expected.status, `SA-A15 ${testCase.id} status`);
    assert.equal(summary.mode, testCase.expected.mode, `SA-A15 ${testCase.id} mode`);
    assert.equal(summary.observed_at, testCase.expected.observed_at, `SA-A15 ${testCase.id} observed_at === min(deployment_observed_at)`);
    assert.equal(summary.cohort_count, testCase.expected.cohort_count, `SA-A15 ${testCase.id} cohort_count`);
    assert.equal(summary.observed_count, testCase.expected.observed_count, `SA-A15 ${testCase.id} observed_count`);
    assert.deepEqual(summary.modes, testCase.expected.modes, `SA-A15 ${testCase.id} modes`);
    assert.equal(summary.missing_count, testCase.expected.missing_count, `SA-A15 ${testCase.id} missing_count`);
    assert.equal(summary.stale_count, testCase.expected.stale_count, `SA-A15 ${testCase.id} stale_count`);
    assert.equal(summary.failed_count, testCase.expected.failed_count, `SA-A15 ${testCase.id} failed_count`);
    assert.equal(summary.conflict_count, testCase.expected.conflict_count, `SA-A15 ${testCase.id} conflict_count`);
    assert.deepEqual(summary.semantics, { monitoring_only: true, not_trading_or_books: true }, `SA-A15 ${testCase.id} semantics`);
    validator.assertValid("common.json#/$defs/FleetModeSummary", summary, `SA-A15:${testCase.id}`);
  }
  console.log(`SA-A15 passed (${matrix.cases.length} fleet scenarios)`);
}

async function runSaA16(validator) {
  const matrix = loadJson(new URL("sa4_9a_three_layer_matrix.json", FIXTURES_DIR));
  const nowIso = matrix.now;
  const nowMs = Date.parse(nowIso);
  const fullTarget = {
    ...matrix.target,
    config: matrix.cases[0].observed_saved.config,
    revision: matrix.cases[0].observed_saved.instance_revision,
  };

  // 1) Zero-write GET spy across DeskReadbackStore + deskReadbackResponse + Workers KV
  const kvSpy = createReadOnlyKv({
    "runtime_target_lifecycle_source:ibkr": JSON.stringify({ targets: [], errors: [] }),
  });
  const doSpy = createReadOnlyStorage({
    kv: {},
    alarm: null,
    sqlRows: () => [],
  });
  let observedCalls = 0;
  const store = new readbackMod.DeskReadbackStore(doSpy.storage, async () => {
    observedCalls += 1;
    const c = matrix.cases[0];
    return readbackMod.buildReadback({
      target: fullTarget,
      observed: c.observed_saved,
      platform: c.platform.effective,
      now: nowMs,
      platformMeta: c.platform,
      deployment: c.deployment,
    });
  }, () => nowMs);

  const getReq = new Request("https://example.invalid/api/desk/targets/ibkr%2Fsyn_tqqq/readback", { method: "GET" });
  const env = { STRATEGY_SWITCH_CONFIG: kvSpy.namespace };
  const deps = {
    auth: async () => ({ login: "syn-reader" }),
    options: async () => ({
      revision: 7,
      options: {
        ibkr: [{
          key: fullTarget.key,
          target_name: fullTarget.key,
          label: fullTarget.label,
          ...fullTarget.config,
        }],
      },
    }),
    command: (_env, cmd) => store.command({ owner: "syn-owner", actor: "syn-reader", ...cmd }),
    now: () => nowMs,
  };
  const getResp = await readbackMod.deskReadbackResponse(getReq, env, deps);
  assert.equal(getResp.status, 200, "GET target readback returns 200");
  assert.equal(observedCalls, 1, "GET invokes readback once");
  assert.equal(kvSpy.violations.length, 0, `SA-A16 kvWrites === 0 (got ${JSON.stringify(kvSpy.violations)})`);
  const doSqlWrites = doSpy.violations.filter(v => v.kind.startsWith("sql_"));
  const doAlarmWrites = doSpy.violations.filter(v => v.kind.startsWith("alarm_"));
  assert.equal(doSqlWrites.length, 0, `SA-A16 doSqlWrites === 0`);
  assert.equal(doAlarmWrites.length, 0, `SA-A16 doAlarmWrites === 0`);
  assert.equal(doSpy.violations.length, 0, `SA-A16 DO storage/KV/alarm total violations === 0 (got ${JSON.stringify(doSpy.violations)})`);

  // 2) Check all 9A three-layer comparison cases & schema validity
  for (const testCase of matrix.cases) {
    const rb = readbackMod.buildReadback({
      target: {
        ...matrix.target,
        config: testCase.observed_saved.config,
        revision: testCase.observed_saved.instance_revision,
      },
      observed: testCase.observed_saved,
      platform: testCase.platform.effective,
      now: nowMs,
      platformMeta: testCase.platform,
      deployment: testCase.deployment,
    });
    assert.equal(rb.saved_revision, testCase.expected.saved_revision, `SA-A16 ${testCase.id} saved_revision`);
    assert.ok(rb.saved_settings && typeof rb.saved_settings === "object", `SA-A16 ${testCase.id} saved_settings present`);
    assert.equal(rb.saved_settings.instance_revision, testCase.expected.saved_instance_revision, `SA-A16 ${testCase.id} instance_revision`);
    assert.equal(rb.saved_settings.draft_revision, testCase.expected.saved_draft_revision, `SA-A16 ${testCase.id} draft_revision`);
    assert.ok(rb.platform_configuration && typeof rb.platform_configuration === "object", `SA-A16 ${testCase.id} platform_configuration present`);
    assert.ok(rb.observed_deployment && typeof rb.observed_deployment === "object", `SA-A16 ${testCase.id} observed_deployment present`);
    assert.ok(rb.comparisons && typeof rb.comparisons === "object", `SA-A16 ${testCase.id} comparisons present`);
    assert.equal(rb.comparisons.saved_vs_platform.status, testCase.expected.saved_vs_platform, `SA-A16 ${testCase.id} saved_vs_platform`);
    assert.equal(rb.comparisons.platform_vs_observed.status, testCase.expected.platform_vs_observed, `SA-A16 ${testCase.id} platform_vs_observed`);
    if (testCase.expected.saved_vs_observed) {
      assert.equal(rb.comparisons.saved_vs_observed.status, testCase.expected.saved_vs_observed, `SA-A16 ${testCase.id} saved_vs_observed`);
    }
    if (testCase.expected.saved_vs_platform_mismatches) {
      assert.deepEqual(rb.comparisons.saved_vs_platform.mismatched_fields, testCase.expected.saved_vs_platform_mismatches);
    }
    if (testCase.expected.skipped_non_mutual_in_observed_include) {
      for (const skippedKey of testCase.expected.skipped_non_mutual_in_observed_include) {
        assert.ok(
          rb.comparisons.platform_vs_observed.skipped_non_mutual_fields.includes(skippedKey),
          `SA-A16 ${testCase.id} skips non-mutual field ${skippedKey}`,
        );
      }
    }
    if (testCase.expected.observed_reason) {
      assert.equal(rb.observed_deployment.reason, testCase.expected.observed_reason);
    }
    assert.equal(rb.actions.reapply_saved.status, "not_enabled", `SA-A16 ${testCase.id} reapply_saved status not_enabled`);
    assert.equal(rb.actions.reapply_saved.allowed, false, `SA-A16 ${testCase.id} reapply_saved allowed false`);
    assert.equal(rb.actions.adopt_platform.status, "not_enabled", `SA-A16 ${testCase.id} adopt_platform status not_enabled`);
    assert.equal(rb.actions.adopt_platform.allowed, false, `SA-A16 ${testCase.id} adopt_platform allowed false`);
    const envelope = await (await deskResponse("readback", rb, { now: nowMs })).json();
    validator.assertValid("readback.json", envelope, `SA-A16:${testCase.id}`);
  }

  // 3) Check N1 accounts consumes readback_9a projection
  assert.equal(typeof accountsMod.accountsProjection, "function");
  const firstCase = matrix.cases[0];
  const rb0 = readbackMod.buildReadback({
    target: fullTarget,
    observed: firstCase.observed_saved,
    platform: firstCase.platform.effective,
    now: nowMs,
    platformMeta: firstCase.platform,
    deployment: firstCase.deployment,
  });
  const acctOut = accountsMod.accountsProjection({
    config: {
      ok: true,
      value: {
        revision: 7,
        options: { ibkr: [{ key: "syn_tqqq", target_name: "syn_tqqq", account_selector: "DU0000001" }] },
      },
    },
    facts: { ok: false },
    credential: { ok: false },
    now: nowMs,
    readbacks9a: {
      "ibkr/syn_tqqq": rb0,
    },
  });
  assert.ok(acctOut.brokers.value[0].readback_9a, "SA-A16 accountsProjection wires readback_9a on broker row");
  assert.equal(acctOut.brokers.value[0].readback_9a.status, "drift", "SA-A16 readback_9a reflects layer drift");
  assert.equal(acctOut.brokers.value[0].readback_9a.actions.reapply_saved.status, "not_enabled");

  // Finding #2: broker_environment never triggers false execution_mode drift across paper/live/dry_run axes.
  const baseSaved = matrix.cases[1].observed_saved;
  const basePlatform = matrix.cases[1].platform;
  const rbPaperLiveMatch = readbackMod.buildReadback({
    target: { ...fullTarget, config: { ...baseSaved.config, broker_environment: "paper", default_execution_mode: "live" } },
    observed: { ...baseSaved, config: { ...baseSaved.config, broker_environment: "paper", default_execution_mode: "live" } },
    platform: { ...basePlatform.effective, broker_environment: "paper", execution_mode: "live" },
    now: nowMs,
    platformMeta: basePlatform,
    deployment: { ...matrix.cases[0].deployment, execution_mode: "live" },
  });
  assert.equal(rbPaperLiveMatch.comparisons.platform_vs_observed.status, "match");
  assert.equal(rbPaperLiveMatch.comparisons.saved_vs_observed.status, "match");
  assert.ok(rbPaperLiveMatch.comparisons.saved_vs_observed.skipped_non_mutual_fields.includes("broker_environment"));
  const rbExecModeDrift = readbackMod.buildReadback({
    target: { ...fullTarget, config: { ...baseSaved.config, broker_environment: "live", default_execution_mode: "dry_run" } },
    observed: { ...baseSaved, config: { ...baseSaved.config, broker_environment: "live", default_execution_mode: "dry_run" } },
    platform: { ...basePlatform.effective, broker_environment: "live", execution_mode: "live" },
    now: nowMs,
    platformMeta: basePlatform,
    deployment: { ...matrix.cases[0].deployment, execution_mode: "live" },
  });
  assert.equal(rbExecModeDrift.comparisons.platform_vs_observed.status, "match");
  assert.equal(rbExecModeDrift.comparisons.saved_vs_observed.status, "drift");
  assert.deepEqual(rbExecModeDrift.comparisons.saved_vs_observed.mismatched_fields, ["execution_mode"]);

  // Finding #3: brokerReadback9a requires all 3 comparisons for "match" and counts observed drift targets.
  const rbMissingDeployment = readbackMod.buildReadback({
    target: fullTarget,
    observed: matrix.cases[1].observed_saved,
    platform: matrix.cases[1].platform.effective,
    now: nowMs,
    platformMeta: matrix.cases[1].platform,
    deployment: matrix.cases[1].deployment,
  });
  assert.equal(rbMissingDeployment.overall, "match");
  const acctMissingDeploy = accountsMod.accountsProjection({
    config: { ok: true, value: { revision: 7, options: { ibkr: [{ key: "syn_tqqq", target_name: "syn_tqqq", account_selector: "DU0000001" }] } } },
    facts: { ok: false },
    credential: { ok: false },
    now: nowMs,
    readbacks9a: { "ibkr/syn_tqqq": rbMissingDeployment },
  });
  assert.equal(acctMissingDeploy.brokers.value[0].readback_9a.status, "unknown", "missing deployment never reports match");
  assert.equal(acctMissingDeploy.brokers.value[0].readback_9a.drift_target_count, 0);

  const rbObservedOnlyDrift = readbackMod.buildReadback({
    target: fullTarget,
    observed: matrix.cases[1].observed_saved,
    platform: matrix.cases[1].platform.effective,
    now: nowMs,
    platformMeta: matrix.cases[1].platform,
    deployment: { ...matrix.cases[0].deployment, runtime_enabled: false },
  });
  assert.equal(rbObservedOnlyDrift.overall, "match");
  assert.equal(rbObservedOnlyDrift.comparisons.platform_vs_observed.status, "drift");
  const acctObsDrift = accountsMod.accountsProjection({
    config: { ok: true, value: { revision: 7, options: { ibkr: [{ key: "syn_tqqq", target_name: "syn_tqqq", account_selector: "DU0000001" }] } } },
    facts: { ok: false },
    credential: { ok: false },
    now: nowMs,
    readbacks9a: { "ibkr/syn_tqqq": rbObservedOnlyDrift },
  });
  assert.equal(acctObsDrift.brokers.value[0].readback_9a.status, "drift");
  assert.equal(acctObsDrift.brokers.value[0].readback_9a.drift_target_count, 1);

  console.log(`SA-4 passed (${matrix.cases.length} readback cases + zero-write GET spy)`);
}

async function runSaA17(validator) {
  const matrix = loadJson(new URL("sa4_12a_queue_matrix.json", FIXTURES_DIR));
  const nowMs = Date.parse(matrix.now);
  assert.equal(typeof inboxMod.projectUnifiedOwnerQueue12A, "function", "projectUnifiedOwnerQueue12A exported from inbox.js");

  for (const testCase of matrix.cases) {
    const queue = inboxMod.projectUnifiedOwnerQueue12A({
      sources: testCase.sources,
      expectedFamilies: matrix.expected_families,
      now: nowMs,
    });
    validator.assertValid("common.json#/$defs/OwnerQueue12A", queue, `SA-A17:${testCase.id}`);
    assert.equal(queue.queue_state, testCase.expected.queue_state, `SA-A17 ${testCase.id} queue_state`);
    assert.equal(queue.actionable_items.length, testCase.expected.actionable_count, `SA-A17 ${testCase.id} actionable_count`);
    assert.equal(queue.blocked_or_expired_items.length, testCase.expected.blocked_or_expired_count, `SA-A17 ${testCase.id} blocked_or_expired_count`);
    assert.equal(queue.total_unresolved, testCase.expected.total_unresolved, `SA-A17 ${testCase.id} total_unresolved`);
    if (testCase.expected.truncated !== undefined) {
      assert.equal(queue.truncated, testCase.expected.truncated, `SA-A17 ${testCase.id} truncated`);
    }
    if (testCase.expected.corrupt_omitted_total !== undefined) {
      assert.equal(queue.corrupt_omitted_total, testCase.expected.corrupt_omitted_total, `SA-A17 ${testCase.id} corrupt_omitted_total`);
    }
    if (testCase.expected.csa26_platforms_included) {
      const credPlatforms = new Set(
        [...queue.actionable_items, ...queue.blocked_or_expired_items]
          .filter(item => item.family === "credential_maintenance")
          .map(item => item.platform),
      );
      for (const p of testCase.expected.csa26_platforms_included) {
        assert.ok(credPlatforms.has(p), `SA-A17 ${testCase.id} includes multi-platform C-SA-26 credential for ${p}`);
      }
    }
  }
  // Finding #4: unobserved records from accountsCredentialCalendarProjection with populated source.observed_at never throw.
  const calendarOut = accountsMod.accountsCredentialCalendarProjection({
    ibkrRecord: { id: "ibkr_flex", expires_at: null, metadata_revision: 0 },
    evaluatedAt: matrix.now,
  });
  const csa26Queue = inboxMod.projectUnifiedOwnerQueue12A({
    sources: {
      owner_decisions: matrix.cases[0].sources.owner_decisions,
      promotion_applications: matrix.cases[0].sources.promotion_applications,
      reconciliation_recovery: matrix.cases[0].sources.reconciliation_recovery,
      credential_maintenance: {
        status: "ok",
        observed_at: "2030-01-08T14:59:00Z",
        cap: null,
        truncated: false,
        corrupt_omitted_count: 0,
        errors: [],
        items: [],
        csa26_records: calendarOut.records,
      },
    },
    expectedFamilies: matrix.expected_families,
    now: nowMs,
  });
  assert.equal(csa26Queue.queue_state, "non_empty");
  assert.equal(csa26Queue.actionable_items.length, 3, "3 unobserved applicable credentials require investigation");
  assert.ok(csa26Queue.actionable_items.every(item => item.observed_at === null), "unobserved credential items preserve null observed_at");
  validator.assertValid("common.json#/$defs/OwnerQueue12A", csa26Queue, "SA-A17:unobserved-csa26");

  // Finding #1: End-to-end HTTP handlers (deskRibbonResponse, deskOverviewResponse, deskAccountsResponse) wire SA-4 fields.
  const fleetMatrix = loadJson(new URL("sa4_8a_fleet_matrix.json", FIXTURES_DIR));
  const fleetCase = fleetMatrix.cases.find(c => c.id === "all-same");
  const rbMatrix = loadJson(new URL("sa4_9a_three_layer_matrix.json", FIXTURES_DIR));
  const rbFirst = readbackMod.buildReadback({
    target: { ...rbMatrix.target, config: rbMatrix.cases[0].observed_saved.config, revision: rbMatrix.cases[0].observed_saved.instance_revision },
    observed: rbMatrix.cases[0].observed_saved,
    platform: rbMatrix.cases[0].platform.effective,
    now: Date.parse(rbMatrix.now),
    platformMeta: rbMatrix.cases[0].platform,
    deployment: rbMatrix.cases[0].deployment,
  });
  const sharedHttpDeps = {
    auth: async () => ({ allowed: true, login: "syn-reader" }),
    now: () => Date.parse(fleetMatrix.now),
    options: async () => ({
      revision: 3,
      options: {
        ibkr: fleetCase.accounts.filter(a => a.platform === "ibkr").map(a => ({ ...a, target_name: a.key })),
        longbridge: fleetCase.accounts.filter(a => a.platform === "longbridge").map(a => ({ ...a, target_name: a.key })),
        schwab: fleetCase.accounts.filter(a => a.platform === "schwab").map(a => ({ ...a, target_name: a.key })),
      },
    }),
    factsBindings: async () => ({ bindings: [] }),
    factsStored: async () => new Map(),
    command: async (_e, cmd) => {
      if (cmd.action === "credential_maintenance_read") return { id: "ibkr_flex", expires_at: null, phase: "unknown" };
      if (cmd.action === "account_facts_history_read") return { ok: true, days: [] };
      throw new Error(`unexpected command ${cmd.action}`);
    },
    runtimeDay: async () => ({ accounts: [] }),
    runtimeLifecycle: async () => fleetCase.snapshot,
    ownerQueueSources: async () => matrix.cases[0].sources,
    readbacks9a: async () => ({ [fleetCase.accounts[0].target_id]: rbFirst }),
  };
  const ribbonHttpRes = await ribbonMod.deskRibbonResponse(new Request("https://example.invalid/api/desk/ribbon"), {}, sharedHttpDeps);
  assert.equal(ribbonHttpRes.status, 200);
  const ribbonPayload = await ribbonHttpRes.json();
  validator.assertValid("n1-ribbon.json", ribbonPayload, "SA4-HTTP:n1-ribbon");
  assert.equal(ribbonPayload.fleet_mode_summary.status, "single_mode");
  assert.equal(ribbonPayload.fleet_mode_summary.mode, "paper");

  const overviewHttpRes = await overviewMod.deskOverviewResponse(new Request("https://example.invalid/api/desk/overview"), {}, sharedHttpDeps);
  assert.equal(overviewHttpRes.status, 200);
  const overviewPayload = await overviewHttpRes.json();
  validator.assertValid("n1-overview.json", overviewPayload, "SA4-HTTP:n1-overview");
  assert.equal(overviewPayload.fleet_mode_summary.status, "single_mode");
  assert.equal(overviewPayload.owner_queue_12a.queue_state, "verified_empty");
  assert.ok(overviewPayload.book.value.every(row => row.execution_mode === "paper" && row.runtime_enabled === true));

  const accountsHttpRes = await accountsMod.deskAccountsResponse(new Request("https://example.invalid/api/desk/accounts"), {}, sharedHttpDeps);
  assert.equal(accountsHttpRes.status, 200);
  const accountsPayload = await accountsHttpRes.json();
  validator.assertValid("n1-accounts.json", accountsPayload, "SA4-HTTP:n1-accounts");
  const ibkrBroker = accountsPayload.brokers.value.find(b => b.platform === "ibkr");
  assert.equal(ibkrBroker.readback_9a.status, "drift");

  console.log(`SA-A17 passed (${matrix.cases.length} 12A queue scenarios + unobserved C-SA-26 + HTTP wiring)`);
}

async function runSaA18() {
  const matrix = loadJson(new URL("sa4_na_regression_matrix.json", FIXTURES_DIR));
  for (const testCase of matrix.cases) {
    if (testCase.id === "historical-date-ribbon") {
      const proj = await ribbonMod.ribbonProjection(
        new Request(`https://example.invalid/api/desk/ribbon?date=${testCase.businessDate}`),
        {},
        {
          runtimeDay: async (_req, _env, _accounts, day) => (day === testCase.summaryDate ? { accounts: [] } : null),
        },
        {
          date: testCase.businessDate,
          now: Date.parse(testCase.now),
          config: {
            options: {
              firstrade: matrix.accounts.map(a => ({ key: a.key, target_name: a.target_id.split("/")[1] })),
            },
          },
        },
      );
      assert.equal(proj.next_run.status, testCase.expected.status, `SA-A18 ${testCase.id} status`);
      assert.equal(proj.next_run.coverage.total, null, `SA-A18 ${testCase.id} coverage.total === null`);
      assert.equal(proj.next_run.coverage.included, 0, `SA-A18 ${testCase.id} coverage.included === 0`);
      assert.equal(proj.next_run.coverage.state, "unavailable", `SA-A18 ${testCase.id} coverage.state === unavailable`);
      continue;
    }
    const next = ribbonMod.nextScheduledRun({
      summary: testCase.summary,
      accounts: matrix.accounts,
      businessDate: testCase.businessDate,
      now: Date.parse(testCase.now),
    });
    assert.equal(next.status, testCase.expected.status, `SA-A18 ${testCase.id} status`);
    assert.equal(next.coverage.total, testCase.expected.coverage_total, `SA-A18 ${testCase.id} coverage.total`);
    assert.equal(next.coverage.included, testCase.expected.coverage_included, `SA-A18 ${testCase.id} coverage.included`);
    assert.equal(next.coverage.state, testCase.expected.coverage_state, `SA-A18 ${testCase.id} coverage.state`);
    if (testCase.expected.reason) {
      assert.equal(next.reason, testCase.expected.reason, `SA-A18 ${testCase.id} reason`);
    }
    if (testCase.expected.due_at) {
      assert.equal(next.value?.due_at, testCase.expected.due_at, `SA-A18 ${testCase.id} due_at`);
    }
  }
  console.log(`SA-A18 passed (${matrix.cases.length} NA next-run scenarios)`);
}

const selected = parseSelectedCase(process.argv.slice(2));
const validator = createSchemaValidator();

const runners = {
  "SA-A15": () => runSaA15(validator),
  "SA-A16": () => runSaA16(validator),
  "SA-A17": () => runSaA17(validator),
  "SA-A18": () => runSaA18(),
};

if (selected) {
  if (!runners[selected]) throw new Error(`Unknown --case ${selected}`);
  await runners[selected]();
} else {
  for (const fn of Object.values(runners)) {
    await fn();
  }
  console.log("SA-4 all acceptance cases (SA-A15..SA-A18) passed");
}
