import assert from "node:assert/strict";
import fs from "node:fs";

import * as runtimeReadbackMod from "../web/strategy-switch-console/application/console_api/runtime_readback.js";
import * as overviewMod from "../web/strategy-switch-console/application/desk/overview.js";
import * as ribbonMod from "../web/strategy-switch-console/application/desk/ribbon.js";
import * as readbackMod from "../web/strategy-switch-console/application/desk/readback.js";
import * as inboxMod from "../web/strategy-switch-console/application/console_api/inbox.js";
import { PUBLIC_ROUTES, INTERNAL_OPERATIONS } from "../web/strategy-switch-console/application/read_contracts.js";
import { createReadOnlyStorage, createReadOnlyKv } from "./helpers/read_only_storage.mjs";

const FIXTURES_DIR = new URL("./fixtures/sa4/", import.meta.url);
const EXCEPTIONS_PATH = new URL("./fixtures/read-contract-exceptions.json", import.meta.url);

function loadJson(url) {
  return JSON.parse(fs.readFileSync(url, "utf8"));
}

const demo = loadJson(new URL("sa4_demo_cases.json", FIXTURES_DIR));
const fleetMatrix = loadJson(new URL("sa4_8a_fleet_matrix.json", FIXTURES_DIR));
const readbackMatrix = loadJson(new URL("sa4_9a_three_layer_matrix.json", FIXTURES_DIR));
const queueMatrix = loadJson(new URL("sa4_12a_queue_matrix.json", FIXTURES_DIR));
const naMatrix = loadJson(new URL("sa4_na_regression_matrix.json", FIXTURES_DIR));

// SA4-D1: 9A Pure no-write GET spy & disabled mutations
{
  const d1 = demo.cases.find(c => c.id === "SA4-D1");
  const c0 = readbackMatrix.cases[0];
  const kvSpy = createReadOnlyKv({});
  const doSpy = createReadOnlyStorage({ kv: {}, alarm: null, sqlRows: () => [] });
  const store = new readbackMod.DeskReadbackStore(doSpy.storage, async () => readbackMod.buildReadback({
    target: readbackMatrix.target,
    effective: c0.platform.effective,
    readAt: readbackMatrix.now,
    observed: c0.observed_saved,
    platformMeta: c0.platform,
    deployment: c0.deployment,
  }), () => Date.parse(readbackMatrix.now));

  const res = await readbackMod.deskReadbackResponse(
    new Request(`https://example.invalid/api/desk/targets/${encodeURIComponent(d1.target_id)}/readback`, { method: "GET" }),
    { STRATEGY_SWITCH_CONFIG: kvSpy.namespace },
    {
      targets: async () => [{ id: d1.target_id, platform: "ibkr", key: "syn_tqqq", label: "SYN TQQQ", revision: 7, options: [] }],
      command: cmd => store.command(cmd),
      now: () => Date.parse(readbackMatrix.now),
    },
  );
  assert.equal(res.status, 200, "SA4-D1 GET returns 200");
  const body = await res.json();
  assert.equal(kvSpy.violations.length, d1.assert_zero_writes.kvWrites, "SA4-D1 kvWrites === 0");
  assert.equal(doSpy.violations.filter(v => v.kind.startsWith("sql_")).length, d1.assert_zero_writes.doSqlWrites, "SA4-D1 doSqlWrites === 0");
  assert.equal(doSpy.violations.filter(v => v.kind.startsWith("alarm_")).length, d1.assert_zero_writes.doAlarmWrites, "SA4-D1 doAlarmWrites === 0");
  assert.equal(doSpy.violations.length, 0, "SA4-D1 DO write violations === 0");
  for (const actionKey of d1.assert_actions_not_enabled) {
    assert.equal(body.actions[actionKey].status, "not_enabled", `SA4-D1 actions.${actionKey}.status === not_enabled`);
    assert.equal(body.actions[actionKey].allowed, false, `SA4-D1 actions.${actionKey}.allowed === false`);
  }
}

// SA4-D2: 9A Three-layer separation without comparing non-mutual fields
{
  const d2 = demo.cases.find(c => c.id === "SA4-D2");
  const c = readbackMatrix.cases.find(item => item.id === d2.case_id);
  const rb = readbackMod.buildReadback({
    target: readbackMatrix.target,
    effective: c.platform.effective,
    readAt: readbackMatrix.now,
    observed: c.observed_saved,
    platformMeta: c.platform,
    deployment: c.deployment,
  });
  assert.equal(rb.saved_settings.instance_revision, 7);
  assert.equal(rb.saved_settings.draft_revision, 9);
  assert.equal(rb.comparisons.saved_vs_platform.status, "drift");
  assert.equal(rb.comparisons.platform_vs_observed.status, "match");
  assert.ok(rb.comparisons.platform_vs_observed.skipped_non_mutual_fields.includes("reserved_cash_floor"));
}

// SA4-D3: 8A Per-target execution_mode & fleet summary transitions
{
  const d3 = demo.cases.find(c => c.id === "SA4-D3");
  assert.equal(typeof overviewMod.projectFleetExecutionMode, "function", "SA4-D3 requires projectFleetExecutionMode");
  for (const cid of d3.case_ids) {
    const tc = fleetMatrix.cases.find(c => c.id === cid);
    const summary = overviewMod.projectFleetExecutionMode({
      accounts: tc.accounts,
      snapshot: tc.snapshot,
      now: Date.parse(fleetMatrix.now),
    });
    assert.equal(summary.status, tc.expected.status, `SA4-D3 ${cid} status`);
    assert.equal(summary.observed_at, tc.expected.observed_at, `SA4-D3 ${cid} oldest observation timestamp`);
  }
  const cAllSame = fleetMatrix.cases.find(c => c.id === "all-same");
  const rt = runtimeReadbackMod.runtimeReadbackProjection(
    cAllSame.accounts[0],
    cAllSame.accounts,
    cAllSame.snapshot,
    Date.parse(fleetMatrix.now),
  );
  assert.equal(rt.execution_mode, "paper", "SA4-D3 runtimeReadbackProjection emits execution_mode");
}

// SA4-D4: 12A 4-family queue & completeness boundary with multi-platform C-SA-26
{
  const d4 = demo.cases.find(c => c.id === "SA4-D4");
  assert.equal(typeof inboxMod.projectUnifiedOwnerQueue12A, "function", "SA4-D4 requires projectUnifiedOwnerQueue12A");
  for (const cid of d4.case_ids) {
    const tc = queueMatrix.cases.find(c => c.id === cid);
    const out = inboxMod.projectUnifiedOwnerQueue12A({
      sources: tc.sources,
      expectedFamilies: queueMatrix.expected_families,
      now: Date.parse(queueMatrix.now),
    });
    assert.equal(out.queue_state, tc.expected.queue_state, `SA4-D4 ${cid} queue_state`);
  }
}

// SA4-D5: NA Next-run denominator regression
{
  const d5 = demo.cases.find(c => c.id === "SA4-D5");
  for (const cid of d5.case_ids) {
    const tc = naMatrix.cases.find(c => c.id === cid);
    if (cid === "historical-date-ribbon") {
      const proj = ribbonMod.ribbonProjection({
        accounts: naMatrix.accounts,
        summaries: [{ date: tc.summaryDate, summary: { accounts: [] } }],
        date: tc.businessDate,
        now: Date.parse(tc.now),
      });
      assert.equal(proj.next_run.coverage.total, null, "SA4-D5 historical coverage.total === null");
      assert.equal(proj.next_run.coverage.state, "unavailable", "SA4-D5 historical coverage.state === unavailable");
      continue;
    }
    const next = ribbonMod.nextScheduledRun({
      summary: tc.summary,
      accounts: naMatrix.accounts,
      businessDate: tc.businessDate,
      now: Date.parse(tc.now),
    });
    assert.equal(next.coverage.total, tc.expected.coverage_total, `SA4-D5 ${cid} coverage.total`);
    assert.equal(next.coverage.state, tc.expected.coverage_state, `SA4-D5 ${cid} coverage.state`);
  }
}

// SA4-D6: ADR 0002 B6 retirement & boundary gate
{
  const d6 = demo.cases.find(c => c.id === "SA4-D6");
  const exceptions = loadJson(EXCEPTIONS_PATH);
  assert.equal(
    exceptions.exceptions.some(e => e.id === d6.retired_exception),
    false,
    "SA4-D6 B6 must be retired from read-contract-exceptions.json",
  );
  const readbacksRoute = PUBLIC_ROUTES.find(r => r.id === "/api/desk/readbacks");
  assert.ok(readbacksRoute, "/api/desk/readbacks route registered");
  const getEffects = Array.isArray(readbacksRoute.effects.GET) ? readbacksRoute.effects.GET : [readbacksRoute.effects.GET];
  assert.equal(getEffects.includes("B6"), false, "SA4-D6 GET /api/desk/readbacks must not carry B6 effect");
  assert.ok(INTERNAL_OPERATIONS[d6.pure_read_action], `SA4-D6 ${d6.pure_read_action} registered`);
  assert.equal(INTERNAL_OPERATIONS[d6.pure_read_action].kind, "read", "SA4-D6 desk_readback_read must be pure read");
}

console.log(`SA-4 design demonstration passed (${demo.cases.length} cases: SA4-D1..SA4-D6)`);
