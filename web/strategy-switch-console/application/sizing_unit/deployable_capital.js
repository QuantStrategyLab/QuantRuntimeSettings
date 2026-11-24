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
import {
  parseInstantNs,
  ratAdd,
  ratCmp,
  ratDiv,
  ratFromText,
  ratMul,
  ratSub,
  ratToDecimalText,
  safePublicText,
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
  if (rawAccount.includes(":")) {
    const match = SAFE_ACCOUNT_TUPLE_RE.exec(rawAccount);
    if (!match) return { ok: false, reason: "invalid_account_id" };
    if (broker && match[1] !== broker) return { ok: false, reason: "account_broker_mismatch" };
    if (environment && match[2] !== environment) return { ok: false, reason: "account_environment_mismatch" };
    return { ok: true, value: rawAccount };
  }
  if (!SAFE_OPAQUE_ACCOUNT_RE.test(rawAccount)) {
    return { ok: false, reason: "invalid_account_id" };
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

function resolveEvaluatedAt(input, options) {
  const candidate = options?.evaluated_at ?? input?.evaluated_at ?? input?.sizing_unit_nav?.evaluated_at ?? input?.orders_fills?.evaluated_at;
  if (typeof candidate !== "string") return null;
  const ns = parseInstantNs(candidate);
  return ns === null ? null : toUtcIsoFromNs(ns);
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

  let bExecRat = ZERO_RAT;
  let bExecValid = true;
  if (rawSchedule.b_exec_usd !== undefined) {
    const parsedBExec = parseNonNegativeRat(rawSchedule.b_exec_usd);
    if (!parsedBExec) {
      bExecValid = false;
    } else {
      bExecRat = parsedBExec;
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
  ) {
    const ticketFee = ratAdd(params.fee_schedule_resolved.cMinRat, params.fee_schedule_resolved.cRegSpec.fixed);
    const ticketsTotal = ratMul({ n: BigInt(params.annual_ticket_count), d: 1n }, ticketFee);
    const roundingAnn = params.rounding_friction_ann_usd !== undefined && params.rounding_friction_ann_usd !== null
      ? parseNonNegativeRat(params.rounding_friction_ann_usd)
      : ZERO_RAT;
    const passthroughAnn = params.fixed_passthrough_ann_usd !== undefined && params.fixed_passthrough_ann_usd !== null
      ? parseNonNegativeRat(params.fixed_passthrough_ann_usd)
      : ZERO_RAT;
    if (roundingAnn && passthroughAnn) {
      cFixedRat = ratAdd(ticketsTotal, ratAdd(roundingAnn, passthroughAnn));
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
      reason: "expected_excess_growth_unset",
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
      reason: "c_fixed_ann_unset",
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
  return stripPrivateLocators({
    schema_version: DEPLOYABLE_CAPITAL_SCHEMA,
    status: "unavailable",
    reason,
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
      reason,
    },
    origin,
    source_class: sourceClass,
    evidence_ref: safePublicText(evidenceRef, "sa2:q21:unavailable") || "sa2:q21:unavailable",
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
  const evidenceRefRaw = raw.evidence_ref ?? nav?.evidence_ref ?? ordersFills?.evidence_ref ?? "sa2:q21:eval";
  const evidenceRef = (
    typeof evidenceRefRaw === "string"
    && !isRawAccountIdentifier(evidenceRefRaw)
    && !isUnsafePrivateLocator(evidenceRefRaw)
    && safePublicText(evidenceRefRaw)
  )
    ? evidenceRefRaw
    : "sa2:q21:eval";

  const rawBroker = raw.broker ?? nav?.platform ?? ordersFills?.broker ?? null;
  const broker = typeof rawBroker === "string" && BROKER_SET.has(rawBroker) ? rawBroker : null;
  const rawEnv = raw.environment ?? raw.broker_environment ?? nav?.broker_environment ?? ordersFills?.environment ?? null;
  const environment = typeof rawEnv === "string" && ENV_SET.has(rawEnv) ? rawEnv : null;

  const rawAccount = raw.account_id ?? nav?.account_id ?? ordersFills?.account ?? null;
  const parsedAccount = parseAccountId(rawAccount, broker, environment);
  const accountId = parsedAccount.ok ? parsedAccount.value : null;

  const unknownSet = new Set();
  for (const list of [raw.order_unknown_symbols, ordersFills?.order_unknown_symbols]) {
    if (Array.isArray(list)) {
      for (const sym of list) {
        if (validateSafeSymbol(sym)) unknownSet.add(sym);
      }
    }
  }
  const orderUnknownSymbols = [...unknownSet].sort();

  const feeParsed = normalizeFeeSchedule(raw.fee_schedule);

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
  if (rawBroker !== null && broker === null) {
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
  if (rawEnv !== null && environment === null) {
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
  if (nav && ordersFills) {
    if (nav.account_id && ordersFills.account && nav.account_id !== ordersFills.account) {
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
    if (nav.platform && ordersFills.broker && nav.platform !== ordersFills.broker) {
      return buildUnavailableResult({
        reason: "nav_orders_broker_mismatch",
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
    if (nav.broker_environment && ordersFills.environment && nav.broker_environment !== ordersFills.environment) {
      return buildUnavailableResult({
        reason: "nav_orders_environment_mismatch",
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
      reason: nav.reason || "sizing_unit_nav_unavailable",
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
  if (ordersFills) {
    if (ordersFills.summary?.k_pend_usd === null || ordersFills.summary?.k_pend_usd === undefined) {
      return buildUnavailableResult({
        reason: "k_pend_usd_unavailable",
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
    const ofKPend = parseNonNegativeRat(ordersFills.summary.k_pend_usd);
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

    const idealNotional = ratMul(wTargetRat, equityRat);
    const qIdealInt = ratFloorBigInt(ratDiv(idealNotional, priceRefRat));
    const deltaQRawInt = qIdealInt - qPreInt;

    // Resolve O5 worst-case limit price (OI-COST-4)
    let priceLimRat = null;
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
    } else if (t.price_lim === null || (t.collar_bps === undefined && !feeParsed.defaultCollarRat)) {
      if (t.price_lim === null || deltaQRawInt > 0n) {
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
    } else {
      const collarBps = t.collar_bps !== undefined && t.collar_bps !== null
        ? parseNonNegativeRat(t.collar_bps)
        : feeParsed.defaultCollarRat;
      if (!collarBps) {
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
      priceLimRat = ratMul(priceRefRat, ratAdd(ONE_RAT, ratDiv(collarBps, BPS_DENOM)));
    }

    const prePosRat = ratMul({ n: qPreInt, d: 1n }, priceRefRat);
    cInvRat = ratAdd(cInvRat, prePosRat);

    const wCurRat = equityRat.n > 0n ? ratDiv(prePosRat, equityRat) : ZERO_RAT;
    const bandThreshold = ratMul(bBandRat, wTargetRat);
    const withinBand = bBandRat.n > 0n && ratCmp(ratAbs(ratSub(wCurRat, wTargetRat)), bandThreshold) <= 0;
    const emergencyBypass = Boolean(t.emergency_bypass ?? raw.emergency_bypass);

    preparedTargets.push({
      symbol: t.symbol,
      qPreInt,
      priceRefRat,
      priceLimRat,
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

  // Fold any held non-target positions into C_inv without double counting.
  const targetBySymbol = new Map(preparedTargets.map((item) => [item.symbol, item]));
  for (const extraPos of [raw.positions, nav?.positions].filter(Array.isArray).flat()) {
    if (!extraPos || typeof extraPos !== "object" || !validateSafeSymbol(extraPos.symbol)) continue;
    const qtyInt = parseNonNegativeIntBigInt(extraPos.qty);
    if (qtyInt === null) {
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
    const matchingTarget = targetBySymbol.get(extraPos.symbol);
    if (matchingTarget) {
      if (matchingTarget.qPreInt !== qtyInt) {
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
      continue;
    }
    if (seenSymbols.has(extraPos.symbol)) continue;
    const mvRat = extraPos.market_value_usd !== undefined
      ? parseNonNegativeRat(extraPos.market_value_usd)
      : (extraPos.price_ref ? ratMul({ n: qtyInt, d: 1n }, parsePositiveRat(extraPos.price_ref) ?? ZERO_RAT) : null);
    if (!mvRat) continue;
    seenSymbols.add(extraPos.symbol);
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

  const rawAvailRat = ratSub(ratAdd(cashSettledRat, proceedsEligibleRat), ratAdd(rCashRat, kPendRat));
  const cAvailRat = ratMaxZero(rawAvailRat);

  // First pass: classify holds, reductions, band-suppressed, ORDER-UNKNOWN blocks, and active buys.
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

    // Buy path (deltaQRawInt > 0n)
    if (item.isOrderUnknown) {
      item.deltaQFinalInt = 0n;
      item.action = "BLOCKED_BUY";
      item.buyBlockedReason = "order_unknown_lock";
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

  const remainingAvailRat = ratSub(cAvailRat, totalBuyCommitRat);
  const bMinInput = raw.b_min_tier && typeof raw.b_min_tier === "object" ? raw.b_min_tier : {};
  const bMinTier = evaluateWorkableBankrollBminTier({
    bankroll_w_usd: bMinInput.bankroll_w_usd ?? formatUsdRat(equityRat),
    c_fixed_ann_usd: bMinInput.c_fixed_ann_usd ?? null,
    annual_ticket_count: bMinInput.annual_ticket_count,
    rounding_friction_ann_usd: bMinInput.rounding_friction_ann_usd,
    fixed_passthrough_ann_usd: bMinInput.fixed_passthrough_ann_usd,
    expected_excess_growth_ann_usd: bMinInput.expected_excess_growth_ann_usd ?? null,
    fee_schedule_resolved: feeParsed,
  });

  return stripPrivateLocators({
    schema_version: DEPLOYABLE_CAPITAL_SCHEMA,
    status: "available",
    reason: null,
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
      k_pend_usd: formatUsdRat(kPendRat),
      k_pend_release_allowed: kPendReleaseAllowed,
      raw_deployable_cash_usd: formatUsdRat(rawAvailRat),
      c_avail_usd: formatUsdRat(cAvailRat),
      total_buy_commit_usd: formatUsdRat(totalBuyCommitRat),
      remaining_deployable_cash_usd: formatUsdRat(remainingAvailRat),
    },
    fee_schedule: feeParsed.view,
    order_unknown_symbols: orderUnknownSymbols,
    orders: orderItems,
    b_min_tier: bMinTier,
    origin,
    source_class: sourceClass,
    evidence_ref: evidenceRef,
  });
}
