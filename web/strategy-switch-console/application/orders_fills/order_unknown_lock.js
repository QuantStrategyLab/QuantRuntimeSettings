/**
 * C-SA-25 + O4/Q5-2: Restart-persistent ORDER-UNKNOWN symbol lock & query-before-retry invariant.
 *
 * Pure serializable JSON store under application/orders_fills/:
 * - Imports only inward from ./constants.js, ./normalize.js, ../naming_canonical/helpers.js,
 *   and ../sizing_unit/nav.js (zero Worker/DO, SQLite, KV, or network imports).
 * - Binds locks to (broker, environment, account, client_order_id) and symbol.
 * - Survives JSON serialization/deserialization reload, prohibits new orders on locked
 *   symbols, retains K_pend commitment, emits deterministic query_target, and clears
 *   ONLY upon definitive terminal broker evidence (FILLED / CANCELED / REJECTED).
 */

import { isRawAccountIdentifier, isUnsafePrivateLocator } from "../naming_canonical/helpers.js";
import {
  addDecimal,
  mulDecimal,
  parseDecimal,
  parseInstantNs,
  subDecimal,
  toUtcIsoFromNs,
} from "../sizing_unit/nav.js";
import {
  CURRENCY_RE,
  ORDER_SIDE_SET,
  ORDER_STATE_SET,
  ORDER_UNKNOWN_LOCK_STORE_SCHEMA,
  OrdersFillsError,
  SAFE_ID_RE,
  SYMBOL_RE,
  TERMINAL_STATE_SET,
} from "./constants.js";
import { formatUsdExact, normalizeBrokerIdentity } from "./normalize.js";

function lockEntryKey(broker, environment, account, clientOrderId) {
  return `${broker}|${environment}|${account}|${clientOrderId}`;
}

function validateSafeLockId(value, fieldName, { allowNull = false } = {}) {
  if (value === null || value === undefined) {
    if (allowNull) return null;
    throw new OrdersFillsError(`missing_${fieldName}`, 400);
  }
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new OrdersFillsError(`invalid_${fieldName}`, 400);
  }
  if (isUnsafePrivateLocator(value)) {
    throw new OrdersFillsError(`unsafe_private_locator_${fieldName}`, 400);
  }
  if (isRawAccountIdentifier(value) || !SAFE_ID_RE.test(value)) {
    throw new OrdersFillsError(`invalid_${fieldName}`, 400);
  }
  return value;
}

function validateLockSymbol(value) {
  if (typeof value !== "string" || !SYMBOL_RE.test(value) || isRawAccountIdentifier(value) || isUnsafePrivateLocator(value)) {
    throw new OrdersFillsError("invalid_lock_symbol", 400);
  }
  return value;
}

function validateLockTimestamp(value, fieldName) {
  if (typeof value !== "string") {
    throw new OrdersFillsError(`invalid_${fieldName}`, 400);
  }
  const ns = parseInstantNs(value);
  if (ns === null) {
    throw new OrdersFillsError(`invalid_${fieldName}`, 400);
  }
  return toUtcIsoFromNs(ns);
}

export function buildOrderUnknownQueryTarget({ broker, environment, account, client_order_id, broker_order_id }) {
  if (broker_order_id !== null && broker_order_id !== undefined) {
    return {
      by: "broker_order_id",
      broker,
      environment,
      account,
      client_order_id,
      broker_order_id,
    };
  }
  return {
    by: "client_order_tuple",
    broker,
    environment,
    account,
    client_order_id,
    broker_order_id: null,
  };
}

function computeOrderUnknownKPendUsd(event) {
  const currency = event.currency ?? "USD";
  if (
    typeof currency !== "string"
    || isRawAccountIdentifier(currency)
    || isUnsafePrivateLocator(currency)
    || !CURRENCY_RE.test(currency)
  ) {
    throw new OrdersFillsError("invalid_order_currency", 400);
  }
  const usdQualified = currency === "USD" || event.usd_basis_qualified === true;
  if (event.k_pend_usd !== undefined && event.k_pend_usd !== null) {
    if (!usdQualified) return null;
    if (typeof event.k_pend_usd !== "string") {
      throw new OrdersFillsError("invalid_k_pend_usd", 400);
    }
    const dec = parseDecimal(event.k_pend_usd);
    if (!dec || dec.num < 0n) throw new OrdersFillsError("invalid_k_pend_usd", 400);
    return formatUsdExact(dec);
  }
  if (event.side === "SELL") {
    return usdQualified ? "0" : null;
  }
  // Never multiply non-USD qty * limit_price into USD even if usd_basis_qualified was set on another field.
  if (currency !== "USD") return null;

  let qtyRemDec = null;
  if (event.qty_remaining !== undefined && event.qty_remaining !== null) {
    qtyRemDec = typeof event.qty_remaining === "string" ? parseDecimal(event.qty_remaining) : null;
  } else if (event.qty_submitted !== undefined && event.qty_submitted !== null) {
    const subDec = typeof event.qty_submitted === "string" ? parseDecimal(event.qty_submitted) : null;
    const fillDec = event.qty_filled !== undefined && event.qty_filled !== null
      ? parseDecimal(String(event.qty_filled))
      : { num: 0n, scale: 0 };
    const cancelDec = event.qty_canceled !== undefined && event.qty_canceled !== null
      ? parseDecimal(String(event.qty_canceled))
      : { num: 0n, scale: 0 };
    if (subDec && fillDec && cancelDec) {
      qtyRemDec = subDecimal(subDecimal(subDec, fillDec), cancelDec);
    }
  }
  if (!qtyRemDec || qtyRemDec.num < 0n) {
    return null;
  }
  if (qtyRemDec.num === 0n) {
    const feeVal = event.estimated_fee_usd ?? event.reserved_fee_usd ?? null;
    if (feeVal !== null && typeof feeVal === "string") {
      const fDec = parseDecimal(feeVal);
      if (fDec && fDec.num >= 0n) return formatUsdExact(fDec);
    }
    return "0";
  }
  if (typeof event.limit_price !== "string") {
    return null;
  }
  const limDec = parseDecimal(event.limit_price);
  if (!limDec || limDec.num <= 0n) {
    throw new OrdersFillsError("invalid_limit_price", 400);
  }
  const feeRaw = event.estimated_fee_usd ?? event.reserved_fee_usd ?? event.fee_usd ?? null;
  if (feeRaw === null || feeRaw === undefined) {
    return null;
  }
  if (typeof feeRaw !== "string") throw new OrdersFillsError("invalid_estimated_fee_usd", 400);
  const feeDec = parseDecimal(feeRaw);
  if (!feeDec || feeDec.num < 0n) throw new OrdersFillsError("invalid_estimated_fee_usd", 400);
  const total = addDecimal(mulDecimal(qtyRemDec, limDec), feeDec);
  return formatUsdExact(total);
}

function validateLockRecord(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OrdersFillsError("invalid_order_unknown_lock_record", 400);
  }
  const identity = normalizeBrokerIdentity(raw);
  const symbol = validateLockSymbol(raw.symbol);
  const clientOrderId = validateSafeLockId(raw.client_order_id, "client_order_id");
  const brokerOrderId = validateSafeLockId(raw.broker_order_id ?? null, "broker_order_id", { allowNull: true });
  const lockedAt = validateLockTimestamp(raw.locked_at, "locked_at");
  if (raw.status !== "locked" || raw.allow_new_orders !== false || raw.query_before_retry_required !== true) {
    throw new OrdersFillsError("invalid_order_unknown_lock_flags", 400);
  }
  if (raw.clear_condition !== "definitive_terminal_broker_evidence") {
    throw new OrdersFillsError("invalid_order_unknown_clear_condition", 400);
  }
  const expectedQuery = buildOrderUnknownQueryTarget({
    ...identity,
    client_order_id: clientOrderId,
    broker_order_id: brokerOrderId,
  });
  if (!raw.query_target || JSON.stringify(raw.query_target) !== JSON.stringify(expectedQuery)) {
    throw new OrdersFillsError("invalid_order_unknown_query_target", 400);
  }
  let kPendUsd = null;
  if (raw.k_pend_usd !== null && raw.k_pend_usd !== undefined) {
    if (typeof raw.k_pend_usd !== "string") {
      throw new OrdersFillsError("invalid_lock_k_pend_usd", 400);
    }
    const dec = parseDecimal(raw.k_pend_usd);
    if (!dec || dec.num < 0n) throw new OrdersFillsError("invalid_lock_k_pend_usd", 400);
    kPendUsd = formatUsdExact(dec);
  }
  return {
    broker: identity.broker,
    environment: identity.environment,
    account: identity.account,
    symbol,
    client_order_id: clientOrderId,
    broker_order_id: brokerOrderId,
    query_target: expectedQuery,
    k_pend_usd: kPendUsd,
    locked_at: lockedAt,
    status: "locked",
    allow_new_orders: false,
    query_before_retry_required: true,
    clear_condition: "definitive_terminal_broker_evidence",
  };
}

function ensureLockStore(store) {
  if (!store || typeof store !== "object" || store.schema_version !== ORDER_UNKNOWN_LOCK_STORE_SCHEMA) {
    throw new OrdersFillsError("invalid_order_unknown_lock_store", 400);
  }
  if (!store.locks || typeof store.locks !== "object" || Array.isArray(store.locks)) {
    throw new OrdersFillsError("invalid_order_unknown_lock_store", 400);
  }
  return store;
}

/**
 * Creates an empty or pre-seeded restart-persistent ORDER-UNKNOWN lock store.
 */
export function createOrderUnknownLockStore(initial = {}) {
  const locks = {};
  const seenBrokerIds = new Set();
  const items = Array.isArray(initial?.locks)
    ? initial.locks
    : (initial?.locks && typeof initial.locks === "object" ? Object.values(initial.locks) : []);
  for (const item of items) {
    const clean = validateLockRecord(item);
    const key = lockEntryKey(clean.broker, clean.environment, clean.account, clean.client_order_id);
    if (clean.broker_order_id !== null) {
      const brkKey = `${clean.broker}|${clean.environment}|${clean.account}|${clean.broker_order_id}`;
      if (seenBrokerIds.has(brkKey) && locks[key]?.broker_order_id !== clean.broker_order_id) {
        throw new OrdersFillsError("conflicting_broker_order_id_on_lock", 409);
      }
      seenBrokerIds.add(brkKey);
    }
    locks[key] = clean;
  }
  return {
    schema_version: ORDER_UNKNOWN_LOCK_STORE_SCHEMA,
    locks,
  };
}

/**
 * Serializes the lock store into deterministic, restart-persistent JSON without private locators.
 */
export function serializeOrderUnknownLockStore(store) {
  ensureLockStore(store);
  const locks = Object.entries(store.locks)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, entry]) => structuredClone(validateLockRecord(entry)));
  return {
    schema_version: ORDER_UNKNOWN_LOCK_STORE_SCHEMA,
    locks,
  };
}

/**
 * Restores and validates an ORDER-UNKNOWN lock store after simulated DO/store restart.
 */
export function deserializeOrderUnknownLockStore(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OrdersFillsError("invalid_serialized_lock_store", 400);
  }
  if (raw.schema_version !== ORDER_UNKNOWN_LOCK_STORE_SCHEMA || !Array.isArray(raw.locks)) {
    throw new OrdersFillsError("invalid_serialized_lock_store", 400);
  }
  return createOrderUnknownLockStore({ locks: raw.locks });
}

/**
 * Applies an order lifecycle observation to the lock store:
 * - Enters/retains symbol lock on ORDER_UNKNOWN.
 * - Never clears on non-terminal follow-ups (SUBMITTED / ACCEPTED / PARTIAL_FILL / PARTIAL_CANCEL).
 * - Clears ONLY on definitive terminal broker evidence (FILLED / CANCELED / REJECTED).
 */
export function applyOrderUnknownObservation(store, event, options = {}) {
  ensureLockStore(store);
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new OrdersFillsError("invalid_order_unknown_event", 400);
  }
  const identity = normalizeBrokerIdentity(event);
  const symbol = validateLockSymbol(event.symbol);
  if (!ORDER_STATE_SET.has(event.state)) {
    throw new OrdersFillsError("invalid_order_state", 400);
  }
  if (event.side !== undefined && !ORDER_SIDE_SET.has(event.side)) {
    throw new OrdersFillsError("invalid_order_side", 400);
  }
  const clientOrderId = validateSafeLockId(event.client_order_id, "client_order_id");
  const brokerOrderId = validateSafeLockId(event.broker_order_id ?? null, "broker_order_id", { allowNull: true });

  const evalAtRaw = options?.evaluatedAt ?? options?.evaluated_at ?? null;
  const evalAtNs = evalAtRaw !== null && evalAtRaw !== undefined ? parseInstantNs(evalAtRaw) : null;
  if (evalAtRaw !== null && evalAtRaw !== undefined && evalAtNs === null) {
    throw new OrdersFillsError("invalid_evaluated_at", 400);
  }
  const eventTsCandidates = [
    event.resolved_at,
    event.canceled_at,
    event.updated_at,
    event.as_of,
    event.executed_at,
    event.submitted_at,
    event.locked_at,
  ];
  let maxEventNs = null;
  for (const ts of eventTsCandidates) {
    if (ts !== undefined && ts !== null) {
      const parsedIso = validateLockTimestamp(ts, "event_timestamp");
      const ns = parseInstantNs(parsedIso);
      if (maxEventNs === null || ns > maxEventNs) maxEventNs = ns;
    }
  }

  const nextLocks = structuredClone(store.locks);
  let targetKey = lockEntryKey(identity.broker, identity.environment, identity.account, clientOrderId);
  let existing = nextLocks[targetKey] ?? null;

  if (brokerOrderId !== null) {
    for (const [key, entry] of Object.entries(nextLocks)) {
      if (
        entry.broker === identity.broker
        && entry.environment === identity.environment
        && entry.account === identity.account
        && entry.broker_order_id === brokerOrderId
        && key !== targetKey
      ) {
        throw new OrdersFillsError("conflicting_broker_order_id_on_lock", 409);
      }
    }
  }

  if (event.state === "ORDER_UNKNOWN") {
    const lockedAtRaw = event.locked_at ?? event.submitted_at ?? event.as_of ?? event.updated_at ?? event.resolved_at;
    const lockedAt = validateLockTimestamp(lockedAtRaw, "locked_at");
    const effectiveBrokerOrderId = brokerOrderId ?? existing?.broker_order_id ?? null;
    if (existing && brokerOrderId !== null && existing.broker_order_id !== null && existing.broker_order_id !== brokerOrderId) {
      throw new OrdersFillsError("conflicting_broker_order_id_on_lock", 409);
    }
    if (existing && existing.symbol !== symbol) {
      throw new OrdersFillsError("conflicting_symbol_on_lock", 409);
    }
    const kPendUsd = computeOrderUnknownKPendUsd(event) ?? existing?.k_pend_usd ?? null;
    nextLocks[targetKey] = {
      broker: identity.broker,
      environment: identity.environment,
      account: identity.account,
      symbol,
      client_order_id: clientOrderId,
      broker_order_id: effectiveBrokerOrderId,
      query_target: buildOrderUnknownQueryTarget({
        ...identity,
        client_order_id: clientOrderId,
        broker_order_id: effectiveBrokerOrderId,
      }),
      k_pend_usd: kPendUsd,
      locked_at: existing?.locked_at ?? lockedAt,
      status: "locked",
      allow_new_orders: false,
      query_before_retry_required: true,
      clear_condition: "definitive_terminal_broker_evidence",
    };
    return { schema_version: ORDER_UNKNOWN_LOCK_STORE_SCHEMA, locks: nextLocks };
  }

  if (!existing) {
    return { schema_version: ORDER_UNKNOWN_LOCK_STORE_SCHEMA, locks: nextLocks };
  }

  if (existing.symbol !== symbol) {
    throw new OrdersFillsError("order_unknown_symbol_mismatch", 409);
  }
  if (brokerOrderId !== null && existing.broker_order_id !== null && existing.broker_order_id !== brokerOrderId) {
    throw new OrdersFillsError("order_unknown_broker_id_mismatch", 409);
  }

  if (TERMINAL_STATE_SET.has(event.state)) {
    if (maxEventNs === null || (evalAtNs !== null && maxEventNs > evalAtNs)) {
      return { schema_version: ORDER_UNKNOWN_LOCK_STORE_SCHEMA, locks: nextLocks };
    }
    delete nextLocks[targetKey];
    return { schema_version: ORDER_UNKNOWN_LOCK_STORE_SCHEMA, locks: nextLocks };
  }

  // Non-terminal follow-up (SUBMITTED / ACCEPTED / PARTIAL_FILL / PARTIAL_CANCEL):
  // retain symbol lock and K_pend, optionally linking broker_order_id if revealed.
  const effectiveBrokerOrderId = brokerOrderId ?? existing.broker_order_id ?? null;
  nextLocks[targetKey] = {
    ...existing,
    broker_order_id: effectiveBrokerOrderId,
    query_target: buildOrderUnknownQueryTarget({
      ...identity,
      client_order_id: existing.client_order_id,
      broker_order_id: effectiveBrokerOrderId,
    }),
  };
  return { schema_version: ORDER_UNKNOWN_LOCK_STORE_SCHEMA, locks: nextLocks };
}

export function listActiveOrderUnknownLocks(store, identityFilter = null) {
  ensureLockStore(store);
  const norm = identityFilter ? normalizeBrokerIdentity(identityFilter) : null;
  return Object.values(store.locks)
    .filter((entry) => (
      !norm
      || (entry.broker === norm.broker && entry.environment === norm.environment && entry.account === norm.account)
    ))
    .map((entry) => structuredClone(entry))
    .sort((a, b) => (
      a.broker.localeCompare(b.broker)
      || a.environment.localeCompare(b.environment)
      || a.account.localeCompare(b.account)
      || a.symbol.localeCompare(b.symbol)
      || a.client_order_id.localeCompare(b.client_order_id)
    ));
}

export function lockedSymbolsForAccount(store, identity) {
  const locks = listActiveOrderUnknownLocks(store, identity);
  return [...new Set(locks.map((l) => l.symbol))].sort();
}

/**
 * Checks whether new orders on (broker, environment, account, symbol) are permitted under O4/Q5-2.
 */
export function checkSymbolOrderAllowed(store, params = {}) {
  ensureLockStore(store);
  const identity = normalizeBrokerIdentity(params);
  const symbol = validateLockSymbol(params.symbol);
  const matches = listActiveOrderUnknownLocks(store, identity).filter((l) => l.symbol === symbol);
  if (matches.length > 0) {
    const first = matches[0];
    return {
      allowed: false,
      reason: "order_unknown_lock",
      lock: first,
      query_target: first.query_target,
    };
  }
  return {
    allowed: true,
    reason: null,
    lock: null,
    query_target: null,
  };
}
