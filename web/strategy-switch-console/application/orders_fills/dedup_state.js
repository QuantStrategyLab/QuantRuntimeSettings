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
  if (aText === null && bText === null) return true;
  if (aText === null || bText === null) return false;
  const a = parseDecimal(aText);
  const b = parseDecimal(bText);
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
  if (
    prev.symbol !== next.symbol
    || prev.side !== next.side
    || !decEqNullable(prev.qty, next.qty)
    || !decEqNullable(prev.price, next.price)
    || prev.currency !== next.currency
    || parseInstantNs(prev.executed_at) !== parseInstantNs(next.executed_at)
  ) {
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

  const enriched = (
    feeNative !== prev.fee_native
    || feeCurrency !== prev.fee_currency
    || feeUsd !== prev.fee_usd
    || (prev.client_order_id === null && next.client_order_id !== null)
    || (prev.broker_order_id === null && next.broker_order_id !== null)
  );

  return {
    ...prev,
    client_order_id: prev.client_order_id ?? next.client_order_id ?? null,
    broker_order_id: prev.broker_order_id ?? next.broker_order_id ?? null,
    fee_native: feeNative,
    fee_currency: feeCurrency,
    fee_usd: feeUsd,
    usd_basis_qualified: usdBasisQualified,
    report_ref: enriched && next.report_ref !== null ? next.report_ref : (prev.report_ref ?? next.report_ref ?? null),
    evidence_ref: enriched ? next.evidence_ref : prev.evidence_ref,
  };
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
    || a.executed_at.localeCompare(b.executed_at)
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
  evaluatedAt,
}) {
  const dedupedExecs = deduplicateExecutions(executions, []);
  const orderMap = new Map();

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
    const entry = ensureEntry(sub.client_order_id, sub);
    if (entry.submission) {
      // Allow idempotent repeat or progression from ORDER_UNKNOWN/SUBMITTED to later state,
      // but reject conflicting immutable fields via mergeOrderSkeleton above.
      if (
        entry.submission.state !== sub.state
        && TERMINAL_STATE_SET.has(entry.submission.state)
        && !TERMINAL_STATE_SET.has(sub.state)
      ) {
        throw new OrdersFillsError("conflicting_duplicate_order", 409);
      }
    }
    entry.submission = sub;
  }

  for (const open of cutoffOpenOrders) {
    const entry = ensureEntry(open.client_order_id, open);
    if (entry.cutoff) {
      throw new OrdersFillsError("conflicting_duplicate_order", 409);
    }
    entry.cutoff = open;
  }

  // Link executions to orders by client_order_id or broker_order_id within the same account.
  const byBrokerOrderId = new Map();
  for (const entry of orderMap.values()) {
    if (entry.broker_order_id !== null) {
      byBrokerOrderId.set(entry.broker_order_id, entry);
    }
  }
  for (const exec of dedupedExecs) {
    let target = null;
    if (exec.client_order_id !== null) {
      target = orderMap.get(`${identity.binding_key}|${exec.client_order_id}`) ?? null;
    } else if (exec.broker_order_id !== null) {
      target = byBrokerOrderId.get(exec.broker_order_id) ?? null;
    }
    if (!target) continue;
    if (target.symbol !== exec.symbol || target.side !== exec.side || target.currency !== exec.currency) {
      throw new OrdersFillsError("execution_order_mismatch", 409);
    }
    if (target.broker_order_id !== null && exec.broker_order_id !== null && target.broker_order_id !== exec.broker_order_id) {
      throw new OrdersFillsError("execution_broker_order_id_mismatch", 409);
    }
    if (target.broker_order_id === null && exec.broker_order_id !== null) {
      target.broker_order_id = exec.broker_order_id;
    }
    target.executions.push(exec);
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
    const activeLock = lockByClientId.get(entry.client_order_id)
      ?? (entry.broker_order_id !== null ? lockByBrokerId.get(entry.broker_order_id) : undefined)
      ?? null;

    const subDec = parseDecimal(entry.qty_submitted);
    let filledFromExecs = ZERO_DEC;
    for (const ex of matchingExecs) {
      filledFromExecs = addDecimal(filledFromExecs, parseDecimal(ex.qty));
    }
    const cutoffFilled = cutoff ? parseDecimal(cutoff.qty_filled) : ZERO_DEC;
    const filledDec = maxDec(filledFromExecs, cutoffFilled);

    const subMeta = getSubmissionMeta(sub);
    let canceledDec = ZERO_DEC;
    if (cutoff) {
      canceledDec = parseDecimal(cutoff.qty_canceled);
    } else if (subMeta?.qty_canceled !== undefined) {
      canceledDec = parseDecimal(subMeta.qty_canceled);
    } else if (sub && (sub.state === "CANCELED" || sub.state === "REJECTED")) {
      canceledDec = subDecimal(subDec, filledDec);
    }

    const remainingDec = subDecimal(subDecimal(subDec, filledDec), canceledDec);
    if (remainingDec.num < 0n) {
      throw new OrdersFillsError("order_quantities_exceed_submitted", 400);
    }
    if (cutoff && !eqDecimal(remainingDec, parseDecimal(cutoff.qty_remaining))) {
      throw new OrdersFillsError("order_remaining_cutoff_mismatch", 409);
    }

    let state = cutoff?.state ?? sub?.state ?? "SUBMITTED";
    if (!ORDER_STATE_SET.has(state)) {
      throw new OrdersFillsError("invalid_order_state", 400);
    }
    const terminalObserved = TERMINAL_STATE_SET.has(sub?.state) || TERMINAL_STATE_SET.has(cutoff?.state);
    if (activeLock && !terminalObserved) {
      state = "ORDER_UNKNOWN";
    } else if (!terminalObserved && state !== "ORDER_UNKNOWN" && state !== "PARTIAL_CANCEL") {
      if (remainingDec.num === 0n && eqDecimal(filledDec, subDec)) {
        state = "FILLED";
      } else if (remainingDec.num === 0n && filledDec.num > 0n && canceledDec.num > 0n) {
        state = "PARTIAL_CANCEL";
      } else if (filledDec.num > 0n && remainingDec.num > 0n) {
        state = "PARTIAL_FILL";
      }
    }

    // Avg fill price across matching executions
    let avgFillPrice = null;
    if (matchingExecs.length > 0 && filledFromExecs.num > 0n) {
      let totalVal = { n: 0n, d: 1n };
      let totalQty = { n: 0n, d: 1n };
      for (const ex of matchingExecs) {
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
    if (matchingExecs.length > 0) {
      const anyNullFee = matchingExecs.some((ex) => ex.fee_native === null);
      const feeCurrencies = [...new Set(matchingExecs.map((ex) => ex.fee_currency).filter(Boolean))];
      if (!anyNullFee && feeCurrencies.length === 1) {
        let sumNative = ZERO_DEC;
        for (const ex of matchingExecs) {
          sumNative = addDecimal(sumNative, parseDecimal(ex.fee_native));
        }
        feeCurrency = feeCurrencies[0];
        feeNative = feeCurrency === "USD" ? formatUsdExact(sumNative) : formatQtyExact(sumNative);
        const allUsd = matchingExecs.every((ex) => ex.fee_usd !== null);
        if (allUsd) {
          let sumUsd = ZERO_DEC;
          for (const ex of matchingExecs) {
            sumUsd = addDecimal(sumUsd, parseDecimal(ex.fee_usd));
          }
          feeUsd = formatUsdExact(sumUsd);
        }
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
        for (const ex of matchingExecs) {
          sumNotional = addDecimal(sumNotional, parseDecimal(ex.notional_usd));
        }
        notionalUsd = formatUsdExact(sumNotional);
      } else if (entry.limit_price !== null) {
        notionalUsd = formatUsdExact(mulDecimal(subDec, parseDecimal(entry.limit_price)));
      }
    } else if (matchingExecs.length > 0 && matchingExecs.every((ex) => ex.notional_usd !== null)) {
      let sumNotional = ZERO_DEC;
      for (const ex of matchingExecs) {
        sumNotional = addDecimal(sumNotional, parseDecimal(ex.notional_usd));
      }
      notionalUsd = formatUsdExact(sumNotional);
      usdBasisQualified = true;
    }

    let kPendUsd = null;
    const isTerminalZeroRemaining = TERMINAL_STATE_SET.has(state) || (state === "PARTIAL_CANCEL" && remainingDec.num === 0n);
    if (entry.side === "SELL") {
      kPendUsd = usdBasisQualified ? "0" : null;
    } else if (isTerminalZeroRemaining) {
      kPendUsd = usdBasisQualified ? "0" : null;
    } else if (cutoff && cutoff.k_pend_usd !== null) {
      kPendUsd = cutoff.k_pend_usd;
    } else if (activeLock && activeLock.k_pend_usd !== null) {
      kPendUsd = activeLock.k_pend_usd;
    } else if (entry.currency === "USD") {
      if (remainingDec.num === 0n) {
        kPendUsd = "0";
      } else if (entry.limit_price !== null) {
        const baseNotional = mulDecimal(remainingDec, parseDecimal(entry.limit_price));
        const feeReserveRaw = cutoff?.reserved_fee_usd ?? subMeta?.estimated_fee_usd ?? null;
        const feeReserve = feeReserveRaw !== null ? parseDecimal(feeReserveRaw) : ZERO_DEC;
        kPendUsd = formatUsdExact(addDecimal(baseNotional, feeReserve));
      } else {
        kPendUsd = null;
      }
    }

    const updatedAt = maxTimestampIso(
      maxTimestampIso(sub?.submitted_at ?? null, cutoff?.as_of ?? null),
      matchingExecs.length > 0 ? matchingExecs[matchingExecs.length - 1].executed_at : null,
    ) ?? evaluatedAt;

    const queryTarget = state === "ORDER_UNKNOWN"
      ? buildOrderUnknownQueryTarget({
        ...identity,
        client_order_id: entry.client_order_id,
        broker_order_id: entry.broker_order_id,
      })
      : null;

    const evidenceRef = cutoff?.evidence_ref
      ?? (matchingExecs.length > 0 ? matchingExecs[matchingExecs.length - 1].evidence_ref : null)
      ?? sub?.evidence_ref;

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

  // Merge active locks from external persistent lockStore that may not appear in current domain poll.
  for (const lock of activeLocks) {
    if (!computedOrderLocks.has(lock.client_order_id)) {
      const alreadyTerminated = reconciledOrders.some(
        (o) => o.client_order_id === lock.client_order_id && TERMINAL_STATE_SET.has(o.state),
      );
      if (!alreadyTerminated) {
        computedOrderLocks.set(lock.client_order_id, lock);
      }
    }
  }

  const orderUnknownLocks = [...computedOrderLocks.values()].sort((a, b) => (
    a.symbol.localeCompare(b.symbol) || a.client_order_id.localeCompare(b.client_order_id)
  ));
  const orderUnknownSymbols = [...new Set(orderUnknownLocks.map((l) => l.symbol))].sort();

  // Compute aggregate K_pend in USD across working orders + any unrepresented external locks.
  let totalKPendDec = ZERO_DEC;
  let kPendUnavailable = false;
  const accountedLockClientIds = new Set();

  for (const ord of reconciledOrders) {
    if (ord.state === "ORDER_UNKNOWN") accountedLockClientIds.add(ord.client_order_id);
    if (ord.k_pend_usd === null) {
      if (ord.side === "BUY" && (!TERMINAL_STATE_SET.has(ord.state) && !(ord.state === "PARTIAL_CANCEL" && ord.qty_remaining === "0"))) {
        kPendUnavailable = true;
      }
    } else {
      totalKPendDec = addDecimal(totalKPendDec, parseDecimal(ord.k_pend_usd));
    }
  }

  for (const lock of orderUnknownLocks) {
    if (accountedLockClientIds.has(lock.client_order_id)) continue;
    if (lock.k_pend_usd === null) {
      kPendUnavailable = true;
    } else {
      totalKPendDec = addDecimal(totalKPendDec, parseDecimal(lock.k_pend_usd));
    }
  }

  const coverageAllowsRelease = Boolean(cutoffCoverage?.k_pend_release_allowed) && orderUnknownLocks.length === 0;
  let kPendUsdOut = kPendUnavailable ? null : formatUsdExact(totalKPendDec);

  if (!coverageAllowsRelease && priorKPendUsd !== null && priorKPendUsd !== undefined) {
    const priorDec = typeof priorKPendUsd === "string" ? parseDecimal(priorKPendUsd) : null;
    if (!priorDec || priorDec.num < 0n) {
      throw new OrdersFillsError("invalid_prior_k_pend_usd", 400);
    }
    if (!kPendUnavailable) {
      kPendUsdOut = formatUsdExact(maxDec(totalKPendDec, priorDec));
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
  };
}
