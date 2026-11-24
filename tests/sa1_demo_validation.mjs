import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const Ajv2020 = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats");

const loadJson = (relPath) => JSON.parse(readFileSync(new URL(relPath, import.meta.url), "utf8"));

const navSchema = loadJson("../schemas/qsl-sizing-unit-nav.v1.schema.json");
const continuitySchema = loadJson("../schemas/qsl-sizing-unit-continuity.v1.schema.json");
const corpActionSchema = loadJson("../schemas/qsl-corporate-action-event.v1.schema.json");
const pinnedCalendar = loadJson("./fixtures/sa1/csa22_pinned_vectors_2025.json");
const demoFixture = loadJson("./fixtures/sa1/sa1_demo_cases.json");

const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
addFormats(ajv);
const validateNavSchema = ajv.compile(navSchema);
const validateContinuitySchema = ajv.compile(continuitySchema);
const validateCorpActionSchema = ajv.compile(corpActionSchema);

// Verify pinned csa22-v1 integrity and schema compilation on every run (R-2).
assert.equal(pinnedCalendar.metadata.calendar_version, "csa22-v1");
assert.equal(
  pinnedCalendar.metadata.spec_digest,
  "6601c01f2907119c25a2687d4b67210285d3c13ebf2d86a2953745dbd1f6f2af",
);
assert.equal(
  pinnedCalendar.metadata.expected_2025_sha256,
  "154779cb27033937270ef970bc8af9bdc0542a0096d60e0f63ef88c92ec64d6a",
);
assert.equal(Object.keys(pinnedCalendar.sessions).length, 365);
for (const ev of demoFixture.cases["SA1-D2"].events) {
  assert.ok(validateCorpActionSchema(ev), `SA1-D2 fixture schema: ${ajv.errorsText(validateCorpActionSchema.errors)}`);
}

const PRIVATE_LOCATOR_RE = new RegExp(
  "(?:source_ref|kv_key|do_key|kv://|do://|/" + "Users/|/" + "home/|broker_account_hash)",
);

const caseArgIndex = process.argv.indexOf("--case");
const requestedCase = caseArgIndex >= 0 ? process.argv[caseArgIndex + 1] : null;

const handlers = {
  async "SA1-D1"() {
    const { evaluateTwrLedger, DESK_7A_LABELS } = await import(
      "../web/strategy-switch-console/application/sizing_unit/twr_ledger.js"
    );
    const { createPinnedCalendarProvider } = await import(
      "../web/strategy-switch-console/application/sizing_unit/freshness.js"
    );
    const provider = createPinnedCalendarProvider(pinnedCalendar);
    const spec = demoFixture.cases["SA1-D1"];
    const depRes = evaluateTwrLedger({
      initialState: spec.deposit_case.initial_state,
      sessions: [spec.deposit_case.session],
      calendarProvider: provider,
    });
    const dep = depRes.sessions[0];
    assert.equal(dep.raw_asset_change_usd, spec.deposit_case.expected.raw_asset_change_usd);
    assert.equal(depRes.labels.raw_asset_change, spec.deposit_case.expected.raw_label);
    assert.equal(DESK_7A_LABELS.raw_asset_change, spec.deposit_case.expected.raw_label);
    assert.equal(dep.adjusted_pnl_usd, spec.deposit_case.expected.adjusted_pnl_usd);
    assert.equal(dep.twr_return, spec.deposit_case.expected.twr_return);
    assert.equal(dep.e_star_after_usd, spec.deposit_case.expected.e_star_after_usd);
    assert.equal(dep.w_ref_usd, spec.deposit_case.expected.w_ref_usd);
    assert.equal(dep.l_usd, spec.deposit_case.expected.l_usd);
    assert.equal(dep.w_usd, spec.deposit_case.expected.w_usd);
    assert.equal(dep.dd_b, spec.deposit_case.expected.dd_b);
    assert.equal(dep.c_t, spec.deposit_case.expected.c_t);
    assert.equal(depRes.method_version, null);

    const wRes = evaluateTwrLedger({
      initialState: spec.withdrawal_case.initial_state,
      sessions: spec.withdrawal_case.sessions,
      calendarProvider: provider,
    });
    const [w1, w2] = wRes.sessions;
    const expW1 = spec.withdrawal_case.expected.after_withdrawal;
    assert.equal(w1.raw_asset_change_usd, expW1.raw_asset_change_usd);
    assert.equal(w1.adjusted_pnl_usd, expW1.adjusted_pnl_usd);
    assert.equal(w1.twr_return, expW1.twr_return);
    assert.equal(w1.e_star_after_usd, expW1.e_star_after_usd);
    assert.equal(w1.w_star_usd, expW1.w_star_usd);
    assert.equal(w1.w_ref_usd, expW1.w_ref_usd);
    assert.equal(w1.l_usd, expW1.l_usd);
    assert.equal(w1.dd_b, expW1.dd_b);
    assert.equal(w1.false_loss_trip, expW1.false_loss_trip);

    const expW2 = spec.withdrawal_case.expected.after_gain;
    assert.equal(w2.w_ref_usd, expW2.w_ref_usd);
    assert.equal(w2.w_star_usd, expW2.w_star_usd);
    assert.notEqual(w2.w_ref_usd, w2.w_star_usd);
    assert.equal(w2.dd_b, expW2.dd_b);
    assert.equal(w2.c_t, expW2.c_t);
    assert.equal(w2.twr_return, expW2.twr_return);
  },

  async "SA1-D2"() {
    const { createCorporateActionLedger, applyCorporateAction, serializeCorporateActionLedger } = await import(
      "../web/strategy-switch-console/application/sizing_unit/corporate_actions.js"
    );
    const spec = demoFixture.cases["SA1-D2"];
    let ledger = createCorporateActionLedger(spec.initial_ledger);
    for (const ev of spec.events) {
      assert.ok(validateCorpActionSchema(ev));
      const res = applyCorporateAction(ledger, ev);
      assert.equal(res.ok, true, res.reason);
      assert.equal(res.replayed, false);
      assert.equal(res.external_flow_delta, spec.expected.external_flow_delta);
      assert.equal(res.phantom_return, spec.expected.phantom_return);
      assert.equal(res.phantom_drawdown, spec.expected.phantom_drawdown);
      ledger = res.ledger;
    }
    assert.equal(ledger.settled_cash_usd, spec.expected.settled_cash_after_usd);
    assert.equal(ledger.dividend_receivable_usd, spec.expected.dividend_receivable_after_usd);
    assert.equal(ledger.loss_memory.dd_b, spec.expected.dd_b);

    const digestBeforeReplay = serializeCorporateActionLedger(ledger).ledger_digest;
    for (const ev of spec.events) {
      const replay = applyCorporateAction(ledger, ev);
      assert.equal(replay.ok, true);
      assert.equal(replay.replayed, true);
      assert.equal(replay.external_flow_delta, "0");
      assert.equal(serializeCorporateActionLedger(replay.ledger).ledger_digest, digestBeforeReplay);
      ledger = replay.ledger;
    }
  },

  async "SA1-D3"() {
    const { createPinnedCalendarProvider, evaluateFreshness } = await import(
      "../web/strategy-switch-console/application/sizing_unit/freshness.js"
    );
    const provider = createPinnedCalendarProvider(pinnedCalendar);
    for (const check of demoFixture.cases["SA1-D3"].checks) {
      const res = evaluateFreshness(
        {
          observed_at: check.observed_at,
          fetched_at: check.fetched_at,
          evaluated_at: check.evaluated_at,
          last_observed_value: "50000.00",
        },
        { calendarProvider: provider },
      );
      for (const [k, v] of Object.entries(check.expected)) {
        assert.equal(res[k], v, `${check.name}.${k}: expected ${v}, got ${res[k]}`);
      }
    }
  },

  async "SA1-D4"() {
    const { evaluateSizingUnitNav, evaluateSizingUnitCohort } = await import(
      "../web/strategy-switch-console/application/sizing_unit/nav.js"
    );
    const { createPinnedCalendarProvider } = await import(
      "../web/strategy-switch-console/application/sizing_unit/freshness.js"
    );
    const provider = createPinnedCalendarProvider(pinnedCalendar);
    const spec = demoFixture.cases["SA1-D4"];
    const single = evaluateSizingUnitNav(spec.single_account_mixed, { calendarProvider: provider });
    assert.ok(validateNavSchema(single), `SA1-D4 single schema: ${ajv.errorsText(validateNavSchema.errors)}`);
    assert.equal(single.status, spec.expected.status);
    assert.equal(single.reason, spec.expected.reason);
    assert.equal(single.nav_usd, spec.expected.nav_usd);
    assert.equal(single.fx_inferred, spec.expected.fx_inferred);
    assert.equal(single.currency_coercion, spec.expected.currency_coercion);
    assert.equal(single.observations[0].observed_at, spec.single_account_mixed.observed_at);

    const cohort = evaluateSizingUnitCohort(spec.cohort_mixed, {
      evaluated_at: "2025-01-08T21:01:00.000Z",
      calendarProvider: provider,
    });
    assert.ok(validateNavSchema(cohort), `SA1-D4 cohort schema: ${ajv.errorsText(validateNavSchema.errors)}`);
    assert.equal(cohort.status, spec.expected.status);
    assert.equal(cohort.reason, spec.expected.reason);
    assert.equal(cohort.nav_usd, null);
    assert.equal(cohort.fx_inferred, false);
    assert.equal(cohort.observations.length, 2);
  },

  async "SA1-D5"() {
    const { evaluatePeriod7aReturn, evaluateTwrLedger } = await import(
      "../web/strategy-switch-console/application/sizing_unit/twr_ledger.js"
    );
    const spec = demoFixture.cases["SA1-D5"];
    const dated = evaluatePeriod7aReturn(spec.date_only_case);
    assert.equal(dated.return_pct, spec.expected.return_pct);
    assert.equal(dated.interpolated, spec.expected.interpolated);
    assert.equal(dated.empty_as_zero, spec.expected.empty_as_zero);
    assert.ok(["partial", "unavailable"].includes(dated.status));

    const missing = evaluateTwrLedger({
      initialState: { e_prev_usd: "50000.00", e_star_prev_usd: "50000.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
      valuations: spec.missing_snapshot_case.valuations,
      flows: spec.missing_snapshot_case.flows,
    });
    assert.equal(missing.return_pct, null);
    assert.equal(missing.interpolated, false);
    assert.equal(missing.empty_as_zero, false);
  },

  async "SA1-D6"() {
    const { evaluateSizingUnitCohort } = await import(
      "../web/strategy-switch-console/application/sizing_unit/nav.js"
    );
    const { createPinnedCalendarProvider } = await import(
      "../web/strategy-switch-console/application/sizing_unit/freshness.js"
    );
    const provider = createPinnedCalendarProvider(pinnedCalendar);
    const spec = demoFixture.cases["SA1-D6"];
    const res = evaluateSizingUnitCohort(spec.accounts, {
      evaluated_at: spec.evaluated_at,
      calendarProvider: provider,
      require_live_cohort: true,
    });
    assert.ok(validateNavSchema(res), `SA1-D6 schema: ${ajv.errorsText(validateNavSchema.errors)}`);
    assert.equal(res.status, spec.expected.status);
    assert.equal(res.account_id, spec.expected.account_id);
    assert.equal(res.nav_usd, spec.expected.nav_usd);
    assert.equal(res.cohort.excluded_count, spec.expected.excluded_count);
    assert.equal(res.margin_enabled, spec.expected.margin_enabled);
    assert.equal(res.margin_debt_usd, spec.expected.margin_debt_usd);
    assert.equal(PRIVATE_LOCATOR_RE.test(JSON.stringify(res)), false, "Private locator leaked into output JSON");
  },

  async "SA1-D7"() {
    const { evaluateHistoryContinuity } = await import(
      "../web/strategy-switch-console/application/sizing_unit/history_continuity.js"
    );
    const spec = demoFixture.cases["SA1-D7"];
    const res = evaluateHistoryContinuity(spec.input);
    assert.ok(validateContinuitySchema(res), `SA1-D7 schema: ${ajv.errorsText(validateContinuitySchema.errors)}`);
    assert.equal(res.continuity_status, spec.expected.continuity_status);
    assert.equal(res.result.status, spec.expected.result_status);
    assert.equal(res.result.return_pct, spec.expected.return_pct);
    assert.equal(res.gap_intervals.length > 0, spec.expected.has_gaps);
  },

  async "SA1-D8"() {
    const { evaluateSizingUnitCohort } = await import(
      "../web/strategy-switch-console/application/sizing_unit/nav.js"
    );
    const { createPinnedCalendarProvider } = await import(
      "../web/strategy-switch-console/application/sizing_unit/freshness.js"
    );
    const { buildAccountFactsContinuityReadModel } = await import(
      "../web/strategy-switch-console/application/account_facts/read.js"
    );
    const { projectDesk7aPerformance } = await import(
      "../web/strategy-switch-console/application/desk/performance.js"
    );
    const { projectDesk7aOverview } = await import(
      "../web/strategy-switch-console/application/desk/overview.js"
    );

    let storageWrites = 0;
    let kvWrites = 0;
    const spyKv = {
      async get() { return null; },
      async put() { kvWrites++; throw new Error("forbidden_kv_write_on_read"); },
      async delete() { kvWrites++; throw new Error("forbidden_kv_delete_on_read"); },
    };
    const spySql = {
      exec(query) {
        if (!/^\s*SELECT\b/i.test(String(query))) {
          storageWrites++;
          throw new Error("forbidden_sql_write_on_read");
        }
        return { toArray: () => [] };
      },
    };
    const spyDeps = {
      kv: spyKv,
      sql: spySql,
      now: () => Date.parse("2025-01-08T21:01:00.000Z"),
    };
    const provider = createPinnedCalendarProvider(pinnedCalendar);
    evaluateSizingUnitCohort(demoFixture.cases["SA1-D6"].accounts, {
      evaluated_at: demoFixture.cases["SA1-D6"].evaluated_at,
      calendarProvider: provider,
    });
    buildAccountFactsContinuityReadModel(demoFixture.cases["SA1-D7"].input, spyDeps);
    projectDesk7aPerformance({
      initialState: demoFixture.cases["SA1-D1"].deposit_case.initial_state,
      sessions: [demoFixture.cases["SA1-D1"].deposit_case.session],
      calendarProvider: provider,
    });
    projectDesk7aOverview({
      initialState: demoFixture.cases["SA1-D1"].deposit_case.initial_state,
      session: demoFixture.cases["SA1-D1"].deposit_case.session,
      calendarProvider: provider,
    });
    assert.equal(storageWrites, demoFixture.cases["SA1-D8"].expected.storage_writes);
    assert.equal(kvWrites, demoFixture.cases["SA1-D8"].expected.kv_writes);
  },
};

const ids = requestedCase ? [requestedCase] : Object.keys(handlers);
let failures = 0;
for (const id of ids) {
  const fn = handlers[id];
  if (!fn) {
    console.error(`[FAIL] ${id}: unknown demo case`);
    failures++;
    continue;
  }
  try {
    await fn();
    console.log(`[PASS] ${id}: ${demoFixture.cases[id].title}`);
  } catch (err) {
    failures++;
    console.error(`[FAIL] ${id}: ${err?.code || err?.name || "Error"}: ${err?.message || err}`);
  }
}
if (failures > 0) {
  console.error(`sa1_demo_validation: FAILED (${failures}/${ids.length} cases failed)`);
  process.exit(1);
}
console.log(`sa1_demo_validation: PASS (${ids.length}/${ids.length} cases passed)`);
