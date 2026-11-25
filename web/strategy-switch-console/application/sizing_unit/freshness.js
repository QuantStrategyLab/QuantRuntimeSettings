/**
 * C-SA-15: Trading-session freshness, future-skew boundary, and O1 gate.
 *
 * Pure leaf module under application/sizing_unit/:
 * - Enforces inclusive unrounded 60_000_000_000 ns (60 s) future-skew across (E, F, G)
 *   in exact BigInt nanoseconds (never truncating sub-millisecond fractional skew).
 * - Counts XNYS trading session closes over half-open (min(E, G), G].
 * - Requires a valid pinned calendarProvider (e.g., pinned csa22-v1 until SA-3);
 *   rejects unpinned providers or empty/malformed session records ({}).
 * - Preserves display values (last_observed_value, last_observed_at, age_seconds,
 *   age_sessions) when failing closed for sizing / Supply-B proof / O1.
 */

import { createXnysRuntimeProvider } from "../market_sessions/xnys_calendar.js";

export const FUTURE_SKEW_LIMIT_MS = 60_000;
export const FUTURE_SKEW_LIMIT_NS = 60_000_000_000n;
export const PINNED_CALENDAR_DIGESTS = Object.freeze({
  "csa22-v1": "6601c01f2907119c25a2687d4b67210285d3c13ebf2d86a2953745dbd1f6f2af",
  "csa22-v2": "2ba8cd7684c361209df68bfa2e10004c1f9922a645c7ec55d421fda520561798",
});
const ISO_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NY_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const NY_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});

export function parseInstantNs(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const wholeMs = Math.trunc(value);
    const subMs = value - wholeMs;
    const subNs = BigInt(Math.round(subMs * 1_000_000));
    return BigInt(wholeMs) * 1_000_000n + subNs;
  }
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

  let offsetMinutes = 0;
  if (match[8] !== "Z") {
    const offH = Number(match[9]);
    const offM = Number(match[10]);
    if (offH > 23 || offM > 59) return null;
    const sign = match[8].startsWith("-") ? -1 : 1;
    offsetMinutes = sign * (offH * 60 + offM);
  }

  const utcCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    utcCheck.getUTCFullYear() !== year
    || utcCheck.getUTCMonth() !== month - 1
    || utcCheck.getUTCDate() !== day
  ) {
    return null;
  }

  const wholeMs = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000;
  const fracNs = BigInt((match[7] || "").padEnd(9, "0").slice(0, 9));
  return BigInt(wholeMs) * 1_000_000n + fracNs;
}

export function toUtcIsoFromNs(ns) {
  if (typeof ns !== "bigint") return null;
  const ms = ns / 1_000_000n;
  const subMsNs = ((ns % 1_000_000n) + 1_000_000n) % 1_000_000n;
  const baseIso = new Date(Number(ms)).toISOString();
  if (subMsNs === 0n) return baseIso;
  const wholeSecMs = ms - (((ms % 1000n) + 1000n) % 1000n);
  const secNs = ((ns - wholeSecMs * 1_000_000n) + 1_000_000_000n) % 1_000_000_000n;
  const frac = secNs.toString().padStart(9, "0").replace(/0+$/, "");
  return `${new Date(Number(wholeSecMs)).toISOString().slice(0, 19)}.${frac}Z`;
}

function toNyDateFromNs(ns) {
  const ms = Number(ns / 1_000_000n);
  return NY_DATE_FORMAT.format(new Date(ms));
}

function toUtcDateFromNs(ns) {
  const ms = Number(ns / 1_000_000n);
  return new Date(ms).toISOString().slice(0, 10);
}

function toNyTimeFromNs(ns) {
  const ms = Number(ns / 1_000_000n);
  return NY_TIME_FORMAT.format(new Date(ms));
}

function isIsoWeekday(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

function nextIsoDate(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

function isPinnedCalendarMetadata(meta) {
  const expectedDigest = meta && typeof meta.calendar_version === "string"
    && Object.hasOwn(PINNED_CALENDAR_DIGESTS, meta.calendar_version)
    ? PINNED_CALENDAR_DIGESTS[meta.calendar_version]
    : null;
  return Boolean(
    meta
    && expectedDigest !== null
    && meta.spec_digest === expectedDigest
    && meta.exchange === "XNYS"
    && typeof meta.coverage_start_date === "string"
    && ISO_DATE_RE.test(meta.coverage_start_date)
    && typeof meta.coverage_end_date === "string"
    && ISO_DATE_RE.test(meta.coverage_end_date)
    && meta.coverage_start_date <= meta.coverage_end_date,
  );
}

/**
 * Wraps pinned calendar vectors (csa22_pinned_vectors_2025.json or SA-3 adapter)
 * into a deterministic synchronous calendarProvider interface.
 */
export function createPinnedCalendarProvider(pinnedVectors) {
  const sessions = pinnedVectors?.sessions && typeof pinnedVectors.sessions === "object"
    ? pinnedVectors.sessions
    : null;
  const meta = pinnedVectors?.metadata && typeof pinnedVectors.metadata === "object"
    ? pinnedVectors.metadata
    : {};
  const pinned = isPinnedCalendarMetadata(meta);
  const startDate = pinned ? meta.coverage_start_date : null;
  const endDate = pinned ? meta.coverage_end_date : null;

  return {
    calendar_version: pinned ? meta.calendar_version : "unknown",
    exchange: meta.exchange ?? "XNYS",
    spec_digest: pinned ? meta.spec_digest : null,
    is_pinned: pinned,
    coverage() {
      return {
        start_date: startDate,
        end_date: endDate,
      };
    },
    getSession(tradeDate) {
      if (!pinned || !sessions || typeof tradeDate !== "string") return null;
      return Object.hasOwn(sessions, tradeDate) ? sessions[tradeDate] : null;
    },
  };
}

function hasValidVersionDigestsMap(calendarProvider) {
  const digests = calendarProvider?.version_digests;
  const versions = calendarProvider?.calendar_versions;
  if (!digests || typeof digests !== "object" || !Array.isArray(versions) || versions.length === 0) {
    return null;
  }
  const map = new Map();
  for (const version of versions) {
    if (
      typeof version !== "string"
      || !Object.hasOwn(PINNED_CALENDAR_DIGESTS, version)
      || !Object.hasOwn(digests, version)
      || digests[version] !== PINNED_CALENDAR_DIGESTS[version]
    ) {
      return null;
    }
    map.set(version, digests[version]);
  }
  return map;
}

/**
 * Returns the C-SA-22 runtime calendar provider powered by digest-verified
 * market_sessions/xnys_calendar.js (spanning csa22-v1 2025 & csa22-v2 2026 by default).
 */
export function createRuntimeCalendarProvider(options = {}) {
  return createXnysRuntimeProvider(options);
}

function evaluateXnysInterval(startExclusiveInput, endInclusiveInput, calendarProvider) {
  if (
    !calendarProvider
    || typeof calendarProvider.getSession !== "function"
    || typeof calendarProvider.coverage !== "function"
    || calendarProvider.is_pinned === false
  ) {
    return { covered: false, age_sessions: null, touched_sessions: null, reason: "calendar_provider_unavailable" };
  }
  const multiVersionMap = hasValidVersionDigestsMap(calendarProvider);
  const expectedDigest = typeof calendarProvider.calendar_version === "string"
    && Object.hasOwn(PINNED_CALENDAR_DIGESTS, calendarProvider.calendar_version)
    ? PINNED_CALENDAR_DIGESTS[calendarProvider.calendar_version]
    : null;
  if (
    calendarProvider.exchange !== "XNYS"
    || expectedDigest === null
    || calendarProvider.spec_digest !== expectedDigest
  ) {
    return { covered: false, age_sessions: null, touched_sessions: null, reason: "calendar_unpinned" };
  }
  if (calendarProvider.calendar_versions !== undefined && multiVersionMap === null) {
    return { covered: false, age_sessions: null, touched_sessions: null, reason: "calendar_unpinned" };
  }

  const cov = calendarProvider.coverage();
  if (
    !cov
    || typeof cov.start_date !== "string"
    || !ISO_DATE_RE.test(cov.start_date)
    || typeof cov.end_date !== "string"
    || !ISO_DATE_RE.test(cov.end_date)
  ) {
    return { covered: false, age_sessions: null, touched_sessions: null, reason: "calendar_coverage_missing" };
  }

  const loRaw = typeof startExclusiveInput === "bigint"
    ? startExclusiveInput
    : parseInstantNs(startExclusiveInput);
  const hiRaw = typeof endInclusiveInput === "bigint"
    ? endInclusiveInput
    : parseInstantNs(endInclusiveInput);
  if (loRaw === null || hiRaw === null) {
    return { covered: false, age_sessions: null, touched_sessions: null, reason: "calendar_interval_invalid" };
  }
  const loNs = loRaw <= hiRaw ? loRaw : hiRaw;
  const hiNs = hiRaw;
  const startNy = toNyDateFromNs(loNs);
  const endNy = toNyDateFromNs(hiNs);
  const endUtc = toUtcDateFromNs(hiNs);

  if (startNy < cov.start_date || endNy > cov.end_date || endUtc > cov.end_date) {
    return { covered: false, age_sessions: null, touched_sessions: null, reason: "calendar_coverage_out_of_range" };
  }

  let count = 0;
  let touched = 0;
  let cursor = startNy;
  let guard = 0;
  while (cursor <= endNy) {
    if (++guard > 2000) {
      return { covered: false, age_sessions: null, touched_sessions: null, reason: "calendar_span_exceeded" };
    }
    const session = calendarProvider.getSession(cursor);
    const sessionPinnedDigest = multiVersionMap
      ? (typeof session?.calendar_version === "string" && multiVersionMap.get(session.calendar_version)) || null
      : (session?.calendar_version === calendarProvider.calendar_version ? calendarProvider.spec_digest : null);
    if (
      !session
      || typeof session !== "object"
      || typeof session.is_trading_day !== "boolean"
      || typeof session.blocks_eligibility !== "boolean"
      || session.exchange !== "XNYS"
      || sessionPinnedDigest === null
      || session.spec_digest !== sessionPinnedDigest
      || (session.trade_date !== undefined && session.trade_date !== cursor)
    ) {
      return {
        covered: false,
        age_sessions: null,
        touched_sessions: null,
        reason: "calendar_session_malformed_or_unpinned",
      };
    }
    const isTrading = session.is_trading_day === true && session.blocks_eligibility !== true;
    if (isTrading) {
      const closeNs = typeof session.close_utc === "string" ? parseInstantNs(session.close_utc) : null;
      if (closeNs === null) {
        return { covered: false, age_sessions: null, touched_sessions: null, reason: "calendar_close_utc_missing" };
      }
      const openNs = typeof session.open_utc === "string" ? parseInstantNs(session.open_utc) : null;
      if (openNs === null) {
        return { covered: false, age_sessions: null, touched_sessions: null, reason: "calendar_open_utc_missing" };
      }
      if (toNyDateFromNs(openNs) !== cursor || toNyDateFromNs(closeNs) !== cursor || openNs >= closeNs) {
        return { covered: false, age_sessions: null, touched_sessions: null, reason: "calendar_session_bounds_mismatch" };
      }
      const closedInInterval = closeNs > loNs && closeNs <= hiNs;
      const openedInInterval = openNs > loNs && openNs <= hiNs;
      if (closedInInterval) {
        count += 1;
      }
      if (closedInInterval || openedInInterval) {
        touched += 1;
      }
    }
    cursor = nextIsoDate(cursor);
  }

  return { covered: true, age_sessions: count, touched_sessions: touched, reason: null };
}

/**
 * Counts XNYS trading session closes in half-open interval (startExclusive, endInclusive].
 * Fails closed when calendarProvider is missing/unpinned, dates are uncovered,
 * or any day returns an empty `{}` or malformed session object.
 */
export function countXnysSessionCloses(startExclusiveInput, endInclusiveInput, calendarProvider) {
  const res = evaluateXnysInterval(startExclusiveInput, endInclusiveInput, calendarProvider);
  return { covered: res.covered, age_sessions: res.age_sessions, reason: res.reason };
}

/**
 * Counts XNYS trading sessions touched (opened or closed) inside (startExclusive, endInclusive],
 * catching missing intermediate trading days even when the ending valuation precedes close.
 */
export function countXnysTouchedSessions(startExclusiveInput, endInclusiveInput, calendarProvider) {
  const res = evaluateXnysInterval(startExclusiveInput, endInclusiveInput, calendarProvider);
  return { covered: res.covered, touched_sessions: res.touched_sessions, reason: res.reason };
}

/**
 * Counts potential Mon-Fri weekday sessions touched in (startMs, endMs] when
 * no calendarProvider is available (fails closed on multi-weekday spans).
 */
export function countWeekdayTouchedSessions(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  const loNs = parseInstantNs(startMs);
  const hiNs = parseInstantNs(endMs);
  if (loNs === null || hiNs === null) return null;
  const startNy = toNyDateFromNs(loNs);
  const endNy = toNyDateFromNs(hiNs);
  if (startNy === endNy) {
    return isIsoWeekday(startNy) ? 1 : 0;
  }
  let count = 0;
  if (isIsoWeekday(startNy) && toNyTimeFromNs(loNs) < "16:00") {
    count += 1;
  }
  let cursor = nextIsoDate(startNy);
  let guard = 0;
  while (cursor < endNy) {
    if (++guard > 2000) return null;
    if (isIsoWeekday(cursor)) count += 1;
    cursor = nextIsoDate(cursor);
  }
  if (isIsoWeekday(endNy)) {
    count += 1;
  }
  return count;
}

function buildResult({
  data_status,
  age_seconds,
  age_sessions,
  observed_at,
  fetched_at,
  evaluated_at,
  sizing_eligible,
  reason,
  last_observed_value,
}) {
  const blocked = !sizing_eligible;
  return {
    data_status,
    age_seconds,
    age_sessions,
    observed_at,
    fetched_at,
    evaluated_at,
    sizing_eligible,
    supply_b_proof_eligible: sizing_eligible,
    o1_block_exposure_increase: blocked,
    o1_state: blocked ? "blocked" : "clear",
    reason,
    display: {
      last_observed_value: last_observed_value ?? null,
      last_observed_at: observed_at,
      age_seconds,
      age_sessions,
    },
  };
}

/**
 * Evaluates C-SA-15 freshness, skew bounds, and O1 fail-closed gate.
 */
export function evaluateFreshness(input = {}, options = {}) {
  const sourceAvailable = input.source_available !== false;
  const inputAvailable = input.input_available !== false;
  const lastObservedValue = input.last_observed_value ?? null;
  const eNs = parseInstantNs(input.observed_at);
  const fNs = parseInstantNs(input.fetched_at);
  const gNs = parseInstantNs(input.evaluated_at ?? options.evaluated_at);
  const eIso = toUtcIsoFromNs(eNs);
  const fIso = toUtcIsoFromNs(fNs);
  const gIso = toUtcIsoFromNs(gNs);
  const ageSeconds = eNs !== null && gNs !== null ? Number(gNs - eNs) / 1e9 : null;

  if (!sourceAvailable || !inputAvailable || eNs === null || fNs === null || gNs === null) {
    return buildResult({
      data_status: "missing",
      age_seconds: ageSeconds,
      age_sessions: null,
      observed_at: eIso,
      fetched_at: fIso,
      evaluated_at: gIso,
      sizing_eligible: false,
      reason: !sourceAvailable ? "source_missing" : !inputAvailable ? "input_missing" : "missing_timestamp",
      last_observed_value: lastObservedValue,
    });
  }

  // Inclusive unrounded 60 s bound in exact nanoseconds: F <= G+60s, E <= F+60s, E <= G+60s.
  if (
    fNs - gNs > FUTURE_SKEW_LIMIT_NS
    || eNs - fNs > FUTURE_SKEW_LIMIT_NS
    || eNs - gNs > FUTURE_SKEW_LIMIT_NS
  ) {
    return buildResult({
      data_status: "invalid_future_skew",
      age_seconds: ageSeconds,
      age_sessions: null,
      observed_at: eIso,
      fetched_at: fIso,
      evaluated_at: gIso,
      sizing_eligible: false,
      reason: "invalid_future_skew",
      last_observed_value: lastObservedValue,
    });
  }

  const loNs = eNs <= gNs ? eNs : gNs;
  const sessionCount = countXnysSessionCloses(loNs, gNs, options.calendarProvider ?? null);
  if (!sessionCount.covered) {
    return buildResult({
      data_status: "unavailable",
      age_seconds: ageSeconds,
      age_sessions: null,
      observed_at: eIso,
      fetched_at: fIso,
      evaluated_at: gIso,
      sizing_eligible: false,
      reason: sessionCount.reason,
      last_observed_value: lastObservedValue,
    });
  }

  const requiredFreshSessions = Number.isInteger(input.required_fresh_sessions) && input.required_fresh_sessions >= 1
    ? input.required_fresh_sessions
    : 1;
  const stale = sessionCount.age_sessions >= requiredFreshSessions;
  return buildResult({
    data_status: stale ? "stale" : "fresh",
    age_seconds: ageSeconds,
    age_sessions: sessionCount.age_sessions,
    observed_at: eIso,
    fetched_at: fIso,
    evaluated_at: gIso,
    sizing_eligible: !stale,
    reason: stale ? "snapshot_stale" : null,
    last_observed_value: lastObservedValue,
  });
}

/**
 * Evaluates C-SA-15 freshness directly against the digest-verified C-SA-22 runtime calendar.
 */
export function evaluateFreshnessWithRuntimeCalendar(input = {}, options = {}) {
  const calendarProvider = options.calendarProvider !== undefined
    ? options.calendarProvider
    : createRuntimeCalendarProvider();
  return evaluateFreshness(input, { ...options, calendarProvider });
}
