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
const deskCommonSchema = loadJson("../schemas/desk/common.json");
const deskN1CommonSchema = loadJson("../schemas/desk/n1-common.json");
const deskOverviewSchema = loadJson("../schemas/desk/overview.json");
const deskPerfSchema = loadJson("../schemas/desk/performance.json");
const deskN1OverviewSchema = loadJson("../schemas/desk/n1-overview.json");
const deskN1PerfSchema = loadJson("../schemas/desk/n1-performance.json");
const pinnedCalendar = loadJson("./fixtures/sa1/csa22_pinned_vectors_2025.json");
const acceptanceFixture = loadJson("./fixtures/sa1/sa1_acceptance_cases.json");

const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
addFormats(ajv);
for (const schema of [
  deskCommonSchema,
  deskN1CommonSchema,
  deskOverviewSchema,
  deskPerfSchema,
  deskN1OverviewSchema,
  deskN1PerfSchema,
]) {
  ajv.addSchema(schema);
}
const validateNavSchema = ajv.compile(navSchema);
const validateContinuitySchema = ajv.compile(continuitySchema);
const validateCorpActionSchema = ajv.compile(corpActionSchema);
const validateN1PerfSchema = ajv.getSchema(deskN1PerfSchema.$id);
const validateN1OverviewSchema = ajv.getSchema(deskN1OverviewSchema.$id);

assert.equal(pinnedCalendar.metadata.calendar_version, "csa22-v1");
assert.equal(
  pinnedCalendar.metadata.spec_digest,
  "6601c01f2907119c25a2687d4b67210285d3c13ebf2d86a2953745dbd1f6f2af",
);
assert.equal(
  pinnedCalendar.metadata.expected_2025_sha256,
  "154779cb27033937270ef970bc8af9bdc0542a0096d60e0f63ef88c92ec64d6a",
);

const PRIVATE_LOCATOR_RE = new RegExp(
  "(?:source_ref|kv_key|do_key|kv://|do://|/" + "Users/|/" + "home/|broker_account_hash)",
);

const caseArgIndex = process.argv.indexOf("--case");
const requestedCase = caseArgIndex >= 0 ? process.argv[caseArgIndex + 1] : null;

const handlers = {
  async "SA-A01"() {
    const { evaluateTwrLedger, DESK_7A_LABELS } = await import(
      "../web/strategy-switch-console/application/sizing_unit/twr_ledger.js"
    );
    const spec = acceptanceFixture.cases["SA-A01"];
    const std = evaluateTwrLedger({
      initialState: spec.standard_deposit.initial_state,
      sessions: [spec.standard_deposit.session],
    });
    const s = std.sessions[0];
    const e1 = spec.standard_deposit.expected;
    assert.equal(s.raw_asset_change_usd, e1.raw_asset_change_usd);
    assert.equal(std.labels.raw_asset_change, e1.raw_label);
    assert.equal(DESK_7A_LABELS.raw_asset_change, e1.raw_label);
    assert.equal(s.adjusted_pnl_usd, e1.adjusted_pnl_usd);
    assert.equal(s.twr_return, e1.twr_return);
    assert.equal(s.dd_b, e1.dd_b);
    assert.equal(s.e_star_after_usd, e1.e_star_after_usd);
    assert.equal(s.w_ref_usd, e1.w_ref_usd);
    assert.equal(s.l_usd, e1.l_usd);
    assert.equal(s.w_usd, e1.w_usd);
    assert.equal(s.c_t, e1.c_t);
    assert.equal(s.mid_drawdown_deposit_flag, e1.mid_drawdown_deposit_flag);

    const mid = evaluateTwrLedger({
      initialState: spec.mid_drawdown_deposit.initial_state,
      sessions: [spec.mid_drawdown_deposit.session],
    });
    const m = mid.sessions[0];
    const e2 = spec.mid_drawdown_deposit.expected;
    assert.equal(m.raw_asset_change_usd, e2.raw_asset_change_usd);
    assert.equal(m.adjusted_pnl_usd, e2.adjusted_pnl_usd);
    assert.equal(m.twr_return, e2.twr_return);
    assert.equal(m.dd_b, e2.dd_b);
    assert.equal(m.c_t, e2.c_t);
    assert.equal(m.e_star_after_usd, e2.e_star_after_usd);
    assert.equal(m.w_ref_usd, e2.w_ref_usd);
    assert.equal(m.l_usd, e2.l_usd);
    assert.equal(m.w_usd, e2.w_usd);
    assert.equal(m.mid_drawdown_deposit_flag, e2.mid_drawdown_deposit_flag);
    assert.equal(m.flow_audit_events.length, 1);
    assert.equal(mid.method_version, null);
  },

  async "SA-A02"() {
    const { evaluateTwrLedger } = await import(
      "../web/strategy-switch-console/application/sizing_unit/twr_ledger.js"
    );
    const spec = acceptanceFixture.cases["SA-A02"];
    const res = evaluateTwrLedger({
      initialState: spec.initial_state,
      sessions: spec.sessions,
    });
    const [w1, w2] = res.sessions;
    const e1 = spec.expected.after_withdrawal;
    assert.equal(w1.raw_asset_change_usd, e1.raw_asset_change_usd);
    assert.equal(w1.adjusted_pnl_usd, e1.adjusted_pnl_usd);
    assert.equal(w1.twr_return, e1.twr_return);
    assert.equal(w1.e_star_after_usd, e1.e_star_after_usd);
    assert.equal(w1.w_star_usd, e1.w_star_usd);
    assert.equal(w1.dd_b, e1.dd_b);
    assert.equal(w1.false_loss_trip, e1.false_loss_trip);

    const e2 = spec.expected.after_gain;
    assert.equal(w2.w_ref_usd, e2.w_ref_after_usd);
    assert.equal(w2.w_star_usd, e2.w_star_usd);
    assert.notEqual(w2.w_ref_usd, w2.w_star_usd);
    assert.equal(w2.dd_b, e2.dd_b);
    assert.equal(w2.c_t, e2.c_t);
    assert.equal(w2.false_loss_trip, e2.false_loss_trip);

    const hRes = evaluateTwrLedger({
      initialState: spec.nonzero_h_withdrawal.initial_state,
      sessions: [spec.nonzero_h_withdrawal.session],
    });
    const wh = hRes.sessions[0];
    const eh = spec.expected.nonzero_h;
    assert.equal(wh.e_star_after_usd, eh.e_star_after_usd);
    assert.equal(wh.w_star_usd, eh.w_star_usd);
    assert.equal(wh.w_ref_usd, eh.w_ref_usd);
    assert.equal(wh.l_usd, eh.l_usd);
    assert.equal(wh.w_usd, eh.w_usd);
    assert.equal(wh.dd_b, eh.dd_b);
    assert.equal(wh.c_t, eh.c_t);
    assert.equal(wh.false_loss_trip, eh.false_loss_trip);
  },

  async "SA-A03"() {
    const {
      createCorporateActionLedger,
      applyCorporateAction,
      serializeCorporateActionLedger,
      hydrateCorporateActionLedger,
      reconcileV2Broker,
      evaluateTierChangeInvariance,
    } = await import("../web/strategy-switch-console/application/sizing_unit/corporate_actions.js");
    const spec = acceptanceFixture.cases["SA-A03"];
    let ledger = createCorporateActionLedger(spec.initial_ledger);
    const appliedEvents = new Map();

    for (const sub of spec.subcases) {
      if (sub.name === "duplicate_event_replay") {
        const priorDigest = serializeCorporateActionLedger(ledger).ledger_digest;
        const dup = applyCorporateAction(ledger, appliedEvents.get(sub.replay_event_id));
        assert.equal(dup.ok, true);
        assert.equal(dup.replayed, true);
        assert.equal(dup.external_flow_delta, "0");
        assert.equal(serializeCorporateActionLedger(dup.ledger).ledger_digest, priorDigest);
        // Restart hydration invariance check
        const hydrated = hydrateCorporateActionLedger(serializeCorporateActionLedger(dup.ledger));
        const afterRestart = applyCorporateAction(hydrated, appliedEvents.get(sub.replay_event_id));
        assert.equal(afterRestart.replayed, true);
        assert.equal(serializeCorporateActionLedger(afterRestart.ledger).ledger_digest, priorDigest);
        // Tier change invariance check
        const tierChecked = evaluateTierChangeInvariance(afterRestart.ledger, "0.50");
        assert.equal(tierChecked.dd_b, spec.expected.dd_b);
        assert.equal(tierChecked.w_ref_usd, ledger.loss_memory.w_ref_usd);
        assert.equal(tierChecked.l_usd, ledger.loss_memory.l_usd);
        ledger = afterRestart.ledger;
        continue;
      }
      if (sub.name === "v2_halt_and_reconcile") {
        assert.ok(validateCorpActionSchema(sub.halt_event));
        const haltRes = applyCorporateAction(ledger, sub.halt_event);
        assert.equal(haltRes.ok, true);
        assert.equal(haltRes.v2.halted, true);
        assert.equal(haltRes.v2.auto_cleared, false);
        assert.equal(haltRes.v2.human_rearm_required, true);

        const mismatchRes = reconcileV2Broker(haltRes.ledger, "inst_tqqq", sub.mismatch_reconcile);
        assert.equal(mismatchRes.v2.auto_cleared, false);
        assert.equal(mismatchRes.v2.halted, true);
        assert.equal(mismatchRes.v2.human_rearm_required, true);

        const exactRes = reconcileV2Broker(mismatchRes.ledger, "inst_tqqq", sub.exact_match_reconcile);
        assert.equal(exactRes.v2.auto_cleared, true);
        assert.equal(exactRes.v2.halted, false);
        assert.equal(exactRes.v2.state, "CLEAR");
        ledger = exactRes.ledger;
        continue;
      }
      assert.ok(validateCorpActionSchema(sub.event), `${sub.name} schema invalid: ${ajv.errorsText(validateCorpActionSchema.errors)}`);
      const res = applyCorporateAction(ledger, sub.event);
      assert.equal(res.ok, true, `${sub.name} failed: ${res.reason}`);
      assert.equal(res.external_flow_delta, "0");
      assert.equal(res.phantom_return, "0");
      assert.equal(res.phantom_drawdown, "0");
      assert.equal(res.ledger.loss_memory.dd_b, spec.expected.dd_b);
      appliedEvents.set(sub.event.event_id, sub.event);
      ledger = res.ledger;
    }

    assert.equal(ledger.settled_cash_usd, spec.expected.settled_cash_after_usd);
    assert.equal(ledger.dividend_receivable_usd, spec.expected.dividend_receivable_after_usd);
    assert.equal(ledger.positions.inst_rename.symbol, "NEWT");
    assert.equal(ledger.positions.inst_rename.instrument_id, "inst_rename");
    assert.equal(ledger.positions.inst_delist.unresolved_pending_evidence, spec.expected.v3_unresolved);
    assert.equal(ledger.v3.triggered, true);

    // Negative check: broken conservation equation fails atomically without mutation
    const broken = structuredClone(spec.subcases[0].event);
    broken.event_id = "ca-a03-broken";
    broken.post_ref = "999.00";
    const beforeDigest = serializeCorporateActionLedger(ledger).ledger_digest;
    const rejected = applyCorporateAction(ledger, broken);
    assert.equal(rejected.ok, false);
    assert.equal(serializeCorporateActionLedger(ledger).ledger_digest, beforeDigest);
  },

  async "SA-A06"() {
    const { createPinnedCalendarProvider, evaluateFreshness } = await import(
      "../web/strategy-switch-console/application/sizing_unit/freshness.js"
    );
    const provider = createPinnedCalendarProvider(pinnedCalendar);
    for (const vec of acceptanceFixture.cases["SA-A06"].vectors) {
      const res = evaluateFreshness(
        {
          observed_at: vec.observed_at,
          fetched_at: vec.fetched_at,
          evaluated_at: vec.evaluated_at,
          last_observed_value: vec.last_observed_value ?? null,
        },
        { calendarProvider: provider },
      );
      if (vec.expected.data_status !== undefined) assert.equal(res.data_status, vec.expected.data_status, vec.name);
      if (vec.expected.age_seconds !== undefined) assert.equal(res.age_seconds, vec.expected.age_seconds, vec.name);
      if (vec.expected.age_sessions !== undefined) assert.equal(res.age_sessions, vec.expected.age_sessions, vec.name);
      if (vec.expected.sizing_eligible !== undefined) assert.equal(res.sizing_eligible, vec.expected.sizing_eligible, vec.name);
      if (vec.expected.o1_block_exposure_increase !== undefined) {
        assert.equal(res.o1_block_exposure_increase, vec.expected.o1_block_exposure_increase, vec.name);
      }
      if (vec.expected.display_preserved) {
        assert.equal(res.display.last_observed_value, vec.last_observed_value, vec.name);
        assert.equal(res.display.last_observed_at, vec.observed_at, vec.name);
        assert.equal(res.display.age_seconds, vec.expected.age_seconds, vec.name);
      }
    }
    // Missing calendar provider also fails closed
    const noCal = evaluateFreshness(
      {
        observed_at: "2025-01-08T21:00:00.000Z",
        fetched_at: "2025-01-08T21:00:01.000Z",
        evaluated_at: "2025-01-08T21:00:30.000Z",
        last_observed_value: "50000.00",
      },
      { calendarProvider: null },
    );
    assert.equal(noCal.data_status, "unavailable");
    assert.equal(noCal.sizing_eligible, false);
    assert.equal(noCal.display.last_observed_value, "50000.00");
  },

  async "SA-A07"() {
    const { evaluatePeriod7aReturn, evaluateTwrLedger } = await import(
      "../web/strategy-switch-console/application/sizing_unit/twr_ledger.js"
    );
    for (const sub of acceptanceFixture.cases["SA-A07"].subcases) {
      const res = sub.valuations
        ? evaluateTwrLedger({
          initialState: { e_prev_usd: "50000.00", e_star_prev_usd: "50000.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
          valuations: sub.valuations,
          flows: sub.flows,
        })
        : evaluatePeriod7aReturn(sub);
      assert.equal(res.return_pct, sub.expected.return_pct, sub.name);
      assert.equal(res.status, sub.expected.status, sub.name);
      assert.equal(res.interpolated, sub.expected.interpolated, sub.name);
      assert.equal(res.empty_as_zero, sub.expected.empty_as_zero, sub.name);
      assert.ok(typeof res.unavailable_reason === "string" && res.unavailable_reason.length > 0, sub.name);
    }
  },

  async "SA-A08"() {
    const { evaluateSizingUnitNav, evaluateSizingUnitCohort } = await import(
      "../web/strategy-switch-console/application/sizing_unit/nav.js"
    );
    const { createPinnedCalendarProvider } = await import(
      "../web/strategy-switch-console/application/sizing_unit/freshness.js"
    );
    const provider = createPinnedCalendarProvider(pinnedCalendar);
    const spec = acceptanceFixture.cases["SA-A08"];
    const single = evaluateSizingUnitNav(spec.single_account_multi_currency, { calendarProvider: provider });
    assert.ok(validateNavSchema(single), ajv.errorsText(validateNavSchema.errors));
    assert.equal(single.status, spec.expected.status);
    assert.equal(single.reason, spec.expected.reason);
    assert.equal(single.nav_usd, spec.expected.nav_usd);
    assert.equal(single.currency_coercion, spec.expected.currency_coercion);
    assert.equal(single.fx_inferred, spec.expected.fx_inferred);
    assert.equal(single.observations[0].observed_at, spec.single_account_multi_currency.observed_at);

    const cohort = evaluateSizingUnitCohort(spec.cohort_multi_currency, {
      evaluated_at: spec.evaluated_at,
      calendarProvider: provider,
    });
    assert.ok(validateNavSchema(cohort), ajv.errorsText(validateNavSchema.errors));
    assert.equal(cohort.status, spec.expected.status);
    assert.equal(cohort.reason, spec.expected.reason);
    assert.equal(cohort.nav_usd, null);
    assert.equal(cohort.fx_inferred, false);
    assert.deepEqual(
      cohort.observations.map((o) => o.observed_at),
      spec.cohort_multi_currency.map((a) => a.observed_at),
    );
  },

  async "SA-A09"() {
    const { evaluateSizingUnitCohort } = await import(
      "../web/strategy-switch-console/application/sizing_unit/nav.js"
    );
    const { createPinnedCalendarProvider } = await import(
      "../web/strategy-switch-console/application/sizing_unit/freshness.js"
    );
    const { projectSizingUnitAccountFacts } = await import(
      "../web/strategy-switch-console/account_facts.js"
    );
    const provider = createPinnedCalendarProvider(pinnedCalendar);
    const spec = acceptanceFixture.cases["SA-A09"];
    const res = evaluateSizingUnitCohort(spec.accounts, {
      evaluated_at: spec.evaluated_at,
      calendarProvider: provider,
      require_live_cohort: true,
    });
    assert.ok(validateNavSchema(res), ajv.errorsText(validateNavSchema.errors));
    for (const [k, v] of Object.entries(spec.expected)) {
      if (k === "excluded_count") {
        assert.equal(res.cohort.excluded_count, v);
      } else {
        assert.equal(res[k], v, `SA-A09.${k}`);
      }
    }
    assert.equal(PRIVATE_LOCATOR_RE.test(JSON.stringify(res)), false, "Private locator leaked into SA-A09 output");

    const projected = projectSizingUnitAccountFacts(spec.accounts, {
      evaluated_at: spec.evaluated_at,
      calendarProvider: provider,
    });
    assert.equal(projected.nav_usd, spec.expected.nav_usd);
    assert.equal(PRIVATE_LOCATOR_RE.test(JSON.stringify(projected)), false);
  },

  async "SA-A10"() {
    const { evaluatePeriod7aReturn, orderObservationsChronologically } = await import(
      "../web/strategy-switch-console/application/sizing_unit/twr_ledger.js"
    );
    const { cashflowCurrencyResult } = await import(
      "../web/strategy-switch-console/application/console_api/cashflow_performance.js"
    );
    const { projectDesk7aPerformance } = await import(
      "../web/strategy-switch-console/application/desk/performance.js"
    );
    const { projectDesk7aOverview } = await import(
      "../web/strategy-switch-console/application/desk/overview.js"
    );
    const spec = acceptanceFixture.cases["SA-A10"];
    const exactTwr = evaluatePeriod7aReturn(spec.volatile_midmonth);
    assert.equal(exactTwr.return_method, spec.expected.twr_method);
    assert.equal(exactTwr.twr_return, spec.expected.twr_return);
    assert.equal(exactTwr.return_pct, spec.expected.twr_return_pct);
    assert.equal(exactTwr.approximate, spec.expected.twr_approximate);
    assert.equal(exactTwr.sizing_eligible, spec.expected.twr_sizing_eligible);
    assert.equal(exactTwr.method_version, spec.expected.method_version);

    const withoutSubval = { ...spec.volatile_midmonth, intraday_subvaluations: [] };
    const dietzFallback = evaluatePeriod7aReturn(withoutSubval);
    assert.equal(dietzFallback.return_method, spec.expected.dietz_method);
    assert.equal(dietzFallback.approximate, spec.expected.dietz_approximate);
    assert.equal(dietzFallback.sizing_eligible, spec.expected.dietz_sizing_eligible);
    assert.equal(dietzFallback.breaker_eligible, false);
    assert.equal(dietzFallback.verdict_eligible, false);
    assert.equal(dietzFallback.method_version, null);
    assert.equal(Number(dietzFallback.return_pct) > 0, spec.expected.dietz_return_approx_positive);
    assert.notEqual(exactTwr.return_pct, dietzFallback.return_pct);

    // Chronological epoch-ms ordering check (".500Z" after "Z", "-05:00" offset honored)
    const ordered = orderObservationsChronologically(spec.chronological_timestamps);
    assert.deepEqual(
      ordered.map((x) => x.id),
      ["whole_second", "later_fraction", "offset_newest"],
    );

    // Verify cashflowCurrencyResult marks Dietz fallback non-sizing-eligible
    const dietzApi = cashflowCurrencyResult(
      [
        {
          id: "synth-1",
          currency: "USD",
          points: [
            { date: "2025-01-02", value: 100, observed_at: "2025-01-02T21:00:00.000Z" },
            { date: "2025-01-04", value: 225, observed_at: "2025-01-04T21:00:00.000Z" },
          ],
          externalFlow: {
            schema_version: "external_flow.v1",
            windows: [
              {
                currency: "USD",
                date: "2025-01-04",
                period_start: "2025-01-02T21:00:00.000Z",
                period_end: "2025-01-04T21:00:00.000Z",
                source: "ibkr_flex",
                coverage: "complete",
                records: [
                  {
                    source_ref: "b".repeat(64),
                    type: "deposit",
                    amount: "100",
                    effective_at: "2025-01-03T21:00:00.000Z",
                    settlement_date: "2025-01-03",
                    transfer_ref: null,
                  },
                ],
              },
            ],
          },
        },
      ],
      { range: "ALL", today: "2025-01-05" },
    );
    assert.equal(dietzApi.approximate, true);
    assert.equal(dietzApi.sizing_eligible, false);
    assert.equal(dietzApi.method_version, null);

    // Verify Desk 7A separation in desk/performance.js and desk/overview.js + schema compliance
    const perf7a = projectDesk7aPerformance({
      initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
      sessions: [
        {
          period_start_utc: spec.volatile_midmonth.period_start_utc,
          period_end_utc: spec.volatile_midmonth.period_end_utc,
          ending_equity_usd: spec.volatile_midmonth.ending_equity_usd,
          intraday_subvaluations: spec.volatile_midmonth.intraday_subvaluations,
          flows: spec.volatile_midmonth.flows,
        },
      ],
    });
    assert.ok(perf7a.cashflow_7a.raw_asset_change.label.includes("Asset change (includes cash flows)"));
    assert.ok(perf7a.cashflow_7a.adjusted_performance.label.includes("Cash-flow-adjusted"));
    assert.equal(perf7a.cashflow_7a.adjusted_performance.method_version, null);
    if (perf7a.n1_envelope) {
      assert.ok(validateN1PerfSchema(perf7a.n1_envelope), ajv.errorsText(validateN1PerfSchema.errors));
    }

    const overview7a = projectDesk7aOverview({
      initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
      session: {
        period_start_utc: spec.volatile_midmonth.period_start_utc,
        period_end_utc: spec.volatile_midmonth.period_end_utc,
        ending_equity_usd: spec.volatile_midmonth.ending_equity_usd,
        intraday_subvaluations: spec.volatile_midmonth.intraday_subvaluations,
        flows: spec.volatile_midmonth.flows,
      },
    });
    assert.ok(overview7a.cashflow_7a.raw_asset_change.label.includes("Asset change (includes cash flows)"));
    assert.equal(overview7a.cashflow_7a.adjusted_performance.method_version, null);
    if (overview7a.n1_envelope) {
      assert.ok(validateN1OverviewSchema(overview7a.n1_envelope), ajv.errorsText(validateN1OverviewSchema.errors));
    }
  },

  async "SA-A11"() {
    const { evaluateHistoryContinuity } = await import(
      "../web/strategy-switch-console/application/sizing_unit/history_continuity.js"
    );
    for (const sub of acceptanceFixture.cases["SA-A11"].subcases) {
      const res = evaluateHistoryContinuity(sub.input);
      assert.ok(validateContinuitySchema(res), `${sub.name} schema: ${ajv.errorsText(validateContinuitySchema.errors)}`);
      if (sub.expected.retention_truncated !== undefined) {
        assert.equal(res.retention_clip.truncated, sub.expected.retention_truncated, sub.name);
      }
      if (sub.expected.desk_truncated !== undefined) {
        assert.equal(res.desk_window_clip.truncated, sub.expected.desk_truncated, sub.name);
      }
      if (sub.expected.truncated !== undefined) {
        assert.equal(res.truncated, sub.expected.truncated, sub.name);
      }
      if (sub.expected.continuity_status !== undefined) {
        assert.equal(res.continuity_status, sub.expected.continuity_status, sub.name);
      }
      assert.equal(res.result.status, sub.expected.result_status, sub.name);
      if (sub.expected.return_pct === null) assert.equal(res.result.return_pct, null, sub.name);
      assert.equal(res.gap_intervals.length > 0, sub.expected.has_gaps, sub.name);
    }
  },
};

const ids = requestedCase ? [requestedCase] : Object.keys(handlers);
let failures = 0;
for (const id of ids) {
  const fn = handlers[id];
  if (!fn) {
    console.error(`[FAIL] ${id}: unknown acceptance case`);
    failures++;
    continue;
  }
  try {
    await fn();
    console.log(`[PASS] ${id}: ${acceptanceFixture.cases[id].title}`);
  } catch (err) {
    failures++;
    console.error(`[FAIL] ${id}: ${err?.code || err?.name || "Error"}: ${err?.message || err}`);
  }
}
if (failures > 0) {
  console.error(`sa1_sizing_contracts_validation: FAILED (${failures}/${ids.length} cases failed)`);
  process.exit(1);
}
console.log(`sa1_sizing_contracts_validation: PASS (${ids.length}/${ids.length} cases passed)`);
