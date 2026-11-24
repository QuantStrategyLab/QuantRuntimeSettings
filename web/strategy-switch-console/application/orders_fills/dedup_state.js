/**
 * C-SA-25: Execution deduplication, conflicting-duplicate rejection, client_order_id ->
 * broker_order_id linking, lifecycle math (partial fill, partial cancel, cancel, reject),
 * and K_pend commitment calculation.
 *
 * Pure leaf module under application/orders_fills/: imports only inward from
 * ./constants.js, ./normalize.js, ./order_unknown_lock.js, and ../sizing_unit/nav.js.
 */

import {
  addDecimal,
  eqDecimal,
  mulDecimal,
  parseDecimal,
  parseInstantNs,
  ratAdd,
  ratDiv,
  ratMul,
  ratSub,
  ratToDecimalText,
  subDecimal,
  toUtcIsoFromNs,
} from "../sizing_unit/nav.js";
import {
  ORDER_STATE_SET,
  OrdersFillsError,
  TERMINAL_STATE_SET,
} from "./constants.js";
import { formatQtyExact, formatUsdExact, getSubmissionMeta } from "./normalize.js";
import { buildOrderUnknownQueryTarget, listActiveOrderUnknownLocks } from "./order_unknown_lock.js";

const ZERO_DEC = { num: 0n, scale: 0 };

function decEqNullable(aText, bText) {
  const aNorm = aText ?? null;
  const bNorm = bText ?? null;
  if (aNorm === null && bNorm === null) return true;
  if (aNorm === null || bNorm === null) return false;
  const a = parseDecimal(aNorm);
  const b = parseDecimal(bNorm);
  return Boolean(a && b && eqDecimal(a, b));
}

function mergeTwoExecutions(prev, next) {
  if (
    prev.broker !== next.broker
    || prev.environment !== next.environment
    || prev.account !== next.account
    || prev.execution_ref !== next.execution_ref
  ) {
    throw new OrdersFillsError("execution_dedup_key_mismatch", 409);
  }
  const prevExecNs = prev.executed_at !== null && prev.executed_at !== undefined
    ? parseInstantNs(prev.executed_at)
    : null;
  const nextExecNs = next.executed_at !== null && next.executed_at !== undefined
    ? parseInstantNs(next.executed_at)
    : null;
  if (
    prev.symbol !== next.symbol
    || prev.side !== next.side
    || !decEqNullable(prev.qty, next.qty)
    || !decEqNullable(prev.price, next.price)
    || prev.currency !== next.currency
    || (prevExecNs !== null && nextExecNs !== null && prevExecNs !== nextExecNs)
  ) {
    throw new OrdersFillsError("conflicting_duplicate_execution", 409);
  }

  if ((prev.usd_basis_qualified ?? null) !== (next.usd_basis_qualified ?? null)) {
    throw new OrdersFillsError("conflicting_duplicate_execution", 409);
  }
  if (!decEqNullable(prev.notional_usd, next.notional_usd)) {
    throw new OrdersFillsError("conflicting_duplicate_execution", 409);
  }

  for (const idField of ["client_order_id", "broker_order_id"]) {
    const a = prev[idField] ?? null;
    const b = next[idField] ?? null;
    if (a !== null && b !== null && a !== b) {
      throw new OrdersFillsError("conflicting_duplicate_execution", 409);
    }
  }

  let feeNative = prev.fee_native ?? null;
  let feeCurrency = prev.fee_currency ?? null;
  let feeUsd = prev.fee_usd ?? null;
  let usdBasisQualified = prev.usd_basis_qualified;

  if (prev.fee_native === null && next.fee_native !== null) {
    feeNative = next.fee_native;
    feeCurrency = next.fee_currency;
    feeUsd = next.fee_usd;
    usdBasisQualified = prev.usd_basis_qualified || next.usd_basis_qualified;
  } else if (prev.fee_native !== null && next.fee_native !== null) {
    if (!decEqNullable(prev.fee_native, next.fee_native) || prev.fee_currency !== next.fee_currency) {
      throw new OrdersFillsError("conflicting_duplicate_execution", 409);
    }
    if (prev.fee_usd !== null && next.fee_usd !== null && !decEqNullable(prev.fee_usd, next.fee_usd)) {
      throw new OrdersFillsError("conflicting_duplicate_execution", 409);
    }
    if (feeUsd === null && next.fee_usd !== null) {
      feeUsd = next.fee_usd;
    }
  } else if (prev.fee_currency !== null && next.fee_currency !== null && prev.fee_currency !== next.fee_currency) {
    throw new OrdersFillsError("conflicting_duplicate_execution", 409);
  } else if (prev.fee_currency === null && next.fee_currency !== null) {
    feeCurrency = next.fee_currency;
  }

  const executedAt = prev.executed_at ?? next.executed_at ?? null;
  const enriched = (
    feeNative !== prev.fee_native
    || feeCurrency !== prev.fee_currency
    || feeUsd !== prev.fee_usd
    || (prev.client_order_id === null && next.client_order_id !== null)
    || (prev.broker_order_id === null && next.broker_order_id !== null)
    || ((prev.executed_at ?? null) === null && (next.executed_at ?? null) !== null)
  );

  return {
    ...prev,
    client_order_id: prev.client_order_id ?? next.client_order_id ?? null,
    broker_order_id: prev.broker_order_id ?? next.broker_order_id ?? null,
    fee_native: feeNative,
    fee_currency: feeCurrency,
    fee_usd: feeUsd,
    usd_basis_qualified: usdBasisQualified,
    executed_at: executedAt,
    report_ref: enriched && next.report_ref !== null ? next.report_ref : (prev.report_ref ?? next.report_ref ?? null),
    evidence_ref: enriched ? next.evidence_ref : prev.evidence_ref,
  };
}

function compareNullableIso(aIso, bIso) {
  if (aIso === bIso) return 0;
  if (aIso === null || aIso === undefined) return 1;
  if (bIso === null || bIso === undefined) return -1;
  return aIso.localeCompare(bIso);
}

/**
 * Deduplicates execution records keyed strictly by (broker, environment, account, execution_ref).
 * Throws OrdersFillsError("conflicting_duplicate_execution", 409) on substantive mismatch.
 */
export function deduplicateExecutions(incomingExecutions = [], existingExecutions = []) {
  const byKey = new Map();
  for (const row of [...existingExecutions, ...incomingExecutions]) {
    if (!row || typeof row !== "object") {
      throw new OrdersFillsError("invalid_execution_record", 400);
    }
    const key = JSON.stringify([row.broker, row.environment, row.account, row.execution_ref]);
    if (byKey.has(key)) {
      byKey.set(key, mergeTwoExecutions(byKey.get(key), row));
    } else {
      byKey.set(key, { ...row });
    }
  }
  return [...byKey.values()].sort((a, b) => (
    a.broker.localeCompare(b.broker)
    || a.environment.localeCompare(b.environment)
    || a.account.localeCompare(b.account)
    || compareNullableIso(a.executed_at ?? null, b.executed_at ?? null)
    || a.execution_ref.localeCompare(b.execution_ref)
  ));
}

function cmpDec(a, b) {
  const lhs = a.num * (10n ** BigInt(b.scale));
  const rhs = b.num * (10n ** BigInt(a.scale));
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}

function maxDec(a, b) {
  return cmpDec(a, b) >= 0 ? a : b;
}

function maxTimestampIso(aIso, bIso) {
  if (!aIso) return bIso;
  if (!bIso) return aIso;
  const aNs = parseInstantNs(aIso);
  const bNs = parseInstantNs(bIso);
  if (aNs === null) return bIso;
  if (bNs === null) return aIso;
  return aNs >= bNs ? toUtcIsoFromNs(aNs) : toUtcIsoFromNs(bNs);
}

function mergeOrderSkeleton(prev, next) {
  if (prev.symbol !== next.symbol || prev.side !== next.side || prev.currency !== next.currency) {
    throw new OrdersFillsError("conflicting_duplicate_order", 409);
  }
  if (!decEqNullable(prev.qty_submitted, next.qty_submitted)) {
    throw new OrdersFillsError("conflicting_duplicate_order", 409);
  }
  if (prev.broker_order_id !== null && next.broker_order_id !== null && prev.broker_order_id !== next.broker_order_id) {
    throw new OrdersFillsError("conflicting_duplicate_order", 409);
  }
  if (prev.limit_price !== null && next.limit_price !== null && !decEqNullable(prev.limit_price, next.limit_price)) {
    throw new OrdersFillsError("conflicting_duplicate_order", 409);
  }
  return {
    ...prev,
    broker_order_id: prev.broker_order_id ?? next.broker_order_id ?? null,
    limit_price: prev.limit_price ?? next.limit_price ?? null,
    usd_basis_qualified: prev.usd_basis_qualified || next.usd_basis_qualified,
  };
}

/**
 * Reconciles submissions, deduplicated executions, cutoff open orders, and ORDER-UNKNOWN locks
 * for one (broker, environment, account) identity.
 */
export function reconcileOrdersAndFills({
  identity,
  submissions = [],
  executions = [],
  cutoffOpenOrders = [],
  cutoffCoverage = null,
  lockStore = null,
  priorKPendUsd = null,
  priorKPendOrderIds = null,
  evaluatedAt,
}) {
  const evalNs = typeof evaluatedAt === "string" ? parseInstantNs(evaluatedAt) : null;
  if (evaluatedAt !== undefined && evaluatedAt !== null && evalNs === null) {
    throw new OrdersFillsError("invalid_evaluated_at", 400);
  }
  const dedupedExecs = deduplicateExecutions(executions, []);
  const orderMap = new Map();
  let hasFutureEvents = false;

  const ensureEntry = (clientOrderId, base) => {
    const key = `${identity.binding_key}|${clientOrderId}`;
    if (!orderMap.has(key)) {
      orderMap.set(key, {
        broker: identity.broker,
        environment: identity.environment,
        account: identity.account,
        client_order_id: clientOrderId,
        broker_order_id: base.broker_order_id ?? null,
        symbol: base.symbol,
        side: base.side,
        currency: base.currency,
        qty_submitted: base.qty_submitted,
        limit_price: base.limit_price ?? null,
        usd_basis_qualified: Boolean(base.usd_basis_qualified),
        submission: null,
        terminalSub: null,
        sawOrderUnknown: false,
        sawFutureTransition: false,
        cutoff: null,
        executions: [],
      });
    } else {
      const merged = mergeOrderSkeleton(orderMap.get(key), base);
      orderMap.set(key, merged);
    }
    return orderMap.get(key);
  };

  for (const sub of submissions) {
    const meta = getSubmissionMeta(sub);
    const subSubmittedNs = meta?.submitted_at_ns ?? parseInstantNs(sub.submitted_at);
    const subEffectiveNs = meta?.effective_at_ns ?? subSubmittedNs;
    const isFutureSub = evalNs !== null && subEffectiveNs !== null && subEffectiveNs > evalNs;
    const isSubmittedAfterEval = evalNs !== null && subSubmittedNs !== null && subSubmittedNs > evalNs;

    if (isFutureSub) {
      hasFutureEvents = true;
      if (isSubmittedAfterEval) {
        continue;
      }
      const entry = ensureEntry(sub.client_order_id, sub);
      entry.sawFutureTransition = true;
      // Keep original WeakMap-tracked sub object when no prior submission exists,
      // while sawFutureTransition prevents future cancel/terminal/filled state taking effect.
      if (!entry.submission) {
        entry.submission = sub;
      }
      if (sub.state === "ORDER_UNKNOWN") {
        entry.sawOrderUnknown = true;
      }
      continue;
    }

    const entry = ensureEntry(sub.client_order_id, sub);
    if (sub.state === "ORDER_UNKNOWN") {
      entry.sawOrderUnknown = true;
    }
    if (entry.submission) {
      if (
        entry.submission.state !== sub.state
        && TERMINAL_STATE_SET.has(entry.submission.state)
        && !TERMINAL_STATE_SET.has(sub.state)
        && !entry.sawFutureTransition
      ) {
        throw new OrdersFillsError("conflicting_duplicate_order", 409);
      }
      if (
        entry.terminalSub
        && TERMINAL_STATE_SET.has(sub.state)
        && entry.terminalSub.state !== sub.state
      ) {
        throw new OrdersFillsError("conflicting_duplicate_order", 409);
      }
    }
    if (TERMINAL_STATE_SET.has(sub.state)) {
      entry.terminalSub = sub;
    }
    entry.submission = sub;
  }

  for (const open of cutoffOpenOrders) {
    const entry = ensureEntry(open.client_order_id, open);
    if (entry.cutoff) {
      throw new OrdersFillsError("conflicting_duplicate_order", 409);
    }
    const cutoffNs = parseInstantNs(open.as_of);
    if (evalNs !== null && cutoffNs !== null && cutoffNs > evalNs) {
      hasFutureEvents = true;
      entry.sawFutureTransition = true;
    }
    entry.cutoff = open;
  }

  // Link executions to orders by client_order_id or broker_order_id within the same account.
  // Reject conflicting duplicate broker_order_id across distinct client_order_id values.
  const byBrokerOrderId = new Map();
  for (const entry of orderMap.values()) {
    if (entry.broker_order_id !== null) {
      const existingOwner = byBrokerOrderId.get(entry.broker_order_id);
      if (existingOwner && existingOwner.client_order_id !== entry.client_order_id) {
        throw new OrdersFillsError("conflicting_duplicate_broker_order_id", 409);
      }
      byBrokerOrderId.set(entry.broker_order_id, entry);
    }
  }
  let hasUnknownExecTimestamps = false;
  const linkExecutionToTarget = (exec, target) => {
    if (target.symbol !== exec.symbol || target.side !== exec.side || target.currency !== exec.currency) {
      throw new OrdersFillsError("execution_order_mismatch", 409);
    }
    if (target.broker_order_id !== null && exec.broker_order_id !== null && target.broker_order_id !== exec.broker_order_id) {
      throw new OrdersFillsError("execution_broker_order_id_mismatch", 409);
    }
    if (target.broker_order_id === null && exec.broker_order_id !== null) {
      const existingOwner = byBrokerOrderId.get(exec.broker_order_id);
      if (existingOwner && existingOwner.client_order_id !== target.client_order_id) {
        throw new OrdersFillsError("conflicting_duplicate_broker_order_id", 409);
      }
      target.broker_order_id = exec.broker_order_id;
      byBrokerOrderId.set(exec.broker_order_id, target);
    }
    target.executions.push(exec);
  };

  // Pass 1: link client_order_id-bearing executions first so they populate missing
  // broker_order_id mappings before retrying broker_order_id-only executions.
  const unmatchedBrokerExecs = [];
  for (const exec of dedupedExecs) {
    const execNs = exec.executed_at !== null && exec.executed_at !== undefined
      ? parseInstantNs(exec.executed_at)
      : null;
    if (execNs === null) {
      hasUnknownExecTimestamps = true;
    } else if (evalNs !== null && execNs > evalNs) {
      hasFutureEvents = true;
    }
    if (exec.client_order_id !== null) {
      const target = orderMap.get(`${identity.binding_key}|${exec.client_order_id}`) ?? null;
      if (target) {
        linkExecutionToTarget(exec, target);
      }
    } else if (exec.broker_order_id !== null) {
      unmatchedBrokerExecs.push(exec);
    }
  }
  for (const exec of unmatchedBrokerExecs) {
    const target = byBrokerOrderId.get(exec.broker_order_id) ?? null;
    if (target) {
      linkExecutionToTarget(exec, target);
    }
  }
  for (const entry of orderMap.values()) {
    if (entry.executions.length > 1) {
      entry.executions.sort((a, b) => (
        compareNullableIso(a.executed_at ?? null, b.executed_at ?? null)
        || a.execution_ref.localeCompare(b.execution_ref)
      ));
    }
  }

  const activeLocks = lockStore ? listActiveOrderUnknownLocks(lockStore, identity) : [];
  const lockByClientId = new Map(activeLocks.map((l) => [l.client_order_id, l]));
  const lockByBrokerId = new Map(activeLocks.filter((l) => l.broker_order_id !== null).map((l) => [l.broker_order_id, l]));

  const reconciledOrders = [];
  const computedOrderLocks = new Map();

  for (const entry of orderMap.values()) {
    const sub = entry.submission;
    const cutoff = entry.cutoff;
    const matchingExecs = entry.executions;
    const effectiveExecs = evalNs === null
      ? matchingExecs
      : matchingExecs.filter((ex) => {
        if (ex.executed_at === null || ex.executed_at === undefined) return true;
        const exNs = parseInstantNs(ex.executed_at);
        return exNs !== null && exNs <= evalNs;
      });
    const orderHasUnknownExecTs = effectiveExecs.some((ex) => ex.executed_at === null || ex.executed_at === undefined);
    const lockFromClient = lockByClientId.get(entry.client_order_id) ?? null;
    const lockFromBroker = entry.broker_order_id !== null ? (lockByBrokerId.get(entry.broker_order_id) ?? null) : null;
    if (lockFromClient && lockFromBroker && lockFromClient.client_order_id !== lockFromBroker.client_order_id) {
      throw new OrdersFillsError("conflicting_broker_order_id_on_lock", 409);
    }
    const activeLock = lockFromClient ?? lockFromBroker ?? null;
    if (activeLock && activeLock.symbol !== entry.symbol) {
      throw new OrdersFillsError("order_unknown_symbol_mismatch", 409);
    }

    const subDec = parseDecimal(entry.qty_submitted);
    let filledFromExecs = ZERO_DEC;
    for (const ex of effectiveExecs) {
      filledFromExecs = addDecimal(filledFromExecs, parseDecimal(ex.qty));
    }
    const cutoffNs = cutoff ? parseInstantNs(cutoff.as_of) : null;
    if (cutoff && cutoffNs === null) {
      throw new OrdersFillsError("invalid_cutoff_as_of", 400);
    }
    const cutoffIsFuture = Boolean(cutoff && evalNs !== null && cutoffNs !== null && cutoffNs > evalNs);
    const subMeta = getSubmissionMeta(sub);

    let filledDec = ZERO_DEC;
    let filledAfterCutoff = ZERO_DEC;
    let canceledDec = ZERO_DEC;
    let postCutoffSubTerminal = false;

    if (cutoff && !cutoffIsFuture) {
      let filledUpToCutoffFromExecs = ZERO_DEC;
      for (const ex of effectiveExecs) {
        const exNs = ex.executed_at !== null && ex.executed_at !== undefined
          ? parseInstantNs(ex.executed_at)
          : null;
        if (exNs === null) {
          continue;
        }
        if (exNs <= cutoffNs) {
          filledUpToCutoffFromExecs = addDecimal(filledUpToCutoffFromExecs, parseDecimal(ex.qty));
        } else {
          filledAfterCutoff = addDecimal(filledAfterCutoff, parseDecimal(ex.qty));
        }
      }
      const cutoffFilled = parseDecimal(cutoff.qty_filled);
      const filledAtCutoffDec = maxDec(filledUpToCutoffFromExecs, cutoffFilled);
      const canceledAtCutoffDec = parseDecimal(cutoff.qty_canceled);
      const remainingAtCutoffDec = subDecimal(subDecimal(subDec, filledAtCutoffDec), canceledAtCutoffDec);
      if (remainingAtCutoffDec.num < 0n) {
        throw new OrdersFillsError("order_quantities_exceed_submitted", 400);
      }
      if (!eqDecimal(remainingAtCutoffDec, parseDecimal(cutoff.qty_remaining))) {
        throw new OrdersFillsError("order_remaining_cutoff_mismatch", 409);
      }

      filledDec = addDecimal(filledAtCutoffDec, filledAfterCutoff);
      canceledDec = canceledAtCutoffDec;
      const subTransitionNs = sub
        ? (subMeta?.effective_at_ns ?? parseInstantNs(sub.submitted_at))
        : null;
      if (
        !entry.sawFutureTransition
        && sub
        && subTransitionNs !== null
        && subTransitionNs > cutoffNs
      ) {
        if (subMeta?.qty_canceled !== undefined) {
          canceledDec = maxDec(canceledAtCutoffDec, parseDecimal(subMeta.qty_canceled));
        } else if (sub.state === "CANCELED" || sub.state === "REJECTED") {
          canceledDec = maxDec(canceledAtCutoffDec, subDecimal(subDec, filledDec));
        } else if (sub.state === "PARTIAL_CANCEL" && filledDec.num > 0n) {
          canceledDec = maxDec(canceledAtCutoffDec, subDecimal(subDec, filledDec));
        }
        if (TERMINAL_STATE_SET.has(sub.state) || sub.state === "PARTIAL_CANCEL") {
          postCutoffSubTerminal = true;
        }
      }
    } else {
      filledDec = filledFromExecs;
      if (!entry.sawFutureTransition && !cutoffIsFuture) {
        if (subMeta?.qty_canceled !== undefined) {
          canceledDec = parseDecimal(subMeta.qty_canceled);
        } else if (sub && (sub.state === "CANCELED" || sub.state === "REJECTED")) {
          canceledDec = subDecimal(subDec, filledDec);
        }
      }
    }

    const remainingDec = subDecimal(subDecimal(subDec, filledDec), canceledDec);
    if (remainingDec.num < 0n) {
      throw new OrdersFillsError("order_quantities_exceed_submitted", 400);
    }

    let state = (postCutoffSubTerminal ? sub.state : null)
      ?? (cutoff && !cutoffIsFuture ? cutoff.state : null)
      ?? (entry.sawFutureTransition ? (entry.sawOrderUnknown ? "ORDER_UNKNOWN" : "SUBMITTED") : sub?.state)
      ?? "SUBMITTED";
    if (!ORDER_STATE_SET.has(state)) {
      throw new OrdersFillsError("invalid_order_state", 400);
    }
    const subTerminal = !entry.sawFutureTransition && (Boolean(entry.terminalSub) || (sub && TERMINAL_STATE_SET.has(sub.state)));
    const cutoffTerminal = Boolean(cutoff && !cutoffIsFuture && TERMINAL_STATE_SET.has(cutoff.state));
    const terminalObserved = !entry.sawFutureTransition && (subTerminal || cutoffTerminal);

    if ((activeLock || entry.sawOrderUnknown) && !terminalObserved) {
      state = "ORDER_UNKNOWN";
    } else if (entry.sawFutureTransition && TERMINAL_STATE_SET.has(state)) {
      state = activeLock || entry.sawOrderUnknown ? "ORDER_UNKNOWN" : "SUBMITTED";
    } else if (!terminalObserved && state !== "ORDER_UNKNOWN" && state !== "PARTIAL_CANCEL") {
      if (remainingDec.num === 0n && eqDecimal(filledDec, subDec) && !cutoffIsFuture) {
        state = "FILLED";
      } else if (remainingDec.num === 0n && filledDec.num > 0n && canceledDec.num > 0n && !cutoffIsFuture) {
        state = "PARTIAL_CANCEL";
      } else if (filledDec.num > 0n && remainingDec.num > 0n) {
        state = "PARTIAL_FILL";
      }
    }

    // Avg fill price across effective (<= evaluatedAt) executions
    let avgFillPrice = null;
    if (effectiveExecs.length > 0 && filledFromExecs.num > 0n) {
      let totalVal = { n: 0n, d: 1n };
      let totalQty = { n: 0n, d: 1n };
      for (const ex of effectiveExecs) {
        const q = parseDecimal(ex.qty);
        const p = parseDecimal(ex.price);
        const qRat = { n: q.num, d: 10n ** BigInt(q.scale) };
        const pRat = { n: p.num, d: 10n ** BigInt(p.scale) };
        totalVal = ratAdd(totalVal, ratMul(qRat, pRat));
        totalQty = ratAdd(totalQty, qRat);
      }
      if (totalQty.n > 0n) {
        avgFillPrice = ratToDecimalText(ratDiv(totalVal, totalQty), { minScale: 2, maxScale: 8 });
      }
    }

    // Fees: preserve null whenever any fee is missing or non-USD without qualified basis.
    let feeNative = null;
    let feeCurrency = null;
    let feeUsd = null;
    if (effectiveExecs.length > 0) {
      const anyNullFee = effectiveExecs.some((ex) => ex.fee_native === null);
      const feeCurrencies = [...new Set(effectiveExecs.map((ex) => ex.fee_currency).filter(Boolean))];
      if (!anyNullFee && feeCurrencies.length === 1) {
        let sumNative = ZERO_DEC;
        for (const ex of effectiveExecs) {
          sumNative = addDecimal(sumNative, parseDecimal(ex.fee_native));
        }
        feeCurrency = feeCurrencies[0];
        feeNative = feeCurrency === "USD" ? formatUsdExact(sumNative) : formatQtyExact(sumNative);
      }
      const allUsd = effectiveExecs.every((ex) => ex.fee_usd !== null);
      if (allUsd) {
        let sumUsd = ZERO_DEC;
        for (const ex of effectiveExecs) {
          sumUsd = addDecimal(sumUsd, parseDecimal(ex.fee_usd));
        }
        feeUsd = formatUsdExact(sumUsd);
      }
    } else if (sub && sub.fee_native !== null) {
      feeNative = sub.fee_native;
      feeCurrency = sub.fee_currency;
      feeUsd = sub.fee_usd;
    }

    let notionalUsd = null;
    let usdBasisQualified = entry.currency === "USD" || entry.usd_basis_qualified;
    if (entry.currency === "USD") {
      if (filledFromExecs.num > 0n) {
        let sumNotional = ZERO_DEC;
        for (const ex of effectiveExecs) {
          sumNotional = addDecimal(sumNotional, parseDecimal(ex.notional_usd));
        }
        notionalUsd = formatUsdExact(sumNotional);
      } else if (entry.limit_price !== null) {
        notionalUsd = formatUsdExact(mulDecimal(subDec, parseDecimal(entry.limit_price)));
      }
    } else if (effectiveExecs.length > 0 && effectiveExecs.every((ex) => ex.notional_usd !== null)) {
      let sumNotional = ZERO_DEC;
      for (const ex of effectiveExecs) {
        sumNotional = addDecimal(sumNotional, parseDecimal(ex.notional_usd));
      }
      notionalUsd = formatUsdExact(sumNotional);
      usdBasisQualified = true;
    }

    let kPendUsd = null;
    const isTerminalZeroRemaining = (
      (TERMINAL_STATE_SET.has(state) || (state === "PARTIAL_CANCEL" && remainingDec.num === 0n))
      && !entry.sawFutureTransition
    );
    if (entry.side === "SELL") {
      kPendUsd = usdBasisQualified ? "0" : null;
    } else if (isTerminalZeroRemaining) {
      kPendUsd = usdBasisQualified ? "0" : null;
    } else if (orderHasUnknownExecTs && cutoff && !cutoffIsFuture) {
      kPendUsd = null;
    } else if (activeLock && activeLock.k_pend_usd !== null) {
      kPendUsd = activeLock.k_pend_usd;
    } else if (cutoff && !cutoffIsFuture && cutoff.k_pend_usd !== null && filledAfterCutoff.num === 0n) {
      kPendUsd = cutoff.k_pend_usd;
    } else if (entry.currency === "USD") {
      if (remainingDec.num === 0n) {
        kPendUsd = "0";
      } else if (entry.limit_price !== null) {
        const feeReserveRaw = cutoff?.reserved_fee_usd ?? subMeta?.estimated_fee_usd ?? null;
        if (feeReserveRaw === null) {
          kPendUsd = null;
        } else {
          const baseNotional = mulDecimal(remainingDec, parseDecimal(entry.limit_price));
          kPendUsd = formatUsdExact(addDecimal(baseNotional, parseDecimal(feeReserveRaw)));
        }
      } else {
        kPendUsd = null;
      }
    }

    const subEventIso = !entry.sawFutureTransition
      ? (subMeta?.effective_at_ns !== null && subMeta?.effective_at_ns !== undefined
        ? toUtcIsoFromNs(subMeta.effective_at_ns)
        : (sub?.submitted_at ?? null))
      : (sub?.submitted_at ?? null);
    let latestExecAt = null;
    for (const ex of effectiveExecs) {
      latestExecAt = maxTimestampIso(latestExecAt, ex.executed_at);
    }
    const updatedAt = maxTimestampIso(
      maxTimestampIso(subEventIso, cutoff && !cutoffIsFuture ? cutoff.as_of : null),
      latestExecAt,
    ) ?? evaluatedAt;

    const queryTarget = state === "ORDER_UNKNOWN"
      ? buildOrderUnknownQueryTarget({
        ...identity,
        client_order_id: entry.client_order_id,
        broker_order_id: entry.broker_order_id,
      })
      : null;

    const evidenceRef = cutoff?.evidence_ref
      ?? (effectiveExecs.length > 0 ? effectiveExecs[effectiveExecs.length - 1].evidence_ref : null)
      ?? sub?.evidence_ref
      ?? (matchingExecs.length > 0 ? matchingExecs[matchingExecs.length - 1].evidence_ref : "sa2:reconciled");

    if (state === "ORDER_UNKNOWN") {
      computedOrderLocks.set(entry.client_order_id, {
        broker: identity.broker,
        environment: identity.environment,
        account: identity.account,
        symbol: entry.symbol,
        client_order_id: entry.client_order_id,
        broker_order_id: entry.broker_order_id,
        query_target: queryTarget,
        k_pend_usd: kPendUsd,
        locked_at: activeLock?.locked_at ?? updatedAt,
        status: "locked",
        allow_new_orders: false,
        query_before_retry_required: true,
        clear_condition: "definitive_terminal_broker_evidence",
      });
    }

    reconciledOrders.push({
      broker: identity.broker,
      environment: identity.environment,
      account: identity.account,
      client_order_id: entry.client_order_id,
      broker_order_id: entry.broker_order_id,
      symbol: entry.symbol,
      side: entry.side,
      state,
      currency: entry.currency,
      qty_submitted: entry.qty_submitted,
      qty_filled: formatQtyExact(filledDec),
      qty_canceled: formatQtyExact(canceledDec),
      qty_remaining: formatQtyExact(remainingDec),
      limit_price: entry.limit_price,
      avg_fill_price: avgFillPrice,
      fee_native: feeNative,
      fee_currency: feeCurrency,
      fee_usd: feeUsd,
      notional_usd: notionalUsd,
      k_pend_usd: kPendUsd,
      usd_basis_qualified: usdBasisQualified,
      query_target: queryTarget,
      updated_at: updatedAt,
      evidence_ref: evidenceRef,
    });
  }

  // Merge active locks from external persistent lockStore that were NOT terminated on exact symbol & identity.
  for (const lock of activeLocks) {
    if (!computedOrderLocks.has(lock.client_order_id)) {
      const terminatedOnMatchingOrder = reconciledOrders.some((o) => {
        const ordMeta = orderMap.get(`${identity.binding_key}|${o.client_order_id}`);
        if (ordMeta?.sawFutureTransition) return false;
        const idMatches = o.client_order_id === lock.client_order_id
          || (lock.broker_order_id !== null && o.broker_order_id === lock.broker_order_id);
        return (
          idMatches
          && o.broker === lock.broker
          && o.environment === lock.environment
          && o.account === lock.account
          && o.symbol === lock.symbol
          && TERMINAL_STATE_SET.has(o.state)
        );
      });
      if (!terminatedOnMatchingOrder) {
        computedOrderLocks.set(lock.client_order_id, lock);
      }
    }
  }

  const orderUnknownLocks = [...computedOrderLocks.values()].sort((a, b) => (
    a.symbol.localeCompare(b.symbol) || a.client_order_id.localeCompare(b.client_order_id)
  ));
  const orderUnknownSymbols = [...new Set(orderUnknownLocks.map((l) => l.symbol))].sort();

  const priorOrderIdSet = new Set();
  if (Array.isArray(priorKPendOrderIds)) {
    for (const id of priorKPendOrderIds) {
      if (typeof id === "string" && id.length > 0) priorOrderIdSet.add(id);
    }
  }

  // Compute aggregate K_pend in USD across working orders + any unrepresented external locks,
  // partitioning any overlapping prior-accounted IDs from non-overlapping new orders/submissions.
  let overlapVisibleDec = ZERO_DEC;
  let newNonOverlappingDec = ZERO_DEC;
  let kPendUnavailable = false;
  const accountedLockClientIds = new Set();

  for (const ord of reconciledOrders) {
    if (ord.state === "ORDER_UNKNOWN") accountedLockClientIds.add(ord.client_order_id);
    const isWorkingBuy = ord.side === "BUY"
      && !TERMINAL_STATE_SET.has(ord.state)
      && !(ord.state === "PARTIAL_CANCEL" && ord.qty_remaining === "0");
    if (ord.k_pend_usd === null) {
      if (isWorkingBuy) {
        kPendUnavailable = true;
      }
    } else {
      const kDec = parseDecimal(ord.k_pend_usd);
      const isPriorOverlap = priorOrderIdSet.has(ord.client_order_id)
        || (ord.broker_order_id !== null && priorOrderIdSet.has(ord.broker_order_id));
      if (isPriorOverlap) {
        overlapVisibleDec = addDecimal(overlapVisibleDec, kDec);
      } else {
        newNonOverlappingDec = addDecimal(newNonOverlappingDec, kDec);
      }
    }
  }

  for (const lock of orderUnknownLocks) {
    if (accountedLockClientIds.has(lock.client_order_id)) continue;
    if (lock.k_pend_usd === null) {
      kPendUnavailable = true;
    } else {
      const kDec = parseDecimal(lock.k_pend_usd);
      const isPriorOverlap = priorOrderIdSet.has(lock.client_order_id)
        || (lock.broker_order_id !== null && priorOrderIdSet.has(lock.broker_order_id));
      if (isPriorOverlap) {
        overlapVisibleDec = addDecimal(overlapVisibleDec, kDec);
      } else {
        newNonOverlappingDec = addDecimal(newNonOverlappingDec, kDec);
      }
    }
  }

  const cutoffCoverageAsOfNs = cutoffCoverage?.as_of ? parseInstantNs(cutoffCoverage.as_of) : null;
  const cutoffCoverageIsFuture = Boolean(
    evalNs !== null && cutoffCoverageAsOfNs !== null && cutoffCoverageAsOfNs > evalNs,
  );
  if (cutoffCoverageIsFuture) {
    hasFutureEvents = true;
  }
  const cutoffDomainProvenComplete = Boolean(cutoffCoverage?.k_pend_release_allowed) && !cutoffCoverageIsFuture;
  const coverageAllowsRelease = (
    cutoffDomainProvenComplete
    && orderUnknownLocks.length === 0
    && !hasFutureEvents
    && !hasUnknownExecTimestamps
  );

  if (!cutoffDomainProvenComplete && (priorKPendUsd === null || priorKPendUsd === undefined)) {
    kPendUnavailable = true;
  }

  let kPendUsdOut = null;
  if (!kPendUnavailable) {
    if (!coverageAllowsRelease && priorKPendUsd !== null && priorKPendUsd !== undefined) {
      const priorDec = typeof priorKPendUsd === "string" ? parseDecimal(priorKPendUsd) : null;
      if (!priorDec || priorDec.num < 0n) {
        throw new OrdersFillsError("invalid_prior_k_pend_usd", 400);
      }
      kPendUsdOut = formatUsdExact(addDecimal(newNonOverlappingDec, maxDec(overlapVisibleDec, priorDec)));
    } else {
      kPendUsdOut = formatUsdExact(addDecimal(overlapVisibleDec, newNonOverlappingDec));
    }
  } else if (!coverageAllowsRelease && priorKPendUsd !== null && priorKPendUsd !== undefined) {
    // Still validate explicit priorKPendUsd type/sign even when unknown working order keeps total K_pend null
    const priorDec = typeof priorKPendUsd === "string" ? parseDecimal(priorKPendUsd) : null;
    if (!priorDec || priorDec.num < 0n) {
      throw new OrdersFillsError("invalid_prior_k_pend_usd", 400);
    }
  }

  reconciledOrders.sort((a, b) => a.client_order_id.localeCompare(b.client_order_id));

  return {
    orders: reconciledOrders,
    executions: dedupedExecs,
    order_unknown_locks: orderUnknownLocks,
    order_unknown_symbols: orderUnknownSymbols,
    k_pend_usd: kPendUsdOut,
    k_pend_release_allowed: coverageAllowsRelease,
    has_future_events: hasFutureEvents,
  };
}
