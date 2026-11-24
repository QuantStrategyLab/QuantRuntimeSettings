/**
 * C-SA-17: Half-open UTC interval continuity evaluator per account, broker
 * environment, binding, and evidence kind (valuation vs external_flow).
 *
 * Pure leaf module under application/sizing_unit/:
 * - Enforces independent 366-day retention and 6-month Desk clipping limits.
 * - Keeps valuation history_source_binding_ids strictly non-transferable to flows.
 * - Rejects cross-account, cross-environment, incomplete, or date-only intervals.
 * - Always fails closed to insufficient_history (return_pct: null) on any gap.
 */

import { parseInstantMs, safePublicText } from "./nav.js";

export const CONTINUITY_SCHEMA = "qsl.sizing_unit_continuity.v1";
export const RETENTION_LIMIT_DAYS = 366;
export const DESK_LIMIT_MONTHS = 6;
const DAY_MS = 86_400_000;

function subtractUtcMonths(ms, months) {
  const dt = new Date(ms);
  const year = dt.getUTCFullYear();
  const month = dt.getUTCMonth();
  const day = dt.getUTCDate();
  const targetMonthIndex = year * 12 + month - months;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  return Date.UTC(
    targetYear,
    targetMonth,
    clampedDay,
    dt.getUTCHours(),
    dt.getUTCMinutes(),
    dt.getUTCSeconds(),
    dt.getUTCMilliseconds(),
  );
}

function mergeHalfOpenIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => (a.startMs !== b.startMs ? a.startMs - b.startMs : a.endMs - b.endMs));
  const merged = [{ startMs: sorted[0].startMs, endMs: sorted[0].endMs }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = merged[merged.length - 1];
    if (cur.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, cur.endMs);
    } else {
      merged.push({ startMs: cur.startMs, endMs: cur.endMs });
    }
  }
  return merged;
}

function findUncoveredRanges(targetStartMs, targetEndMs, coveredIntervals, rejectedForKind, evidenceKind) {
  const merged = mergeHalfOpenIntervals(coveredIntervals);
  const gaps = [];
  let cursor = targetStartMs;

  const pushGap = (s, e) => {
    if (e <= s) return;
    const overlappingRej = rejectedForKind.find((r) => r.startMs < e && r.endMs > s && r.reason !== "currency_mismatch")
      || rejectedForKind.find((r) => r.startMs < e && r.endMs > s);
    gaps.push({
      start_utc: new Date(s).toISOString(),
      end_utc: new Date(e).toISOString(),
      evidence_kind: evidenceKind,
      reason: overlappingRej ? overlappingRej.reason : "uncovered_interval",
      binding_id: null,
    });
  };

  for (const iv of merged) {
    if (iv.endMs <= cursor) continue;
    if (iv.startMs >= targetEndMs) break;
    if (iv.startMs > cursor) {
      pushGap(cursor, Math.min(iv.startMs, targetEndMs));
    }
    cursor = Math.max(cursor, Math.min(iv.endMs, targetEndMs));
  }
  if (cursor < targetEndMs) {
    pushGap(cursor, targetEndMs);
  }
  return gaps;
}

function classifySeriesIntervals({
  rawIntervals,
  evidenceKind,
  accountId,
  brokerEnv,
  allowedBindings,
  reqStartMs,
  reqEndMs,
  defaultSourceClass,
  targetCurrency,
  hasExplicitInputCurrency,
}) {
  const covered = [];
  const coveredCoords = [];
  const rejected = [];
  const rejectedCoords = [];
  const intervalsList = Array.isArray(rawIntervals) ? rawIntervals : [];
  const requireCurrencyMatch = hasExplicitInputCurrency
    || intervalsList.some((raw) => raw && Object.hasOwn(raw, "currency"));

  for (const raw of intervalsList) {
    const sMs = parseInstantMs(raw?.start_utc);
    const eMs = parseInstantMs(raw?.end_utc);
    if (sMs === null || eMs === null || eMs <= sMs) continue;

    let rejectReason = null;
    if (raw.account_id !== accountId) {
      rejectReason = "account_identity_mismatch";
    } else if (raw.broker_environment !== brokerEnv) {
      rejectReason = "environment_mismatch";
    } else if (requireCurrencyMatch && (targetCurrency === null || raw.currency !== targetCurrency)) {
      rejectReason = "currency_mismatch";
    } else if (typeof raw.binding_id !== "string" || !allowedBindings.has(raw.binding_id)) {
      rejectReason = evidenceKind === "external_flow"
        ? "flow_binding_not_authorized"
        : "valuation_binding_not_authorized";
    } else if (raw.coverage !== "complete") {
      rejectReason = "incomplete_interval_coverage";
    } else if (raw.precision !== "exact") {
      rejectReason = "non_exact_interval_precision";
    }

    const clippedStart = Math.max(sMs, reqStartMs);
    const clippedEnd = Math.min(eMs, reqEndMs);
    if (clippedEnd <= clippedStart) continue;

    if (rejectReason) {
      rejected.push({
        start_utc: new Date(clippedStart).toISOString(),
        end_utc: new Date(clippedEnd).toISOString(),
        evidence_kind: evidenceKind,
        reason: rejectReason,
        binding_id: typeof raw.binding_id === "string" ? raw.binding_id : null,
        account_id: typeof raw.account_id === "string" ? raw.account_id : null,
        broker_environment: raw.broker_environment === "live" || raw.broker_environment === "paper"
          ? raw.broker_environment
          : null,
      });
      rejectedCoords.push({ startMs: clippedStart, endMs: clippedEnd, reason: rejectReason });
    } else {
      covered.push({
        start_utc: new Date(clippedStart).toISOString(),
        end_utc: new Date(clippedEnd).toISOString(),
        account_id: accountId,
        broker_environment: brokerEnv,
        binding_id: raw.binding_id,
        evidence_kind: evidenceKind,
        coverage: raw.coverage,
        precision: raw.precision,
        source_class: raw.source_class || defaultSourceClass,
      });
      coveredCoords.push({ startMs: clippedStart, endMs: clippedEnd });
    }
  }

  const gaps = findUncoveredRanges(reqStartMs, reqEndMs, coveredCoords, rejectedCoords, evidenceKind);
  return { covered, rejected, gaps };
}

function coalesceIntervalsByBinding(coveredIntervals) {
  const byBinding = new Map();
  for (const iv of coveredIntervals) {
    const startMs = parseInstantMs(iv.start_utc);
    const endMs = parseInstantMs(iv.end_utc);
    if (startMs === null || endMs === null || endMs <= startMs) continue;
    const list = byBinding.get(iv.binding_id) || [];
    list.push({ startMs, endMs });
    byBinding.set(iv.binding_id, list);
  }
  const coalesced = [];
  for (const [binding_id, coords] of byBinding.entries()) {
    for (const span of mergeHalfOpenIntervals(coords)) {
      coalesced.push({
        binding_id,
        startMs: span.startMs,
        endMs: span.endMs,
        start_utc: new Date(span.startMs).toISOString(),
      });
    }
  }
  return coalesced.sort((a, b) => (
    a.startMs !== b.startMs
      ? a.startMs - b.startMs
      : a.endMs !== b.endMs
        ? a.endMs - b.endMs
        : (a.binding_id < b.binding_id ? -1 : a.binding_id > b.binding_id ? 1 : 0)
  ));
}

function extractBindingTransitions(coveredIntervals) {
  const ordered = coalesceIntervalsByBinding(coveredIntervals);
  const transitions = [];
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const curr = ordered[i];
    if (prev.binding_id !== curr.binding_id) {
      transitions.push({
        at_ms: curr.startMs,
        at_utc: curr.start_utc,
        from_binding: prev.binding_id,
        to_binding: curr.binding_id,
      });
    }
  }
  return transitions;
}

function findTransitionMismatches(valCovered, flowCovered, evalEndIso) {
  const valTransitions = extractBindingTransitions(valCovered);
  const flowTransitions = extractBindingTransitions(flowCovered);
  const valTimes = new Set(valTransitions.map((t) => t.at_ms));
  const flowTimes = new Set(flowTransitions.map((t) => t.at_ms));
  const unmatchedTimes = [...new Set([
    ...valTransitions.filter((t) => !flowTimes.has(t.at_ms)).map((t) => t.at_ms),
    ...flowTransitions.filter((t) => !valTimes.has(t.at_ms)).map((t) => t.at_ms),
  ])].sort((a, b) => a - b);
  if (unmatchedTimes.length === 0) return [];
  const startMs = unmatchedTimes[0];
  const endMs = unmatchedTimes.length > 1 ? unmatchedTimes[unmatchedTimes.length - 1] : parseInstantMs(evalEndIso);
  return [{
    start_utc: new Date(startMs).toISOString(),
    end_utc: new Date(endMs > startMs ? endMs : parseInstantMs(evalEndIso)).toISOString(),
    evidence_kind: "external_flow",
    reason: "binding_transition_mismatch",
    binding_id: null,
  }];
}

/**
 * Evaluates C-SA-17 half-open UTC continuity across retention, Desk 6-month view,
 * account/environment isolation, and separate valuation vs external_flow bindings.
 */
export function evaluateHistoryContinuity(input = {}) {
  const accountId = safePublicText(input.account_id, "redacted-account");
  const rawBrokerEnv = input.broker_environment;
  const brokerEnvValid = rawBrokerEnv === "live" || rawBrokerEnv === "paper";
  const brokerEnv = brokerEnvValid ? rawBrokerEnv : null;
  const origin = input.origin === "production" ? "production" : "synthetic";
  const sourceClass = input.source_class || "synthetic";
  const evidenceRef = safePublicText(input.evidence_ref, `sa1:continuity:${accountId}`);

  const reqStartMs = parseInstantMs(input.requested_interval?.start_utc);
  const reqEndMs = parseInstantMs(input.requested_interval?.end_utc);
  if (reqStartMs === null || reqEndMs === null || reqEndMs <= reqStartMs) {
    const nowIso = new Date().toISOString();
    return {
      schema_version: CONTINUITY_SCHEMA,
      account_id: accountId,
      broker_environment: brokerEnv,
      requested_interval: { start_utc: nowIso, end_utc: nowIso },
      retention_clip: { limit_days: RETENTION_LIMIT_DAYS, effective_start_utc: nowIso, effective_end_utc: nowIso, truncated: false },
      desk_window_clip: { limit_months: DESK_LIMIT_MONTHS, applicable: false, effective_start_utc: nowIso, effective_end_utc: nowIso, truncated: false },
      truncated: false,
      continuity_status: "insufficient_history",
      covered_intervals: [],
      gap_intervals: [{ start_utc: nowIso, end_utc: nowIso, evidence_kind: "both", reason: "invalid_requested_interval", binding_id: null }],
      rejected_intervals: [],
      result: { status: "insufficient_history", return_pct: null, unavailable_reason: "invalid_requested_interval" },
      origin,
      source_class: sourceClass,
      evidence_ref: evidenceRef,
    };
  }

  const reqStartIso = new Date(reqStartMs).toISOString();
  const reqEndIso = new Date(reqEndMs).toISOString();

  // Independent 366-day retention boundary and 6-month Desk view boundary.
  const retentionFloorMs = reqEndMs - RETENTION_LIMIT_DAYS * DAY_MS;
  const retentionTruncated = reqStartMs < retentionFloorMs;
  const retentionEffectiveStartMs = retentionTruncated ? retentionFloorMs : reqStartMs;

  const deskApplicable = input.desk_view === true;
  const deskFloorMs = subtractUtcMonths(reqEndMs, DESK_LIMIT_MONTHS);
  const deskTruncated = deskApplicable && reqStartMs < deskFloorMs;
  const deskEffectiveStartMs = deskTruncated ? deskFloorMs : reqStartMs;

  const truncated = retentionTruncated || deskTruncated;

  if (!brokerEnvValid) {
    return {
      schema_version: CONTINUITY_SCHEMA,
      account_id: accountId,
      broker_environment: null,
      requested_interval: { start_utc: reqStartIso, end_utc: reqEndIso },
      retention_clip: {
        limit_days: RETENTION_LIMIT_DAYS,
        effective_start_utc: new Date(retentionEffectiveStartMs).toISOString(),
        effective_end_utc: reqEndIso,
        truncated: retentionTruncated,
      },
      desk_window_clip: {
        limit_months: DESK_LIMIT_MONTHS,
        applicable: deskApplicable,
        effective_start_utc: new Date(deskEffectiveStartMs).toISOString(),
        effective_end_utc: reqEndIso,
        truncated: deskTruncated,
      },
      truncated,
      continuity_status: "insufficient_history",
      covered_intervals: [],
      gap_intervals: [{
        start_utc: reqStartIso,
        end_utc: reqEndIso,
        evidence_kind: "both",
        reason: "broker_environment_missing_or_unverified",
        binding_id: null,
      }],
      rejected_intervals: [],
      result: {
        status: "insufficient_history",
        return_pct: null,
        unavailable_reason: "broker_environment_missing_or_unverified",
      },
      origin,
      source_class: sourceClass,
      evidence_ref: evidenceRef,
    };
  }

  // Bindings are strictly scoped by evidence kind: valuation history bindings
  // never authorize external-flow continuity.
  const valBindings = new Set(
    [input.current_valuation_binding_id, ...(Array.isArray(input.history_source_binding_ids) ? input.history_source_binding_ids : [])]
      .filter((x) => typeof x === "string" && x.length > 0),
  );
  const flowBindings = new Set(
    [input.current_flow_binding_id, ...(Array.isArray(input.flow_history_source_binding_ids) ? input.flow_history_source_binding_ids : [])]
      .filter((x) => typeof x === "string" && x.length > 0),
  );

  const hasExplicitInputCurrency = Object.hasOwn(input, "currency");
  const targetCurrency = hasExplicitInputCurrency
    ? (typeof input.currency === "string" && input.currency.length > 0 ? input.currency : null)
    : "USD";

  const valEvalStart = Math.max(reqStartMs, retentionEffectiveStartMs, deskEffectiveStartMs);
  const valSeries = classifySeriesIntervals({
    rawIntervals: input.valuation_intervals,
    evidenceKind: "valuation",
    accountId,
    brokerEnv,
    allowedBindings: valBindings,
    reqStartMs: valEvalStart,
    reqEndMs,
    defaultSourceClass: sourceClass,
    targetCurrency,
    hasExplicitInputCurrency,
  });
  const flowSeries = classifySeriesIntervals({
    rawIntervals: input.flow_intervals,
    evidenceKind: "external_flow",
    accountId,
    brokerEnv,
    allowedBindings: flowBindings,
    reqStartMs: valEvalStart,
    reqEndMs,
    defaultSourceClass: sourceClass,
    targetCurrency,
    hasExplicitInputCurrency,
  });

  const gapIntervals = [];
  if (truncated) {
    const clipEndMs = Math.min(reqEndMs, valEvalStart);
    gapIntervals.push({
      start_utc: reqStartIso,
      end_utc: new Date(clipEndMs).toISOString(),
      evidence_kind: "both",
      reason: retentionTruncated ? "retention_window_exceeded" : "desk_6m_window_clipped",
      binding_id: null,
    });
  }
  const transitionMismatches = valSeries.gaps.length === 0 && flowSeries.gaps.length === 0
    ? findTransitionMismatches(valSeries.covered, flowSeries.covered, reqEndIso)
    : [];
  gapIntervals.push(...valSeries.gaps, ...flowSeries.gaps, ...transitionMismatches);

  const rejectedIntervals = [...valSeries.rejected, ...flowSeries.rejected];
  const coveredIntervals = [...valSeries.covered, ...flowSeries.covered];

  let continuityStatus;
  let result;
  if (truncated) {
    continuityStatus = "insufficient_history";
    result = {
      status: "insufficient_history",
      return_pct: null,
      unavailable_reason: retentionTruncated ? "retention_366d_exceeded" : "desk_6m_window_exceeded",
    };
  } else if (valSeries.gaps.length === 0 && flowSeries.gaps.length === 0 && transitionMismatches.length === 0) {
    continuityStatus = "continuous";
    result = {
      status: "eligible",
      return_pct: typeof input.candidate_return_pct === "string" ? input.candidate_return_pct : null,
      unavailable_reason: null,
    };
  } else if (valSeries.gaps.length === 0 && flowSeries.gaps.length > 0) {
    continuityStatus = "valuation_only_continuous";
    result = {
      status: "insufficient_history",
      return_pct: null,
      unavailable_reason: flowSeries.gaps[0]?.reason || "flow_continuity_gap",
    };
  } else {
    continuityStatus = "binding_gap";
    result = {
      status: "insufficient_history",
      return_pct: null,
      unavailable_reason: valSeries.gaps[0]?.reason || flowSeries.gaps[0]?.reason || transitionMismatches[0]?.reason || "binding_gap",
    };
  }

  return {
    schema_version: CONTINUITY_SCHEMA,
    account_id: accountId,
    broker_environment: brokerEnv,
    requested_interval: { start_utc: reqStartIso, end_utc: reqEndIso },
    retention_clip: {
      limit_days: RETENTION_LIMIT_DAYS,
      effective_start_utc: new Date(retentionEffectiveStartMs).toISOString(),
      effective_end_utc: reqEndIso,
      truncated: retentionTruncated,
    },
    desk_window_clip: {
      limit_months: DESK_LIMIT_MONTHS,
      applicable: deskApplicable,
      effective_start_utc: new Date(deskEffectiveStartMs).toISOString(),
      effective_end_utc: reqEndIso,
      truncated: deskTruncated,
    },
    truncated,
    continuity_status: continuityStatus,
    covered_intervals: coveredIntervals,
    gap_intervals: gapIntervals,
    rejected_intervals: rejectedIntervals,
    result,
    origin,
    source_class: sourceClass,
    evidence_ref: evidenceRef,
  };
}
