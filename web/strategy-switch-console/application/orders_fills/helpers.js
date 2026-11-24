/**
 * C-SA-25: Authoritative orders, fills, cutoff open orders, and ORDER-UNKNOWN composition entrypoint.
 *
 * Pure leaf barrel/composition module under application/orders_fills/:
 * - Imports only inward from sibling leaf modules and ../naming_canonical / ../sizing_unit/nav.js.
 * - Never imports runtime_support.js, worker.js, storage, or network.
 */

import { isRawAccountIdentifier, isUnsafePrivateLocator } from "../naming_canonical/helpers.js";
import { parseInstantNs, stripPrivateLocators, toUtcIsoFromNs } from "../sizing_unit/nav.js";
import {
  AUTHORITATIVE_ORDERS_FILLS_SCHEMA,
  ORIGIN_SET,
  OrdersFillsError,
  SAFE_ID_RE,
  SHA256_EVIDENCE_RE,
  SOURCE_CLASS_SET,
} from "./constants.js";
import { evaluateDomainCoverage } from "./coverage.js";
import { deduplicateExecutions, reconcileOrdersAndFills } from "./dedup_state.js";
import { adaptLegacyBrokerExecutionPayload, normalizeBrokerIdentity, normalizeOrderDomain } from "./normalize.js";
import {
  applyOrderUnknownObservation,
  checkSymbolOrderAllowed,
  createOrderUnknownLockStore,
  deserializeOrderUnknownLockStore,
  listActiveOrderUnknownLocks,
  lockedSymbolsForAccount,
  serializeOrderUnknownLockStore,
} from "./order_unknown_lock.js";

export {
  AUTHORITATIVE_ORDERS_FILLS_SCHEMA,
  OrdersFillsError,
  adaptLegacyBrokerExecutionPayload,
  applyOrderUnknownObservation,
  checkSymbolOrderAllowed,
  createOrderUnknownLockStore,
  deduplicateExecutions,
  deserializeOrderUnknownLockStore,
  evaluateDomainCoverage,
  listActiveOrderUnknownLocks,
  lockedSymbolsForAccount,
  normalizeBrokerIdentity,
  normalizeOrderDomain,
  reconcileOrdersAndFills,
  serializeOrderUnknownLockStore,
};

function validateEnvelopeRef(value, fieldName) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new OrdersFillsError(`invalid_${fieldName}`, 400);
  }
  if (isUnsafePrivateLocator(value)) {
    throw new OrdersFillsError(`unsafe_private_locator_${fieldName}`, 400);
  }
  if (SHA256_EVIDENCE_RE.test(value)) return value;
  if (isRawAccountIdentifier(value) || !SAFE_ID_RE.test(value)) {
    throw new OrdersFillsError(`invalid_${fieldName}`, 400);
  }
  return value;
}

function parseEnvelopeUtc(value, fieldName, { nullable = false } = {}) {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw new OrdersFillsError(`missing_${fieldName}`, 400);
  }
  if (typeof value !== "string") {
    throw new OrdersFillsError(`invalid_${fieldName}`, 400);
  }
  const ns = parseInstantNs(value);
  if (ns === null) {
    throw new OrdersFillsError(`invalid_${fieldName}`, 400);
  }
  return toUtcIsoFromNs(ns);
}

/**
 * Evaluates and reconciles submissions, executions, cutoff open orders, cap/completeness proof,
 * and ORDER-UNKNOWN locks into a closed qsl.authoritative_orders_fills.v1 envelope.
 */
export function evaluateAuthoritativeOrdersAndFills(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new OrdersFillsError("invalid_orders_fills_input", 400);
  }
  const identity = normalizeBrokerIdentity(input);
  const asOf = parseEnvelopeUtc(input.as_of ?? null, "as_of", { nullable: true });
  const evaluatedAt = parseEnvelopeUtc(input.evaluated_at ?? options.evaluated_at, "evaluated_at", { nullable: false });

  const origin = ORIGIN_SET.has(input.origin) ? input.origin : null;
  if (!origin) throw new OrdersFillsError("invalid_origin", 400);
  const sourceClass = SOURCE_CLASS_SET.has(input.source_class) ? input.source_class : null;
  if (!sourceClass) throw new OrdersFillsError("invalid_source_class", 400);
  const evidenceRef = validateEnvelopeRef(input.evidence_ref, "evidence_ref");

  if (!input.domains || typeof input.domains !== "object" || Array.isArray(input.domains)) {
    throw new OrdersFillsError("missing_domains", 400);
  }

  const lockStore = options.lockStore ?? null;
  const submissions = normalizeOrderDomain("submissions", input.domains.submissions, identity);
  const executions = normalizeOrderDomain("executions", input.domains.executions, identity);
  const prelimCutoff = normalizeOrderDomain("cutoff_open_orders", input.domains.cutoff_open_orders, identity);

  const reconciled = reconcileOrdersAndFills({
    identity,
    submissions: submissions.records,
    executions: executions.records,
    cutoffOpenOrders: prelimCutoff.records,
    cutoffCoverage: prelimCutoff,
    lockStore,
    priorKPendUsd: options.priorKPendUsd ?? input.prior_k_pend_usd ?? null,
    evaluatedAt,
  });

  const hasOrderUnknownLocks = reconciled.order_unknown_locks.length > 0;
  const cutoffFinal = {
    ...prelimCutoff,
    k_pend_release_allowed: prelimCutoff.k_pend_release_allowed && !hasOrderUnknownLocks,
  };

  const currenciesSet = new Set([
    ...submissions.currencies_present,
    ...executions.currencies_present,
    ...cutoffFinal.currencies_present,
    ...reconciled.orders.map((o) => o.currency),
  ]);
  const currenciesPresent = [...currenciesSet].sort();

  const status = hasOrderUnknownLocks
    ? "blocked"
    : cutoffFinal.domain_capability === "unsupported" && submissions.domain_capability === "unsupported" && executions.domain_capability === "unsupported"
      ? "unavailable"
      : "ok";
  const reason = hasOrderUnknownLocks
    ? "order_unknown_symbol_lock_active"
    : status === "unavailable"
      ? "all_order_domains_unsupported"
      : null;

  return stripPrivateLocators({
    schema_version: AUTHORITATIVE_ORDERS_FILLS_SCHEMA,
    status,
    reason,
    broker: identity.broker,
    environment: identity.environment,
    account: identity.account,
    account_binding: identity,
    as_of: asOf,
    evaluated_at: evaluatedAt,
    domains: {
      submissions,
      executions,
      cutoff_open_orders: cutoffFinal,
    },
    orders: reconciled.orders,
    executions: reconciled.executions,
    order_unknown_locks: reconciled.order_unknown_locks,
    order_unknown_symbols: reconciled.order_unknown_symbols,
    summary: {
      k_pend_usd: reconciled.k_pend_usd,
      k_pend_release_allowed: reconciled.k_pend_release_allowed,
      empty_open_orders_proven: cutoffFinal.empty_domain_proven,
      order_unknown_active: hasOrderUnknownLocks,
      currencies_present: currenciesPresent,
      currency_coercion: "prohibited",
      fx_inferred: false,
    },
    origin,
    source_class: sourceClass,
    evidence_ref: evidenceRef,
  });
}
