/**
 * C-SA-16 & 7A: Daily-linked TWR ledger, flow qualification, Modified Dietz
 * non-eligibility demarcation, and canonical E* / W* / W^{ref} / L / dd^B / c_t.
 *
 * Pure leaf module under application/sizing_unit/: uses BigInt exact rationals
 * from ./nav.js, sets method_version: null (no invented version IDs), never
 * interpolates missing prices, and never converts empty/reported flows to zero.
 */

import {
  parseDecimal,
  parseInstantMs,
  ratAdd,
  ratCmp,
  ratDiv,
  ratFromText,
  ratMax,
  ratMul,
  ratSub,
  ratToDecimalText,
} from "./nav.js";

export const DESK_7A_LABELS = Object.freeze({
  raw_asset_change: "资产变动（含出入金） / Asset change (includes cash flows)",
  adjusted_pnl: "现金流调整损益 / Cash-flow-adjusted P&L",
  adjusted_return: "现金流调整收益率 / Cash-flow-adjusted return",
  adjusted_combined: "现金流调整损益/收益率 / Cash-flow-adjusted P&L/return",
});

const ZERO = { n: 0n, d: 1n };
const ONE = { n: 1n, d: 1n };
const HUNDRED = { n: 100n, d: 1n };

function failPeriod(status, reason) {
  return {
    status,
    return_method: null,
    cashflow_method: null,
    twr_return: null,
    return_pct: null,
    bankroll_return: null,
    raw_asset_change_usd: null,
    adjusted_pnl_usd: null,
    approximate: false,
    sizing_eligible: false,
    breaker_eligible: false,
    verdict_eligible: false,
    interpolated: false,
    empty_as_zero: false,
    method_version: null,
    unavailable_reason: reason,
  };
}

function formatUsd(r, { explicitPlus = false } = {}) {
  if (r.n === 0n) return "0";
  return ratToDecimalText(r, { minScale: 2, maxScale: 8, explicitPlus });
}

function parseSignedFlowAmount(flow) {
  const raw = flow?.amount_usd ?? flow?.amount;
  const text = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : raw;
  const r = ratFromText(text);
  if (!r) return null;
  if (flow?.type === "withdrawal" && r.n > 0n) {
    return ratSub(ZERO, r);
  }
  return r;
}

/**
 * Chronological epoch-millisecond ordering preserving ISO-8601 fractional seconds
 * and numeric timezone offsets (".500Z" after "Z", "-05:00" resolved to UTC).
 */
export function orderObservationsChronologically(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, idx) => {
      const ms = parseInstantMs(item?.observed_at ?? item?.effective_at ?? item?.timestamp);
      return { item, idx, ms: ms === null ? Number.POSITIVE_INFINITY : ms };
    })
    .sort((a, b) => (a.ms !== b.ms ? a.ms - b.ms : a.idx - b.idx))
    .map((x) => x.item);
}

function validateAndNormalizeFlows(flows, flowWindowMeta, startMs, endMs) {
  if (flowWindowMeta && typeof flowWindowMeta === "object") {
    if (flowWindowMeta.coverage === "incomplete") {
      return { ok: false, status: "partial", reason: "incomplete_flow_coverage" };
    }
    if (flowWindowMeta.time_precision === "date") {
      return { ok: false, status: "partial", reason: "date_only_flow_disqualified" };
    }
    if (flowWindowMeta.coverage === "reported" && (!Array.isArray(flows) || flows.length === 0)) {
      return { ok: false, status: "partial", reason: "reported_empty_flow_disqualified" };
    }
  }
  if (!Array.isArray(flows)) {
    return { ok: false, status: "unavailable", reason: "missing_flow_array" };
  }
  const normalized = [];
  for (const flow of flows) {
    if (!flow || typeof flow !== "object") {
      return { ok: false, status: "partial", reason: "malformed_flow_record" };
    }
    if (flow.coverage === "incomplete") {
      return { ok: false, status: "partial", reason: "incomplete_flow_coverage" };
    }
    if (flow.coverage !== "complete") {
      return { ok: false, status: "partial", reason: "unqualified_flow_coverage" };
    }
    if (flow.time_precision === "date") {
      return { ok: false, status: "partial", reason: "date_only_flow_disqualified" };
    }
    const effectiveMs = parseInstantMs(flow.effective_at);
    if (effectiveMs === null) {
      return { ok: false, status: "partial", reason: "missing_exact_flow_timestamp" };
    }
    if (effectiveMs < startMs || effectiveMs > endMs) {
      return { ok: false, status: "partial", reason: "flow_outside_period_window" };
    }
    const amountRat = parseSignedFlowAmount(flow);
    if (!amountRat) {
      return { ok: false, status: "partial", reason: "invalid_flow_amount" };
    }
    normalized.push({
      raw: flow,
      type: flow.type ?? (amountRat.n >= 0n ? "deposit" : "withdrawal"),
      effective_ms: effectiveMs,
      effective_at: new Date(effectiveMs).toISOString(),
      amount_rat: amountRat,
    });
  }
  normalized.sort((a, b) => a.effective_ms - b.effective_ms);
  return { ok: true, flows: normalized };
}

/**
 * Evaluates a single Desk 7A / C-SA-16 period. Uses exact daily-linked TWR when
 * pre-flow valuations isolate every intraday flow, falls back strictly to
 * Modified Dietz (approximate: true, sizing_eligible: false) only when exact
 * complete-coverage flows lack intraday sub-valuations, and fails closed on
 * date-only, incomplete, reported-empty, or missing snapshot inputs.
 */
export function evaluatePeriod7aReturn(input = {}) {
  if (input.missing === true || input.opening_equity_usd == null || input.ending_equity_usd == null) {
    return failPeriod("unavailable", "missing_valuation_snapshot");
  }
  if (input.gap_before === true) {
    return failPeriod("partial", "internal_valuation_gap");
  }
  const startMs = parseInstantMs(input.period_start_utc);
  const endMs = parseInstantMs(input.period_end_utc);
  if (startMs === null || endMs === null || endMs <= startMs) {
    return failPeriod("unavailable", "invalid_period_boundaries");
  }
  const openingRat = ratFromText(String(input.opening_equity_usd));
  const endingRat = ratFromText(String(input.ending_equity_usd));
  const hRat = ratFromText(String(input.h_usd ?? "0"));
  if (!openingRat || !endingRat || !hRat || openingRat.n <= 0n || hRat.n < 0n) {
    return failPeriod("unavailable", "invalid_equity_or_reserve");
  }

  const flowCheck = validateAndNormalizeFlows(input.flows ?? [], input.flow_window_meta, startMs, endMs);
  if (!flowCheck.ok) {
    return failPeriod(flowCheck.status, flowCheck.reason);
  }
  const flows = flowCheck.flows;
  let netFlowRat = ZERO;
  let depositsRat = ZERO;
  let withdrawalsRat = ZERO;
  for (const f of flows) {
    netFlowRat = ratAdd(netFlowRat, f.amount_rat);
    if (f.amount_rat.n > 0n) depositsRat = ratAdd(depositsRat, f.amount_rat);
    if (f.amount_rat.n < 0n) withdrawalsRat = ratAdd(withdrawalsRat, ratSub(ZERO, f.amount_rat));
  }

  const rawChangeRat = ratSub(endingRat, openingRat);
  const adjPnlRat = ratSub(rawChangeRat, netFlowRat);

  // Partition flows at start, strictly interior (startMs, endMs), and end boundary.
  const subValsByMs = new Map();
  if (Array.isArray(input.intraday_subvaluations)) {
    for (const sv of input.intraday_subvaluations) {
      if (sv?.missing === true || sv?.pre_flow_equity_usd == null) {
        return failPeriod("unavailable", "missing_intraday_subvaluation");
      }
      const svMs = parseInstantMs(sv.effective_at);
      const svRat = ratFromText(String(sv.pre_flow_equity_usd));
      if (svMs === null || !svRat || svMs <= startMs || svMs > endMs) {
        return failPeriod("unavailable", "invalid_intraday_subvaluation");
      }
      subValsByMs.set(svMs, (subValsByMs.get(svMs) || []).concat([svRat]));
    }
  }

  const groupedInterior = new Map();
  let startBoundaryFlow = ZERO;
  let endBoundaryFlow = ZERO;
  for (const f of flows) {
    if (f.effective_ms === startMs) {
      startBoundaryFlow = ratAdd(startBoundaryFlow, f.amount_rat);
    } else if (f.effective_ms === endMs) {
      endBoundaryFlow = ratAdd(endBoundaryFlow, f.amount_rat);
    } else {
      groupedInterior.set(
        f.effective_ms,
        ratAdd(groupedInterior.get(f.effective_ms) || ZERO, f.amount_rat),
      );
    }
  }

  const interiorTimes = [...groupedInterior.keys()].sort((a, b) => a - b);
  const allInteriorHaveSubvals = interiorTimes.every((ms) => (subValsByMs.get(ms)?.length ?? 0) > 0);
  const ePreEndRat = ratSub(endingRat, endBoundaryFlow);

  if (allInteriorHaveSubvals) {
    // Exact daily-linked TWR (no Dietz approximation).
    const observedSubvals = [];
    let equityGrowth = ONE;
    let bankrollGrowth = ONE;
    let prevPostEq = ratAdd(openingRat, startBoundaryFlow);
    if (startBoundaryFlow.n !== 0n) observedSubvals.push(prevPostEq);

    for (const ms of interiorTimes) {
      const preList = subValsByMs.get(ms);
      const preEq = preList[preList.length - 1];
      const flowAtT = groupedInterior.get(ms);
      if (prevPostEq.n <= 0n || ratAdd(prevPostEq, hRat).n <= 0n) {
        return failPeriod("unavailable", "nonpositive_subperiod_base");
      }
      equityGrowth = ratMul(equityGrowth, ratDiv(preEq, prevPostEq));
      bankrollGrowth = ratMul(bankrollGrowth, ratDiv(ratAdd(preEq, hRat), ratAdd(prevPostEq, hRat)));
      const postEq = ratAdd(preEq, flowAtT);
      observedSubvals.push(preEq, postEq);
      prevPostEq = postEq;
    }

    if (prevPostEq.n <= 0n || ratAdd(prevPostEq, hRat).n <= 0n) {
      return failPeriod("unavailable", "nonpositive_terminal_base");
    }
    equityGrowth = ratMul(equityGrowth, ratDiv(ePreEndRat, prevPostEq));
    bankrollGrowth = ratMul(
      bankrollGrowth,
      ratDiv(ratAdd(ePreEndRat, hRat), ratAdd(prevPostEq, hRat)),
    );
    observedSubvals.push(ePreEndRat, endingRat);

    const twrEq = ratSub(equityGrowth, ONE);
    const twrBankroll = ratSub(bankrollGrowth, ONE);
    return {
      status: "ok",
      return_method: "daily_linked_twr",
      cashflow_method: "daily_linked_twr",
      twr_return: ratToDecimalText(twrEq),
      return_pct: ratToDecimalText(ratMul(twrEq, HUNDRED)),
      bankroll_return: ratToDecimalText(twrBankroll),
      raw_asset_change_usd: formatUsd(rawChangeRat, { explicitPlus: true }),
      adjusted_pnl_usd: formatUsd(adjPnlRat),
      approximate: false,
      sizing_eligible: true,
      breaker_eligible: true,
      verdict_eligible: true,
      interpolated: false,
      empty_as_zero: false,
      method_version: null,
      unavailable_reason: null,
      _internal: {
        rawChangeRat,
        adjPnlRat,
        netFlowRat,
        depositsRat,
        withdrawalsRat,
        twrEq,
        twrBankroll,
        ePreEndRat,
        observedSubvals,
      },
    };
  }

  // Exact-time complete flows exist strictly inside the window without pre-flow
  // sub-valuations: fall back strictly to Modified Dietz with explicit flags.
  const durationBig = BigInt(endMs - startMs);
  let weightedFlow = ZERO;
  for (const f of flows) {
    const w = { n: BigInt(endMs - f.effective_ms), d: durationBig };
    weightedFlow = ratAdd(weightedFlow, ratMul(w, f.amount_rat));
  }
  const dietzBase = ratAdd(openingRat, weightedFlow);
  if (dietzBase.n <= 0n) {
    return failPeriod("unavailable", "nonpositive_dietz_denominator");
  }
  const dietzReturn = ratDiv(adjPnlRat, dietzBase);
  return {
    status: "ok",
    return_method: "modified_dietz",
    cashflow_method: "modified_dietz",
    twr_return: ratToDecimalText(dietzReturn, { maxScale: 8 }),
    return_pct: ratToDecimalText(ratMul(dietzReturn, HUNDRED), { maxScale: 6 }),
    bankroll_return: null,
    raw_asset_change_usd: formatUsd(rawChangeRat, { explicitPlus: true }),
    adjusted_pnl_usd: formatUsd(adjPnlRat),
    approximate: true,
    sizing_eligible: false,
    breaker_eligible: false,
    verdict_eligible: false,
    interpolated: false,
    empty_as_zero: false,
    method_version: null,
    unavailable_reason: null,
    _internal: {
      rawChangeRat,
      adjPnlRat,
      netFlowRat,
      depositsRat,
      withdrawalsRat,
      twrEq: dietzReturn,
      twrBankroll: null,
      ePreEndRat,
      observedSubvals: [endingRat],
    },
  };
}

function buildSessionsFromValuations(valuations, allFlows) {
  if (!Array.isArray(valuations) || valuations.length === 0) {
    return { ok: false, status: "unavailable", reason: "missing_valuation_snapshot" };
  }
  const ordered = orderObservationsChronologically(valuations);
  for (const val of ordered) {
    if (val?.missing === true || val?.equity_usd == null || !parseDecimal(String(val.equity_usd))) {
      return { ok: false, status: "unavailable", reason: "missing_valuation_snapshot" };
    }
    if (val?.gap_before === true) {
      return { ok: false, status: "partial", reason: "internal_valuation_gap" };
    }
    if (parseInstantMs(val.observed_at) === null) {
      return { ok: false, status: "unavailable", reason: "invalid_valuation_timestamp" };
    }
  }
  const sessions = [];
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const curr = ordered[i];
    const prevMs = parseInstantMs(prev.observed_at);
    const currMs = parseInstantMs(curr.observed_at);
    const sessionFlows = (allFlows || []).filter((f) => {
      const fMs = parseInstantMs(f.effective_at);
      return fMs === null || (fMs > prevMs && fMs <= currMs);
    });
    sessions.push({
      period_start_utc: prev.observed_at,
      period_end_utc: curr.observed_at,
      opening_equity_usd: prev.equity_usd,
      ending_equity_usd: curr.equity_usd,
      intraday_subvaluations: [],
      flows: sessionFlows,
    });
  }
  return { ok: true, opening_equity_usd: ordered[0].equity_usd, sessions };
}

/**
 * Evaluates a multi-session TWR + bankroll risk-memory ledger (`E*`, `W*`,
 * `W^{ref}`, `L`, `W`, `dd^B`, `c_t`). Never emits Dietz returns as sizing-eligible.
 */
export function evaluateTwrLedger({ initialState = {}, sessions, valuations, flows } = {}) {
  let effectiveSessions = Array.isArray(sessions) ? sessions : null;
  let inferredOpening = null;
  if (!effectiveSessions && Array.isArray(valuations)) {
    const built = buildSessionsFromValuations(valuations, flows);
    if (!built.ok) {
      return {
        labels: DESK_7A_LABELS,
        status: built.status,
        return_pct: null,
        interpolated: false,
        empty_as_zero: false,
        sizing_eligible: false,
        breaker_eligible: false,
        verdict_eligible: false,
        method_version: null,
        unavailable_reason: built.reason,
        sessions: [],
      };
    }
    effectiveSessions = built.sessions;
    inferredOpening = built.opening_equity_usd;
  }

  let ePrev = ratFromText(String(initialState.e_prev_usd ?? inferredOpening ?? "0"));
  let eStar = ratFromText(String(initialState.e_star_prev_usd ?? initialState.e_prev_usd ?? inferredOpening ?? "0"));
  const h = ratFromText(String(initialState.h_usd ?? "0"));
  const d = ratFromText(String(initialState.tier_drawdown_limit_d ?? "0.30"));
  let iB = ratFromText(String(initialState.prior_i_b ?? "1"));
  let iBStar = ratFromText(String(initialState.prior_i_b_star ?? "1"));

  if (!ePrev || !eStar || !h || !d || !iB || !iBStar || d.n <= 0n || iB.n <= 0n || iBStar.n <= 0n) {
    return {
      labels: DESK_7A_LABELS,
      status: "unavailable",
      return_pct: null,
      interpolated: false,
      empty_as_zero: false,
      sizing_eligible: false,
      breaker_eligible: false,
      verdict_eligible: false,
      method_version: null,
      unavailable_reason: "invalid_initial_ledger_state",
      sessions: [],
    };
  }

  const outSessions = [];
  let compoundedGrowth = ONE;
  for (const session of effectiveSessions || []) {
    const period = evaluatePeriod7aReturn({
      ...session,
      opening_equity_usd: session.opening_equity_usd ?? ratToDecimalText(ePrev, { minScale: 2 }),
      h_usd: session.h_usd ?? ratToDecimalText(h, { minScale: 2 }),
    });
    if (period.status !== "ok" || !period.sizing_eligible) {
      return {
        labels: DESK_7A_LABELS,
        status: period.status === "ok" ? "partial" : period.status,
        return_pct: null,
        interpolated: false,
        empty_as_zero: false,
        sizing_eligible: false,
        breaker_eligible: false,
        verdict_eligible: false,
        method_version: null,
        unavailable_reason: period.unavailable_reason || "session_not_sizing_eligible",
        sessions: outSessions,
      };
    }

    const { _internal } = period;
    const prevEStar = eStar;
    const prevDdB = ratSub(ONE, ratDiv(iB, iBStar));
    const hadDeposit = _internal.depositsRat.n > 0n;
    const hadWithdrawal = _internal.withdrawalsRat.n > 0n;

    iB = ratMul(iB, ratAdd(ONE, _internal.twrBankroll));
    iBStar = ratMax(iBStar, iB);
    compoundedGrowth = ratMul(compoundedGrowth, ratAdd(ONE, _internal.twrEq));

    const ddB = ratSub(ONE, ratDiv(iB, iBStar));
    const oneMinusDd = ratSub(ONE, ddB);
    const eEnd = ratFromText(String(session.ending_equity_usd));
    let nextEStar = eStar;
    for (const obs of [ePrev, _internal.ePreEndRat, ..._internal.observedSubvals, eEnd]) {
      nextEStar = ratMax(nextEStar, obs);
    }
    eStar = nextEStar;

    const w = ratAdd(eEnd, h);
    const wStar = ratAdd(eStar, h);
    const wRef = oneMinusDd.n > 0n ? ratDiv(w, oneMinusDd) : wStar;
    const lUsd = ratCmp(wRef, w) >= 0 ? ratSub(wRef, w) : ZERO;
    const cT = ratCmp(ddB, d) >= 0 ? ZERO : ratDiv(ratSub(d, ddB), oneMinusDd);

    const midDrawdownDepositFlag = hadDeposit
      && ratCmp(prevDdB, ZERO) > 0
      && ratCmp(eStar, prevEStar) > 0;

    const flowAuditEvents = midDrawdownDepositFlag
      ? [{
        event_kind: "mid_drawdown_deposit",
        period_end_utc: session.period_end_utc,
        e_star_before_usd: formatUsd(prevEStar),
        e_star_after_usd: formatUsd(eStar),
        dd_b: ratToDecimalText(ddB),
        c_t: ratToDecimalText(cT),
      }]
      : [];

    // Pure withdrawal never causes a drawdown increase when market return is >= 0.
    const falseLossTrip = hadWithdrawal && _internal.twrBankroll.n >= 0n && ratCmp(ddB, prevDdB) > 0;

    outSessions.push({
      period_start_utc: session.period_start_utc,
      period_end_utc: session.period_end_utc,
      raw_asset_change_usd: period.raw_asset_change_usd,
      adjusted_pnl_usd: period.adjusted_pnl_usd,
      twr_return: period.twr_return,
      twr_return_pct: period.return_pct,
      e_star_after_usd: formatUsd(eStar),
      w_star_usd: formatUsd(wStar),
      w_ref_usd: formatUsd(wRef),
      l_usd: formatUsd(lUsd),
      w_usd: formatUsd(w),
      dd_b: ratToDecimalText(ddB),
      c_t: ratToDecimalText(cT),
      mid_drawdown_deposit_flag: midDrawdownDepositFlag,
      flow_audit_events: flowAuditEvents,
      false_loss_trip: falseLossTrip,
      return_method: period.return_method,
      cashflow_method: period.cashflow_method,
      approximate: period.approximate,
      sizing_eligible: period.sizing_eligible,
      breaker_eligible: period.breaker_eligible,
      verdict_eligible: period.verdict_eligible,
      method_version: null,
    });
    ePrev = eEnd;
  }

  return {
    labels: DESK_7A_LABELS,
    status: "ok",
    return_pct: ratToDecimalText(ratMul(ratSub(compoundedGrowth, ONE), HUNDRED)),
    interpolated: false,
    empty_as_zero: false,
    sizing_eligible: true,
    breaker_eligible: true,
    verdict_eligible: true,
    method_version: null,
    unavailable_reason: null,
    sessions: outSessions,
  };
}

export function buildCashflow7aSummary({ initialState, sessions } = {}) {
  const res = evaluateTwrLedger({ initialState, sessions });
  const last = res.sessions.at(-1) || null;
  return {
    ledger: res,
    last,
    cashflow_7a: {
      raw_asset_change: {
        label: DESK_7A_LABELS.raw_asset_change,
        amount_usd: last ? last.raw_asset_change_usd : null,
      },
      adjusted_performance: {
        label: DESK_7A_LABELS.adjusted_combined,
        pnl_usd: last ? last.adjusted_pnl_usd : null,
        return_pct: res.return_pct,
        return_method: last ? last.return_method : null,
        approximate: last ? last.approximate : false,
        sizing_eligible: res.sizing_eligible,
        method_version: null,
      },
    },
  };
}
