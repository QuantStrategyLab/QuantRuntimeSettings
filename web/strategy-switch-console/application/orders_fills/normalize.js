/**
 * C-SA-25: Broker-agnostic submission, execution, and cutoff open-order normalizer.
 *
 * Pure leaf module under application/orders_fills/:
 * - Separates broker from paper/live environment and binds keys to (broker, environment, account).
 * - Rejects IEEE floats, raw brokerage account IDs, and private storage locators.
 * - Preserves null fees (never coerced to "0") and non-USD unavailability without FX guessing.
 * - Provides pure additive adaptLegacyBrokerExecutionPayload(...) preserving broker_executions.v1.
 */

import { isRawAccountIdentifier, isUnsafePrivateLocator } from "../naming_canonical/helpers.js";
import {
  absDecimal,
  addDecimal,
  formatDecimal,
  mulDecimal,
  parseDecimal,
  parseInstantNs,
  safePublicText,
  subDecimal,
  toUtcIsoFromNs,
} from "../sizing_unit/nav.js";
import {
  BROKER_SET,
  CANONICAL_ORDER_ACCOUNT_RE,
  CURRENCY_RE,
  DECIMAL_RE,
  ENVIRONMENT_SET,
  HEX64_RE,
  NON_NEGATIVE_DECIMAL_RE,
  OPAQUE_ACCOUNT_SLOT_RE,
  ORDER_SIDE_SET,
  ORDER_STATE_SET,
  OrdersFillsError,
  POSITIVE_DECIMAL_RE,
  SAFE_ID_RE,
  SHA256_EVIDENCE_RE,
  SYMBOL_RE,
} from "./constants.js";
import { evaluateDomainCoverage } from "./coverage.js";

function assertSafeIdentifier(value, fieldName, { allowNull = false, allowHex64 = false, allowSha256 = false } = {}) {
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
  if (allowHex64 && HEX64_RE.test(value)) return value;
  if (allowSha256 && SHA256_EVIDENCE_RE.test(value)) return value;
  if (isRawAccountIdentifier(value)) {
    throw new OrdersFillsError(`raw_account_id_prohibited_${fieldName}`, 400);
  }
  if (!SAFE_ID_RE.test(value)) {
    throw new OrdersFillsError(`invalid_${fieldName}`, 400);
  }
  return value;
}

function parseStrictUtcString(value, fieldName) {
  if (typeof value !== "string") {
    throw new OrdersFillsError(`invalid_${fieldName}`, 400);
  }
  const ns = parseInstantNs(value);
  if (ns === null) {
    throw new OrdersFillsError(`invalid_${fieldName}`, 400);
  }
  return toUtcIsoFromNs(ns);
}

function validateSymbol(value) {
  if (typeof value !== "string" || !SYMBOL_RE.test(value) || isRawAccountIdentifier(value) || isUnsafePrivateLocator(value)) {
    throw new OrdersFillsError("invalid_symbol", 400);
  }
  return value;
}

function validateCurrency(value, fieldName = "currency", { allowNull = false } = {}) {
  if (value === null || value === undefined) {
    if (allowNull) return null;
    throw new OrdersFillsError(`missing_${fieldName}`, 400);
  }
  if (typeof value !== "string" || !CURRENCY_RE.test(value)) {
    throw new OrdersFillsError(`invalid_${fieldName}`, 400);
  }
  return value;
}

function validateDecimalString(value, fieldName, { allowNull = false, positive = false, nonNegative = false } = {}) {
  if (value === null || value === undefined) {
    if (allowNull) return null;
    throw new OrdersFillsError(`missing_${fieldName}`, 400);
  }
  if (typeof value !== "string") {
    throw new OrdersFillsError(`invalid_float_or_nonstring_${fieldName}`, 400);
  }
  if (positive && !POSITIVE_DECIMAL_RE.test(value)) {
    throw new OrdersFillsError(`non_positive_${fieldName}`, 400);
  }
  if (nonNegative && !NON_NEGATIVE_DECIMAL_RE.test(value)) {
    throw new OrdersFillsError(`negative_or_invalid_${fieldName}`, 400);
  }
  if (!DECIMAL_RE.test(value)) {
    throw new OrdersFillsError(`invalid_decimal_${fieldName}`, 400);
  }
  const dec = parseDecimal(value);
  if (!dec) {
    throw new OrdersFillsError(`invalid_decimal_${fieldName}`, 400);
  }
  if (dec.num === 0n && value.startsWith("-")) return "0";
  return value;
}

export function formatUsdExact(dec) {
  if (!dec || typeof dec.num !== "bigint") return null;
  if (dec.num === 0n) return "0";
  return formatDecimal(dec, { minScale: Math.max(2, dec.scale) });
}

export function formatQtyExact(dec) {
  if (!dec || typeof dec.num !== "bigint") return null;
  return formatDecimal(dec);
}

/**
 * Normalizes and validates (broker, environment, account) identity separation.
 */
export function normalizeBrokerIdentity(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OrdersFillsError("invalid_identity", 400);
  }
  const broker = raw.broker;
  if (typeof broker !== "string" || !BROKER_SET.has(broker)) {
    throw new OrdersFillsError("invalid_broker", 400);
  }
  const environment = raw.environment;
  if (typeof environment !== "string" || !ENVIRONMENT_SET.has(environment)) {
    throw new OrdersFillsError("invalid_order_environment", 400);
  }
  const account = raw.account;
  if (typeof account !== "string" || account.length === 0 || account.length > 64) {
    throw new OrdersFillsError("invalid_account", 400);
  }
  if (isUnsafePrivateLocator(account)) {
    throw new OrdersFillsError("unsafe_private_locator_account", 400);
  }
  if (isRawAccountIdentifier(account)) {
    throw new OrdersFillsError("raw_account_id_prohibited", 400);
  }
  if (account.includes(":")) {
    const match = CANONICAL_ORDER_ACCOUNT_RE.exec(account);
    if (!match) {
      throw new OrdersFillsError("invalid_canonical_account_tuple", 400);
    }
    const [, acctBroker, acctEnv, slot] = match;
    if (acctBroker !== broker || acctEnv !== environment) {
      throw new OrdersFillsError("account_broker_environment_mismatch", 409);
    }
    if (isRawAccountIdentifier(slot)) {
      throw new OrdersFillsError("raw_account_id_prohibited", 400);
    }
  } else if (!OPAQUE_ACCOUNT_SLOT_RE.test(account)) {
    throw new OrdersFillsError("invalid_account_slot", 400);
  }

  return {
    broker,
    environment,
    account,
    binding_key: `${broker}|${environment}|${account}`,
  };
}

function assertRecordIdentityMatches(raw, identity) {
  if (raw.broker !== undefined && raw.broker !== identity.broker) {
    throw new OrdersFillsError("record_broker_mismatch", 409);
  }
  if (raw.environment !== undefined && raw.environment !== identity.environment) {
    throw new OrdersFillsError("record_environment_mismatch", 409);
  }
  if (raw.account !== undefined && raw.account !== identity.account) {
    throw new OrdersFillsError("record_account_mismatch", 409);
  }
}

function resolveFeeFields(raw) {
  const feeNative = validateDecimalString(raw.fee_native ?? null, "fee_native", { allowNull: true });
  const feeCurrency = validateCurrency(raw.fee_currency ?? null, "fee_currency", { allowNull: true });
  if (feeNative === null) {
    if (raw.fee_usd !== undefined && raw.fee_usd !== null) {
      throw new OrdersFillsError("fee_usd_without_native_fee", 400);
    }
    return {
      fee_native: null,
      fee_currency: feeCurrency,
      fee_usd: null,
      fee_usd_qualified: false,
    };
  }
  if (feeCurrency === null) {
    throw new OrdersFillsError("missing_fee_currency", 400);
  }
  if (feeCurrency === "USD") {
    const dec = parseDecimal(feeNative);
    return {
      fee_native: feeNative,
      fee_currency: "USD",
      fee_usd: formatUsdExact(dec),
      fee_usd_qualified: true,
    };
  }
  if (raw.usd_basis_qualified === true && raw.fee_usd !== undefined && raw.fee_usd !== null) {
    const explicit = validateDecimalString(raw.fee_usd, "fee_usd");
    return {
      fee_native: feeNative,
      fee_currency: feeCurrency,
      fee_usd: formatUsdExact(parseDecimal(explicit)),
      fee_usd_qualified: true,
    };
  }
  return {
    fee_native: feeNative,
    fee_currency: feeCurrency,
    fee_usd: null,
    fee_usd_qualified: false,
  };
}

function resolveNotionalUsd(qtyText, priceText, currency, raw) {
  if (priceText === null) {
    if (currency === "USD") return { notional_usd: null, usd_basis_qualified: true };
    return { notional_usd: null, usd_basis_qualified: raw.usd_basis_qualified === true };
  }
  if (currency === "USD") {
    const prod = mulDecimal(parseDecimal(qtyText), parseDecimal(priceText));
    return { notional_usd: formatUsdExact(prod), usd_basis_qualified: true };
  }
  if (raw.usd_basis_qualified === true && raw.notional_usd !== undefined && raw.notional_usd !== null) {
    const explicit = validateDecimalString(raw.notional_usd, "notional_usd", { nonNegative: true });
    return { notional_usd: formatUsdExact(parseDecimal(explicit)), usd_basis_qualified: true };
  }
  return { notional_usd: null, usd_basis_qualified: false };
}

const SUBMISSION_META = new WeakMap();

export function getSubmissionMeta(record) {
  return (record && typeof record === "object" ? SUBMISSION_META.get(record) : null) ?? null;
}

export function normalizeSubmissionRecord(raw, identity) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OrdersFillsError("invalid_submission_record", 400);
  }
  assertRecordIdentityMatches(raw, identity);
  const clientOrderId = assertSafeIdentifier(raw.client_order_id, "client_order_id");
  const brokerOrderId = assertSafeIdentifier(raw.broker_order_id ?? null, "broker_order_id", { allowNull: true });
  const symbol = validateSymbol(raw.symbol);
  if (!ORDER_SIDE_SET.has(raw.side)) {
    throw new OrdersFillsError("invalid_order_side", 400);
  }
  if (!ORDER_STATE_SET.has(raw.state)) {
    throw new OrdersFillsError("invalid_order_state", 400);
  }
  const qtySubmitted = validateDecimalString(raw.qty_submitted, "qty_submitted", { positive: true });
  const limitPrice = validateDecimalString(raw.limit_price ?? null, "limit_price", { allowNull: true, positive: true });
  const currency = validateCurrency(raw.currency);
  const submittedAt = parseStrictUtcString(raw.submitted_at, "submitted_at");
  const evidenceRef = assertSafeIdentifier(raw.evidence_ref, "evidence_ref", { allowSha256: true });

  const fee = resolveFeeFields(raw);
  const notional = resolveNotionalUsd(qtySubmitted, limitPrice, currency, raw);

  // Optional submission cancel / estimated fee fields carried through for reconciliation metadata.
  const qtyCanceled = raw.qty_canceled !== undefined && raw.qty_canceled !== null
    ? validateDecimalString(raw.qty_canceled, "qty_canceled", { nonNegative: true })
    : null;
  const estimatedFeeUsd = raw.estimated_fee_usd !== undefined && raw.estimated_fee_usd !== null
    ? validateDecimalString(raw.estimated_fee_usd, "estimated_fee_usd", { nonNegative: true })
    : null;

  const record = {
    broker: identity.broker,
    environment: identity.environment,
    account: identity.account,
    client_order_id: clientOrderId,
    broker_order_id: brokerOrderId,
    symbol,
    side: raw.side,
    state: raw.state,
    qty_submitted: qtySubmitted,
    limit_price: limitPrice,
    currency,
    notional_usd: notional.notional_usd,
    fee_native: fee.fee_native,
    fee_currency: fee.fee_currency,
    fee_usd: fee.fee_usd,
    usd_basis_qualified: notional.usd_basis_qualified,
    submitted_at: submittedAt,
    evidence_ref: evidenceRef,
  };
  if (qtyCanceled !== null || estimatedFeeUsd !== null) {
    SUBMISSION_META.set(record, {
      ...(qtyCanceled !== null ? { qty_canceled: qtyCanceled } : {}),
      ...(estimatedFeeUsd !== null ? { estimated_fee_usd: estimatedFeeUsd } : {}),
    });
  }
  return record;
}

export function normalizeExecutionRecord(raw, identity) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OrdersFillsError("invalid_execution_record", 400);
  }
  assertRecordIdentityMatches(raw, identity);
  const executionRef = assertSafeIdentifier(raw.execution_ref, "execution_ref", { allowHex64: true });
  const reportRef = assertSafeIdentifier(raw.report_ref ?? null, "report_ref", { allowNull: true, allowHex64: true });
  const clientOrderId = assertSafeIdentifier(raw.client_order_id ?? null, "client_order_id", { allowNull: true });
  const brokerOrderId = assertSafeIdentifier(raw.broker_order_id ?? null, "broker_order_id", { allowNull: true });
  const symbol = validateSymbol(raw.symbol);
  if (!ORDER_SIDE_SET.has(raw.side)) {
    throw new OrdersFillsError("invalid_order_side", 400);
  }
  const qty = validateDecimalString(raw.qty, "qty", { positive: true });
  const price = validateDecimalString(raw.price, "price", { nonNegative: true });
  const currency = validateCurrency(raw.currency);
  const executedAt = parseStrictUtcString(raw.executed_at, "executed_at");
  const evidenceRef = assertSafeIdentifier(raw.evidence_ref, "evidence_ref", { allowSha256: true });

  const fee = resolveFeeFields(raw);
  const notional = resolveNotionalUsd(qty, price, currency, raw);

  return {
    broker: identity.broker,
    environment: identity.environment,
    account: identity.account,
    execution_ref: executionRef,
    report_ref: reportRef,
    client_order_id: clientOrderId,
    broker_order_id: brokerOrderId,
    symbol,
    side: raw.side,
    qty,
    price,
    currency,
    notional_usd: notional.notional_usd,
    fee_native: fee.fee_native,
    fee_currency: fee.fee_currency,
    fee_usd: fee.fee_usd,
    usd_basis_qualified: notional.usd_basis_qualified,
    executed_at: executedAt,
    evidence_ref: evidenceRef,
  };
}

export function normalizeCutoffOpenOrderRecord(raw, identity) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OrdersFillsError("invalid_cutoff_open_order_record", 400);
  }
  assertRecordIdentityMatches(raw, identity);
  const clientOrderId = assertSafeIdentifier(raw.client_order_id, "client_order_id");
  const brokerOrderId = assertSafeIdentifier(raw.broker_order_id ?? null, "broker_order_id", { allowNull: true });
  const symbol = validateSymbol(raw.symbol);
  if (!ORDER_SIDE_SET.has(raw.side)) {
    throw new OrdersFillsError("invalid_order_side", 400);
  }
  if (!ORDER_STATE_SET.has(raw.state)) {
    throw new OrdersFillsError("invalid_order_state", 400);
  }
  const qtySubmitted = validateDecimalString(raw.qty_submitted, "qty_submitted", { positive: true });
  const qtyFilled = validateDecimalString(raw.qty_filled ?? "0", "qty_filled", { nonNegative: true });
  const qtyCanceled = validateDecimalString(raw.qty_canceled ?? "0", "qty_canceled", { nonNegative: true });
  const expectedRemainingDec = subDecimal(
    subDecimal(parseDecimal(qtySubmitted), parseDecimal(qtyFilled)),
    parseDecimal(qtyCanceled),
  );
  if (expectedRemainingDec.num < 0n) {
    throw new OrdersFillsError("open_order_qty_exceeds_submitted", 400);
  }
  const qtyRemaining = raw.qty_remaining !== undefined && raw.qty_remaining !== null
    ? validateDecimalString(raw.qty_remaining, "qty_remaining", { nonNegative: true })
    : formatQtyExact(expectedRemainingDec);
  if (parseDecimal(qtyRemaining).num * (10n ** BigInt(expectedRemainingDec.scale))
      !== expectedRemainingDec.num * (10n ** BigInt(parseDecimal(qtyRemaining).scale))) {
    throw new OrdersFillsError("open_order_qty_remaining_mismatch", 400);
  }

  const limitPrice = validateDecimalString(raw.limit_price ?? null, "limit_price", { allowNull: true, positive: true });
  const currency = validateCurrency(raw.currency);
  const asOf = parseStrictUtcString(raw.as_of, "open_order_as_of");
  const evidenceRef = assertSafeIdentifier(raw.evidence_ref, "evidence_ref", { allowSha256: true });

  const reservedFeeUsd = raw.reserved_fee_usd !== undefined && raw.reserved_fee_usd !== null
    ? formatUsdExact(parseDecimal(validateDecimalString(raw.reserved_fee_usd, "reserved_fee_usd", { nonNegative: true })))
    : null;

  let kPendUsd = null;
  let usdBasisQualified = currency === "USD" || raw.usd_basis_qualified === true;
  if (raw.k_pend_usd !== undefined && raw.k_pend_usd !== null) {
    if (!usdBasisQualified) {
      kPendUsd = null;
    } else {
      kPendUsd = formatUsdExact(parseDecimal(validateDecimalString(raw.k_pend_usd, "k_pend_usd", { nonNegative: true })));
    }
  } else if (raw.side === "SELL") {
    kPendUsd = usdBasisQualified ? "0" : null;
  } else if (currency === "USD") {
    if (expectedRemainingDec.num === 0n) {
      kPendUsd = "0";
    } else if (limitPrice !== null) {
      const baseNotional = mulDecimal(expectedRemainingDec, parseDecimal(limitPrice));
      const feeDec = reservedFeeUsd !== null ? parseDecimal(reservedFeeUsd) : { num: 0n, scale: 0 };
      kPendUsd = formatUsdExact(addDecimal(baseNotional, feeDec));
    } else {
      kPendUsd = null;
    }
  } else {
    usdBasisQualified = false;
    kPendUsd = null;
  }

  return {
    broker: identity.broker,
    environment: identity.environment,
    account: identity.account,
    client_order_id: clientOrderId,
    broker_order_id: brokerOrderId,
    symbol,
    side: raw.side,
    state: raw.state,
    qty_submitted: qtySubmitted,
    qty_filled: qtyFilled,
    qty_canceled: qtyCanceled,
    qty_remaining: qtyRemaining,
    limit_price: limitPrice,
    currency,
    k_pend_usd: kPendUsd,
    reserved_fee_usd: reservedFeeUsd,
    usd_basis_qualified: usdBasisQualified,
    as_of: asOf,
    evidence_ref: evidenceRef,
  };
}

/**
 * Normalizes one domain (submissions | executions | cutoff_open_orders) with cap/completeness proof.
 */
export function normalizeOrderDomain(domainName, rawDomain, identity, options = {}) {
  if (!rawDomain || typeof rawDomain !== "object" || Array.isArray(rawDomain)) {
    throw new OrdersFillsError(`missing_domain_${domainName}`, 400);
  }
  const capability = rawDomain.domain_capability;
  if (capability === "unsupported") {
    return evaluateDomainCoverage(rawDomain, { ...options, domain: domainName });
  }
  const hasRecordsArray = Array.isArray(rawDomain.records);
  if (!hasRecordsArray && rawDomain.records !== undefined) {
    throw new OrdersFillsError(`invalid_domain_records_${domainName}`, 400);
  }
  const rawRecords = hasRecordsArray ? rawDomain.records : [];
  let normalizedRecords;
  if (domainName === "submissions") {
    normalizedRecords = rawRecords.map((rec) => normalizeSubmissionRecord(rec, identity));
  } else if (domainName === "executions") {
    normalizedRecords = rawRecords.map((rec) => normalizeExecutionRecord(rec, identity));
  } else if (domainName === "cutoff_open_orders") {
    normalizedRecords = rawRecords.map((rec) => normalizeCutoffOpenOrderRecord(rec, identity));
  } else {
    throw new OrdersFillsError("invalid_domain_name", 400);
  }

  return evaluateDomainCoverage(rawDomain, {
    ...options,
    domain: domainName,
    records: hasRecordsArray ? normalizedRecords : undefined,
  });
}

/**
 * Pure additive adapter converting legacy broker_executions.v1 (ibkr_flex) payloads
 * into C-SA-25 multi-domain input without mutating legacy contracts or exposing
 * private storage locators (source_ref / source_binding_id) or raw account selectors.
 */
export function adaptLegacyBrokerExecutionPayload(legacyPayload, context = {}) {
  if (!legacyPayload || typeof legacyPayload !== "object" || Array.isArray(legacyPayload)) {
    throw new OrdersFillsError("invalid_legacy_broker_executions", 400);
  }
  if (legacyPayload.schema_version !== "broker_executions.v1" || legacyPayload.source !== "ibkr_flex") {
    throw new OrdersFillsError("unsupported_legacy_broker_executions_schema", 400);
  }
  if (!Array.isArray(legacyPayload.records)) {
    throw new OrdersFillsError("invalid_legacy_broker_executions_records", 400);
  }
  const identity = normalizeBrokerIdentity({
    broker: context.broker ?? "ibkr",
    environment: context.environment ?? "live",
    account: context.account,
  });
  const asOf = parseStrictUtcString(legacyPayload.observed_at, "legacy_observed_at");
  const evaluatedAt = context.evaluated_at
    ? parseStrictUtcString(context.evaluated_at, "evaluated_at")
    : asOf;
  const cap = context.cap ?? 256;
  const evidenceRef = safePublicText(context.evidence_ref, "legacy:broker_executions:v1");
  const obsDate = asOf.slice(0, 10);

  const mappedRecords = legacyPayload.records.map((row, idx) => {
    const qtyDec = parseDecimal(row?.quantity);
    if (!qtyDec || qtyDec.num === 0n) {
      throw new OrdersFillsError("invalid_legacy_execution_quantity", 400);
    }
    const positiveQty = formatQtyExact(absDecimal(qtyDec));
    if (typeof row.trade_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.trade_date)) {
      throw new OrdersFillsError("invalid_legacy_execution_trade_date", 400);
    }
    const executedAt = row.trade_date === obsDate
      ? asOf
      : `${row.trade_date}T00:00:00.000Z`;
    return {
      broker: identity.broker,
      environment: identity.environment,
      account: identity.account,
      execution_ref: row.execution_ref,
      report_ref: row.report_ref ?? null,
      client_order_id: null,
      broker_order_id: null,
      symbol: row.symbol,
      side: row.side,
      qty: positiveQty,
      price: row.price,
      currency: row.currency,
      fee_native: row.commission ?? null,
      fee_currency: row.commission_currency ?? null,
      executed_at: executedAt,
      evidence_ref: `${evidenceRef}:${idx}`,
    };
  });

  return {
    broker: identity.broker,
    environment: identity.environment,
    account: identity.account,
    as_of: asOf,
    evaluated_at: evaluatedAt,
    origin: context.origin === "production" ? "production" : "synthetic",
    source_class: context.source_class ?? "authorized_live_broker",
    evidence_ref: evidenceRef,
    domains: {
      submissions: {
        domain_capability: "unsupported",
        as_of: null,
        source: "ibkr_flex_executions_only",
        scope: "account_submissions",
      },
      executions: {
        domain_capability: "supported",
        as_of: asOf,
        source: legacyPayload.source,
        scope: legacyPayload.coverage,
        cap,
        count: mappedRecords.length,
        truncated: mappedRecords.length >= cap,
        completeness: "incomplete",
        records: mappedRecords,
      },
      cutoff_open_orders: {
        domain_capability: "unsupported",
        as_of: null,
        source: "ibkr_flex_executions_only",
        scope: "cutoff_open_orders",
      },
    },
  };
}
