/**
 * C-SA-Q21: Exact-decimal deployable capital (C_inv, C_avail, R_cash, K_pend),
 * whole-share ideal target, fee-and-collar-aware buyable share allocation,
 * unblocked reductions, ORDER-UNKNOWN buy blocks, B_{min,tier}, and rho_order.
 *
 * Pure leaf module under application/sizing_unit/:
 * - Imports only inward from ./nav.js and ../naming_canonical/helpers.js.
 * - Never imports Worker/DO modules, runtime_support.js, storage, or network.
 * - Zero IEEE floats for money, shares, fees, weights, or capital equations.
 */

import { isRawAccountIdentifier, isUnsafePrivateLocator } from "../naming_canonical/helpers.js";
import { evaluateFreshness } from "./freshness.js";
import {
  parseInstantNs,
  ratAdd,
  ratCmp,
  ratDiv,
  ratFromText,
  ratMul,
  ratSub,
  ratToDecimalText,
  stripPrivateLocators,
  toUtcIsoFromNs,
} from "./nav.js";

export const DEPLOYABLE_CAPITAL_SCHEMA = "qsl.deployable_capital_sizing.v1";

const ZERO_RAT = { n: 0n, d: 1n };
const ONE_RAT = { n: 1n, d: 1n };
const TEN_RAT = { n: 10n, d: 1n };
const BPS_DENOM = { n: 10000n, d: 1n };

const BROKER_SET = new Set(["schwab", "firstrade", "ibkr", "longbridge", "binance"]);
const ENV_SET = new Set(["live", "paper"]);
const FEE_PROVENANCE_SET = new Set(["synthetic_fixture", "research_prereg_amended", "venue_observed"]);
const SOURCE_CLASS_SET = new Set([
  "synthetic",
  "historical_reconstruction",
  "decision_time_market",
  "operator_declared",
  "authorized_operational",
  "paper_broker",
  "authorized_live_broker",
]);
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9./_-]{0,63}$/;
const INTEGER_TEXT_RE = /^(?:0|[1-9][0-9]*)$/;
const SAFE_ACCOUNT_TUPLE_RE = /^(schwab|firstrade|ibkr|longbridge|binance):(live|paper):([a-z0-9][a-z0-9_-]{0,31})$/;
const SAFE_OPAQUE_ACCOUNT_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function exactTerminatingScale(r, minScale = 0, fallbackMaxScale = 12) {
  let d = r.d;
  let pow2 = 0;
  let pow5 = 0;
  while (d % 2n === 0n) { d /= 2n; pow2++; }
  while (d % 5n === 0n) { d /= 5n; pow5++; }
  return d === 1n ? Math.max(pow2, pow5, minScale) : Math.max(minScale, fallbackMaxScale);
}

function formatUsdRat(r) {
  if (r.n === 0n) return "0";
  return ratToDecimalText(r, { minScale: 2, maxScale: exactTerminatingScale(r, 2) });
}

function formatRatioRat(r) {
  if (r.n === 0n) return "0";
  return ratToDecimalText(r, { minScale: 0, maxScale: 12 });
}

function ratAbs(r) {
  return r.n < 0n ? { n: -r.n, d: r.d } : r;
}

function ratMaxZero(r) {
  return r.n > 0n ? r : ZERO_RAT;
}

function ratFloorBigInt(r) {
  if (r.n < 0n) {
    throw new RangeError("negative_floor_unsupported");
  }
  return r.n / r.d;
}

function parseNonNegativeRat(val) {
  if (typeof val !== "string") return null;
  const r = ratFromText(val);
  if (!r || r.n < 0n) return null;
  return r;
}

function parsePositiveRat(val) {
  if (typeof val !== "string") return null;
  const r = ratFromText(val);
  if (!r || r.n <= 0n) return null;
  return r;
}

function parseNonNegativeIntBigInt(val) {
  if (typeof val !== "string" || !INTEGER_TEXT_RE.test(val)) return null;
  return BigInt(val);
}

function parseAccountId(rawAccount, broker, environment) {
  if (rawAccount === null || rawAccount === undefined) return { ok: true, value: null };
  if (typeof rawAccount !== "string" || rawAccount.length === 0 || rawAccount.length > 64) {
    return { ok: false, reason: "invalid_account_id" };
  }
  if (isUnsafePrivateLocator(rawAccount)) {
    return { ok: false, reason: "unsafe_private_locator" };
  }
  if (isRawAccountIdentifier(rawAccount)) {
    return { ok: false, reason: "raw_account_id_prohibited" };
  }
  let slot;
  if (rawAccount.includes(":")) {
    const match = SAFE_ACCOUNT_TUPLE_RE.exec(rawAccount);
    if (!match) return { ok: false, reason: "invalid_account_id" };
    if (broker && match[1] !== broker) return { ok: false, reason: "account_broker_mismatch" };
    if (environment && match[2] !== environment) return { ok: false, reason: "account_environment_mismatch" };
    if (isRawAccountIdentifier(match[3])) return { ok: false, reason: "raw_account_id_prohibited" };
    slot = match[3];
    const resolvedBroker = broker ?? match[1];
    const resolvedEnv = environment ?? match[2];
    return { ok: true, value: `${resolvedBroker}:${resolvedEnv}:${slot}` };
  }
  if (!SAFE_OPAQUE_ACCOUNT_RE.test(rawAccount)) {
    return { ok: false, reason: "invalid_account_id" };
  }
  if (broker && environment) {
    return { ok: true, value: `${broker}:${environment}:${rawAccount}` };
  }
  return { ok: true, value: rawAccount };
}

function validateSafeSymbol(sym) {
  return (
    typeof sym === "string"
    && SYMBOL_RE.test(sym)
    && !isRawAccountIdentifier(sym)
    && !isUnsafePrivateLocator(sym)
  );
}

const SAFE_MACHINE_REASON_RE = /^[a-z][a-z0-9_]{0,127}$/;
const SENSITIVE_REASON_WORD_RE = /(?:token|secret|password|sig|auth)/i;
const SAFE_EVIDENCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_EVIDENCE_RE = /^sha256:[a-f0-9]{64}$/;

function sanitizePublicReason(value, fallback = "unavailable") {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) return fallback;
  if (isRawAccountIdentifier(value) || isUnsafePrivateLocator(value)) return fallback;
  if (!SAFE_MACHINE_REASON_RE.test(value) || SENSITIVE_REASON_WORD_RE.test(value)) return fallback;
  return value;
}

function isSafeEvidenceRef(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) return false;
  if (isUnsafePrivateLocator(value)) return false;
  if (SHA256_EVIDENCE_RE.test(value)) return true;
  if (isRawAccountIdentifier(value)) return false;
  return SAFE_EVIDENCE_ID_RE.test(value);
}

function resolveEvaluatedAt(input, options) {
  const candidate = options?.evaluated_at ?? input?.evaluated_at ?? input?.sizing_unit_nav?.evaluated_at ?? input?.orders_fills?.evaluated_at;
  if (typeof candidate !== "string") return null;
  const ns = parseInstantNs(candidate);
  return ns === null ? null : toUtcIsoFromNs(ns);
}

function validateNavAtSizingBoundary(nav, { evaluatedAt, sizingEvalNs, options, raw }) {
  const topObserved = nav.observed_at ?? null;
  const freshObserved = nav.freshness?.observed_at ?? null;
  if (topObserved !== null && freshObserved !== null && parseInstantNs(topObserved) !== parseInstantNs(freshObserved)) {
    return { ok: false, reason: "nav_timestamp_mismatch" };
  }
  const navObservedRaw = topObserved ?? freshObserved ?? nav.as_of ?? nav.snapshot_at ?? null;
  const navObservedNs = typeof navObservedRaw === "string" ? parseInstantNs(navObservedRaw) : null;
  if (navObservedNs === null) {
    return { ok: false, reason: "nav_missing_or_invalid_timestamp" };
  }

  const topEvaluated = nav.evaluated_at ?? null;
  const freshEvaluated = nav.freshness?.evaluated_at ?? null;
  if (topEvaluated !== null && freshEvaluated !== null && parseInstantNs(topEvaluated) !== parseInstantNs(freshEvaluated)) {
    return { ok: false, reason: "nav_timestamp_mismatch" };
  }
  const navEvaluatedRaw = topEvaluated ?? freshEvaluated ?? null;
  const navEvaluatedNs = typeof navEvaluatedRaw === "string" ? parseInstantNs(navEvaluatedRaw) : null;
  if (navEvaluatedNs === null) {
    return { ok: false, reason: "nav_missing_or_invalid_timestamp" };
  }

  const topFetched = nav.fetched_at ?? null;
  const freshFetched = nav.freshness?.fetched_at ?? null;
  if (topFetched !== null && freshFetched !== null && parseInstantNs(topFetched) !== parseInstantNs(freshFetched)) {
    return { ok: false, reason: "nav_timestamp_mismatch" };
  }
  const navFetchedRaw = topFetched ?? freshFetched ?? null;
  let navFetchedNs = null;
  if (navFetchedRaw !== null) {
    navFetchedNs = typeof navFetchedRaw === "string" ? parseInstantNs(navFetchedRaw) : null;
    if (navFetchedNs === null) {
      return { ok: false, reason: "nav_missing_or_invalid_timestamp" };
    }
  }

  if (sizingEvalNs !== null) {
    if (navObservedNs > sizingEvalNs) {
      return { ok: false, reason: "nav_observed_after_sizing_boundary" };
    }
    if (navFetchedNs !== null && navFetchedNs > sizingEvalNs) {
      return { ok: false, reason: "nav_fetched_after_sizing_boundary" };
    }
    if (navEvaluatedNs > sizingEvalNs) {
      return { ok: false, reason: "nav_evaluated_after_sizing_boundary" };
    }
  }

  if (nav.coverage_window?.end_utc !== undefined && nav.coverage_window?.end_utc !== null) {
    const covEndNs = typeof nav.coverage_window.end_utc === "string"
      ? parseInstantNs(nav.coverage_window.end_utc)
      : null;
    if (covEndNs === null) {
      return { ok: false, reason: "nav_missing_or_invalid_timestamp" };
    }
    if (sizingEvalNs !== null && covEndNs > sizingEvalNs) {
      return { ok: false, reason: "nav_observed_after_sizing_boundary" };
    }
  }

  if (Array.isArray(nav.observations)) {
    for (const obs of nav.observations) {
      if (obs && typeof obs === "object") {
        if (obs.observed_at !== undefined && obs.observed_at !== null) {
          const obsNs = typeof obs.observed_at === "string" ? parseInstantNs(obs.observed_at) : null;
          if (obsNs === null || (sizingEvalNs !== null && obsNs > sizingEvalNs)) {
            return { ok: false, reason: obsNs === null ? "nav_missing_or_invalid_timestamp" : "nav_observed_after_sizing_boundary" };
          }
        }
        if (obs.fetched_at !== undefined && obs.fetched_at !== null) {
          const obsFetchedNs = typeof obs.fetched_at === "string" ? parseInstantNs(obs.fetched_at) : null;
          if (obsFetchedNs === null || (sizingEvalNs !== null && obsFetchedNs > sizingEvalNs)) {
            return { ok: false, reason: obsFetchedNs === null ? "nav_missing_or_invalid_timestamp" : "nav_fetched_after_sizing_boundary" };
          }
        }
      }
    }
  }

  if (typeof nav.freshness?.age_sessions === "number" && nav.freshness.age_sessions !== 0) {
    return { ok: false, reason: "snapshot_stale" };
  }

  const maxAgeRaw = options?.max_nav_age_seconds ?? raw?.max_nav_age_seconds;
  if (maxAgeRaw !== undefined && maxAgeRaw !== null) {
    const maxAgeRat = typeof maxAgeRaw === "number"
      ? (Number.isFinite(maxAgeRaw) && maxAgeRaw >= 0 ? ratFromText(String(maxAgeRaw)) : null)
      : ratFromText(maxAgeRaw);
    if (!maxAgeRat || maxAgeRat.n < 0n || sizingEvalNs === null) {
      return { ok: false, reason: "invalid_max_nav_age_seconds" };
    }
    const ageNsRat = { n: sizingEvalNs - navObservedNs, d: 1_000_000_000n };
    if (ratCmp(ageNsRat, maxAgeRat) > 0) {
      return { ok: false, reason: "sizing_unit_nav_max_age_exceeded" };
    }
  }

  if (options?.calendarProvider || (sizingEvalNs !== null && sizingEvalNs !== navEvaluatedNs)) {
    const freshCheck = evaluateFreshness(
      {
        observed_at: toUtcIsoFromNs(navObservedNs),
        fetched_at: toUtcIsoFromNs(navFetchedNs ?? navObservedNs),
        evaluated_at: evaluatedAt,
      },
      options ?? {},
    );
    if (freshCheck.data_status !== "fresh" || freshCheck.sizing_eligible !== true) {
      return { ok: false, reason: sanitizePublicReason(freshCheck.reason, "sizing_unit_nav_stale") };
    }
  }

  return { ok: true };
}

function normalizeFeeSchedule(rawSchedule) {
  if (!rawSchedule || typeof rawSchedule !== "object" || Array.isArray(rawSchedule)) {
    return {
      ok: false,
      reason: "oi_cost_3_fee_schedule_unavailable",
      view: {
        status: "unavailable",
        provenance: null,
        c_min_usd: null,
        c_per_share_usd: null,
        c_reg: null,
        b_exec_usd: null,
        oi_cost_3_resolved: false,
        oi_cost_4_resolved: false,
      },
    };
  }
  const provenance = FEE_PROVENANCE_SET.has(rawSchedule.provenance) ? rawSchedule.provenance : null;
  const cMinRat = parseNonNegativeRat(rawSchedule.c_min_usd);
  const cPerShareRat = parseNonNegativeRat(rawSchedule.c_per_share_usd);

  let cRegSpec = null;
  let cRegView = null;
  if (typeof rawSchedule.c_reg === "string") {
    const r = parseNonNegativeRat(rawSchedule.c_reg);
    if (r) {
      cRegSpec = { fixed: r, perShare: ZERO_RAT, notionalRate: ZERO_RAT };
      cRegView = formatUsdRat(r);
    }
  } else if (rawSchedule.c_reg && typeof rawSchedule.c_reg === "object" && !Array.isArray(rawSchedule.c_reg)) {
    const fixed = parseNonNegativeRat(rawSchedule.c_reg.fixed_usd);
    const perShare = parseNonNegativeRat(rawSchedule.c_reg.per_share_usd);
    const notionalRate = parseNonNegativeRat(rawSchedule.c_reg.notional_rate);
    if (fixed && perShare && notionalRate) {
      cRegSpec = { fixed, perShare, notionalRate };
      cRegView = {
        fixed_usd: formatUsdRat(fixed),
        per_share_usd: formatUsdRat(perShare),
        notional_rate: formatRatioRat(notionalRate),
      };
    }
  }

  let bExecRat = null;
  let bExecValid = false;
  if (rawSchedule.b_exec_usd !== undefined && rawSchedule.b_exec_usd !== null) {
    const parsedBExec = parseNonNegativeRat(rawSchedule.b_exec_usd);
    if (parsedBExec) {
      bExecRat = parsedBExec;
      bExecValid = true;
    }
  }

  let defaultCollarRat = null;
  if (rawSchedule.default_collar_bps !== undefined && rawSchedule.default_collar_bps !== null) {
    defaultCollarRat = parseNonNegativeRat(rawSchedule.default_collar_bps);
    if (!defaultCollarRat) {
      return {
        ok: false,
        reason: "oi_cost_4_price_collar_unavailable",
        view: {
          status: "unavailable",
          provenance,
          c_min_usd: cMinRat ? formatUsdRat(cMinRat) : null,
          c_per_share_usd: cPerShareRat ? formatUsdRat(cPerShareRat) : null,
          c_reg: cRegView,
          b_exec_usd: bExecValid ? formatUsdRat(bExecRat) : null,
          oi_cost_3_resolved: Boolean(provenance && cMinRat && cPerShareRat && cRegSpec && bExecValid),
          oi_cost_4_resolved: false,
        },
      };
    }
  }

  if (!provenance || !cMinRat || !cPerShareRat || !cRegSpec || !bExecValid) {
    return {
      ok: false,
      reason: "oi_cost_3_fee_schedule_unavailable",
      view: {
        status: "unavailable",
        provenance: null,
        c_min_usd: null,
        c_per_share_usd: null,
        c_reg: null,
        b_exec_usd: null,
        oi_cost_3_resolved: false,
        oi_cost_4_resolved: false,
      },
    };
  }

  return {
    ok: true,
    provenance,
    cMinRat,
    cPerShareRat,
    cRegSpec,
    bExecRat,
    defaultCollarRat,
    view: {
      status: "available",
      provenance,
      c_min_usd: formatUsdRat(cMinRat),
      c_per_share_usd: formatUsdRat(cPerShareRat),
      c_reg: cRegView,
      b_exec_usd: formatUsdRat(bExecRat),
      oi_cost_3_resolved: true,
      oi_cost_4_resolved: true,
    },
  };
}

function computeOrderCostForQty(qtyBigInt, priceLimRat, feeModel) {
  if (qtyBigInt <= 0n) {
    return {
      worstCaseNotional: ZERO_RAT,
      commission: ZERO_RAT,
      bExec: ZERO_RAT,
      totalCost: ZERO_RAT,
    };
  }
  const qRat = { n: qtyBigInt, d: 1n };
  const worstCaseNotional = ratMul(qRat, priceLimRat);
  const perShareTotal = ratMul(feeModel.cPerShareRat, qRat);
  const ticketBase = ratCmp(feeModel.cMinRat, perShareTotal) >= 0 ? feeModel.cMinRat : perShareTotal;
  const regFee = ratAdd(
    feeModel.cRegSpec.fixed,
    ratAdd(
      ratMul(feeModel.cRegSpec.perShare, qRat),
      ratMul(feeModel.cRegSpec.notionalRate, worstCaseNotional),
    ),
  );
  const commission = ratAdd(ticketBase, regFee);
  const bExec = feeModel.bExecRat;
  const totalCost = ratAdd(worstCaseNotional, ratAdd(commission, bExec));
  return { worstCaseNotional, commission, bExec, totalCost };
}

function maxAffordableShares(maxQtyBigInt, budgetRat, priceLimRat, feeModel) {
  if (maxQtyBigInt <= 0n || budgetRat.n <= 0n) return 0n;
  if (ratCmp(computeOrderCostForQty(1n, priceLimRat, feeModel).totalCost, budgetRat) > 0) {
    return 0n;
  }
  let lo = 1n;
  let hi = maxQtyBigInt;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    const cost = computeOrderCostForQty(mid, priceLimRat, feeModel).totalCost;
    if (ratCmp(cost, budgetRat) <= 0) {
      lo = mid;
    } else {
      hi = mid - 1n;
    }
  }
  return lo;
}

/**
 * Evaluates B_{min,tier}: C_{fixed,ann}(W) < 0.10 * DeltaG_{ex,ann}^$(W).
 * Keeps unset expected excess growth explicitly unavailable rather than inventing growth.
 */
export function evaluateWorkableBankrollBminTier(params = {}) {
  const bankrollW = params.bankroll_w_usd !== undefined && params.bankroll_w_usd !== null
    ? parseNonNegativeRat(params.bankroll_w_usd)
    : null;
  if (params.bankroll_w_usd !== undefined && params.bankroll_w_usd !== null && !bankrollW) {
    return {
      status: "unavailable",
      workable: null,
      bankroll_w_usd: null,
      c_fixed_ann_usd: null,
      expected_excess_growth_ann_usd: null,
      threshold_ratio: "0.1",
      friction_ratio: null,
      reason: "invalid_bankroll_w_usd",
    };
  }

  let cFixedCostFailureReason = null;
  let cFixedRat = null;
  if (params.c_fixed_ann_usd !== undefined && params.c_fixed_ann_usd !== null) {
    cFixedRat = parseNonNegativeRat(params.c_fixed_ann_usd);
    if (!cFixedRat) {
      return {
        status: "unavailable",
        workable: null,
        bankroll_w_usd: bankrollW ? formatUsdRat(bankrollW) : null,
        c_fixed_ann_usd: null,
        expected_excess_growth_ann_usd: null,
        threshold_ratio: "0.1",
        friction_ratio: null,
        reason: "invalid_c_fixed_ann_usd",
      };
    }
  } else if (
    Number.isInteger(params.annual_ticket_count)
    && params.annual_ticket_count >= 0
    && params.fee_schedule_resolved
    && params.fee_schedule_resolved.ok
  ) {
    const rawRounding = params.annual_rounding_friction_usd !== undefined
      ? params.annual_rounding_friction_usd
      : params.rounding_friction_ann_usd;
    const rawPassthrough = params.annual_passthrough_usd !== undefined
      ? params.annual_passthrough_usd
      : params.fixed_passthrough_ann_usd;
    if (rawRounding === undefined || rawRounding === null || rawPassthrough === undefined || rawPassthrough === null) {
      cFixedCostFailureReason = "incomplete_fixed_annual_cost_inputs";
    } else {
      const roundingAnn = parseNonNegativeRat(rawRounding);
      const passthroughAnn = parseNonNegativeRat(rawPassthrough);
      if (!roundingAnn || !passthroughAnn) {
        cFixedCostFailureReason = "invalid_fixed_annual_cost_inputs";
      } else {
        const ticketFee = ratAdd(params.fee_schedule_resolved.cMinRat, params.fee_schedule_resolved.cRegSpec.fixed);
        const ticketsTotal = ratMul({ n: BigInt(params.annual_ticket_count), d: 1n }, ticketFee);
        cFixedRat = ratAdd(ticketsTotal, ratAdd(roundingAnn, passthroughAnn));
      }
    }
  }

  if (params.expected_excess_growth_ann_usd === null || params.expected_excess_growth_ann_usd === undefined) {
    return {
      status: "unavailable",
      workable: null,
      bankroll_w_usd: bankrollW ? formatUsdRat(bankrollW) : null,
      c_fixed_ann_usd: cFixedRat ? formatUsdRat(cFixedRat) : null,
      expected_excess_growth_ann_usd: null,
      threshold_ratio: "0.1",
      friction_ratio: null,
      reason: cFixedCostFailureReason ?? "expected_excess_growth_unset",
    };
  }

  if (typeof params.expected_excess_growth_ann_usd !== "string") {
    return {
      status: "unavailable",
      workable: null,
      bankroll_w_usd: bankrollW ? formatUsdRat(bankrollW) : null,
      c_fixed_ann_usd: cFixedRat ? formatUsdRat(cFixedRat) : null,
      expected_excess_growth_ann_usd: null,
      threshold_ratio: "0.1",
      friction_ratio: null,
      reason: "invalid_expected_excess_growth",
    };
  }
  const deltaGRat = ratFromText(params.expected_excess_growth_ann_usd);
  if (!deltaGRat) {
    return {
      status: "unavailable",
      workable: null,
      bankroll_w_usd: bankrollW ? formatUsdRat(bankrollW) : null,
      c_fixed_ann_usd: cFixedRat ? formatUsdRat(cFixedRat) : null,
      expected_excess_growth_ann_usd: null,
      threshold_ratio: "0.1",
      friction_ratio: null,
      reason: "invalid_expected_excess_growth",
    };
  }

  if (!cFixedRat) {
    return {
      status: "unavailable",
      workable: null,
      bankroll_w_usd: bankrollW ? formatUsdRat(bankrollW) : null,
      c_fixed_ann_usd: null,
      expected_excess_growth_ann_usd: formatUsdRat(deltaGRat),
      threshold_ratio: "0.1",
      friction_ratio: null,
      reason: cFixedCostFailureReason ?? "c_fixed_ann_unset",
    };
  }

  if (deltaGRat.n <= 0n) {
    return {
      status: "available",
      workable: false,
      bankroll_w_usd: bankrollW ? formatUsdRat(bankrollW) : null,
      c_fixed_ann_usd: formatUsdRat(cFixedRat),
      expected_excess_growth_ann_usd: formatUsdRat(deltaGRat),
      threshold_ratio: "0.1",
      friction_ratio: null,
      reason: "non_positive_expected_excess_growth",
    };
  }

  const ratioRat = ratDiv(cFixedRat, deltaGRat);
  const workable = ratCmp(ratMul(cFixedRat, TEN_RAT), deltaGRat) < 0;
  return {
    status: "available",
    workable,
    bankroll_w_usd: bankrollW ? formatUsdRat(bankrollW) : null,
    c_fixed_ann_usd: formatUsdRat(cFixedRat),
    expected_excess_growth_ann_usd: formatUsdRat(deltaGRat),
    threshold_ratio: "0.1",
    friction_ratio: formatRatioRat(ratioRat),
    reason: null,
  };
}

function buildUnavailableResult({
  reason,
  accountId = null,
  broker = null,
  environment = null,
  evaluatedAt = "1970-01-01T00:00:00.000Z",
  feeScheduleView = null,
  bMinTier = null,
  orderUnknownSymbols = [],
  origin = "synthetic",
  sourceClass = "synthetic",
  evidenceRef = "sa2:q21:unavailable",
}) {
  const safeReason = sanitizePublicReason(reason, "unavailable");
  const safeEvidenceRef = isSafeEvidenceRef(evidenceRef) ? evidenceRef : "sa2:q21:unavailable";
  return stripPrivateLocators({
    schema_version: DEPLOYABLE_CAPITAL_SCHEMA,
    status: "unavailable",
    reason: safeReason,
    account_id: accountId,
    broker,
    environment,
    currency: "USD",
    currency_coercion: "prohibited",
    fx_inferred: false,
    margin_enabled: false,
    h_usd: "0",
    kelly_applied: false,
    live_trading_enabled: false,
    stop_loss_return_enabled: false,
    fractional_shares: "prohibited",
    evaluated_at: evaluatedAt,
    capital: {
      equity_usd: null,
      c_inv_usd: null,
      cash_settled_usd: null,
      proceeds_eligible_usd: null,
      r_cash_usd: null,
      k_pend_usd: null,
      k_pend_release_allowed: false,
      raw_deployable_cash_usd: null,
      c_avail_usd: null,
      total_buy_commit_usd: null,
      remaining_deployable_cash_usd: null,
    },
    fee_schedule: feeScheduleView ?? {
      status: "unavailable",
      provenance: null,
      c_min_usd: null,
      c_per_share_usd: null,
      c_reg: null,
      b_exec_usd: null,
      oi_cost_3_resolved: false,
      oi_cost_4_resolved: false,
    },
    order_unknown_symbols: orderUnknownSymbols,
    orders: [],
    b_min_tier: bMinTier ?? {
      status: "unavailable",
      workable: null,
      bankroll_w_usd: null,
      c_fixed_ann_usd: null,
      expected_excess_growth_ann_usd: null,
      threshold_ratio: "0.1",
      friction_ratio: null,
      reason: safeReason,
    },
    origin,
    source_class: sourceClass,
    evidence_ref: safeEvidenceRef,
  });
}

/**
 * Evaluates C-SA-Q21 exact-decimal deployable capital, whole-share targets, fee-and-collar
 * buy allocation, unblocked reductions, ORDER-UNKNOWN buy blocks, B_min,tier, and rho_order.
 */
export function evaluateDeployableCapitalSizing(input = {}, options = {}) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const nav = raw.sizing_unit_nav ?? null;
  const ordersFills = raw.orders_fills ?? null;

  const evaluatedAt = resolveEvaluatedAt(raw, options) ?? "1970-01-01T00:00:00.000Z";
  const origin = raw.origin === "production" ? "production" : "synthetic";
  const sourceClass = SOURCE_CLASS_SET.has(raw.source_class)
    ? raw.source_class
    : (SOURCE_CLASS_SET.has(nav?.source_class) ? nav.source_class : "synthetic");
  const feeParsed = normalizeFeeSchedule(raw.fee_schedule);

  const rawEvidenceUnsafe = raw.evidence_ref !== undefined && raw.evidence_ref !== null && !isSafeEvidenceRef(raw.evidence_ref);
  const evidenceRefCandidate = raw.evidence_ref ?? nav?.evidence_ref ?? ordersFills?.evidence_ref ?? "sa2:q21:eval";
  const evidenceRef = isSafeEvidenceRef(evidenceRefCandidate) ? evidenceRefCandidate : "sa2:q21:eval";

  const rawBrokerSpec = raw.broker ?? null;
  const navBrokerSpec = nav?.platform ?? null;
  const ordersBrokerSpec = ordersFills?.broker ?? null;
  const effectiveBrokerSpec = rawBrokerSpec ?? navBrokerSpec ?? ordersBrokerSpec ?? null;
  const broker = typeof effectiveBrokerSpec === "string" && BROKER_SET.has(effectiveBrokerSpec) ? effectiveBrokerSpec : null;

  const rawEnvSpec = raw.environment ?? raw.broker_environment ?? null;
  const navEnvSpec = nav?.broker_environment ?? null;
  const ordersEnvSpec = ordersFills?.environment ?? null;
  const effectiveEnvSpec = rawEnvSpec ?? navEnvSpec ?? ordersEnvSpec ?? null;
  const environment = typeof effectiveEnvSpec === "string" && ENV_SET.has(effectiveEnvSpec) ? effectiveEnvSpec : null;

  const rawAccountSpec = raw.account_id ?? null;
  const navAccountSpec = nav?.account_id ?? null;
  const ordersAccountSpec = ordersFills?.account ?? null;
  const effectiveAccountRaw = rawAccountSpec ?? navAccountSpec ?? ordersAccountSpec ?? null;
  const parsedAccount = parseAccountId(effectiveAccountRaw, broker, environment);
  const accountId = parsedAccount.ok ? parsedAccount.value : null;

  if (rawEvidenceUnsafe) {
    return buildUnavailableResult({
      reason: "unsafe_evidence_ref",
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols: [],
      origin,
      sourceClass,
      evidenceRef: "sa2:q21:unavailable",
    });
  }

  const unknownSet = new Set();
  for (const list of [raw.order_unknown_symbols, ordersFills?.order_unknown_symbols]) {
    if (list !== undefined && list !== null && !Array.isArray(list)) {
      return buildUnavailableResult({
        reason: "invalid_order_unknown_symbols",
        accountId,
        broker,
        environment,
        evaluatedAt,
        feeScheduleView: feeParsed.view,
        orderUnknownSymbols: [],
        origin,
        sourceClass,
        evidenceRef,
      });
    }
    if (Array.isArray(list)) {
      for (const sym of list) {
        if (!validateSafeSymbol(sym)) {
          return buildUnavailableResult({
            reason: "invalid_order_unknown_symbol",
            accountId,
            broker,
            environment,
            evaluatedAt,
            feeScheduleView: feeParsed.view,
            orderUnknownSymbols: [],
            origin,
            sourceClass,
            evidenceRef,
          });
        }
        unknownSet.add(sym);
      }
    }
  }
  const orderUnknownSymbols = [...unknownSet].sort();

  if (!resolveEvaluatedAt(raw, options)) {
    return buildUnavailableResult({
      reason: "missing_or_invalid_evaluated_at",
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }
  if (!parsedAccount.ok) {
    return buildUnavailableResult({
      reason: parsedAccount.reason,
      accountId: null,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }
  if (effectiveBrokerSpec !== null && broker === null) {
    return buildUnavailableResult({
      reason: "invalid_broker",
      accountId,
      broker: null,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }
  if (effectiveEnvSpec !== null && environment === null) {
    return buildUnavailableResult({
      reason: "invalid_environment",
      accountId,
      broker,
      environment: null,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }

  // Pairwise (broker, environment, account) consistency across raw, sizing_unit_nav, and orders_fills.
  const identityMismatchChecks = [
    [rawBrokerSpec && navBrokerSpec && rawBrokerSpec !== navBrokerSpec, "raw_nav_broker_mismatch"],
    [rawBrokerSpec && ordersBrokerSpec && rawBrokerSpec !== ordersBrokerSpec, "raw_orders_broker_mismatch"],
    [navBrokerSpec && ordersBrokerSpec && navBrokerSpec !== ordersBrokerSpec, "nav_orders_broker_mismatch"],
    [rawEnvSpec && navEnvSpec && rawEnvSpec !== navEnvSpec, "raw_nav_environment_mismatch"],
    [rawEnvSpec && ordersEnvSpec && rawEnvSpec !== ordersEnvSpec, "raw_orders_environment_mismatch"],
    [navEnvSpec && ordersEnvSpec && navEnvSpec !== ordersEnvSpec, "nav_orders_environment_mismatch"],
  ];
  for (const [cond, mismatchReason] of identityMismatchChecks) {
    if (cond) {
      return buildUnavailableResult({
        reason: mismatchReason,
        accountId,
        broker,
        environment,
        evaluatedAt,
        feeScheduleView: feeParsed.view,
        orderUnknownSymbols,
        origin,
        sourceClass,
        evidenceRef,
      });
    }
  }

  const parsedNavAccount = navAccountSpec ? parseAccountId(navAccountSpec, navBrokerSpec ?? broker, navEnvSpec ?? environment) : { ok: true, value: null };
  const parsedOrdersAccount = ordersAccountSpec ? parseAccountId(ordersAccountSpec, ordersBrokerSpec ?? broker, ordersEnvSpec ?? environment) : { ok: true, value: null };
  if (!parsedNavAccount.ok || !parsedOrdersAccount.ok) {
    return buildUnavailableResult({
      reason: !parsedNavAccount.ok ? parsedNavAccount.reason : parsedOrdersAccount.reason,
      accountId: null,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }
  if (accountId && parsedNavAccount.value && accountId !== parsedNavAccount.value) {
    return buildUnavailableResult({
      reason: "raw_nav_account_mismatch",
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }
  if (accountId && parsedOrdersAccount.value && accountId !== parsedOrdersAccount.value) {
    return buildUnavailableResult({
      reason: "raw_orders_account_mismatch",
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }
  if (parsedNavAccount.value && parsedOrdersAccount.value && parsedNavAccount.value !== parsedOrdersAccount.value) {
    return buildUnavailableResult({
      reason: "nav_orders_account_mismatch",
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }
  const sizingEvalNs = parseInstantNs(evaluatedAt);
  if (ordersFills) {
    const ordersEvalNs = typeof ordersFills.evaluated_at === "string"
      ? parseInstantNs(ordersFills.evaluated_at)
      : null;
    if (ordersEvalNs === null) {
      return buildUnavailableResult({
        reason: "orders_fills_missing_or_invalid_evaluated_at",
        accountId,
        broker,
        environment,
        evaluatedAt,
        feeScheduleView: feeParsed.view,
        orderUnknownSymbols,
        origin,
        sourceClass,
        evidenceRef,
      });
    }
    if (sizingEvalNs !== null && ordersEvalNs > sizingEvalNs) {
      return buildUnavailableResult({
        reason: "orders_fills_evaluated_after_sizing_boundary",
        accountId,
        broker,
        environment,
        evaluatedAt,
        feeScheduleView: feeParsed.view,
        orderUnknownSymbols,
        origin,
        sourceClass,
        evidenceRef,
      });
    }
    if (ordersFills.as_of !== undefined && ordersFills.as_of !== null) {
      const ordersAsOfNs = typeof ordersFills.as_of === "string"
        ? parseInstantNs(ordersFills.as_of)
        : null;
      if (ordersAsOfNs === null || (sizingEvalNs !== null && ordersAsOfNs > sizingEvalNs)) {
        return buildUnavailableResult({
          reason: ordersAsOfNs === null
            ? "orders_fills_invalid_as_of"
            : "orders_fills_as_of_after_sizing_boundary",
          accountId,
          broker,
          environment,
          evaluatedAt,
          feeScheduleView: feeParsed.view,
          orderUnknownSymbols,
          origin,
          sourceClass,
          evidenceRef,
        });
      }
    }
  }
  if (ordersFills?.account_binding) {
    const ab = ordersFills.account_binding;
    const expectedAccount = parsedOrdersAccount.value ?? accountId;
    if (
      (broker && ab.broker !== broker)
      || (environment && ab.environment !== environment)
      || (expectedAccount && parseAccountId(ab.account, ab.broker, ab.environment).value !== expectedAccount)
    ) {
      return buildUnavailableResult({
        reason: "orders_fills_account_binding_mismatch",
        accountId,
        broker,
        environment,
        evaluatedAt,
        feeScheduleView: feeParsed.view,
        orderUnknownSymbols,
        origin,
        sourceClass,
        evidenceRef,
      });
    }
  }

  if (raw.emergency_bypass !== undefined && raw.emergency_bypass !== null && typeof raw.emergency_bypass !== "boolean") {
    return buildUnavailableResult({
      reason: "invalid_emergency_bypass",
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }

  // Standing safety locks (OA-10 / pilot boundaries)
  if (raw.margin_enabled === true || nav?.margin_enabled === true) {
    return buildUnavailableResult({
      reason: "margin_prohibited",
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }
  if (raw.h_usd !== undefined) {
    const hRat = typeof raw.h_usd === "string" ? ratFromText(raw.h_usd) : null;
    if (!hRat || hRat.n !== 0n) {
      return buildUnavailableResult({
        reason: "nonzero_h_prohibited_in_pilot",
        accountId,
        broker,
        environment,
        evaluatedAt,
        feeScheduleView: feeParsed.view,
        orderUnknownSymbols,
        origin,
        sourceClass,
        evidenceRef,
      });
    }
  }
  if (raw.kelly_applied === true) {
    return buildUnavailableResult({
      reason: "kelly_prohibited",
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }
  if (raw.live_trading_enabled === true) {
    return buildUnavailableResult({
      reason: "live_trading_prohibited",
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }
  if (raw.stop_loss_return_enabled === true) {
    return buildUnavailableResult({
      reason: "stop_loss_return_prohibited",
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }

  // Currency check (single-USD sizing unit, zero invented FX)
  const inputCurrency = raw.currency ?? nav?.currency ?? "USD";
  if (inputCurrency !== "USD") {
    return buildUnavailableResult({
      reason: "fx_unavailable",
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }
  if (nav && (nav.status !== "available" || nav.freshness?.data_status !== "fresh" || nav.currency !== "USD")) {
    return buildUnavailableResult({
      reason: sanitizePublicReason(nav.reason, "sizing_unit_nav_unavailable"),
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }
  if (nav) {
    const navBoundaryCheck = validateNavAtSizingBoundary(nav, {
      evaluatedAt,
      sizingEvalNs,
      options,
      raw,
    });
    if (!navBoundaryCheck.ok) {
      return buildUnavailableResult({
        reason: navBoundaryCheck.reason,
        accountId,
        broker,
        environment,
        evaluatedAt,
        feeScheduleView: feeParsed.view,
        orderUnknownSymbols,
        origin,
        sourceClass,
        evidenceRef,
      });
    }
  }

  // Fee schedule (OI-COST-3) must be explicitly provided with provenance
  if (!feeParsed.ok) {
    return buildUnavailableResult({
      reason: feeParsed.reason,
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }

  const equityRat = parseNonNegativeRat(raw.equity_usd ?? nav?.nav_usd);
  const cashSettledRat = parseNonNegativeRat(raw.cash_settled_usd ?? nav?.settled_cash_usd);
  const proceedsEligibleRat = raw.proceeds_eligible_usd === undefined
    ? ZERO_RAT
    : parseNonNegativeRat(raw.proceeds_eligible_usd);
  const rCashRat = parseNonNegativeRat(raw.r_cash_usd);

  if (!equityRat || !cashSettledRat || !proceedsEligibleRat || !rCashRat) {
    return buildUnavailableResult({
      reason: "incomplete_capital_inputs",
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }

  let kPendRat = null;
  let kPendReleaseAllowed = true;
  let kPendUnknown = false;
  if (ordersFills) {
    const cutoffDom = ordersFills.domains?.cutoff_open_orders;
    const cutoffDomAsOfNs = cutoffDom?.as_of ? parseInstantNs(cutoffDom.as_of) : null;
    const cutoffCoverageUnproven = Boolean(
      cutoffDom && (
        cutoffDom.domain_capability !== "supported"
        || cutoffDom.completeness !== "complete"
        || cutoffDom.truncated !== false
        || (cutoffDomAsOfNs !== null && sizingEvalNs !== null && cutoffDomAsOfNs > sizingEvalNs)
        || (typeof cutoffDom.cap === "number" && typeof cutoffDom.count === "number" && cutoffDom.count >= cutoffDom.cap)
      ),
    );
    const rawOfKPend = ordersFills.summary?.k_pend_usd;
    if (rawOfKPend === null || rawOfKPend === undefined || (cutoffCoverageUnproven && rawOfKPend === "0")) {
      kPendUnknown = true;
      kPendRat = null;
      kPendReleaseAllowed = false;
    } else {
      const ofKPend = parseNonNegativeRat(rawOfKPend);
      if (!ofKPend) {
        return buildUnavailableResult({
          reason: "invalid_k_pend_usd",
          accountId,
          broker,
          environment,
          evaluatedAt,
          feeScheduleView: feeParsed.view,
          orderUnknownSymbols,
          origin,
          sourceClass,
          evidenceRef,
        });
      }
      kPendRat = ofKPend;
      kPendReleaseAllowed = Boolean(ordersFills.summary.k_pend_release_allowed);
      if (raw.k_pend_usd !== undefined && raw.k_pend_usd !== null) {
        const explicitK = parseNonNegativeRat(raw.k_pend_usd);
        if (!explicitK) {
          return buildUnavailableResult({
            reason: "invalid_k_pend_usd",
            accountId,
            broker,
            environment,
            evaluatedAt,
            feeScheduleView: feeParsed.view,
            orderUnknownSymbols,
            origin,
            sourceClass,
            evidenceRef,
          });
        }
        if (ratCmp(explicitK, kPendRat) > 0) kPendRat = explicitK;
      }
      if (raw.k_pend_release_allowed === false) kPendReleaseAllowed = false;
    }
  } else if (raw.k_pend_usd === null && raw.k_pend_release_allowed === false) {
    kPendUnknown = true;
    kPendRat = null;
    kPendReleaseAllowed = false;
  } else {
    kPendRat = parseNonNegativeRat(raw.k_pend_usd);
    if (!kPendRat) {
      return buildUnavailableResult({
        reason: "missing_or_invalid_k_pend_usd",
        accountId,
        broker,
        environment,
        evaluatedAt,
        feeScheduleView: feeParsed.view,
        orderUnknownSymbols,
        origin,
        sourceClass,
        evidenceRef,
      });
    }
    kPendReleaseAllowed = raw.k_pend_release_allowed !== false;
  }

  let bBandRat = ZERO_RAT;
  if (raw.b_band !== undefined && raw.b_band !== null) {
    const parsedBand = parseNonNegativeRat(raw.b_band);
    if (!parsedBand || ratCmp(parsedBand, ONE_RAT) > 0) {
      return buildUnavailableResult({
        reason: "invalid_b_band",
        accountId,
        broker,
        environment,
        evaluatedAt,
        feeScheduleView: feeParsed.view,
        orderUnknownSymbols,
        origin,
        sourceClass,
        evidenceRef,
      });
    }
    bBandRat = parsedBand;
  }

  if (!Array.isArray(raw.targets)) {
    return buildUnavailableResult({
      reason: "missing_targets",
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }

  const seenSymbols = new Set();
  let weightSum = ZERO_RAT;
  let cInvRat = ZERO_RAT;
  const preparedTargets = [];

  for (const t of raw.targets) {
    if (!t || typeof t !== "object" || Array.isArray(t) || !validateSafeSymbol(t.symbol) || seenSymbols.has(t.symbol)) {
      return buildUnavailableResult({
        reason: "invalid_or_duplicate_target",
        accountId,
        broker,
        environment,
        evaluatedAt,
        feeScheduleView: feeParsed.view,
        orderUnknownSymbols,
        origin,
        sourceClass,
        evidenceRef,
      });
    }
    seenSymbols.add(t.symbol);

    const qPreInt = parseNonNegativeIntBigInt(t.q_pre);
    if (qPreInt === null) {
      return buildUnavailableResult({
        reason: "fractional_shares_prohibited",
        accountId,
        broker,
        environment,
        evaluatedAt,
        feeScheduleView: feeParsed.view,
        orderUnknownSymbols,
        origin,
        sourceClass,
        evidenceRef,
      });
    }
    const priceRefRat = parsePositiveRat(t.price_ref);
    const wTargetRat = parseNonNegativeRat(t.w_target);
    if (!priceRefRat || !wTargetRat || ratCmp(wTargetRat, ONE_RAT) > 0) {
      return buildUnavailableResult({
        reason: "invalid_target_price_or_weight",
        accountId,
        broker,
        environment,
        evaluatedAt,
        feeScheduleView: feeParsed.view,
        orderUnknownSymbols,
        origin,
        sourceClass,
        evidenceRef,
      });
    }
    weightSum = ratAdd(weightSum, wTargetRat);
    if (ratCmp(weightSum, ONE_RAT) > 0) {
      return buildUnavailableResult({
        reason: "target_weights_exceed_one",
        accountId,
        broker,
        environment,
        evaluatedAt,
        feeScheduleView: feeParsed.view,
        orderUnknownSymbols,
        origin,
        sourceClass,
        evidenceRef,
      });
    }

    if (t.emergency_bypass !== undefined && t.emergency_bypass !== null && typeof t.emergency_bypass !== "boolean") {
      return buildUnavailableResult({
        reason: "invalid_emergency_bypass",
        accountId,
        broker,
        environment,
        evaluatedAt,
        feeScheduleView: feeParsed.view,
        orderUnknownSymbols,
        origin,
        sourceClass,
        evidenceRef,
      });
    }

    const idealNotional = ratMul(wTargetRat, equityRat);
    const qIdealInt = ratFloorBigInt(ratDiv(idealNotional, priceRefRat));
    const deltaQRawInt = qIdealInt - qPreInt;

    // Resolve O5 worst-case limit price (OI-COST-4)
    let priceLimRat = null;
    let o5CollarMissing = false;
    if (t.price_lim !== undefined && t.price_lim !== null) {
      priceLimRat = parsePositiveRat(t.price_lim);
      if (!priceLimRat || ratCmp(priceLimRat, priceRefRat) < 0) {
        return buildUnavailableResult({
          reason: "invalid_o5_price_collar",
          accountId,
          broker,
          environment,
          evaluatedAt,
          feeScheduleView: { ...feeParsed.view, oi_cost_4_resolved: false },
          orderUnknownSymbols,
          origin,
          sourceClass,
          evidenceRef,
        });
      }
    } else if (t.collar_bps !== undefined && t.collar_bps !== null) {
      const collarBps = parseNonNegativeRat(t.collar_bps);
      if (!collarBps) {
        return buildUnavailableResult({
          reason: "invalid_o5_price_collar",
          accountId,
          broker,
          environment,
          evaluatedAt,
          feeScheduleView: { ...feeParsed.view, oi_cost_4_resolved: false },
          orderUnknownSymbols,
          origin,
          sourceClass,
          evidenceRef,
        });
      }
      priceLimRat = ratMul(priceRefRat, ratAdd(ONE_RAT, ratDiv(collarBps, BPS_DENOM)));
    } else if (t.price_lim !== null && feeParsed.defaultCollarRat) {
      priceLimRat = ratMul(priceRefRat, ratAdd(ONE_RAT, ratDiv(feeParsed.defaultCollarRat, BPS_DENOM)));
    } else if (deltaQRawInt > 0n) {
      o5CollarMissing = true;
    }

    const prePosRat = ratMul({ n: qPreInt, d: 1n }, priceRefRat);
    cInvRat = ratAdd(cInvRat, prePosRat);

    const wCurRat = equityRat.n > 0n ? ratDiv(prePosRat, equityRat) : ZERO_RAT;
    const bandThreshold = ratMul(bBandRat, wTargetRat);
    const withinBand = bBandRat.n > 0n && ratCmp(ratAbs(ratSub(wCurRat, wTargetRat)), bandThreshold) <= 0;
    const emergencyBypass = (t.emergency_bypass ?? raw.emergency_bypass) === true;

    preparedTargets.push({
      symbol: t.symbol,
      qPreInt,
      priceRefRat,
      priceLimRat,
      o5CollarMissing,
      wTargetRat,
      wCurRat,
      idealNotional,
      qIdealInt,
      deltaQRawInt,
      withinBand,
      emergencyBypass,
      isOrderUnknown: unknownSet.has(t.symbol),
    });
  }

  // Reconcile targets & held positions against any complete positions lists (nav.positions / raw.positions),
  // treating an absent symbol in a supplied positions list as zero holdings so stale q_pre cannot oversell.
  const targetBySymbol = new Map(preparedTargets.map((item) => [item.symbol, item]));
  const hasRawPositions = Array.isArray(raw.positions);
  const hasNavPositions = Array.isArray(nav?.positions);

  const parsePositionsList = (list) => {
    const map = new Map();
    if (list === undefined || list === null) return { ok: true, map };
    if (!Array.isArray(list)) return { ok: false, reason: "invalid_position_entry" };
    for (const pos of list) {
      if (!pos || typeof pos !== "object" || Array.isArray(pos) || !validateSafeSymbol(pos.symbol)) {
        return { ok: false, reason: "invalid_position_entry" };
      }
      const qtyInt = parseNonNegativeIntBigInt(pos.qty);
      if (qtyInt === null) {
        return { ok: false, reason: "fractional_shares_prohibited" };
      }
      const prev = map.get(pos.symbol);
      if (prev && prev.qtyInt !== qtyInt) {
        return { ok: false, reason: "positions_qty_mismatch" };
      }
      if (!prev) {
        map.set(pos.symbol, { symbol: pos.symbol, qtyInt, pos });
      }
    }
    return { ok: true, map };
  };

  const rawPosParsed = parsePositionsList(raw.positions);
  if (!rawPosParsed.ok) {
    return buildUnavailableResult({
      reason: rawPosParsed.reason,
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }
  const navPosParsed = parsePositionsList(nav?.positions);
  if (!navPosParsed.ok) {
    return buildUnavailableResult({
      reason: navPosParsed.reason,
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }

  if (hasRawPositions && hasNavPositions) {
    for (const sym of new Set([...rawPosParsed.map.keys(), ...navPosParsed.map.keys()])) {
      const rq = rawPosParsed.map.get(sym)?.qtyInt ?? 0n;
      const nq = navPosParsed.map.get(sym)?.qtyInt ?? 0n;
      if (rq !== nq) {
        return buildUnavailableResult({
          reason: "positions_qty_mismatch",
          accountId,
          broker,
          environment,
          evaluatedAt,
          feeScheduleView: feeParsed.view,
          orderUnknownSymbols,
          origin,
          sourceClass,
          evidenceRef,
        });
      }
    }
  }

  for (const item of preparedTargets) {
    if (hasNavPositions) {
      const navQty = navPosParsed.map.get(item.symbol)?.qtyInt ?? 0n;
      if (item.qPreInt !== navQty) {
        return buildUnavailableResult({
          reason: "positions_target_q_pre_mismatch",
          accountId,
          broker,
          environment,
          evaluatedAt,
          feeScheduleView: feeParsed.view,
          orderUnknownSymbols,
          origin,
          sourceClass,
          evidenceRef,
        });
      }
    }
    if (hasRawPositions) {
      const rawQty = rawPosParsed.map.get(item.symbol)?.qtyInt ?? 0n;
      if (item.qPreInt !== rawQty) {
        return buildUnavailableResult({
          reason: "positions_target_q_pre_mismatch",
          accountId,
          broker,
          environment,
          evaluatedAt,
          feeScheduleView: feeParsed.view,
          orderUnknownSymbols,
          origin,
          sourceClass,
          evidenceRef,
        });
      }
    }
  }

  // Fold any held non-target positions into C_inv without double counting;
  // reject unpriced or zero-valued held non-zero positions fail-closed.
  const allNonTargetEntries = [...rawPosParsed.map.values(), ...navPosParsed.map.values()];
  for (const { symbol, qtyInt, pos: extraPos } of allNonTargetEntries) {
    if (targetBySymbol.has(symbol) || seenSymbols.has(symbol)) continue;

    let mvRat = null;
    if (extraPos.market_value_usd !== undefined && extraPos.market_value_usd !== null) {
      mvRat = parseNonNegativeRat(extraPos.market_value_usd);
      if (!mvRat || (qtyInt > 0n && mvRat.n === 0n)) {
        return buildUnavailableResult({
          reason: "held_position_valuation_unavailable",
          accountId,
          broker,
          environment,
          evaluatedAt,
          feeScheduleView: feeParsed.view,
          orderUnknownSymbols,
          origin,
          sourceClass,
          evidenceRef,
        });
      }
    } else if (extraPos.price_ref !== undefined && extraPos.price_ref !== null) {
      const refPriceRat = parsePositiveRat(extraPos.price_ref);
      if (!refPriceRat) {
        return buildUnavailableResult({
          reason: "held_position_valuation_unavailable",
          accountId,
          broker,
          environment,
          evaluatedAt,
          feeScheduleView: feeParsed.view,
          orderUnknownSymbols,
          origin,
          sourceClass,
          evidenceRef,
        });
      }
      mvRat = ratMul({ n: qtyInt, d: 1n }, refPriceRat);
    } else if (qtyInt === 0n) {
      mvRat = ZERO_RAT;
    } else {
      return buildUnavailableResult({
        reason: "held_position_valuation_unavailable",
        accountId,
        broker,
        environment,
        evaluatedAt,
        feeScheduleView: feeParsed.view,
        orderUnknownSymbols,
        origin,
        sourceClass,
        evidenceRef,
      });
    }
    seenSymbols.add(symbol);
    cInvRat = ratAdd(cInvRat, mvRat);
  }

  if (ratCmp(cInvRat, equityRat) > 0) {
    return buildUnavailableResult({
      reason: "invested_exceeds_equity_margin_prohibited",
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: feeParsed.view,
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }

  const anyBuyMissingCollar = preparedTargets.some((item) => item.deltaQRawInt > 0n && item.o5CollarMissing);
  const anyReductionTarget = preparedTargets.some((item) => item.deltaQRawInt < 0n);
  if (anyBuyMissingCollar && !anyReductionTarget) {
    return buildUnavailableResult({
      reason: "oi_cost_4_price_collar_unavailable",
      accountId,
      broker,
      environment,
      evaluatedAt,
      feeScheduleView: { ...feeParsed.view, oi_cost_4_resolved: false },
      orderUnknownSymbols,
      origin,
      sourceClass,
      evidenceRef,
    });
  }
  const oiCost4AllBuysResolved = !anyBuyMissingCollar;

  const rawAvailRat = kPendUnknown
    ? null
    : ratSub(ratAdd(cashSettledRat, proceedsEligibleRat), ratAdd(rCashRat, kPendRat));
  const cAvailRat = kPendUnknown ? ZERO_RAT : ratMaxZero(rawAvailRat);

  // First pass: classify holds, reductions, band-suppressed, missing-collar / ORDER-UNKNOWN / unknown-K_pend blocks, and active buys.
  const buyCandidates = [];
  for (const item of preparedTargets) {
    item.bandSuppressed = false;
    item.emergencyBypassApplied = false;
    item.buyBlockedReason = null;
    item.deltaQFinalInt = 0n;

    if (item.deltaQRawInt === 0n) {
      item.action = "HOLD";
      continue;
    }

    if (item.deltaQRawInt < 0n) {
      if (item.emergencyBypass) {
        item.emergencyBypassApplied = true;
        item.deltaQFinalInt = item.deltaQRawInt;
        item.action = "SELL";
      } else if (item.withinBand) {
        item.bandSuppressed = true;
        item.deltaQFinalInt = 0n;
        item.action = "HOLD";
      } else {
        item.deltaQFinalInt = item.deltaQRawInt;
        item.action = "SELL";
      }
      continue;
    }

    // Buy path (deltaQRawInt > 0n): reductions above NEVER depend on K_pend, C_avail, or O5 collars.
    if (item.isOrderUnknown) {
      item.deltaQFinalInt = 0n;
      item.action = "BLOCKED_BUY";
      item.buyBlockedReason = "order_unknown_lock";
      continue;
    }
    if (item.o5CollarMissing) {
      item.deltaQFinalInt = 0n;
      item.action = "BLOCKED_BUY";
      item.buyBlockedReason = "oi_cost_4_price_collar_unavailable";
      continue;
    }
    if (kPendUnknown) {
      item.deltaQFinalInt = 0n;
      item.action = "BLOCKED_BUY";
      item.buyBlockedReason = "k_pend_unavailable_open_orders";
      continue;
    }
    if (item.withinBand) {
      item.bandSuppressed = true;
      item.deltaQFinalInt = 0n;
      item.action = "HOLD";
      item.buyBlockedReason = "no_trade_band";
      continue;
    }
    if (cAvailRat.n === 0n) {
      item.deltaQFinalInt = 0n;
      item.action = "BLOCKED_BUY";
      item.buyBlockedReason = "zero_deployable_cash";
      continue;
    }
    const demandCost = computeOrderCostForQty(item.deltaQRawInt, item.priceLimRat, feeParsed).totalCost;
    item.demandCostRat = demandCost;
    buyCandidates.push(item);
  }

  // Second pass: exact fee-and-collar-constrained whole-share allocation within C_avail.
  if (buyCandidates.length > 0) {
    let totalDemandCost = ZERO_RAT;
    for (const c of buyCandidates) totalDemandCost = ratAdd(totalDemandCost, c.demandCostRat);

    if (ratCmp(totalDemandCost, cAvailRat) <= 0) {
      for (const c of buyCandidates) {
        c.deltaQFinalInt = c.deltaQRawInt;
        c.action = "BUY";
      }
    } else {
      for (const c of buyCandidates) {
        const shareBudget = ratMul(cAvailRat, ratDiv(c.demandCostRat, totalDemandCost));
        const maxQ = maxAffordableShares(c.deltaQRawInt, shareBudget, c.priceLimRat, feeParsed);
        c.deltaQFinalInt = maxQ;
        if (maxQ === 0n) {
          c.action = "BLOCKED_BUY";
          c.buyBlockedReason = "budget_insufficient_for_one_share";
        } else {
          c.action = "BUY";
        }
      }
    }
  }

  let totalBuyCommitRat = ZERO_RAT;
  const orderItems = preparedTargets.map((item) => {
    const deltaQBuyInt = item.deltaQFinalInt > 0n ? item.deltaQFinalInt : 0n;
    const deltaQSellInt = item.deltaQFinalInt < 0n ? -item.deltaQFinalInt : 0n;
    const qTargetInt = item.qPreInt + item.deltaQFinalInt;

    const absDeltaInt = item.deltaQFinalInt < 0n ? -item.deltaQFinalInt : item.deltaQFinalInt;
    const estNotionalRefRat = ratMul({ n: absDeltaInt, d: 1n }, item.priceRefRat);

    let estWorstCaseNotionalRat = ZERO_RAT;
    let estCommRat = ZERO_RAT;
    let estBExecRat = ZERO_RAT;
    let estTotalBuyCommitRat = ZERO_RAT;

    if (deltaQBuyInt > 0n) {
      const buyCost = computeOrderCostForQty(deltaQBuyInt, item.priceLimRat, feeParsed);
      estWorstCaseNotionalRat = buyCost.worstCaseNotional;
      estCommRat = buyCost.commission;
      estBExecRat = buyCost.bExec;
      estTotalBuyCommitRat = buyCost.totalCost;
      totalBuyCommitRat = ratAdd(totalBuyCommitRat, estTotalBuyCommitRat);
    } else if (deltaQSellInt > 0n) {
      const sellPriceBasis = item.priceLimRat ?? item.priceRefRat;
      const sellCost = computeOrderCostForQty(deltaQSellInt, sellPriceBasis, feeParsed);
      estCommRat = sellCost.commission;
      estBExecRat = sellCost.bExec;
    }

    const idealRoundedNotional = ratMul({ n: item.qIdealInt, d: 1n }, item.priceRefRat);
    const roundingFrictionRat = ratAbs(ratSub(item.idealNotional, idealRoundedNotional));

    let rhoOrder;
    if (absDeltaInt === 0n || estNotionalRefRat.n === 0n) {
      rhoOrder = {
        value: null,
        threshold: null,
        status: "not_applicable_zero_order",
        numerator_usd: null,
        denominator_usd: null,
        rounding_friction_usd: formatUsdRat(roundingFrictionRat),
      };
    } else {
      const numRat = ratAdd(estCommRat, roundingFrictionRat);
      rhoOrder = {
        value: formatRatioRat(ratDiv(numRat, estNotionalRefRat)),
        threshold: null,
        status: "diagnostic_only_threshold_unset",
        numerator_usd: formatUsdRat(numRat),
        denominator_usd: formatUsdRat(estNotionalRefRat),
        rounding_friction_usd: formatUsdRat(roundingFrictionRat),
      };
    }

    return {
      symbol: item.symbol,
      price_ref: formatUsdRat(item.priceRefRat),
      price_lim: item.priceLimRat ? formatUsdRat(item.priceLimRat) : null,
      w_target: formatRatioRat(item.wTargetRat),
      w_cur: formatRatioRat(item.wCurRat),
      q_pre: item.qPreInt.toString(),
      q_ideal: item.qIdealInt.toString(),
      delta_q_raw: item.deltaQRawInt.toString(),
      delta_q_final: item.deltaQFinalInt.toString(),
      delta_q_buy: deltaQBuyInt.toString(),
      delta_q_sell: deltaQSellInt.toString(),
      q_target: qTargetInt.toString(),
      action: item.action,
      band_suppressed: item.bandSuppressed,
      emergency_bypass_applied: item.emergencyBypassApplied,
      buy_blocked_reason: item.buyBlockedReason,
      est_notional_ref_usd: formatUsdRat(estNotionalRefRat),
      est_worst_case_notional_usd: formatUsdRat(estWorstCaseNotionalRat),
      est_commission_usd: formatUsdRat(estCommRat),
      est_b_exec_usd: formatUsdRat(estBExecRat),
      est_total_buy_commit_usd: formatUsdRat(estTotalBuyCommitRat),
      rho_order: rhoOrder,
    };
  });

  const remainingAvailRat = kPendUnknown ? ZERO_RAT : ratSub(cAvailRat, totalBuyCommitRat);
  const bMinInput = raw.b_min_tier && typeof raw.b_min_tier === "object" ? raw.b_min_tier : {};
  const bMinTier = evaluateWorkableBankrollBminTier({
    bankroll_w_usd: bMinInput.bankroll_w_usd ?? formatUsdRat(equityRat),
    c_fixed_ann_usd: bMinInput.c_fixed_ann_usd ?? null,
    annual_ticket_count: bMinInput.annual_ticket_count,
    annual_rounding_friction_usd: bMinInput.annual_rounding_friction_usd,
    rounding_friction_ann_usd: bMinInput.rounding_friction_ann_usd,
    annual_passthrough_usd: bMinInput.annual_passthrough_usd,
    fixed_passthrough_ann_usd: bMinInput.fixed_passthrough_ann_usd,
    expected_excess_growth_ann_usd: bMinInput.expected_excess_growth_ann_usd ?? null,
    fee_schedule_resolved: feeParsed,
  });

  const topReason = kPendUnknown
    ? "k_pend_unavailable_buys_blocked"
    : (!oiCost4AllBuysResolved ? "oi_cost_4_price_collar_unavailable_buys_blocked" : null);

  return stripPrivateLocators({
    schema_version: DEPLOYABLE_CAPITAL_SCHEMA,
    status: "available",
    reason: topReason,
    account_id: accountId,
    broker,
    environment,
    currency: "USD",
    currency_coercion: "prohibited",
    fx_inferred: false,
    margin_enabled: false,
    h_usd: "0",
    kelly_applied: false,
    live_trading_enabled: false,
    stop_loss_return_enabled: false,
    fractional_shares: "prohibited",
    evaluated_at: evaluatedAt,
    capital: {
      equity_usd: formatUsdRat(equityRat),
      c_inv_usd: formatUsdRat(cInvRat),
      cash_settled_usd: formatUsdRat(cashSettledRat),
      proceeds_eligible_usd: formatUsdRat(proceedsEligibleRat),
      r_cash_usd: formatUsdRat(rCashRat),
      k_pend_usd: kPendUnknown ? null : formatUsdRat(kPendRat),
      k_pend_release_allowed: kPendReleaseAllowed,
      raw_deployable_cash_usd: kPendUnknown ? null : formatUsdRat(rawAvailRat),
      c_avail_usd: formatUsdRat(cAvailRat),
      total_buy_commit_usd: kPendUnknown ? "0" : formatUsdRat(totalBuyCommitRat),
      remaining_deployable_cash_usd: formatUsdRat(remainingAvailRat),
    },
    fee_schedule: {
      ...feeParsed.view,
      oi_cost_4_resolved: oiCost4AllBuysResolved,
    },
    order_unknown_symbols: orderUnknownSymbols,
    orders: orderItems,
    b_min_tier: bMinTier,
    origin,
    source_class: sourceClass,
    evidence_ref: evidenceRef,
  });
}
