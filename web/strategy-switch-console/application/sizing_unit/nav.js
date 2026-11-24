/**
 * C-SA-14: Single-account USD sizing-unit NAV & cash breakdown contract.
 *
 * Pure leaf module under application/sizing_unit/: never imports legacy
 * Worker runtime modules, never accesses storage/network,
 * never coerces or invents FX rates, and strips private storage locators.
 */

import { MANAGEMENT_STATUS, processingEligible } from "../account_mapping/policy.js";
import { managementDisposition, scopeConflict } from "../account_mapping/management_cohort.js";
import { evaluateFreshness as evaluateSessionFreshness } from "./freshness.js";

export const SIZING_UNIT_NAV_SCHEMA = "qsl.sizing_unit_nav.v1";
export const FUTURE_SKEW_LIMIT_MS = 60_000;
export const MAX_MONEY_SCALE = 12;

const DECIMAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const CURRENCY_RE = /^[A-Z]{3,4}$/;
const ISO_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/;
const PRIVATE_KEYS = new Set([
  "source_ref",
  "kv_key",
  "do_key",
  "storage_key",
  "storage_path",
  "internal_locator",
  "broker_account_hash",
  "broker_account_id",
  "source_binding_id",
  "raw_path",
]);
const PRIVATE_VALUE_RE = new RegExp(
  "(?:https?://|kv://|do://|gs://|s3://|r2://|file://|/" + "Users/|/" + "home/|[A-Za-z]:\\\\|[?&](?:X-Goog-|Signature|Expires|AWSAccessKeyId|token|sig|auth)=)",
  "i",
);

export function parseInstantMs(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = ISO_INSTANT_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (match[8] !== "Z" && (Number(match[9]) > 23 || Number(match[10]) > 59)) return null;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function toUtcIso(ms) {
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

// ------------------------------------------------------------ exact decimal & rational math

export function parseDecimal(text) {
  if (typeof text !== "string" || !DECIMAL_RE.test(text)) return null;
  const neg = text.startsWith("-");
  const unsigned = neg ? text.slice(1) : text;
  const [whole, frac = ""] = unsigned.split(".");
  const digits = BigInt(whole + frac);
  return { num: neg && digits !== 0n ? -digits : digits, scale: frac.length };
}

function alignDecimals(a, b) {
  const scale = Math.max(a.scale, b.scale);
  const da = a.num * 10n ** BigInt(scale - a.scale);
  const db = b.num * 10n ** BigInt(scale - b.scale);
  return { da, db, scale };
}

export function addDecimal(a, b) {
  const { da, db, scale } = alignDecimals(a, b);
  return { num: da + db, scale };
}

export function subDecimal(a, b) {
  const { da, db, scale } = alignDecimals(a, b);
  return { num: da - db, scale };
}

export function mulDecimal(a, b) {
  return { num: a.num * b.num, scale: a.scale + b.scale };
}

export function cmpDecimal(a, b) {
  const { da, db } = alignDecimals(a, b);
  return da < db ? -1 : da > db ? 1 : 0;
}

export function eqDecimal(a, b) {
  return cmpDecimal(a, b) === 0;
}

export function absDecimal(a) {
  return { num: a.num < 0n ? -a.num : a.num, scale: a.scale };
}

export function isZeroDecimal(a) {
  return a.num === 0n;
}

export function formatDecimal(dec, { minScale = 0, explicitPlus = false } = {}) {
  if (!dec || typeof dec.num !== "bigint" || !Number.isInteger(dec.scale)) return null;
  if (dec.num === 0n) return "0";
  const neg = dec.num < 0n;
  const absNum = neg ? -dec.num : dec.num;
  const rawDigits = absNum.toString().padStart(dec.scale + 1, "0");
  const whole = dec.scale > 0 ? rawDigits.slice(0, -dec.scale) : rawDigits;
  let frac = dec.scale > 0 ? rawDigits.slice(-dec.scale).replace(/0+$/, "") : "";
  if (minScale > frac.length) frac = frac.padEnd(minScale, "0");
  const sign = neg ? "-" : explicitPlus ? "+" : "";
  return frac.length > 0 ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

function bigGcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0n ? 1n : x;
}

export function ratNormalize(n, d) {
  if (d === 0n) throw new RangeError("division_by_zero");
  if (n === 0n) return { n: 0n, d: 1n };
  const sign = d < 0n ? -1n : 1n;
  const nn = n * sign;
  const dd = d * sign;
  const g = bigGcd(nn, dd);
  return { n: nn / g, d: dd / g };
}

export function ratFromDecimal(dec) {
  return ratNormalize(dec.num, 10n ** BigInt(dec.scale));
}

export function ratFromText(text) {
  const dec = parseDecimal(text);
  if (!dec) return null;
  return ratFromDecimal(dec);
}

export function ratAdd(a, b) {
  return ratNormalize(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function ratSub(a, b) {
  return ratNormalize(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function ratMul(a, b) {
  return ratNormalize(a.n * b.n, a.d * b.d);
}

export function ratDiv(a, b) {
  return ratNormalize(a.n * b.d, a.d * b.n);
}

export function ratCmp(a, b) {
  const lhs = a.n * b.d;
  const rhs = b.n * a.d;
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}

export function ratMax(a, b) {
  return ratCmp(a, b) >= 0 ? a : b;
}

export function ratToDecimalText(r, { minScale = 0, maxScale = 12, explicitPlus = false } = {}) {
  if (r.n === 0n) return "0";
  const neg = r.n < 0n;
  const absN = neg ? -r.n : r.n;
  // Determine exact terminating decimal scale if denominator is 2^a * 5^b within maxScale.
  let d = r.d;
  let pow2 = 0;
  let pow5 = 0;
  while (d % 2n === 0n) { d /= 2n; pow2++; }
  while (d % 5n === 0n) { d /= 5n; pow5++; }
  const terminating = d === 1n && Math.max(pow2, pow5) <= maxScale;
  const scale = terminating ? Math.max(pow2, pow5, minScale) : maxScale;
  const scaled = (absN * 10n ** BigInt(scale) + r.d / 2n) / r.d;
  if (scaled === 0n) return "0";
  const digits = scaled.toString().padStart(scale + 1, "0");
  const whole = scale > 0 ? digits.slice(0, -scale) : digits;
  let frac = scale > 0 ? digits.slice(-scale).replace(/0+$/, "") : "";
  if (minScale > frac.length) frac = frac.padEnd(minScale, "0");
  const sign = neg ? "-" : explicitPlus ? "+" : "";
  return frac.length > 0 ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

// ------------------------------------------------------------ private locator stripping

export function stripPrivateLocators(value) {
  if (Array.isArray(value)) return value.map(stripPrivateLocators);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (PRIVATE_KEYS.has(k)) continue;
      if (typeof v === "string" && PRIVATE_VALUE_RE.test(v)) continue;
      out[k] = stripPrivateLocators(v);
    }
    return out;
  }
  return value;
}

function safePublicText(ref, fallback = null) {
  if (
    typeof ref !== "string"
    || !ref.length
    || ref.length > 128
    || ref.includes("://")
    || ref.includes("?")
    || PRIVATE_VALUE_RE.test(ref)
  ) {
    return fallback;
  }
  return ref;
}

function safePriceRef(ref) {
  return safePublicText(ref, null);
}

// ------------------------------------------------------------ C-SA-15 freshness wiring

function runFreshnessCheck(account, options = {}) {
  const evaluatedAt = options.evaluated_at ?? account.evaluated_at ?? new Date().toISOString();
  const payload = {
    observed_at: account.observed_at ?? account.observed_finished_at ?? null,
    fetched_at: account.fetched_at ?? null,
    evaluated_at: evaluatedAt,
    last_observed_value: account.nav_usd ?? account.balances?.[0]?.net_assets ?? null,
  };
  const fn = typeof options.evaluateFreshness === "function"
    ? options.evaluateFreshness
    : evaluateSessionFreshness;
  return fn(payload, { calendarProvider: options.calendarProvider ?? null });
}

// ------------------------------------------------------------ B2 cohort & currency classification

function normalizeManagementView(account) {
  if (account?.management_view && typeof account.management_view === "object") {
    return account.management_view;
  }
  return {
    management_status: account?.management_status ?? MANAGEMENT_STATUS.UNKNOWN,
    evidence_state: account?.evidence_state ?? "unknown",
    scope: account?.scope ?? account?.broker_environment ?? "unknown",
  };
}

export function classifyAccountEligibility(account, { require_live_cohort = true } = {}) {
  const view = normalizeManagementView(account);
  const paper = account?.broker_environment === "paper" || account?.account_scope === "paper";
  const env = account?.broker_environment ?? null;
  const conflict = scopeConflict({ paper, environment: env }, view);
  if (conflict) {
    return {
      processing_eligible: false,
      management_status: MANAGEMENT_STATUS.UNKNOWN,
      disposition: "unknown",
      reason: "management_status_unknown",
    };
  }
  if (require_live_cohort && (paper || (view.scope === "paper" && view.evidence_state === "known"))) {
    return {
      processing_eligible: false,
      management_status: view.management_status || MANAGEMENT_STATUS.UNKNOWN,
      disposition: "paper",
      reason: "paper_account",
    };
  }
  const disposition = managementDisposition({ paper, environment: env }, view);
  const eligible = processingEligible(view) && !(require_live_cohort && disposition === "paper");
  if (eligible) {
    return {
      processing_eligible: true,
      management_status: MANAGEMENT_STATUS.MANAGED,
      disposition: "managed",
      reason: null,
    };
  }
  const reasonMap = {
    not_under_management: "not_under_management",
    disabled: "management_disabled",
    paper: "paper_account",
    unknown: "management_status_unknown",
  };
  const statusMap = {
    not_under_management: MANAGEMENT_STATUS.NOT_UNDER_MANAGEMENT,
    disabled: MANAGEMENT_STATUS.DISABLED,
    unknown: MANAGEMENT_STATUS.UNKNOWN,
  };
  return {
    processing_eligible: false,
    management_status: statusMap[disposition] || view.management_status || MANAGEMENT_STATUS.UNKNOWN,
    disposition,
    reason: reasonMap[disposition] || "management_status_unknown",
  };
}

function collectCurrenciesFromBucket(bucket, found) {
  if (!bucket) return;
  if (Array.isArray(bucket)) {
    for (const row of bucket) {
      if (typeof row?.currency === "string" && CURRENCY_RE.test(row.currency)) {
        found.add(row.currency);
      }
    }
    return;
  }
  if (typeof bucket === "object") {
    if (typeof bucket.currency === "string" && CURRENCY_RE.test(bucket.currency)) {
      found.add(bucket.currency);
    }
    for (const [k, v] of Object.entries(bucket)) {
      if (CURRENCY_RE.test(k)) found.add(k);
      if (typeof v?.currency === "string" && CURRENCY_RE.test(v.currency)) {
        found.add(v.currency);
      }
    }
  }
}

function collectAccountCurrencies(account) {
  const found = new Set();
  if (typeof account?.currency === "string" && CURRENCY_RE.test(account.currency)) {
    found.add(account.currency);
  }
  collectCurrenciesFromBucket(account?.balances, found);
  collectCurrenciesFromBucket(account?.broker_reported_balances, found);
  collectCurrenciesFromBucket(account?.account_balances, found);
  collectCurrenciesFromBucket(account?.cash, found);
  collectCurrenciesFromBucket(account?.positions, found);
  return [...found].sort();
}

function buildObservationMeta(account, fresh) {
  const currencies = collectAccountCurrencies(account);
  return {
    account_id: typeof account?.account_id === "string" ? account.account_id : null,
    platform: typeof account?.platform === "string" ? account.platform : null,
    broker_environment: account?.broker_environment === "live" || account?.broker_environment === "paper"
      ? account.broker_environment : null,
    currency: currencies.length === 1 ? currencies[0] : (currencies[0] || null),
    observed_at: fresh.observed_at,
    data_status: fresh.data_status,
    age_seconds: fresh.age_seconds,
  };
}

function failClosedResult({
  account,
  eligibility,
  fresh,
  reason,
  currencies = [],
  observations = [],
  cohort = { total_accounts: 1, included_count: 0, excluded_count: 0, excluded_accounts: [] },
}) {
  return stripPrivateLocators({
    schema_version: SIZING_UNIT_NAV_SCHEMA,
    status: "unavailable",
    reason,
    account_id: typeof account?.account_id === "string" ? account.account_id : null,
    platform: typeof account?.platform === "string" ? account.platform : null,
    broker_environment: account?.broker_environment === "live" || account?.broker_environment === "paper"
      ? account.broker_environment : null,
    management_status: eligibility.management_status,
    processing_eligible: eligibility.processing_eligible,
    currency: "USD",
    currencies_present: currencies,
    currency_coercion: "prohibited",
    fx_inferred: false,
    margin_enabled: false,
    nav_usd: null,
    settled_cash_usd: null,
    unsettled_cash_usd: null,
    tbill_nav_usd: null,
    etf_market_value_usd: null,
    accrued_fees_usd: null,
    margin_debt_usd: null,
    positions: [],
    observed_at: fresh.observed_at,
    fetched_at: fresh.fetched_at,
    evaluated_at: fresh.evaluated_at,
    data_status: fresh.data_status,
    freshness: {
      data_status: fresh.data_status,
      age_seconds: fresh.age_seconds,
      age_sessions: fresh.age_sessions,
      observed_at: fresh.observed_at,
      fetched_at: fresh.fetched_at,
      evaluated_at: fresh.evaluated_at,
      reason: fresh.reason,
    },
    observations,
    cohort,
    origin: account?.origin === "production" ? "production" : "synthetic",
    source_class: account?.source_class || "synthetic",
    native_precision: { exact_decimal: true, money_scale_max: 8 },
    coverage_window: fresh.observed_at
      ? { start_utc: fresh.observed_at, end_utc: fresh.observed_at }
      : null,
    evidence_ref: safePublicText(account?.evidence_ref, "sa1:sizing_unit:unavailable"),
  });
}

// ------------------------------------------------------------ C-SA-14 single-account evaluator

export function evaluateSizingUnitNav(input, options = {}) {
  const account = input || {};
  const eligibility = classifyAccountEligibility(account, {
    require_live_cohort: options.require_live_cohort ?? true,
  });
  const fresh = runFreshnessCheck(account, options);
  const currencies = collectAccountCurrencies(account);
  const observations = options.observations || [buildObservationMeta(account, fresh)];
  const cohort = options.cohort || {
    total_accounts: 1,
    included_count: eligibility.processing_eligible ? 1 : 0,
    excluded_count: eligibility.processing_eligible ? 0 : 1,
    excluded_accounts: eligibility.processing_eligible
      ? []
      : [{
        account_id: typeof account?.account_id === "string" ? account.account_id : null,
        platform: typeof account?.platform === "string" ? account.platform : null,
        broker_environment: account?.broker_environment ?? null,
        management_status: eligibility.management_status,
        disposition: eligibility.disposition,
        reason: eligibility.reason,
      }],
  };

  if (!eligibility.processing_eligible) {
    return failClosedResult({ account, eligibility, fresh, reason: eligibility.reason, currencies, observations, cohort });
  }
  if (currencies.length > 1) {
    return failClosedResult({ account, eligibility, fresh, reason: "mixed_currency", currencies, observations, cohort });
  }
  if (currencies.length === 0 || currencies[0] !== "USD") {
    return failClosedResult({ account, eligibility, fresh, reason: "fx_unavailable", currencies, observations, cohort });
  }
  if (fresh.data_status !== "fresh" || !fresh.sizing_eligible) {
    return failClosedResult({
      account,
      eligibility,
      fresh,
      reason: fresh.reason || (fresh.data_status === "stale" ? "snapshot_stale" : fresh.data_status),
      currencies,
      observations,
      cohort,
    });
  }
  if (account.margin_enabled === true) {
    return failClosedResult({ account, eligibility, fresh, reason: "margin_prohibited", currencies, observations, cohort });
  }

  const marginDebtDec = parseDecimal(account.margin_debt_usd);
  if (!marginDebtDec || !isZeroDecimal(marginDebtDec)) {
    return failClosedResult({ account, eligibility, fresh, reason: "margin_prohibited", currencies, observations, cohort });
  }

  const settledDec = parseDecimal(account.settled_cash_usd);
  const unsettledDec = parseDecimal(account.unsettled_cash_usd);
  const tbillDec = parseDecimal(account.tbill_nav_usd);
  const etfDec = parseDecimal(account.etf_market_value_usd);
  const feesDec = parseDecimal(account.accrued_fees_usd);
  if (!settledDec || !unsettledDec || !tbillDec || !etfDec || !feesDec) {
    return failClosedResult({ account, eligibility, fresh, reason: "cash_breakdown_incomplete", currencies, observations, cohort });
  }

  if (!Array.isArray(account.positions)) {
    return failClosedResult({ account, eligibility, fresh, reason: "positions_missing", currencies, observations, cohort });
  }
  const cleanPositions = [];
  let posSum = { num: 0n, scale: 0 };
  for (const pos of account.positions) {
    const qtyDec = parseDecimal(pos?.qty);
    const mvDec = parseDecimal(pos?.market_value_usd);
    const pRef = safePriceRef(pos?.price_ref);
    if (typeof pos?.symbol !== "string" || !qtyDec || !mvDec || !pRef) {
      return failClosedResult({ account, eligibility, fresh, reason: "invalid_position", currencies, observations, cohort });
    }
    posSum = addDecimal(posSum, mvDec);
    cleanPositions.push({
      symbol: pos.symbol,
      qty: formatDecimal(qtyDec),
      market_value_usd: formatDecimal(mvDec, { minScale: mvDec.scale }),
      price_ref: pRef,
    });
  }
  if (cleanPositions.length > 0 && !eqDecimal(posSum, etfDec)) {
    return failClosedResult({ account, eligibility, fresh, reason: "positions_etf_mismatch", currencies, observations, cohort });
  }

  const computedNav = subDecimal(
    addDecimal(addDecimal(addDecimal(settledDec, unsettledDec), tbillDec), etfDec),
    feesDec,
  );
  const declaredNavText = account.nav_usd ?? account.balances?.[0]?.net_assets ?? null;
  if (declaredNavText !== null) {
    const declaredNav = parseDecimal(declaredNavText);
    if (!declaredNav || !eqDecimal(computedNav, declaredNav)) {
      return failClosedResult({ account, eligibility, fresh, reason: "nav_reconciliation_mismatch", currencies, observations, cohort });
    }
  }

  const formatMoneyField = (dec, rawText) => {
    const rawFrac = (String(rawText).split(".")[1] || "").length;
    return dec.num === 0n ? "0" : formatDecimal(dec, { minScale: Math.max(2, rawFrac) });
  };

  return stripPrivateLocators({
    schema_version: SIZING_UNIT_NAV_SCHEMA,
    status: "available",
    reason: null,
    account_id: account.account_id,
    platform: account.platform,
    broker_environment: account.broker_environment,
    management_status: MANAGEMENT_STATUS.MANAGED,
    processing_eligible: true,
    currency: "USD",
    currencies_present: ["USD"],
    currency_coercion: "prohibited",
    fx_inferred: false,
    margin_enabled: false,
    nav_usd: declaredNavText !== null
      ? formatMoneyField(parseDecimal(declaredNavText), declaredNavText)
      : formatDecimal(computedNav, { minScale: 2 }),
    settled_cash_usd: formatMoneyField(settledDec, account.settled_cash_usd),
    unsettled_cash_usd: formatMoneyField(unsettledDec, account.unsettled_cash_usd),
    tbill_nav_usd: formatMoneyField(tbillDec, account.tbill_nav_usd),
    etf_market_value_usd: formatMoneyField(etfDec, account.etf_market_value_usd),
    accrued_fees_usd: formatMoneyField(feesDec, account.accrued_fees_usd),
    margin_debt_usd: "0",
    positions: cleanPositions,
    observed_at: fresh.observed_at,
    fetched_at: fresh.fetched_at,
    evaluated_at: fresh.evaluated_at,
    data_status: "fresh",
    freshness: {
      data_status: "fresh",
      age_seconds: fresh.age_seconds,
      age_sessions: fresh.age_sessions,
      observed_at: fresh.observed_at,
      fetched_at: fresh.fetched_at,
      evaluated_at: fresh.evaluated_at,
      reason: null,
    },
    observations,
    cohort,
    origin: account.origin === "production" ? "production" : "synthetic",
    source_class: account.source_class || "synthetic",
    native_precision: { exact_decimal: true, money_scale_max: 8 },
    coverage_window: { start_utc: fresh.observed_at, end_utc: fresh.observed_at },
    evidence_ref: safePublicText(account.evidence_ref, `sa1:sizing_unit:${account.account_id}`),
  });
}

// ------------------------------------------------------------ C-SA-14 cohort isolation evaluator

export function evaluateSizingUnitCohort(accounts, options = {}) {
  const list = Array.isArray(accounts) ? accounts : [];
  const requireLive = options.require_live_cohort ?? true;
  const evaluatedAt = options.evaluated_at ?? new Date().toISOString();
  const observations = [];
  const eligibleAccounts = [];
  const excludedAccounts = [];
  const excludedRecords = [];

  for (const acct of list) {
    const fresh = runFreshnessCheck(acct, { ...options, evaluated_at: evaluatedAt });
    observations.push(buildObservationMeta(acct, fresh));
    const elig = classifyAccountEligibility(acct, { require_live_cohort: requireLive });
    if (elig.processing_eligible) {
      eligibleAccounts.push({ acct, elig, fresh });
    } else {
      const excl = {
        account_id: typeof acct?.account_id === "string" ? acct.account_id : null,
        platform: typeof acct?.platform === "string" ? acct.platform : null,
        broker_environment: acct?.broker_environment ?? null,
        management_status: elig.management_status,
        disposition: elig.disposition,
        reason: elig.reason,
      };
      excludedAccounts.push(excl);
      excludedRecords.push({ acct, excl });
    }
  }

  const cohortSummary = {
    total_accounts: list.length,
    included_count: eligibleAccounts.length === 1 ? 1 : 0,
    excluded_count: excludedAccounts.length,
    excluded_accounts: excludedAccounts,
  };

  if (eligibleAccounts.length === 0) {
    const fallbackFresh = runFreshnessCheck({}, { ...options, evaluated_at: evaluatedAt });
    return failClosedResult({
      account: {},
      eligibility: { processing_eligible: false, management_status: MANAGEMENT_STATUS.UNKNOWN },
      fresh: fallbackFresh,
      reason: "no_eligible_sizing_unit",
      currencies: [],
      observations,
      cohort: cohortSummary,
    });
  }

  const eligibleCurrencies = [...new Set(eligibleAccounts.flatMap(({ acct }) => collectAccountCurrencies(acct)))].sort();
  if (eligibleCurrencies.length > 1) {
    const first = eligibleAccounts[0];
    return failClosedResult({
      account: first.acct,
      eligibility: first.elig,
      fresh: first.fresh,
      reason: "mixed_currency",
      currencies: eligibleCurrencies,
      observations,
      cohort: { ...cohortSummary, included_count: 0 },
    });
  }

  const designatedId = options.designated_account_id ?? options.designated_account_key ?? null;
  const designatedPlatform = typeof options.designated_platform === "string" && options.designated_platform.length
    ? options.designated_platform
    : null;
  const matchesDesignated = (acctOrExcl) => {
    if (designatedPlatform !== null && acctOrExcl?.platform !== designatedPlatform) return false;
    return acctOrExcl?.account_id === designatedId || acctOrExcl?.account_key === designatedId;
  };
  let targetEntry = null;
  if (designatedId !== null) {
    const eligibleMatches = eligibleAccounts.filter(({ acct }) => matchesDesignated(acct));
    const excludedMatches = excludedRecords.filter(({ acct }) => matchesDesignated(acct));
    if (eligibleMatches.length > 1 || (designatedPlatform === null && eligibleMatches.length + excludedMatches.length > 1)) {
      return failClosedResult({
        account: { account_id: designatedId, platform: designatedPlatform },
        eligibility: { processing_eligible: false, management_status: MANAGEMENT_STATUS.UNKNOWN },
        fresh: runFreshnessCheck({}, { ...options, evaluated_at: evaluatedAt }),
        reason: "ambiguous_sizing_unit",
        currencies: eligibleCurrencies,
        observations,
        cohort: { ...cohortSummary, included_count: 0 },
      });
    }
    targetEntry = eligibleMatches[0] || null;
    if (!targetEntry) {
      const excluded = excludedMatches[0]?.excl;
      const fallbackFresh = runFreshnessCheck({}, { ...options, evaluated_at: evaluatedAt });
      return failClosedResult({
        account: { account_id: designatedId, platform: designatedPlatform },
        eligibility: {
          processing_eligible: false,
          management_status: excluded?.management_status || MANAGEMENT_STATUS.UNKNOWN,
        },
        fresh: fallbackFresh,
        reason: excluded?.reason || "designated_account_not_eligible",
        currencies: eligibleCurrencies,
        observations,
        cohort: { ...cohortSummary, included_count: 0 },
      });
    }
  } else if (eligibleAccounts.length > 1) {
    const first = eligibleAccounts[0];
    return failClosedResult({
      account: first.acct,
      eligibility: first.elig,
      fresh: first.fresh,
      reason: "ambiguous_sizing_unit",
      currencies: eligibleCurrencies,
      observations,
      cohort: { ...cohortSummary, included_count: 0 },
    });
  } else {
    targetEntry = eligibleAccounts[0];
  }

  return evaluateSizingUnitNav(targetEntry.acct, {
    ...options,
    evaluated_at: evaluatedAt,
    observations,
    cohort: cohortSummary,
  });
}
