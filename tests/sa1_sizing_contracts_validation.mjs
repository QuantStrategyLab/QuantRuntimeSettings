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
    const { createPinnedCalendarProvider } = await import(
      "../web/strategy-switch-console/application/sizing_unit/freshness.js"
    );
    const provider = createPinnedCalendarProvider(pinnedCalendar);
    const spec = acceptanceFixture.cases["SA-A01"];
    const std = evaluateTwrLedger({
      initialState: spec.standard_deposit.initial_state,
      sessions: [spec.standard_deposit.session],
      calendarProvider: provider,
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
      calendarProvider: provider,
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

    // P1 regression: omitted flows fails closed (never defaults to [] / +20% deposit profit)
    const { flows: _omitted, ...sessionNoFlows } = spec.standard_deposit.session;
    const missingFlows = evaluateTwrLedger({
      initialState: spec.standard_deposit.initial_state,
      sessions: [sessionNoFlows],
    });
    assert.equal(missingFlows.sizing_eligible, false);
    assert.equal(missingFlows.return_pct, null);
    // P1 regression: empty valuation periods never return 0% / sizing_eligible: true
    const emptyPeriods = evaluateTwrLedger({
      initialState: spec.standard_deposit.initial_state,
      sessions: [],
    });
    assert.equal(emptyPeriods.status, "unavailable");
    assert.equal(emptyPeriods.return_pct, null);
    assert.equal(emptyPeriods.sizing_eligible, false);
  },

  async "SA-A02"() {
    const { evaluateTwrLedger } = await import(
      "../web/strategy-switch-console/application/sizing_unit/twr_ledger.js"
    );
    const { createPinnedCalendarProvider } = await import(
      "../web/strategy-switch-console/application/sizing_unit/freshness.js"
    );
    const provider = createPinnedCalendarProvider(pinnedCalendar);
    const spec = acceptanceFixture.cases["SA-A02"];
    const res = evaluateTwrLedger({
      initialState: spec.initial_state,
      sessions: spec.sessions,
      calendarProvider: provider,
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
      calendarProvider: provider,
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

    // P1 regression: unapplied 2:1 split (unchanged 100 units / 150.00 ref) must fail & halt
    const unappliedSplit = structuredClone(spec.subcases[0].event);
    unappliedSplit.event_id = "ca-a03-unapplied-split";
    unappliedSplit.post_units = "100";
    unappliedSplit.post_ref = "150.00";
    const freshSplitLedger = createCorporateActionLedger(spec.initial_ledger);
    const unappliedRes = applyCorporateAction(freshSplitLedger, unappliedSplit);
    assert.equal(unappliedRes.ok, false);
    assert.equal(unappliedRes.v2.halted, true);
    assert.equal(unappliedRes.ledger.v2.halted, true);
    assert.equal(unappliedRes.ledger.v2.state, "HALT");
    assert.equal(unappliedRes.ledger.positions.inst_tqqq.units, "100");
    assert.equal(unappliedRes.ledger.applied_events.length, 0);
    // S8: V2 HALT persists across serialize/hydrate after rejected unapplied split
    const roundTripHalted = hydrateCorporateActionLedger(serializeCorporateActionLedger(unappliedRes.ledger));
    assert.equal(roundTripHalted.v2.halted, true);
    assert.equal(roundTripHalted.v2.state, "HALT");
    assert.equal(roundTripHalted.v2.halted_instruments.some((h) => h.instrument_id === "inst_tqqq"), true);

    // S8: Failed reconciliation on inst_a records halted_instruments so reconciling inst_b cannot clear HALT
    const failRecA = reconcileV2Broker(freshSplitLedger, "inst_tqqq", {
      broker_reconciled: "mismatch",
      broker_ledger: { adjusted_equity_usd: "23500.00", shares: "999", hwm_usd: spec.initial_ledger.loss_memory.w_ref_usd },
    });
    assert.equal(failRecA.v2.halted, true);
    assert.equal(failRecA.ledger.v2.halted_instruments.some((h) => h.instrument_id === "inst_tqqq"), true);
    const totalEq = "22500.00";
    const clearRecB = reconcileV2Broker(failRecA.ledger, "inst_soxl", {
      broker_reconciled: "exact_match",
      broker_ledger: { adjusted_equity_usd: totalEq, shares: "10", hwm_usd: spec.initial_ledger.loss_memory.w_ref_usd },
    });
    assert.equal(clearRecB.ok, false);
    assert.equal(clearRecB.v2.halted, true);
    assert.equal(clearRecB.v2.state, "HALT");
    assert.equal(clearRecB.v2.human_rearm_required, true);

    // R3-3 / S8-a: sequential mismatches on A then B persist both in halted_instruments across hydrate;
    // reconciling only A leaves ledger halted on B until B also reconciles cleanly.
    const seqExactEq = "23500.00";
    const seqFailA = reconcileV2Broker(freshSplitLedger, "inst_tqqq", {
      broker_reconciled: "mismatch",
      broker_ledger: { adjusted_equity_usd: seqExactEq, shares: "999", hwm_usd: spec.initial_ledger.loss_memory.w_ref_usd },
    });
    const seqFailB = reconcileV2Broker(seqFailA.ledger, "inst_soxl", {
      broker_reconciled: "mismatch",
      broker_ledger: { adjusted_equity_usd: seqExactEq, shares: "99", hwm_usd: spec.initial_ledger.loss_memory.w_ref_usd },
    });
    const seqHydrated = hydrateCorporateActionLedger(serializeCorporateActionLedger(seqFailB.ledger));
    assert.equal(seqHydrated.v2.halted_instruments.some((h) => h.instrument_id === "inst_tqqq"), true);
    assert.equal(seqHydrated.v2.halted_instruments.some((h) => h.instrument_id === "inst_soxl"), true);
    const seqClearA = reconcileV2Broker(seqHydrated, "inst_tqqq", {
      broker_reconciled: "exact_match",
      broker_ledger: { adjusted_equity_usd: seqExactEq, shares: "100", hwm_usd: spec.initial_ledger.loss_memory.w_ref_usd },
    });
    assert.equal(seqClearA.ok, false);
    assert.equal(seqClearA.v2.state, "HALT");
    assert.equal(seqClearA.v2.halted_instruments.some((h) => h.instrument_id === "inst_soxl"), true);
    assert.equal(seqClearA.v2.halted_instruments.some((h) => h.instrument_id === "inst_tqqq"), false);
    const seqClearB = reconcileV2Broker(seqClearA.ledger, "inst_soxl", {
      broker_reconciled: "exact_match",
      broker_ledger: { adjusted_equity_usd: seqExactEq, shares: "10", hwm_usd: spec.initial_ledger.loss_memory.w_ref_usd },
    });
    assert.equal(seqClearB.ok, true);
    assert.equal(seqClearB.v2.state, "CLEAR");

    // R3-4 / S8-b: announced split within 2 sessions failing pre_state_mismatch triggers V2 HALT
    const preMismatchSplit = structuredClone(spec.subcases[0].event);
    preMismatchSplit.event_id = "ca-a03-pre-mismatch-halt";
    preMismatchSplit.pre_ref = "149.99";
    preMismatchSplit.post_ref = "74.995";
    preMismatchSplit.v2_control.announced_within_two_sessions = true;
    const preMismatchRes = applyCorporateAction(freshSplitLedger, preMismatchSplit);
    assert.equal(preMismatchRes.ok, false);
    assert.equal(preMismatchRes.reason, "pre_state_mismatch");
    assert.equal(preMismatchRes.v2.state, "HALT");
    assert.equal(preMismatchRes.ledger.v2.state, "HALT");
    assert.equal(preMismatchRes.ledger.v2.halted_instruments.some((h) => h.instrument_id === "inst_tqqq"), true);
    assert.equal(preMismatchRes.ledger.positions.inst_tqqq.ref_price_usd, "150.00");

    // S9: accrue dividend on OLDT -> ticker_change OLDT->NEWT -> settle dividend on NEWT succeeds
    let renameLedger = createCorporateActionLedger(spec.initial_ledger);
    const renameExDiv = structuredClone(spec.subcases[2].event);
    renameExDiv.event_id = "ca-a03-s9-div-ex";
    renameExDiv.instrument_id = "inst_rename";
    renameExDiv.symbol = "OLDT";
    renameExDiv.pre_units = "50";
    renameExDiv.post_units = "50";
    renameExDiv.pre_ref = "40.00";
    renameExDiv.post_ref = "38.00";
    renameExDiv.eligible_units = "50";
    renameExDiv.dividend_per_unit_usd = "2.00";
    const rStep1 = applyCorporateAction(renameLedger, renameExDiv);
    assert.equal(rStep1.ok, true);
    assert.equal(rStep1.ledger.dividend_receivable_usd, "100.00");

    const renameEvt = structuredClone(spec.subcases.find((s) => s.name === "ticker_change").event);
    renameEvt.event_id = "ca-a03-s9-rename";
    renameEvt.pre_ref = "38.00";
    renameEvt.post_ref = "38.00";
    const rStep2 = applyCorporateAction(rStep1.ledger, renameEvt);
    assert.equal(rStep2.ok, true);
    assert.equal(rStep2.ledger.positions.inst_rename.symbol, "NEWT");

    const renamePay = structuredClone(spec.subcases[3].event);
    renamePay.event_id = "ca-a03-s9-div-pay";
    renamePay.instrument_id = "inst_rename";
    renamePay.symbol = "NEWT";
    renamePay.pre_units = "50";
    renamePay.post_units = "50";
    renamePay.pre_ref = "38.00";
    renamePay.post_ref = "38.00";
    renamePay.eligible_units = "50";
    const rStep3 = applyCorporateAction(rStep2.ledger, renamePay);
    assert.equal(rStep3.ok, true, `S9 failed: ${rStep3.reason}`);
    assert.equal(rStep3.ledger.dividend_receivable_usd, "0");
    assert.equal(rStep3.ledger.settled_cash_usd, "1100.00");

    // R3-5 / S9: dividend_payment carrying prior historical symbol OLDT settles NEWT receivable, while FAKE still fails
    const fakePay = structuredClone(renamePay);
    fakePay.event_id = "ca-a03-s9-div-fake";
    fakePay.symbol = "FAKE";
    const fakePayRes = applyCorporateAction(rStep2.ledger, fakePay);
    assert.equal(fakePayRes.ok, false);
    assert.equal(fakePayRes.reason, "instrument_symbol_mismatch");
    const histPay = structuredClone(renamePay);
    histPay.event_id = "ca-a03-s9-div-pay-hist";
    histPay.symbol = "OLDT";
    const histPayRes = applyCorporateAction(rStep2.ledger, histPay);
    assert.equal(histPayRes.ok, true, `R3-5 historical symbol payment failed: ${histPayRes.reason}`);
    assert.equal(histPayRes.ledger.dividend_receivable_usd, "0");
    assert.equal(histPayRes.ledger.settled_cash_usd, "1100.00");

    // P1 regression: cross-symbol dividend settlement cannot clear inst_dist's receivable
    const exDiv = applyCorporateAction(freshSplitLedger, spec.subcases[2].event);
    assert.equal(exDiv.ok, true);

    // R4-4: dividend_payment cannot rewrite share count or ref price via equal notional (100*49 -> 200*24.50)
    const shareRewritePay = structuredClone(spec.subcases[3].event);
    shareRewritePay.event_id = "ca-a03-r4-share-rewrite";
    shareRewritePay.post_units = "200";
    shareRewritePay.post_ref = "24.50";
    const shareRewriteRes = applyCorporateAction(exDiv.ledger, shareRewritePay);
    assert.equal(shareRewriteRes.ok, false);
    assert.equal(shareRewriteRes.reason, "unexpected_position_change_on_payment");
    assert.equal(shareRewriteRes.ledger.positions.inst_dist.units, "100");
    assert.equal(shareRewriteRes.ledger.positions.inst_dist.ref_price_usd, "49.00");
    assert.equal(shareRewriteRes.ledger.dividend_receivable_usd, "100.00");

    // R4-3 / S8-b: dividend_payment with altered post_ref triggers V2 HALT under announced_within_two_sessions or price_anomaly_detected
    for (const flagKey of ["announced_within_two_sessions", "price_anomaly_detected"]) {
      const payHaltEvt = structuredClone(spec.subcases[3].event);
      payHaltEvt.event_id = `ca-a03-r4-pay-halt-${flagKey}`;
      payHaltEvt.post_ref = "48.00";
      payHaltEvt.v2_control[flagKey] = true;
      const payHaltRes = applyCorporateAction(exDiv.ledger, payHaltEvt);
      assert.equal(payHaltRes.ok, false);
      assert.equal(payHaltRes.reason, "unexpected_position_change_on_payment");
      assert.equal(payHaltRes.v2.state, "HALT", flagKey);
      assert.equal(payHaltRes.ledger.v2.state, "HALT", flagKey);
      assert.equal(payHaltRes.ledger.v2.halted_instruments.some((h) => h.instrument_id === "inst_dist"), true, flagKey);
    }

    const crossPay = structuredClone(spec.subcases[3].event);
    crossPay.event_id = "ca-a03-cross-pay";
    crossPay.instrument_id = "inst_soxl";
    crossPay.symbol = "SOXL";
    crossPay.pre_units = "10";
    crossPay.post_units = "10";
    crossPay.pre_ref = "20.00";
    crossPay.post_ref = "20.00";
    const crossRes = applyCorporateAction(exDiv.ledger, crossPay);
    assert.equal(crossRes.ok, false);
    assert.equal(crossRes.ledger.dividend_receivable_usd, "100.00");

    // P1 regression: reconciling wrong symbol (inst_soxl) never clears inst_tqqq V2 HALT
    const haltedState = applyCorporateAction(
      createCorporateActionLedger({
        ...spec.initial_ledger,
        positions: {
          ...spec.initial_ledger.positions,
          inst_tqqq: { instrument_id: "inst_tqqq", symbol: "TQQQ", units: "200", ref_price_usd: "75.00" },
        },
      }),
      spec.subcases.find((s) => s.name === "v2_halt_and_reconcile").halt_event,
    );
    assert.equal(haltedState.v2.halted, true);
    const wrongSymRec = reconcileV2Broker(haltedState.ledger, "inst_soxl", {
      broker_reconciled: "exact_match",
      broker_ledger: {
        adjusted_equity_usd: "23500.00",
        shares: "10",
        hwm_usd: spec.initial_ledger.loss_memory.w_ref_usd,
      },
    });
    assert.equal(wrongSymRec.ok, false);
    assert.equal(wrongSymRec.v2.halted, true);
    assert.equal(wrongSymRec.v2.state, "HALT");
    assert.equal(wrongSymRec.v2.human_rearm_required, true);

    // R5-2: instrument_symbol_mismatch under v2Triggered triggers V2 HALT
    for (const flagKey of ["announced_within_two_sessions", "price_anomaly_detected"]) {
      const symMismatchPay = structuredClone(spec.subcases[3].event);
      symMismatchPay.event_id = `ca-a03-r5-sym-${flagKey}`;
      symMismatchPay.symbol = "SOXL";
      symMismatchPay.v2_control[flagKey] = true;
      const symMismatchRes = applyCorporateAction(exDiv.ledger, symMismatchPay);
      assert.equal(symMismatchRes.ok, false);
      assert.equal(symMismatchRes.reason, "instrument_symbol_mismatch");
      assert.equal(symMismatchRes.v2.state, "HALT", flagKey);
      assert.equal(symMismatchRes.ledger.v2.state, "HALT", flagKey);
      assert.equal(symMismatchRes.ledger.v2.halted_instruments.some((h) => h.instrument_id === "inst_dist"), true, flagKey);
    }

    // R5-5: cash_dividend and ticker_change cannot rewrite share counts (or ref_price on ticker_change)
    const divDoubleShares = structuredClone(spec.subcases[2].event);
    divDoubleShares.event_id = "ca-a03-r5-cashdiv-rewrite";
    divDoubleShares.post_units = "200";
    divDoubleShares.post_ref = "24.50";
    const divRewriteRes = applyCorporateAction(freshSplitLedger, divDoubleShares);
    assert.equal(divRewriteRes.ok, false);
    assert.equal(divRewriteRes.reason, "unexpected_position_change_on_cash_dividend");
    assert.equal(divRewriteRes.ledger.positions.inst_dist.units, "100");

    const renameDoubleShares = structuredClone(spec.subcases.find((s) => s.name === "ticker_change").event);
    renameDoubleShares.event_id = "ca-a03-r5-rename-rewrite";
    renameDoubleShares.post_units = "100";
    renameDoubleShares.post_ref = "20.00";
    const renameRewriteRes = applyCorporateAction(freshSplitLedger, renameDoubleShares);
    assert.equal(renameRewriteRes.ok, false);
    assert.equal(renameRewriteRes.reason, "ticker_lineage_mismatch");
    assert.equal(renameRewriteRes.ledger.positions.inst_rename.units, "50");

    // R5-8: resolved delisting validates & settles terminal valuation out of position equity
    const unresolvedEvt = spec.subcases.find((s) => s.name === "delisting_v3").event;
    const contradictoryDelist = structuredClone(unresolvedEvt);
    contradictoryDelist.event_id = "ca-a03-r5-delist-contradiction";
    contradictoryDelist.delisting = { invoked_v3: true, resolved: true, terminal_valuation_usd: "0" };
    const contradictoryDelistRes = applyCorporateAction(freshSplitLedger, contradictoryDelist);
    assert.equal(contradictoryDelistRes.ok, false);
    assert.equal(contradictoryDelistRes.reason, "delisting_terminal_valuation_mismatch");

    const zeroResolvedDelist = structuredClone(unresolvedEvt);
    zeroResolvedDelist.event_id = "ca-a03-r5-delist-zero";
    zeroResolvedDelist.post_units = "0";
    zeroResolvedDelist.post_ref = "0";
    zeroResolvedDelist.delisting = { invoked_v3: true, resolved: true, terminal_valuation_usd: "0" };
    assert.ok(validateCorpActionSchema(zeroResolvedDelist));
    const zeroDelistRes = applyCorporateAction(freshSplitLedger, zeroResolvedDelist);
    assert.equal(zeroDelistRes.ok, true, zeroDelistRes.reason);
    assert.equal(zeroDelistRes.ledger.positions.inst_delist.units, "0");
    assert.equal(zeroDelistRes.ledger.positions.inst_delist.ref_price_usd, "0");
    assert.equal(zeroDelistRes.ledger.positions.inst_delist.unresolved_pending_evidence, false);
    assert.equal(zeroDelistRes.ledger.v3.unresolved_instruments.includes("inst_delist"), false);

    const cashResolvedDelist = structuredClone(unresolvedEvt);
    cashResolvedDelist.event_id = "ca-a03-r5-delist-cash";
    cashResolvedDelist.post_units = "0";
    cashResolvedDelist.post_ref = "0";
    cashResolvedDelist.delisting = { invoked_v3: true, resolved: true, terminal_valuation_usd: "75.00" };
    assert.ok(validateCorpActionSchema(cashResolvedDelist));
    const cashDelistRes = applyCorporateAction(freshSplitLedger, cashResolvedDelist);
    assert.equal(cashDelistRes.ok, true, cashDelistRes.reason);
    assert.equal(cashDelistRes.ledger.positions.inst_delist.units, "0");
    assert.equal(cashDelistRes.ledger.settled_cash_usd, "1075.00");

    // R6-3 / R5-8a: cannot settle an already delisted/empty zero-unit position a second time
    const repeatDelist = structuredClone(unresolvedEvt);
    repeatDelist.event_id = "ca-a03-r6-delist-repeat";
    repeatDelist.pre_units = "0";
    repeatDelist.post_units = "0";
    repeatDelist.pre_ref = "0";
    repeatDelist.post_ref = "0";
    repeatDelist.delisting = { invoked_v3: true, resolved: true, terminal_valuation_usd: "75.00" };
    const repeatDelistRes = applyCorporateAction(cashDelistRes.ledger, repeatDelist);
    assert.equal(repeatDelistRes.ok, false);
    assert.equal(repeatDelistRes.reason, "delisting_already_settled_or_empty_position");
    assert.equal(repeatDelistRes.ledger.settled_cash_usd, "1075.00");

    // R6-4 / R5-8b: kept-units resolved delisting rejects contradictory payment/CIL legs
    const keptUnitsBadPay = structuredClone(unresolvedEvt);
    keptUnitsBadPay.event_id = "ca-a03-r6-kept-pay";
    keptUnitsBadPay.post_units = "25";
    keptUnitsBadPay.post_ref = "3.00";
    keptUnitsBadPay.delisting = { invoked_v3: true, resolved: true, terminal_valuation_usd: "75.00" };
    keptUnitsBadPay.payment_transfer_usd = { applicable: true, amount_usd: "750.00" };
    const keptBadPayRes = applyCorporateAction(freshSplitLedger, keptUnitsBadPay);
    assert.equal(keptBadPayRes.ok, false);
    assert.equal(keptBadPayRes.reason, "delisting_terminal_valuation_mismatch");
    assert.equal(keptBadPayRes.ledger.settled_cash_usd, "1000.00");

    const keptUnitsBadCil = structuredClone(keptUnitsBadPay);
    keptUnitsBadCil.event_id = "ca-a03-r6-kept-cil";
    keptUnitsBadCil.payment_transfer_usd = { applicable: false, amount_usd: null, reason: "delisted_position_marked" };
    keptUnitsBadCil.incremental_cash_in_lieu = { applicable: true, amount_usd: "750.00" };
    const keptBadCilRes = applyCorporateAction(freshSplitLedger, keptUnitsBadCil);
    assert.equal(keptBadCilRes.ok, false);
    assert.equal(keptBadCilRes.reason, "delisting_terminal_valuation_mismatch");

    const keptUnitsClean = structuredClone(keptUnitsBadPay);
    keptUnitsClean.event_id = "ca-a03-r6-kept-clean";
    keptUnitsClean.payment_transfer_usd = { applicable: false, amount_usd: null, reason: "delisted_position_marked" };
    assert.ok(validateCorpActionSchema(keptUnitsClean));
    const keptCleanRes = applyCorporateAction(freshSplitLedger, keptUnitsClean);
    assert.equal(keptCleanRes.ok, true, keptCleanRes.reason);
    assert.equal(keptCleanRes.ledger.positions.inst_delist.units, "25");
    assert.equal(keptCleanRes.ledger.positions.inst_delist.ref_price_usd, "3.00");
    assert.equal(keptCleanRes.ledger.settled_cash_usd, "1000.00");

    // Codex P2 #1: preserve >8 decimal places when persisting corporate-action state
    const highPrecLedger = createCorporateActionLedger({
      ...spec.initial_ledger,
      positions: {
        inst_tqqq: { instrument_id: "inst_tqqq", symbol: "TQQQ", units: "100", ref_price_usd: "100.00000001" },
      },
    });
    const highPrecSplit = structuredClone(spec.subcases[0].event);
    highPrecSplit.event_id = "ca-a03-p2-9dec-split";
    highPrecSplit.pre_units = "100";
    highPrecSplit.post_units = "200";
    highPrecSplit.pre_ref = "100.00000001";
    highPrecSplit.post_ref = "50.000000005";
    const hpSplitRes = applyCorporateAction(highPrecLedger, highPrecSplit);
    assert.equal(hpSplitRes.ok, true, hpSplitRes.reason);
    assert.equal(hpSplitRes.ledger.positions.inst_tqqq.ref_price_usd, "50.000000005");
    const followOnDiv = structuredClone(spec.subcases[2].event);
    followOnDiv.event_id = "ca-a03-p2-9dec-div";
    followOnDiv.instrument_id = "inst_tqqq";
    followOnDiv.symbol = "TQQQ";
    followOnDiv.pre_units = "200";
    followOnDiv.post_units = "200";
    followOnDiv.pre_ref = "50.000000005";
    followOnDiv.post_ref = "49.000000005";
    followOnDiv.eligible_units = "200";
    followOnDiv.dividend_per_unit_usd = "1.00";
    followOnDiv.incremental_dividend_receivable = { applicable: true, amount_usd: "200.00" };
    const followOnDivRes = applyCorporateAction(hpSplitRes.ledger, followOnDiv);
    assert.equal(followOnDivRes.ok, true, followOnDivRes.reason);
    assert.equal(followOnDivRes.ledger.positions.inst_tqqq.ref_price_usd, "49.000000005");

    // Codex P2 #3: ratio=1 halt sentinel rejects position/ref mutations
    const badSentinel = structuredClone(spec.subcases.find((s) => s.name === "v2_halt_and_reconcile").halt_event);
    badSentinel.event_id = "ca-a03-p2-bad-sentinel";
    badSentinel.pre_units = "100";
    badSentinel.post_units = "200";
    badSentinel.pre_ref = "150.00";
    badSentinel.post_ref = "75.00";
    const badSentinelRes = applyCorporateAction(freshSplitLedger, badSentinel);
    assert.equal(badSentinelRes.ok, false);
    assert.equal(badSentinelRes.reason, "invalid_halt_sentinel_position_change");
    assert.equal(badSentinelRes.v2.state, "HALT");
    assert.equal(badSentinelRes.ledger.positions.inst_tqqq.units, "100");
    assert.equal(badSentinelRes.ledger.positions.inst_tqqq.ref_price_usd, "150.00");
    assert.equal(badSentinelRes.ledger.applied_events.length, 0);

    // Codex P2 #4: halted instrument ticker_change preserves V2 reconciliation under new symbol
    const haltOldTicker = reconcileV2Broker(freshSplitLedger, "inst_rename", {
      broker_reconciled: "mismatch",
      broker_ledger: { adjusted_equity_usd: "23500.00", shares: "99", hwm_usd: spec.initial_ledger.loss_memory.w_ref_usd },
    });
    assert.equal(haltOldTicker.v2.halted_instruments.some((h) => h.symbol === "OLDT"), true);
    const renameWhileHaltedEvt = structuredClone(spec.subcases.find((s) => s.name === "ticker_change").event);
    renameWhileHaltedEvt.event_id = "ca-a03-p2-halted-rename";
    const renamedHaltedRes = applyCorporateAction(haltOldTicker.ledger, renameWhileHaltedEvt);
    assert.equal(renamedHaltedRes.ok, true, renamedHaltedRes.reason);
    assert.equal(renamedHaltedRes.ledger.v2.halted_instruments.find((h) => h.instrument_id === "inst_rename").symbol, "NEWT");
    const staleOldSymRec = reconcileV2Broker(renamedHaltedRes.ledger, "inst_rename", {
      broker_reconciled: "exact_match",
      symbol: "OLDT",
      broker_ledger: { adjusted_equity_usd: "23500.00", shares: "50", hwm_usd: spec.initial_ledger.loss_memory.w_ref_usd },
    });
    assert.equal(staleOldSymRec.ok, false);
    assert.equal(staleOldSymRec.reason, "halted_instrument_mismatch");
    const clearNewSymRec = reconcileV2Broker(renamedHaltedRes.ledger, "inst_rename", {
      broker_reconciled: "exact_match",
      symbol: "NEWT",
      broker_ledger: { adjusted_equity_usd: "23500.00", shares: "50", hwm_usd: spec.initial_ledger.loss_memory.w_ref_usd },
    });
    assert.equal(clearNewSymRec.ok, true, clearNewSymRec.reason);
    assert.equal(clearNewSymRec.v2.state, "CLEAR");

    // Codex P2 4683652398: terminal-marked delisting leaves position eligible for later cash settlement
    const markedTerminalDelist = structuredClone(unresolvedEvt);
    markedTerminalDelist.event_id = "ca-a03-p2-delist-marked-terminal";
    markedTerminalDelist.post_units = "25";
    markedTerminalDelist.post_ref = "3.00";
    markedTerminalDelist.payment_transfer_usd = {
      applicable: false,
      amount_usd: null,
      reason: "delisting_terminal_marking",
    };
    markedTerminalDelist.incremental_cash_in_lieu = {
      applicable: false,
      amount_usd: null,
      reason: "delisting_terminal_marking",
    };
    markedTerminalDelist.delisting = { invoked_v3: true, resolved: true, terminal_valuation_usd: "75.00" };
    assert.ok(validateCorpActionSchema(markedTerminalDelist));
    const markedTerminalRes = applyCorporateAction(freshSplitLedger, markedTerminalDelist);
    assert.equal(markedTerminalRes.ok, true, markedTerminalRes.reason);
    assert.equal(markedTerminalRes.ledger.positions.inst_delist.units, "25");
    assert.equal(markedTerminalRes.ledger.positions.inst_delist.ref_price_usd, "3.00");
    assert.equal(markedTerminalRes.ledger.positions.inst_delist.unresolved_pending_evidence, false);
    assert.equal(markedTerminalRes.ledger.positions.inst_delist.delisted_settled, false);
    assert.equal(markedTerminalRes.ledger.positions.inst_delist.delisted_terminal_marked, true);
    assert.equal(markedTerminalRes.ledger.settled_cash_usd, freshSplitLedger.settled_cash_usd);

    const settleAfterMarkedDelist = structuredClone(unresolvedEvt);
    settleAfterMarkedDelist.event_id = "ca-a03-p2-delist-settle-after-mark";
    settleAfterMarkedDelist.pre_units = "25";
    settleAfterMarkedDelist.post_units = "0";
    settleAfterMarkedDelist.pre_ref = "3.00";
    settleAfterMarkedDelist.post_ref = "0";
    settleAfterMarkedDelist.payment_transfer_usd = {
      applicable: true,
      amount_usd: "75.00",
      reason: "delisting_terminal_cash_settlement",
    };
    settleAfterMarkedDelist.incremental_cash_in_lieu = {
      applicable: false,
      amount_usd: null,
      reason: "delisting_terminal_cash_settlement",
    };
    settleAfterMarkedDelist.delisting = { invoked_v3: true, resolved: true, terminal_valuation_usd: "75.00" };
    assert.ok(validateCorpActionSchema(settleAfterMarkedDelist));
    const settleAfterMarkedRes = applyCorporateAction(markedTerminalRes.ledger, settleAfterMarkedDelist);
    assert.equal(settleAfterMarkedRes.ok, true, settleAfterMarkedRes.reason);
    assert.equal(settleAfterMarkedRes.ledger.positions.inst_delist.units, "0");
    assert.equal(settleAfterMarkedRes.ledger.positions.inst_delist.ref_price_usd, "0");
    assert.equal(settleAfterMarkedRes.ledger.positions.inst_delist.delisted_settled, true);
    assert.equal(settleAfterMarkedRes.ledger.positions.inst_delist.delisted_terminal_marked, false);
    assert.equal(settleAfterMarkedRes.ledger.settled_cash_usd, "1075.00");

    const dupSettleAfterMarked = structuredClone(settleAfterMarkedDelist);
    dupSettleAfterMarked.event_id = "ca-a03-p2-delist-settle-dup";
    dupSettleAfterMarked.pre_units = "0";
    dupSettleAfterMarked.pre_ref = "0";
    const dupSettleAfterMarkedRes = applyCorporateAction(settleAfterMarkedRes.ledger, dupSettleAfterMarked);
    assert.equal(dupSettleAfterMarkedRes.ok, false);
    assert.equal(dupSettleAfterMarkedRes.reason, "delisting_already_settled_or_empty_position");
    assert.equal(dupSettleAfterMarkedRes.ledger.settled_cash_usd, "1075.00");
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

    // P1 regression: sub-millisecond > 60s skew (60.000001s) must fail closed
    const nanoSkew = evaluateFreshness(
      {
        observed_at: "2025-01-08T21:01:00.000001Z",
        fetched_at: "2025-01-08T21:01:00.000001Z",
        evaluated_at: "2025-01-08T21:00:00.000Z",
        last_observed_value: "50000.00",
      },
      { calendarProvider: provider },
    );
    assert.equal(nanoSkew.data_status, "invalid_future_skew");
    assert.equal(nanoSkew.sizing_eligible, false);
    assert.equal(nanoSkew.o1_block_exposure_increase, true);

    // P1 regression: unpinned or {} session calendar never turns stale fact fresh
    const emptySessionProvider = {
      calendar_version: "unknown",
      exchange: "XNYS",
      spec_digest: null,
      coverage: () => ({ start_date: "2025-01-01", end_date: "2025-12-31" }),
      getSession: () => ({}),
    };
    const unpinnedRes = evaluateFreshness(
      {
        observed_at: "2025-01-08T20:59:59.000Z",
        fetched_at: "2025-01-08T21:00:00.000Z",
        evaluated_at: "2025-01-08T21:00:00.000Z",
        last_observed_value: "50000.00",
      },
      { calendarProvider: emptySessionProvider },
    );
    assert.equal(unpinnedRes.data_status, "unavailable");
    assert.equal(unpinnedRes.sizing_eligible, false);
    assert.equal(unpinnedRes.o1_block_exposure_increase, true);

    const pinnedButEmptySessionProvider = {
      calendar_version: "csa22-v1",
      exchange: "XNYS",
      spec_digest: pinnedCalendar.metadata.spec_digest,
      coverage: () => ({ start_date: "2025-01-01", end_date: "2025-12-31" }),
      getSession: () => ({}),
    };
    const emptySesRes = evaluateFreshness(
      {
        observed_at: "2025-01-08T20:59:59.000Z",
        fetched_at: "2025-01-08T21:00:00.000Z",
        evaluated_at: "2025-01-08T21:00:00.000Z",
        last_observed_value: "50000.00",
      },
      { calendarProvider: pinnedButEmptySessionProvider },
    );
    assert.equal(emptySesRes.data_status, "unavailable");
    assert.equal(emptySesRes.sizing_eligible, false);

    // S3: numeric ms timestamp evaluatedAtMs + 60000.001 exceeds 60s bound
    const evalMs = Date.parse("2025-01-08T21:00:00.000Z");
    const numSkewRes = evaluateFreshness(
      {
        observed_at: evalMs + 60000.001,
        fetched_at: evalMs + 60000.001,
        evaluated_at: evalMs,
        last_observed_value: "50000.00",
      },
      { calendarProvider: provider },
    );
    assert.equal(numSkewRes.data_status, "invalid_future_skew");
    assert.equal(numSkewRes.sizing_eligible, false);

    // S4: forged spec_digest on csa22-v1 with shifted close fails closed
    const forgedDigest = "a".repeat(64);
    const forgedCal = structuredClone(pinnedCalendar);
    forgedCal.metadata.spec_digest = forgedDigest;
    forgedCal.sessions["2025-01-08"].spec_digest = forgedDigest;
    forgedCal.sessions["2025-01-08"].close_utc = "2025-01-08T22:00:00.000Z";
    const forgedProvider = createPinnedCalendarProvider(forgedCal);
    assert.equal(forgedProvider.is_pinned, false);
    const forgedRes = evaluateFreshness(
      {
        observed_at: "2025-01-08T20:59:59.000Z",
        fetched_at: "2025-01-08T21:00:00.000Z",
        evaluated_at: "2025-01-08T21:00:00.000Z",
        last_observed_value: "50000.00",
      },
      { calendarProvider: forgedProvider },
    );
    assert.equal(forgedRes.data_status, "unavailable");
    assert.equal(forgedRes.sizing_eligible, false);
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

    // P1 regression: 3 missing days between two +10% periods cannot compound +21%
    const gappedRes = evaluateTwrLedger({
      initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
      sessions: [
        {
          period_start_utc: "2025-01-02T21:00:00.000Z",
          period_end_utc: "2025-01-03T21:00:00.000Z",
          ending_equity_usd: "110.00",
          intraday_subvaluations: [],
          flows: [],
        },
        {
          period_start_utc: "2025-01-06T21:00:00.000Z",
          period_end_utc: "2025-01-07T21:00:00.000Z",
          ending_equity_usd: "121.00",
          intraday_subvaluations: [],
          flows: [],
        },
      ],
    });
    assert.equal(gappedRes.return_pct, null);
    assert.equal(gappedRes.sizing_eligible, false);
    assert.equal(gappedRes.unavailable_reason, "session_continuity_gap");
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

    // P1 regression: broker_reported_balances multi-currency fails closed
    const withBrokerBalances = {
      ...acceptanceFixture.cases["SA-A09"].accounts[0],
      broker_reported_balances: [
        { currency: "USD", net_assets: "50000.00" },
        { currency: "EUR", net_assets: "1200.00" },
      ],
    };
    const mixedBrokerRes = evaluateSizingUnitNav(withBrokerBalances, { calendarProvider: provider });
    assert.equal(mixedBrokerRes.status, "unavailable");
    assert.equal(mixedBrokerRes.reason, "mixed_currency");
    assert.equal(mixedBrokerRes.nav_usd, null);
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

    // P1 regression: missing observed_at or fetched_at individually never cross-backfills
    const { observed_at: _o, ...noObs } = spec.accounts[0];
    const missingObsProj = projectSizingUnitAccountFacts([noObs], {
      evaluated_at: spec.evaluated_at,
      calendarProvider: provider,
    });
    assert.equal(missingObsProj.status, "unavailable");
    assert.equal(missingObsProj.data_status, "missing");
    assert.equal(missingObsProj.nav_usd, null);

    const { fetched_at: _f, ...noFetch } = spec.accounts[0];
    const missingFetchProj = projectSizingUnitAccountFacts([noFetch], {
      evaluated_at: spec.evaluated_at,
      calendarProvider: provider,
    });
    assert.equal(missingFetchProj.status, "unavailable");
    assert.equal(missingFetchProj.data_status, "missing");
    assert.equal(missingFetchProj.nav_usd, null);

    // P1 regression: duplicate account_key across platforms is order-independent & disambiguated
    const acctA = { ...spec.accounts[0], account_id: "shared-key-1", account_key: "shared-key-1", platform: "ibkr", nav_usd: "50000.00" };
    const acctB = {
      ...spec.accounts[0],
      account_id: "shared-key-1",
      account_key: "shared-key-1",
      platform: "longbridge",
      nav_usd: "51000.00",
      settled_cash_usd: "19500.00",
    };
    const ambigForward = evaluateSizingUnitCohort([acctA, acctB], {
      evaluated_at: spec.evaluated_at,
      calendarProvider: provider,
      designated_account_id: "shared-key-1",
    });
    const ambigReverse = evaluateSizingUnitCohort([acctB, acctA], {
      evaluated_at: spec.evaluated_at,
      calendarProvider: provider,
      designated_account_id: "shared-key-1",
    });
    assert.equal(ambigForward.status, "unavailable");
    assert.equal(ambigForward.reason, "ambiguous_sizing_unit");
    assert.equal(ambigReverse.reason, "ambiguous_sizing_unit");
    const disambigA = evaluateSizingUnitCohort([acctB, acctA], {
      evaluated_at: spec.evaluated_at,
      calendarProvider: provider,
      designated_platform: "ibkr",
      designated_account_id: "shared-key-1",
    });
    assert.equal(disambigA.status, "available");
    assert.equal(disambigA.nav_usd, "50000.00");

    // S1: explicit (platform, account_key) ignores unrelated EUR balance on other platform
    const acctBEur = {
      ...spec.accounts[0],
      account_id: "shared-key-1",
      account_key: "shared-key-1",
      platform: "longbridge",
      currency: "EUR",
      balances: [{ currency: "EUR", net_assets: "1000.00" }],
    };
    const disambigUsdOverEur = evaluateSizingUnitCohort([acctBEur, acctA], {
      evaluated_at: spec.evaluated_at,
      calendarProvider: provider,
      designated_platform: "ibkr",
      designated_account_id: "shared-key-1",
    });
    assert.equal(disambigUsdOverEur.status, "available");
    assert.equal(disambigUsdOverEur.nav_usd, "50000.00");

    // S2: single-slash file:/ path and signed GCS HTTPS URL in positions[].price_ref rejected cleanly
    const singleSlashAcct = structuredClone(spec.accounts[0]);
    singleSlashAcct.positions[0].price_ref = "file:/tmp/example/prices";
    const singleSlashProjected = projectSizingUnitAccountFacts([singleSlashAcct], {
      evaluated_at: spec.evaluated_at,
      calendarProvider: provider,
    });
    assert.equal(singleSlashProjected.status, "unavailable");
    assert.equal(singleSlashProjected.nav_usd, null);
    assert.equal(/file:\/tmp\/example\/prices/.test(JSON.stringify(singleSlashProjected)), false);

    // P1 regression: signed GCS HTTPS URL in positions[].price_ref must be stripped & rejected
    const signedUrlAcct = structuredClone(spec.accounts[0]);
    signedUrlAcct.positions[0].price_ref = "https://storage.example.invalid/private-bucket/prices.json?X-Goog-Algorithm=GOOG4&X-Goog-Signature=deadbeef";
    const signedProjected = projectSizingUnitAccountFacts([signedUrlAcct], {
      evaluated_at: spec.evaluated_at,
      calendarProvider: provider,
    });
    assert.equal(signedProjected.status, "unavailable");
    assert.equal(signedProjected.nav_usd, null);
    assert.equal(/storage\.example\.invalid|X-Goog-Signature/.test(JSON.stringify(signedProjected)), false);

    // R3-6 / C-SA-14: empty positions array with nonzero etf_market_value_usd fails closed
    const emptyPosEtfAcct = structuredClone(spec.accounts[0]);
    emptyPosEtfAcct.positions = [];
    const emptyPosEtfCohort = evaluateSizingUnitCohort([emptyPosEtfAcct], {
      evaluated_at: spec.evaluated_at,
      calendarProvider: provider,
    });
    assert.equal(emptyPosEtfCohort.status, "unavailable");
    assert.equal(emptyPosEtfCohort.reason, "positions_etf_mismatch");
    assert.equal(emptyPosEtfCohort.nav_usd, null);
    const emptyPosEtfProjected = projectSizingUnitAccountFacts([emptyPosEtfAcct], {
      evaluated_at: spec.evaluated_at,
      calendarProvider: provider,
    });
    assert.equal(emptyPosEtfProjected.status, "unavailable");
    assert.equal(emptyPosEtfProjected.reason, "positions_etf_mismatch");
    assert.equal(emptyPosEtfProjected.nav_usd, null);

    // R4-6: contradictory live/paper flags and missing/null broker_environment fail closed in require_live_cohort=true
    const { evaluateSizingUnitNav: evalNavDirect } = await import(
      "../web/strategy-switch-console/application/sizing_unit/nav.js"
    );
    const conflictPaperLive = { ...structuredClone(spec.accounts[0]), paper: true, broker_environment: "live" };
    const conflictIsPaperLive = { ...structuredClone(spec.accounts[0]), is_paper: true, broker_environment: "live" };
    const nullEnvAcct = { ...structuredClone(spec.accounts[0]), broker_environment: null };
    for (const suspectAcct of [conflictPaperLive, conflictIsPaperLive, nullEnvAcct]) {
      const singleRes = evalNavDirect(suspectAcct, { evaluated_at: spec.evaluated_at, calendarProvider: provider, require_live_cohort: true });
      assert.equal(singleRes.status, "unavailable");
      assert.equal(singleRes.processing_eligible, false);
      assert.equal(singleRes.nav_usd, null);
      const projRes = projectSizingUnitAccountFacts([suspectAcct], {
        evaluated_at: spec.evaluated_at,
        calendarProvider: provider,
        require_live_cohort: true,
      });
      assert.equal(projRes.status, "unavailable");
      assert.equal(projRes.processing_eligible, false);
      assert.equal(projRes.nav_usd, null);
    }

    // R5-3 & R5-7: secondary environment conflicts & source_available/input_available=false fail closed
    const nullPrimaryLiveSecondary = {
      ...structuredClone(spec.accounts[0]),
      broker_environment: null,
      environment: "live",
    };
    const omittedBrokerLiveSecondary = structuredClone(spec.accounts[0]);
    delete omittedBrokerLiveSecondary.broker_environment;
    omittedBrokerLiveSecondary.environment = "live";
    const livePrimaryPaperSecondary = {
      ...structuredClone(spec.accounts[0]),
      broker_environment: "live",
      environment: "paper",
    };
    const sourceUnavailableAcct = { ...structuredClone(spec.accounts[0]), source_available: false };
    const inputUnavailableAcct = { ...structuredClone(spec.accounts[0]), input_available: false };
    for (const r5Acct of [nullPrimaryLiveSecondary, omittedBrokerLiveSecondary, livePrimaryPaperSecondary]) {
      const sRes = evalNavDirect(r5Acct, { evaluated_at: spec.evaluated_at, calendarProvider: provider, require_live_cohort: true });
      assert.equal(sRes.status, "unavailable");
      assert.equal(sRes.processing_eligible, false);
      assert.equal(sRes.management_status, "unknown");
      assert.equal(sRes.reason, "management_status_unknown");
      assert.equal(sRes.nav_usd, null);
      const pRes = projectSizingUnitAccountFacts([r5Acct], {
        evaluated_at: spec.evaluated_at,
        calendarProvider: provider,
        require_live_cohort: true,
      });
      assert.equal(pRes.status, "unavailable");
      assert.equal(pRes.processing_eligible, false);
      assert.equal(pRes.nav_usd, null);
      assert.equal(pRes.cohort.excluded_accounts[0].reason, "management_status_unknown");
    }
    for (const [r5Acct, expectedReason] of [[sourceUnavailableAcct, "source_missing"], [inputUnavailableAcct, "input_missing"]]) {
      const sRes = evalNavDirect(r5Acct, { evaluated_at: spec.evaluated_at, calendarProvider: provider, require_live_cohort: true });
      assert.equal(sRes.status, "unavailable");
      assert.equal(sRes.data_status, "missing");
      assert.equal(sRes.reason, expectedReason);
      assert.equal(sRes.nav_usd, null);
      const pRes = projectSizingUnitAccountFacts([r5Acct], {
        evaluated_at: spec.evaluated_at,
        calendarProvider: provider,
        require_live_cohort: true,
      });
      assert.equal(pRes.status, "unavailable");
      assert.equal(pRes.data_status, "missing");
      assert.equal(pRes.reason, expectedReason);
      assert.equal(pRes.nav_usd, null);
    }
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

    // P1 regression: Desk 7A propagates Dietz return_pct & approximate:true while keeping sizing_eligible:false
    const deskDietzPerf = projectDesk7aPerformance({
      initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
      sessions: [
        {
          period_start_utc: spec.volatile_midmonth.period_start_utc,
          period_end_utc: spec.volatile_midmonth.period_end_utc,
          ending_equity_usd: spec.volatile_midmonth.ending_equity_usd,
          intraday_subvaluations: [],
          flows: spec.volatile_midmonth.flows,
        },
      ],
    });
    assert.equal(deskDietzPerf.cashflow_7a.adjusted_performance.return_method, "modified_dietz");
    assert.equal(deskDietzPerf.cashflow_7a.adjusted_performance.approximate, true);
    assert.equal(deskDietzPerf.cashflow_7a.adjusted_performance.sizing_eligible, false);
    assert.ok(Number(deskDietzPerf.cashflow_7a.adjusted_performance.return_pct) > 16);

    // P1 regression: multi-currency native replacement on USD leaves EUR Dietz approximate flags intact
    const { applyNativeDailyReturns } = await import(
      "../web/strategy-switch-console/application/console_api/native_daily_returns.js"
    );
    const multiCurrencyBlocks = {
      returns: {
        status: "ok",
        cashflow_method: "modified_dietz",
        approximate: true,
        sizing_eligible: false,
        per_currency: [
          {
            currency: "USD",
            twr_return_percent: 10,
            max_drawdown: { percent: 8, peak_date: "2025-01-01", trough_date: "2025-01-02", unavailable_reason: null },
            multi_day_intervals: [{ days: 2 }],
            cashflow_method: "modified_dietz",
            approximate: true,
            sizing_eligible: false,
          },
          { currency: "EUR", twr_return_percent: 13.3333, cashflow_method: "modified_dietz", approximate: true, sizing_eligible: false },
        ],
      },
      summary: {
        status: "ok",
        cashflow_method: "modified_dietz",
        approximate: true,
        sizing_eligible: false,
        metric_reasons: {},
        per_currency: [
          { currency: "USD", twr_return_percent: 10, max_drawdown: { percent: 0 }, cashflow_method: "modified_dietz", approximate: true, sizing_eligible: false },
          { currency: "EUR", twr_return_percent: 13.3333, max_drawdown: { percent: 1 }, cashflow_method: "modified_dietz", approximate: true, sizing_eligible: false },
        ],
      },
      calendar: {
        status: "ok",
        cells: [
          { date: "2025-01-02", status: "ok", return_method: "modified_dietz", cashflow_method: "modified_dietz", approximate: true },
        ],
      },
    };
    const nativeInput = {
      range: "ALL",
      today: "2025-01-02",
      benchmarks: [],
      accounts: [
        {
          platform: "ibkr",
          account_key: "synth-usd",
          broker_environment: "live",
          return: {
            daily: [
              {
                status: "available",
                method: "native_ibkr_twr",
                unit: "ratio",
                source: "ChangeInNAV.twr",
                currency: "USD",
                period: { from: "2025-01-02", to: "2025-01-02" },
                value: "0.02",
              },
            ],
          },
        },
      ],
    };
    const appliedMulti = applyNativeDailyReturns(multiCurrencyBlocks, nativeInput);
    const eurSummaryRow = appliedMulti.summary.per_currency.find((r) => r.currency === "EUR");
    assert.equal(eurSummaryRow.twr_return_percent, 13.3333);
    assert.equal(eurSummaryRow.cashflow_method, "modified_dietz");
    assert.equal(eurSummaryRow.approximate, true);
    assert.equal(eurSummaryRow.sizing_eligible, false);
    const usdSummaryRow = appliedMulti.summary.per_currency.find((r) => r.currency === "USD");
    assert.equal(Object.hasOwn(usdSummaryRow, "cashflow_method"), false);
    assert.equal(Object.hasOwn(usdSummaryRow, "approximate"), false);
    assert.equal(Object.hasOwn(usdSummaryRow, "sizing_eligible"), false);
    // S7: multi-currency returns.per_currency retains BOTH USD native and EUR Dietz entries
    const usdReturnRow = appliedMulti.returns.per_currency.find((r) => r.currency === "USD");
    const eurReturnRow = appliedMulti.returns.per_currency.find((r) => r.currency === "EUR");
    assert.ok(usdReturnRow && eurReturnRow, "returns.per_currency must include both USD and EUR");
    assert.equal(Object.hasOwn(usdReturnRow, "cashflow_method"), false);
    assert.equal(Object.hasOwn(usdReturnRow, "multi_day_intervals"), false);
    assert.ok(Math.abs(usdReturnRow.twr_return_percent - 2) < 1e-10);
    assert.equal(usdReturnRow.twr_return_percent, appliedMulti.summary.twr_return_percent);
    assert.equal(usdReturnRow.max_drawdown.percent, 0);
    assert.equal(eurReturnRow.cashflow_method, "modified_dietz");
    assert.equal(eurReturnRow.approximate, true);

    // R3-2 / S7: single-EUR top-level curve (empty returns.per_currency) preserved when USD native is applied
    const topLevelEurBlocks = {
      returns: {
        status: "ok",
        currency: "EUR",
        value_kind: "pnl",
        return_kind: "twr",
        as_of: "2025-01-02",
        points: [{ date: "2025-01-02", value: 10, daily_return_percent: 10 }],
        cashflow_method: "modified_dietz",
        approximate: true,
        sizing_eligible: false,
        per_currency: [],
      },
      summary: {
        status: "ok",
        currency: "EUR",
        metric_reasons: {},
        per_currency: [
          { currency: "EUR", twr_return_percent: 10, max_drawdown: { percent: 0 } },
          { currency: "USD", twr_return_percent: null, status: "no_data" },
        ],
      },
      calendar: {
        status: "ok",
        cells: [{ date: "2025-01-02", status: "ok" }],
      },
    };
    const appliedTopLevelEur = applyNativeDailyReturns(topLevelEurBlocks, nativeInput);
    const preservedEurCurve = appliedTopLevelEur.returns.per_currency.find((r) => r.currency === "EUR");
    const addedUsdCurve = appliedTopLevelEur.returns.per_currency.find((r) => r.currency === "USD");
    assert.ok(preservedEurCurve && addedUsdCurve, "top-level EUR curve preserved alongside USD native curve");
    assert.equal(preservedEurCurve.points[0].value, 10);
    assert.equal(preservedEurCurve.approximate, true);
    assert.equal(addedUsdCurve.points[0].daily_return_percent, 2);

    // S5: missing intermediate trading day rejected (including 48h Mon->Wed and pre-close Wed w/ calendar)
    const { createPinnedCalendarProvider } = await import(
      "../web/strategy-switch-console/application/sizing_unit/freshness.js"
    );
    const { evaluateTwrLedger } = await import(
      "../web/strategy-switch-console/application/sizing_unit/twr_ledger.js"
    );
    const calProv = createPinnedCalendarProvider(pinnedCalendar);
    const jan6to10Vals = [
      { observed_at: "2025-01-06T21:00:00.000Z", equity_usd: "100.00" },
      { observed_at: "2025-01-10T21:00:00.000Z", equity_usd: "120.00" },
    ];
    for (const calArg of [undefined, calProv]) {
      const ledgerGap = evaluateTwrLedger({
        initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
        valuations: jan6to10Vals,
        flows: [],
        calendarProvider: calArg,
      });
      assert.equal(ledgerGap.status, "partial");
      assert.equal(ledgerGap.return_pct, null);
      assert.equal(ledgerGap.sizing_eligible, false);

      const deskPerfGap = projectDesk7aPerformance({
        initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
        valuations: jan6to10Vals,
        flows: [],
        calendarProvider: calArg,
      });
      assert.equal(deskPerfGap.cashflow_7a.adjusted_performance.return_pct, null);
      assert.equal(deskPerfGap.cashflow_7a.adjusted_performance.sizing_eligible, false);

      const deskOvGap = projectDesk7aOverview({
        initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
        valuations: jan6to10Vals,
        flows: [],
        calendarProvider: calArg,
      });
      assert.equal(deskOvGap.cashflow_7a.adjusted_performance.return_pct, null);
      assert.equal(deskOvGap.cashflow_7a.adjusted_performance.sizing_eligible, false);
    }

    // R3-1 / S5 Repro 1 & 2: Mon Jan 6 -> Wed Jan 8 skipping Tue Jan 7 fails closed without calendar (48h)
    // AND fails closed with pinned calendar even when end timestamp is moved to 1 min before Wed close
    const jan6to8NoCal = [
      { observed_at: "2025-01-06T21:00:00.000Z", equity_usd: "100.00" },
      { observed_at: "2025-01-08T21:00:00.000Z", equity_usd: "120.00" },
    ];
    const jan6to8PreClose = [
      { observed_at: "2025-01-06T21:00:00.000Z", equity_usd: "100.00" },
      { observed_at: "2025-01-08T20:59:00.000Z", equity_usd: "120.00" },
    ];
    for (const [vals, calArg] of [[jan6to8NoCal, undefined], [jan6to8PreClose, calProv]]) {
      const lGap = evaluateTwrLedger({
        initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
        valuations: vals,
        flows: [],
        calendarProvider: calArg,
      });
      assert.equal(lGap.status, "partial");
      assert.equal(lGap.return_pct, null);
      assert.equal(lGap.sizing_eligible, false);

      const pGap = projectDesk7aPerformance({
        initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
        valuations: vals,
        flows: [],
        calendarProvider: calArg,
      });
      assert.equal(pGap.cashflow_7a.adjusted_performance.return_pct, null);
      assert.equal(pGap.cashflow_7a.adjusted_performance.sizing_eligible, false);

      const oGap = projectDesk7aOverview({
        initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
        valuations: vals,
        flows: [],
        calendarProvider: calArg,
      });
      assert.equal(oGap.cashflow_7a.adjusted_performance.return_pct, null);
      assert.equal(oGap.cashflow_7a.adjusted_performance.sizing_eligible, false);
    }

    // R4-1 / S5: direct evaluatePeriod7aReturn rejects missing Tuesday with or without calendarProvider
    const skippedPeriod = {
      period_start_utc: "2025-01-06T21:00:00.000Z",
      period_end_utc: "2025-01-08T20:59:00.000Z",
      opening_equity_usd: "100.00",
      ending_equity_usd: "120.00",
      intraday_subvaluations: [],
      flows: [],
    };
    for (const calArg of [undefined, calProv]) {
      const directGap = evaluatePeriod7aReturn(skippedPeriod, { calendarProvider: calArg });
      assert.equal(directGap.status, "partial");
      assert.equal(directGap.return_pct, null);
      assert.equal(directGap.sizing_eligible, false);
      assert.equal(directGap.breaker_eligible, false);
      assert.equal(directGap.verdict_eligible, false);
    }

    // R4-2 / S5: trading session missing open_utc fails closed (never silently skips opened session check)
    const noOpenCal = structuredClone(pinnedCalendar);
    delete noOpenCal.sessions["2025-01-08"].open_utc;
    const noOpenProv = createPinnedCalendarProvider(noOpenCal);
    const ledgerNoOpen = evaluateTwrLedger({
      initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
      valuations: jan6to8PreClose,
      flows: [],
      calendarProvider: noOpenProv,
    });
    assert.equal(ledgerNoOpen.status, "partial");
    assert.equal(ledgerNoOpen.return_pct, null);
    assert.equal(ledgerNoOpen.sizing_eligible, false);
    assert.equal(ledgerNoOpen.unavailable_reason, "calendar_open_utc_missing");
    const periodNoOpen = evaluatePeriod7aReturn(skippedPeriod, { calendarProvider: noOpenProv });
    assert.equal(periodNoOpen.status, "partial");
    assert.equal(periodNoOpen.sizing_eligible, false);
    assert.equal(periodNoOpen.unavailable_reason, "calendar_open_utc_missing");

    // R4-5: zero-flow intermediate subvaluation 100 -> 200 -> 120 updates bankroll HWM / dd_b=0.4 / c_t=0 identically to 3 valuations
    const subvalPeakLedger = evaluateTwrLedger({
      initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
      sessions: [
        {
          period_start_utc: "2025-01-06T21:00:00.000Z",
          period_end_utc: "2025-01-08T21:00:00.000Z",
          ending_equity_usd: "120.00",
          intraday_subvaluations: [
            { effective_at: "2025-01-07T21:00:00.000Z", pre_flow_equity_usd: "200.00" },
          ],
          flows: [],
        },
      ],
      calendarProvider: calProv,
    });
    const threeValPeakLedger = evaluateTwrLedger({
      initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
      valuations: [
        { observed_at: "2025-01-06T21:00:00.000Z", equity_usd: "100.00" },
        { observed_at: "2025-01-07T21:00:00.000Z", equity_usd: "200.00" },
        { observed_at: "2025-01-08T21:00:00.000Z", equity_usd: "120.00" },
      ],
      flows: [],
      calendarProvider: calProv,
    });
    assert.equal(subvalPeakLedger.return_pct, "20");
    assert.equal(subvalPeakLedger.sizing_eligible, true);
    assert.equal(threeValPeakLedger.sizing_eligible, true);
    assert.equal(subvalPeakLedger.sessions.at(-1).dd_b, "0.4");
    assert.equal(subvalPeakLedger.sessions.at(-1).c_t, "0");
    assert.equal(subvalPeakLedger.sessions.at(-1).w_ref_usd, "200.00");
    assert.equal(subvalPeakLedger.sessions.at(-1).dd_b, threeValPeakLedger.sessions.at(-1).dd_b);
    assert.equal(subvalPeakLedger.sessions.at(-1).c_t, threeValPeakLedger.sessions.at(-1).c_t);
    assert.equal(subvalPeakLedger.sessions.at(-1).w_ref_usd, threeValPeakLedger.sessions.at(-1).w_ref_usd);

    // R5-1: trading session open_utc falling on wrong NY calendar date fails closed
    const shiftedOpenCal = structuredClone(pinnedCalendar);
    shiftedOpenCal.sessions["2025-01-08"].open_utc = "2025-01-06T14:30:00.000Z";
    const shiftedOpenProv = createPinnedCalendarProvider(shiftedOpenCal);
    const shiftedPeriodRes = evaluatePeriod7aReturn(skippedPeriod, { calendarProvider: shiftedOpenProv });
    assert.equal(shiftedPeriodRes.status, "partial");
    assert.equal(shiftedPeriodRes.return_pct, null);
    assert.equal(shiftedPeriodRes.sizing_eligible, false);
    assert.equal(shiftedPeriodRes.breaker_eligible, false);
    assert.equal(shiftedPeriodRes.verdict_eligible, false);
    assert.equal(shiftedPeriodRes.unavailable_reason, "calendar_session_bounds_mismatch");
    const shiftedLedgerRes = evaluateTwrLedger({
      initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
      valuations: jan6to8PreClose,
      flows: [],
      calendarProvider: shiftedOpenProv,
    });
    assert.equal(shiftedLedgerRes.status, "partial");
    assert.equal(shiftedLedgerRes.sizing_eligible, false);
    assert.equal(shiftedLedgerRes.unavailable_reason, "calendar_session_bounds_mismatch");

    // R5-4: session.h_usd cannot override ledger reserve h to dilute drawdown
    const reserveBypassLedger = evaluateTwrLedger({
      initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
      sessions: [
        {
          period_start_utc: "2025-01-06T21:00:00.000Z",
          period_end_utc: "2025-01-07T21:00:00.000Z",
          ending_equity_usd: "60.00",
          h_usd: "900",
          intraday_subvaluations: [],
          flows: [],
        },
      ],
      calendarProvider: calProv,
    });
    assert.equal(reserveBypassLedger.status, "unavailable");
    assert.equal(reserveBypassLedger.return_pct, null);
    assert.equal(reserveBypassLedger.sizing_eligible, false);
    assert.equal(reserveBypassLedger.breaker_eligible, false);
    assert.equal(reserveBypassLedger.verdict_eligible, false);
    assert.equal(reserveBypassLedger.unavailable_reason, "session_reserve_mismatch");

    // Codex P2 #2: multi-session Desk 7A summary aggregates monetary P&L and raw asset change over evaluated sessions
    const roundTripSessions = [
      {
        period_start_utc: "2025-01-06T21:00:00.000Z",
        period_end_utc: "2025-01-07T21:00:00.000Z",
        ending_equity_usd: "110.00",
        intraday_subvaluations: [],
        flows: [],
      },
      {
        period_start_utc: "2025-01-07T21:00:00.000Z",
        period_end_utc: "2025-01-08T21:00:00.000Z",
        ending_equity_usd: "100.00",
        intraday_subvaluations: [],
        flows: [],
      },
    ];
    const deskRoundTripPerf = projectDesk7aPerformance({
      initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
      sessions: roundTripSessions,
      calendarProvider: calProv,
    });
    assert.equal(deskRoundTripPerf.cashflow_7a.raw_asset_change.amount_usd, "0");
    assert.equal(deskRoundTripPerf.cashflow_7a.adjusted_performance.pnl_usd, "0");
    assert.equal(deskRoundTripPerf.cashflow_7a.adjusted_performance.return_pct, "0");
    const deskRoundTripOv = projectDesk7aOverview({
      initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
      sessions: roundTripSessions,
      calendarProvider: calProv,
    });
    assert.equal(deskRoundTripOv.cashflow_7a.raw_asset_change.amount_usd, "0");
    assert.equal(deskRoundTripOv.cashflow_7a.adjusted_performance.pnl_usd, "0");
    assert.equal(deskRoundTripOv.cashflow_7a.adjusted_performance.return_pct, "0");

    // Codex P2 #5: conflicting same-timestamp intraday_subvaluations fail closed regardless of ordering
    const sameTsPeriod = {
      period_start_utc: "2025-01-06T21:00:00.000Z",
      period_end_utc: "2025-01-07T21:00:00.000Z",
      opening_equity_usd: "100.00",
      ending_equity_usd: "120.00",
      intraday_subvaluations: [
        { effective_at: "2025-01-07T15:00:00.000Z", pre_flow_equity_usd: "100.00" },
        { effective_at: "2025-01-07T15:00:00.000Z", pre_flow_equity_usd: "110.00" },
      ],
      flows: [
        {
          source_ref: "e1".padEnd(64, "0"),
          type: "deposit",
          amount_usd: "10.00",
          effective_at: "2025-01-07T15:00:00.000Z",
          time_precision: "exact",
          coverage: "complete",
        },
        {
          source_ref: "e2".padEnd(64, "0"),
          type: "deposit",
          amount_usd: "10.00",
          effective_at: "2025-01-07T15:00:00.000Z",
          time_precision: "exact",
          coverage: "complete",
        },
      ],
    };
    const sameTsDirect = evaluatePeriod7aReturn(sameTsPeriod, { calendarProvider: calProv });
    assert.equal(sameTsDirect.status, "partial");
    assert.equal(sameTsDirect.return_pct, null);
    assert.equal(sameTsDirect.sizing_eligible, false);
    assert.equal(sameTsDirect.breaker_eligible, false);
    assert.equal(sameTsDirect.verdict_eligible, false);
    assert.equal(sameTsDirect.unavailable_reason, "ambiguous_same_timestamp_subvaluations");

    // S6: Dietz -64% period followed by exact 0% period never regains eligibility or dd_b="0"
    const dietzThenExactSessions = [
      {
        period_start_utc: "2025-01-06T21:00:00.000Z",
        period_end_utc: "2025-01-07T21:00:00.000Z",
        ending_equity_usd: "55.00",
        intraday_subvaluations: [],
        flows: [
          {
            source_ref: "d64".padEnd(64, "0"),
            type: "deposit",
            amount_usd: "25.00",
            effective_at: "2025-01-07T15:00:00.000Z",
            time_precision: "exact",
            coverage: "complete",
          },
        ],
      },
      {
        period_start_utc: "2025-01-07T21:00:00.000Z",
        period_end_utc: "2025-01-08T21:00:00.000Z",
        ending_equity_usd: "55.00",
        intraday_subvaluations: [],
        flows: [],
      },
    ];
    const mixedChainLedger = evaluateTwrLedger({
      initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
      sessions: dietzThenExactSessions,
      calendarProvider: calProv,
    });
    assert.equal(mixedChainLedger.return_method, "modified_dietz");
    assert.equal(mixedChainLedger.approximate, true);
    assert.equal(mixedChainLedger.sizing_eligible, false);
    assert.equal(mixedChainLedger.breaker_eligible, false);
    assert.equal(mixedChainLedger.sessions[1].sizing_eligible, false);
    assert.equal(mixedChainLedger.sessions[1].breaker_eligible, false);
    assert.equal(mixedChainLedger.sessions[1].approximate, true);
    assert.notEqual(mixedChainLedger.sessions[1].dd_b, "0");

    const mixedChainDesk = projectDesk7aPerformance({
      initialState: { e_prev_usd: "100.00", e_star_prev_usd: "100.00", h_usd: "0", tier_drawdown_limit_d: "0.30" },
      sessions: dietzThenExactSessions,
      calendarProvider: calProv,
    });
    assert.equal(mixedChainDesk.cashflow_7a.adjusted_performance.return_method, "modified_dietz");
    assert.equal(mixedChainDesk.cashflow_7a.adjusted_performance.approximate, true);
    assert.equal(mixedChainDesk.cashflow_7a.adjusted_performance.sizing_eligible, false);

    // Codex P2 4683652404: sub-millisecond ISO timestamps preserved via BigInt ns precision
    const { parseInstantNs, toUtcIsoFromNs } = await import(
      "../web/strategy-switch-console/application/sizing_unit/nav.js"
    );
    const t1Ns = parseInstantNs("2025-01-08T14:30:00.000100Z");
    const t2Ns = parseInstantNs("2025-01-08T14:30:00.000200Z");
    assert.notEqual(t1Ns, null);
    assert.notEqual(t1Ns, t2Ns);
    assert.equal(toUtcIsoFromNs(t1Ns), "2025-01-08T14:30:00.0001Z");

    const subMsPeriodBase = {
      opening_equity_usd: "100.00",
      ending_equity_usd: "120.00",
      period_start_utc: "2025-01-08T14:30:00Z",
      period_end_utc: "2025-01-08T21:00:00Z",
      flows: [
        {
          source_ref: "subms1".padEnd(64, "0"),
          type: "deposit",
          amount_usd: "10.00",
          effective_at: "2025-01-08T14:30:00.000100Z",
          time_precision: "exact",
          coverage: "complete",
        },
      ],
      intraday_subvaluations: [],
    };
    const subMsNoSubval = evaluatePeriod7aReturn(subMsPeriodBase, { calendarProvider: calProv });
    assert.equal(subMsNoSubval.return_method, "modified_dietz");
    assert.equal(subMsNoSubval.approximate, true);
    assert.equal(subMsNoSubval.sizing_eligible, false);
    assert.equal(subMsNoSubval.breaker_eligible, false);
    assert.equal(subMsNoSubval.verdict_eligible, false);

    const subMsExactMatch = evaluatePeriod7aReturn(
      {
        ...subMsPeriodBase,
        intraday_subvaluations: [{ effective_at: "2025-01-08T14:30:00.000100Z", pre_flow_equity_usd: "105.00" }],
      },
      { calendarProvider: calProv },
    );
    assert.equal(subMsExactMatch.return_method, "daily_linked_twr");
    assert.equal(subMsExactMatch.approximate, false);
    assert.equal(subMsExactMatch.sizing_eligible, true);
    assert.equal(subMsExactMatch.breaker_eligible, true);
    assert.equal(subMsExactMatch.verdict_eligible, true);
    assert.equal(subMsExactMatch.status, "ok");

    const subMsSameMsMismatch = evaluatePeriod7aReturn(
      {
        ...subMsPeriodBase,
        intraday_subvaluations: [{ effective_at: "2025-01-08T14:30:00.000200Z", pre_flow_equity_usd: "105.00" }],
      },
      { calendarProvider: calProv },
    );
    assert.equal(subMsSameMsMismatch.return_method, "modified_dietz");
    assert.equal(subMsSameMsMismatch.approximate, true);
    assert.equal(subMsSameMsMismatch.sizing_eligible, false);
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

    // P1 regression: asynchronous valuation (Aug 1) vs flow (Aug 15) binding switch fails closed
    const mismatchedSwitch = evaluateHistoryContinuity({
      account_id: "synth-sizing-01",
      broker_environment: "live",
      requested_interval: {
        start_utc: "2025-07-01T00:00:00.000Z",
        end_utc: "2025-09-01T00:00:00.000Z",
      },
      desk_view: true,
      current_valuation_binding_id: "b_val_curr",
      history_source_binding_ids: ["b_val_prior"],
      current_flow_binding_id: "b_flow_curr",
      flow_history_source_binding_ids: ["b_flow_prior"],
      valuation_intervals: [
        {
          start_utc: "2025-07-01T00:00:00.000Z",
          end_utc: "2025-08-01T00:00:00.000Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_val_prior",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
        {
          start_utc: "2025-08-01T00:00:00.000Z",
          end_utc: "2025-09-01T00:00:00.000Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_val_curr",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
      ],
      flow_intervals: [
        {
          start_utc: "2025-07-01T00:00:00.000Z",
          end_utc: "2025-08-15T00:00:00.000Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_flow_prior",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
        {
          start_utc: "2025-08-15T00:00:00.000Z",
          end_utc: "2025-09-01T00:00:00.000Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_flow_curr",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
      ],
      origin: "synthetic",
      source_class: "synthetic",
      evidence_ref: "sa1:a11:switch-mismatch",
    });
    assert.ok(validateContinuitySchema(mismatchedSwitch));
    assert.equal(mismatchedSwitch.continuity_status, "binding_gap");
    assert.equal(mismatchedSwitch.result.status, "insufficient_history");
    assert.equal(mismatchedSwitch.result.return_pct, null);
    assert.ok(mismatchedSwitch.gap_intervals.length > 0);

    // S2: continuity evidence_ref never echoes signed HTTPS URL query params
    const signedContinuity = evaluateHistoryContinuity({
      account_id: "synth-sizing-01",
      broker_environment: "live",
      requested_interval: { start_utc: "2025-07-01T00:00:00.000Z", end_utc: "2025-09-01T00:00:00.000Z" },
      desk_view: true,
      current_valuation_binding_id: "b_val_1",
      history_source_binding_ids: [],
      current_flow_binding_id: "b_flow_1",
      flow_history_source_binding_ids: [],
      valuation_intervals: [
        {
          start_utc: "2025-07-01T00:00:00.000Z",
          end_utc: "2025-09-01T00:00:00.000Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_val_1",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
      ],
      flow_intervals: [
        {
          start_utc: "2025-07-01T00:00:00.000Z",
          end_utc: "2025-09-01T00:00:00.000Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_flow_1",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
      ],
      origin: "synthetic",
      source_class: "synthetic",
      evidence_ref: "https://storage.example.invalid/private-bucket/continuity.json?sig=secret123",
    });
    assert.ok(validateContinuitySchema(signedContinuity));
    assert.equal(/storage\.example\.invalid|sig=secret123|https:/.test(JSON.stringify(signedContinuity)), false);

    // R4-7: complete EUR external_flow window cannot mask incomplete/missing USD window
    const { normalizeExternalFlow } = await import(
      "../web/strategy-switch-console/application/account_facts/external_flow.js"
    );
    const { buildAccountFactsContinuityReadModel } = await import(
      "../web/strategy-switch-console/application/account_facts/read.js"
    );
    const buildFlowReadModel = (windows) => buildAccountFactsContinuityReadModel({
      account_id: "synth-sizing-01",
      broker_environment: "live",
      requested_interval: { start_utc: "2025-01-02T00:00:00.000Z", end_utc: "2025-01-03T00:00:00.000Z" },
      desk_view: false,
      current_valuation_binding_id: "b_val_1",
      history_source_binding_ids: [],
      current_flow_binding_id: "b_flow_1",
      flow_history_source_binding_ids: [],
      valuation_intervals: [
        {
          start_utc: "2025-01-02T00:00:00.000Z",
          end_utc: "2025-01-03T00:00:00.000Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_val_1",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
      ],
      externalFlow: normalizeExternalFlow({ schema_version: "external_flow.v1", windows }),
      candidate_return_pct: "20",
      origin: "synthetic",
      source_class: "synthetic",
      evidence_ref: "sa1:a11:r4-currency",
    });

    const usdIncPlusEurComplete = buildFlowReadModel([
      {
        currency: "USD",
        date: "2025-01-03",
        period_start: "2025-01-02T00:00:00.000Z",
        period_end: "2025-01-03T00:00:00.000Z",
        coverage: "incomplete",
        source: "ibkr_flex",
        records: [],
      },
      {
        currency: "EUR",
        date: "2025-01-03",
        period_start: "2025-01-02T00:00:00.000Z",
        period_end: "2025-01-03T00:00:00.000Z",
        coverage: "complete",
        source: "ibkr_flex",
        records: [],
      },
    ]);
    assert.ok(validateContinuitySchema(usdIncPlusEurComplete));
    assert.equal(usdIncPlusEurComplete.result.status, "insufficient_history");
    assert.equal(usdIncPlusEurComplete.result.return_pct, null);

    const eurOnlyComplete = buildFlowReadModel([
      {
        currency: "EUR",
        date: "2025-01-03",
        period_start: "2025-01-02T00:00:00.000Z",
        period_end: "2025-01-03T00:00:00.000Z",
        coverage: "complete",
        source: "ibkr_flex",
        records: [],
      },
    ]);
    assert.ok(validateContinuitySchema(eurOnlyComplete));
    assert.equal(eurOnlyComplete.result.status, "insufficient_history");
    assert.equal(eurOnlyComplete.result.return_pct, null);

    const usdComplete = buildFlowReadModel([
      {
        currency: "USD",
        date: "2025-01-03",
        period_start: "2025-01-02T00:00:00.000Z",
        period_end: "2025-01-03T00:00:00.000Z",
        coverage: "complete",
        source: "ibkr_flex",
        records: [],
      },
    ]);
    assert.ok(validateContinuitySchema(usdComplete));
    assert.equal(usdComplete.continuity_status, "continuous");
    assert.equal(usdComplete.result.status, "eligible");
    assert.equal(usdComplete.result.return_pct, "20");

    // R5-6: missing/null broker_environment never silently becomes "live" in externalFlowContinuityIntervals or continuity
    const { externalFlowContinuityIntervals } = await import(
      "../web/strategy-switch-console/application/account_facts/external_flow.js"
    );
    const nullCtxIntervals = externalFlowContinuityIntervals(
      normalizeExternalFlow({
        schema_version: "external_flow.v1",
        windows: [
          {
            currency: "USD",
            date: "2025-01-03",
            period_start: "2025-01-02T00:00:00.000Z",
            period_end: "2025-01-03T00:00:00.000Z",
            coverage: "complete",
            source: "ibkr_flex",
            records: [],
          },
        ],
      }),
      { account_id: "synth-sizing-01", broker_environment: null, binding_id: "b_flow_1" },
    );
    assert.equal(nullCtxIntervals[0].broker_environment, null);
    const nullEnvContinuity = buildAccountFactsContinuityReadModel({
      account_id: "synth-sizing-01",
      broker_environment: null,
      requested_interval: { start_utc: "2025-01-02T00:00:00.000Z", end_utc: "2025-01-03T00:00:00.000Z" },
      desk_view: false,
      current_valuation_binding_id: "b_val_1",
      history_source_binding_ids: [],
      current_flow_binding_id: "b_flow_1",
      flow_history_source_binding_ids: [],
      valuation_intervals: [
        {
          start_utc: "2025-01-02T00:00:00.000Z",
          end_utc: "2025-01-03T00:00:00.000Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_val_1",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
      ],
      externalFlow: normalizeExternalFlow({
        schema_version: "external_flow.v1",
        windows: [
          {
            currency: "USD",
            date: "2025-01-03",
            period_start: "2025-01-02T00:00:00.000Z",
            period_end: "2025-01-03T00:00:00.000Z",
            coverage: "complete",
            source: "ibkr_flex",
            records: [],
          },
        ],
      }),
      candidate_return_pct: "20",
      origin: "synthetic",
      source_class: "synthetic",
      evidence_ref: "sa1:a11:r5-null-env",
    });
    assert.ok(validateContinuitySchema(nullEnvContinuity));
    assert.equal(nullEnvContinuity.broker_environment, null);
    assert.equal(nullEnvContinuity.continuity_status, "insufficient_history");
    assert.equal(nullEnvContinuity.result.status, "insufficient_history");
    assert.equal(nullEnvContinuity.result.return_pct, null);
    assert.equal(nullEnvContinuity.result.unavailable_reason, "broker_environment_missing_or_unverified");

    // R6-2 / R5-6: JSON Schema forbids broker_environment: null combined with continuous/eligible
    assert.equal(validateContinuitySchema({ ...usdComplete, broker_environment: null }), false);
    assert.equal(
      validateContinuitySchema({
        ...usdComplete,
        broker_environment: null,
        continuity_status: "insufficient_history",
      }),
      false,
    );

    // Codex P2 #7: coalesce redundant overlapping same-binding intervals before transition detection,
    // while genuine oscillating A -> B -> A transitions still reject with binding_transition_mismatch
    const baseOverlapArgs = {
      account_id: "synth-sizing-01",
      broker_environment: "live",
      requested_interval: { start_utc: "2025-01-01T00:00:00.000Z", end_utc: "2025-01-04T00:00:00.000Z" },
      desk_view: true,
      current_valuation_binding_id: "b_val_curr",
      history_source_binding_ids: ["b_val_prior"],
      current_flow_binding_id: "b_flow_curr",
      flow_history_source_binding_ids: ["b_flow_prior"],
      flow_intervals: [
        {
          start_utc: "2025-01-01T00:00:00.000Z",
          end_utc: "2025-01-02T00:00:00.000Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_flow_prior",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
        {
          start_utc: "2025-01-02T00:00:00.000Z",
          end_utc: "2025-01-04T00:00:00.000Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_flow_curr",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
      ],
      candidate_return_pct: "20",
      origin: "synthetic",
      source_class: "synthetic",
      evidence_ref: "sa1:a11:coalesce-bindings",
    };
    const coalescedOverlap = evaluateHistoryContinuity({
      ...baseOverlapArgs,
      valuation_intervals: [
        {
          start_utc: "2025-01-01T00:00:00.000Z",
          end_utc: "2025-01-03T12:00:00.000Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_val_prior",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
        {
          start_utc: "2025-01-02T00:00:00.000Z",
          end_utc: "2025-01-04T00:00:00.000Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_val_curr",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
        {
          start_utc: "2025-01-03T00:00:00.000Z",
          end_utc: "2025-01-03T12:00:00.000Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_val_prior",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
      ],
    });
    assert.ok(validateContinuitySchema(coalescedOverlap));
    assert.equal(coalescedOverlap.continuity_status, "continuous");
    assert.equal(coalescedOverlap.result.status, "eligible");
    assert.equal(coalescedOverlap.result.return_pct, "20");

    const trueOscillating = evaluateHistoryContinuity({
      ...baseOverlapArgs,
      valuation_intervals: [
        {
          start_utc: "2025-01-01T00:00:00.000Z",
          end_utc: "2025-01-02T00:00:00.000Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_val_prior",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
        {
          start_utc: "2025-01-02T00:00:00.000Z",
          end_utc: "2025-01-03T00:00:00.000Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_val_curr",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
        {
          start_utc: "2025-01-03T00:00:00.000Z",
          end_utc: "2025-01-04T00:00:00.000Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_val_prior",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
      ],
    });
    assert.ok(validateContinuitySchema(trueOscillating));
    assert.equal(trueOscillating.continuity_status, "binding_gap");
    assert.equal(trueOscillating.result.status, "insufficient_history");
    assert.equal(trueOscillating.result.return_pct, null);
    assert.equal(trueOscillating.result.unavailable_reason, "binding_transition_mismatch");

    // Codex P2 4683652404: sub-millisecond transitions aligned vs mismatched in BigInt ns
    const subMsAligned = evaluateHistoryContinuity({
      account_id: "synth-sizing-01",
      broker_environment: "live",
      requested_interval: { start_utc: "2025-01-01T00:00:00.000Z", end_utc: "2025-01-04T00:00:00.000Z" },
      desk_view: false,
      current_valuation_binding_id: "b_val_curr",
      history_source_binding_ids: ["b_val_prior"],
      current_flow_binding_id: "b_flow_curr",
      flow_history_source_binding_ids: ["b_flow_prior"],
      valuation_intervals: [
        {
          start_utc: "2025-01-01T00:00:00Z",
          end_utc: "2025-01-02T00:00:00.000100Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_val_prior",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
        {
          start_utc: "2025-01-02T00:00:00.000100Z",
          end_utc: "2025-01-04T00:00:00Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_val_curr",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
      ],
      flow_intervals: [
        {
          start_utc: "2025-01-01T00:00:00Z",
          end_utc: "2025-01-02T00:00:00.000100Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_flow_prior",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
        {
          start_utc: "2025-01-02T00:00:00.000100Z",
          end_utc: "2025-01-04T00:00:00Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_flow_curr",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
      ],
      candidate_return_pct: "0.025",
      origin: "synthetic",
      source_class: "synthetic",
      evidence_ref: "sha256:" + "d".repeat(64),
    });
    assert.ok(validateContinuitySchema(subMsAligned), ajv.errorsText(validateContinuitySchema.errors));
    assert.equal(subMsAligned.continuity_status, "continuous");
    assert.equal(subMsAligned.result.status, "eligible");
    assert.equal(subMsAligned.result.return_pct, "0.025");
    assert.equal(subMsAligned.gap_intervals.length, 0);

    const subMsMismatched = evaluateHistoryContinuity({
      account_id: "synth-sizing-01",
      broker_environment: "live",
      requested_interval: { start_utc: "2025-01-01T00:00:00.000Z", end_utc: "2025-01-04T00:00:00.000Z" },
      desk_view: false,
      current_valuation_binding_id: "b_val_curr",
      history_source_binding_ids: ["b_val_prior"],
      current_flow_binding_id: "b_flow_curr",
      flow_history_source_binding_ids: ["b_flow_prior"],
      valuation_intervals: [
        {
          start_utc: "2025-01-01T00:00:00Z",
          end_utc: "2025-01-02T00:00:00.000100Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_val_prior",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
        {
          start_utc: "2025-01-02T00:00:00.000100Z",
          end_utc: "2025-01-04T00:00:00Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_val_curr",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
      ],
      flow_intervals: [
        {
          start_utc: "2025-01-01T00:00:00Z",
          end_utc: "2025-01-02T00:00:00.000200Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_flow_prior",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
        {
          start_utc: "2025-01-02T00:00:00.000200Z",
          end_utc: "2025-01-04T00:00:00Z",
          account_id: "synth-sizing-01",
          broker_environment: "live",
          binding_id: "b_flow_curr",
          coverage: "complete",
          precision: "exact",
          source_class: "synthetic",
        },
      ],
      candidate_return_pct: "0.025",
      origin: "synthetic",
      source_class: "synthetic",
      evidence_ref: "sha256:" + "e".repeat(64),
    });
    assert.ok(validateContinuitySchema(subMsMismatched), ajv.errorsText(validateContinuitySchema.errors));
    assert.equal(subMsMismatched.continuity_status, "binding_gap");
    assert.equal(subMsMismatched.result.status, "insufficient_history");
    assert.equal(subMsMismatched.result.return_pct, null);
    assert.equal(subMsMismatched.result.unavailable_reason, "binding_transition_mismatch");
    assert.equal(subMsMismatched.gap_intervals[0].start_utc, "2025-01-02T00:00:00.0001Z");
    assert.equal(subMsMismatched.gap_intervals[0].end_utc, "2025-01-02T00:00:00.0002Z");
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
