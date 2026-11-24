/**
 * C-SA-15: Trading-session freshness, future-skew boundary, and O1 gate.
 *
 * Pure leaf module under application/sizing_unit/:
 * - Enforces inclusive unrounded 60_000 ms future-skew across (E, F, G).
 * - Counts XNYS trading session closes over half-open (min(E, G), G].
 * - Requires an injected calendarProvider (e.g., pinned csa22-v1 until SA-3);
 *   never falls back to weekday heuristics or synthetic holiday tables.
 * - Preserves display values (last_observed_value, last_observed_at, age_seconds,
 *   age_sessions) when failing closed for sizing / Supply-B proof / O1.
 */

export const FUTURE_SKEW_LIMIT_MS = 60_000;
const ISO_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NY_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function parseInstantMs(value) {
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

function toUtcIso(ms) {
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function toNyDate(ms) {
  return NY_DATE_FORMAT.format(new Date(ms));
}

function toUtcDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function nextIsoDate(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
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
  const dates = sessions ? Object.keys(sessions).filter((k) => ISO_DATE_RE.test(k)).sort() : [];
  const startDate = typeof meta.coverage_start_date === "string"
    ? meta.coverage_start_date
    : (dates[0] ?? null);
  const endDate = typeof meta.coverage_end_date === "string"
    ? meta.coverage_end_date
    : (dates.at(-1) ?? null);

  return {
    calendar_version: meta.calendar_version ?? "unknown",
    exchange: meta.exchange ?? "XNYS",
    spec_digest: meta.spec_digest ?? null,
    coverage() {
      return {
        start_date: startDate,
        end_date: endDate,
      };
    },
    getSession(tradeDate) {
      if (!sessions || typeof tradeDate !== "string") return null;
      return Object.hasOwn(sessions, tradeDate) ? sessions[tradeDate] : null;
    },
  };
}

/**
 * Counts XNYS trading session closes in half-open interval (startExclusiveMs, endInclusiveMs].
 * Fails closed when calendarProvider or any date along the span is missing/uncovered.
 */
export function countXnysSessionCloses(startExclusiveMs, endInclusiveMs, calendarProvider) {
  if (!calendarProvider || typeof calendarProvider.getSession !== "function") {
    return { covered: false, age_sessions: null, reason: "calendar_provider_unavailable" };
  }
  const loMs = Math.min(startExclusiveMs, endInclusiveMs);
  const hiMs = endInclusiveMs;
  const startNy = toNyDate(loMs);
  const endNy = toNyDate(hiMs);
  const endUtc = toUtcDate(hiMs);
  const cov = typeof calendarProvider.coverage === "function" ? calendarProvider.coverage() : null;
  if (cov?.start_date && cov?.end_date) {
    if (startNy < cov.start_date || endNy > cov.end_date || endUtc > cov.end_date) {
      return { covered: false, age_sessions: null, reason: "calendar_coverage_out_of_range" };
    }
  }

  let count = 0;
  let cursor = startNy;
  let guard = 0;
  while (cursor <= endNy) {
    if (++guard > 2000) {
      return { covered: false, age_sessions: null, reason: "calendar_span_exceeded" };
    }
    const session = calendarProvider.getSession(cursor);
    if (!session || typeof session !== "object") {
      return { covered: false, age_sessions: null, reason: "calendar_session_missing" };
    }
    if (session.exchange && session.exchange !== "XNYS") {
      return { covered: false, age_sessions: null, reason: "calendar_exchange_mismatch" };
    }
    const isTrading = session.is_trading_day === true && session.blocks_eligibility !== true;
    if (isTrading) {
      const closeMs = parseInstantMs(session.close_utc);
      if (closeMs === null) {
        return { covered: false, age_sessions: null, reason: "calendar_close_utc_missing" };
      }
      if (closeMs > loMs && closeMs <= hiMs) {
        count += 1;
      }
    }
    cursor = nextIsoDate(cursor);
  }

  return { covered: true, age_sessions: count, reason: null };
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
  const eMs = parseInstantMs(input.observed_at);
  const fMs = parseInstantMs(input.fetched_at);
  const gMs = parseInstantMs(input.evaluated_at ?? options.evaluated_at);
  const eIso = toUtcIso(eMs);
  const fIso = toUtcIso(fMs);
  const gIso = toUtcIso(gMs);
  const ageSeconds = eMs !== null && gMs !== null ? (gMs - eMs) / 1000 : null;

  if (!sourceAvailable || !inputAvailable || eMs === null || fMs === null || gMs === null) {
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

  // Inclusive unrounded 60_000 ms bound: F <= G + 60s, E <= F + 60s, E <= G + 60s.
  if (
    fMs - gMs > FUTURE_SKEW_LIMIT_MS
    || eMs - fMs > FUTURE_SKEW_LIMIT_MS
    || eMs - gMs > FUTURE_SKEW_LIMIT_MS
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

  const sessionCount = countXnysSessionCloses(Math.min(eMs, gMs), gMs, options.calendarProvider ?? null);
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
