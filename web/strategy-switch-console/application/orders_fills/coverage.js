/**
 * C-SA-25: Explicit cap (256 / 512 / 2048), completeness proof, empty-domain gate,
 * unsupported-domain marker, and K_pend non-release enforcement.
 *
 * Pure leaf module under application/orders_fills/: imports only inward from
 * ./constants.js, ../naming_canonical/helpers.js, and ../sizing_unit/nav.js.
 */

import { isRawAccountIdentifier, isUnsafePrivateLocator } from "../naming_canonical/helpers.js";
import { parseInstantNs, toUtcIsoFromNs } from "../sizing_unit/nav.js";
import {
  COMPLETENESS_SET,
  CURRENCY_RE,
  DOMAIN_CAP_SET,
  DOMAIN_CAPABILITY_SET,
  DOMAIN_NAME_SET,
  OrdersFillsError,
} from "./constants.js";

function validateSafeCurrencyToken(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new OrdersFillsError(`invalid_${fieldName}`, 400);
  }
  if (isUnsafePrivateLocator(value)) {
    throw new OrdersFillsError(`unsafe_private_locator_${fieldName}`, 400);
  }
  if (isRawAccountIdentifier(value)) {
    throw new OrdersFillsError(`raw_account_id_prohibited_${fieldName}`, 400);
  }
  if (!CURRENCY_RE.test(value)) {
    throw new OrdersFillsError(`invalid_${fieldName}`, 400);
  }
  return value;
}

function validateSafeMetaText(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) {
    throw new OrdersFillsError(`invalid_${fieldName}`, 400);
  }
  if (isUnsafePrivateLocator(value)) {
    throw new OrdersFillsError(`unsafe_private_locator_${fieldName}`, 400);
  }
  if (isRawAccountIdentifier(value)) {
    throw new OrdersFillsError(`raw_account_id_prohibited_${fieldName}`, 400);
  }
  return value;
}

function parseStrictUtcInstant(value, fieldName, { nullable = false } = {}) {
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
 * Evaluates C-SA-25 domain coverage, cap (256/512/2048), completeness, empty-domain proof,
 * and K_pend release gating.
 */
export function evaluateDomainCoverage(rawDomain, options = {}) {
  if (!rawDomain || typeof rawDomain !== "object" || Array.isArray(rawDomain)) {
    throw new OrdersFillsError("invalid_domain_envelope", 400);
  }
  const domain = options.domain ?? rawDomain.domain;
  if (!DOMAIN_NAME_SET.has(domain)) {
    throw new OrdersFillsError("invalid_domain_name", 400);
  }
  const capability = rawDomain.domain_capability;
  if (!DOMAIN_CAPABILITY_SET.has(capability)) {
    throw new OrdersFillsError("invalid_domain_capability", 400);
  }

  const source = validateSafeMetaText(rawDomain.source, "domain_source");
  const scope = validateSafeMetaText(rawDomain.scope, "domain_scope");

  if (capability === "unsupported") {
    if (Array.isArray(rawDomain.records) && rawDomain.records.length > 0) {
      throw new OrdersFillsError("unsupported_domain_has_records", 400);
    }
    if (rawDomain.completeness === "complete") {
      throw new OrdersFillsError("unsupported_domain_cannot_be_complete", 400);
    }
    if (rawDomain.count !== undefined && rawDomain.count !== null) {
      throw new OrdersFillsError("unsupported_domain_cannot_emit_count", 400);
    }
    const asOf = parseStrictUtcInstant(rawDomain.as_of ?? null, "domain_as_of", { nullable: true });
    return {
      domain,
      domain_capability: "unsupported",
      as_of: asOf,
      source,
      scope,
      native_currency: null,
      currencies_present: [],
      cap: null,
      count: null,
      truncated: null,
      completeness: "unsupported",
      empty_domain_proven: false,
      k_pend_release_allowed: false,
      records: [],
    };
  }

  const asOf = parseStrictUtcInstant(rawDomain.as_of, "domain_as_of", { nullable: false });
  if (!Number.isInteger(rawDomain.cap) || !DOMAIN_CAP_SET.has(rawDomain.cap)) {
    throw new OrdersFillsError("invalid_domain_cap", 400);
  }
  const cap = rawDomain.cap;

  let completeness = rawDomain.completeness;
  if (!COMPLETENESS_SET.has(completeness) || completeness === "unsupported") {
    throw new OrdersFillsError("invalid_domain_completeness", 400);
  }
  if (typeof rawDomain.truncated !== "boolean") {
    throw new OrdersFillsError("invalid_domain_truncated_flag", 400);
  }
  const truncated = rawDomain.truncated;

  const normalizedRecords = Array.isArray(options.records)
    ? options.records
    : Array.isArray(rawDomain.records)
      ? rawDomain.records
      : null;

  if (normalizedRecords !== null && normalizedRecords.length > cap) {
    throw new OrdersFillsError("domain_records_exceed_cap", 400);
  }

  let count;
  if (rawDomain.count !== undefined && rawDomain.count !== null) {
    if (!Number.isInteger(rawDomain.count) || rawDomain.count < 0) {
      throw new OrdersFillsError("invalid_domain_count", 400);
    }
    if (normalizedRecords !== null && rawDomain.count < normalizedRecords.length) {
      throw new OrdersFillsError("domain_count_below_records_length", 400);
    }
    count = rawDomain.count;
  } else if (normalizedRecords !== null) {
    count = normalizedRecords.length;
  } else {
    throw new OrdersFillsError("missing_domain_count_or_records", 400);
  }

  if (count > cap && !truncated) {
    throw new OrdersFillsError("domain_count_exceeds_cap", 400);
  }

  if (normalizedRecords !== null && count !== normalizedRecords.length && !truncated) {
    completeness = "incomplete";
  }

  const currencies = new Set();
  if (rawDomain.native_currency !== undefined && rawDomain.native_currency !== null) {
    currencies.add(validateSafeCurrencyToken(rawDomain.native_currency, "native_currency"));
  }
  if (normalizedRecords) {
    for (const rec of normalizedRecords) {
      if (rec && rec.currency !== undefined && rec.currency !== null) {
        currencies.add(validateSafeCurrencyToken(rec.currency, "record_currency"));
      }
      if (rec && rec.fee_currency !== undefined && rec.fee_currency !== null) {
        validateSafeCurrencyToken(rec.fee_currency, "record_fee_currency");
      }
    }
  }
  const currenciesPresent = [...currencies].sort();
  const nativeCurrency = currenciesPresent.length === 1 ? currenciesPresent[0] : null;

  const emptyDomainProven = truncated === false && completeness === "complete" && count === 0;
  const hasOrderUnknownLocks = Boolean(options.hasOrderUnknownLocks);
  const kPendReleaseAllowed = truncated === false
    && completeness === "complete"
    && count < cap
    && !hasOrderUnknownLocks;

  return {
    domain,
    domain_capability: "supported",
    as_of: asOf,
    source,
    scope,
    native_currency: nativeCurrency,
    currencies_present: currenciesPresent,
    cap,
    count,
    truncated,
    completeness,
    empty_domain_proven: emptyDomainProven,
    k_pend_release_allowed: kPendReleaseAllowed,
    records: normalizedRecords ?? [],
  };
}
