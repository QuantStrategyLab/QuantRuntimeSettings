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

import { parseInstantNs, safePublicText, toUtcIsoFromNs } from "./nav.js";

export const CONTINUITY_SCHEMA = "qsl.sizing_unit_continuity.v1";
export const RETENTION_LIMIT_DAYS = 366;
export const DESK_LIMIT_MONTHS = 6;
const MS_TO_NS = 1_000_000n;
const DAY_NS = 86_400_000n * MS_TO_NS;

function cmpNs(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function minNs(...vals) {
  return vals.reduce((a, b) => (a <= b ? a : b));
}

function maxNs(...vals) {
  return vals.reduce((a, b) => (a >= b ? a : b));
}

function subtractUtcMonthsNs(ns, months) {
  let wholeMs = ns / MS_TO_NS;
  let subNs = ns - wholeMs * MS_TO_NS;
  if (subNs < 0n) {
    wholeMs -= 1n;
    subNs += MS_TO_NS;
  }
  return BigInt(subtractUtcMonths(Number(wholeMs), months)) * MS_TO_NS + subNs;
}

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
  const sorted = [...intervals].sort((a, b) => (a.startNs !== b.startNs ? cmpNs(a.startNs, b.startNs) : cmpNs(a.endNs, b.endNs)));
  const merged = [{ startNs: sorted[0].startNs, endNs: sorted[0].endNs }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = merged[merged.length - 1];
    if (cur.startNs <= last.endNs) {
      last.endNs = maxNs(last.endNs, cur.endNs);
    } else {
      merged.push({ startNs: cur.startNs, endNs: cur.endNs });
    }
  }
  return merged;
}

function findUncoveredRanges(targetStartNs, targetEndNs, coveredIntervals, rejectedForKind, evidenceKind) {
  const merged = mergeHalfOpenIntervals(coveredIntervals);
  const gaps = [];
  let cursor = targetStartNs;

  const pushGap = (s, e) => {
    if (e <= s) return;
    const overlappingRej = rejectedForKind.find((r) => r.startNs < e && r.endNs > s && r.reason !== "currency_mismatch")
      || rejectedForKind.find((r) => r.startNs < e && r.endNs > s);
    gaps.push({
      start_utc: toUtcIsoFromNs(s),
      end_utc: toUtcIsoFromNs(e),
      evidence_kind: evidenceKind,
      reason: overlappingRej ? overlappingRej.reason : "uncovered_interval",
      binding_id: null,
    });
  };

  for (const iv of merged) {
    if (iv.endNs <= cursor) continue;
    if (iv.startNs >= targetEndNs) break;
    if (iv.startNs > cursor) {
      pushGap(cursor, minNs(iv.startNs, targetEndNs));
    }
    cursor = maxNs(cursor, minNs(iv.endNs, targetEndNs));
  }
  if (cursor < targetEndNs) {
    pushGap(cursor, targetEndNs);
  }
  return gaps;
}

function classifySeriesIntervals({
  rawIntervals,
  evidenceKind,
  accountId,
  brokerEnv,
  allowedBindings,
  reqStartNs,
  reqEndNs,
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
    const sNs = parseInstantNs(raw?.start_utc);
    const eNs = parseInstantNs(raw?.end_utc);
    if (sNs === null || eNs === null || eNs <= sNs) continue;

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

    const clippedStart = maxNs(sNs, reqStartNs);
    const clippedEnd = minNs(eNs, reqEndNs);
    if (clippedEnd <= clippedStart) continue;

    if (rejectReason) {
      rejected.push({
        start_utc: toUtcIsoFromNs(clippedStart),
        end_utc: toUtcIsoFromNs(clippedEnd),
        evidence_kind: evidenceKind,
        reason: rejectReason,
        binding_id: typeof raw.binding_id === "string" ? raw.binding_id : null,
        account_id: typeof raw.account_id === "string" ? raw.account_id : null,
        broker_environment: raw.broker_environment === "live" || raw.broker_environment === "paper"
          ? raw.broker_environment
          : null,
      });
      rejectedCoords.push({ startNs: clippedStart, endNs: clippedEnd, reason: rejectReason });
    } else {
      covered.push({
        start_utc: toUtcIsoFromNs(clippedStart),
        end_utc: toUtcIsoFromNs(clippedEnd),
        account_id: accountId,
        broker_environment: brokerEnv,
        binding_id: raw.binding_id,
        evidence_kind: evidenceKind,
        coverage: raw.coverage,
        precision: raw.precision,
        source_class: raw.source_class || defaultSourceClass,
      });
      coveredCoords.push({ startNs: clippedStart, endNs: clippedEnd });
    }
  }

  const gaps = findUncoveredRanges(reqStartNs, reqEndNs, coveredCoords, rejectedCoords, evidenceKind);
  return { covered, rejected, gaps };
}

function coalesceIntervalsByBinding(coveredIntervals) {
  const byBinding = new Map();
  for (const iv of coveredIntervals) {
    const startNs = parseInstantNs(iv.start_utc);
    const endNs = parseInstantNs(iv.end_utc);
    if (startNs === null || endNs === null || endNs <= startNs) continue;
    const list = byBinding.get(iv.binding_id) || [];
    list.push({ startNs, endNs });
    byBinding.set(iv.binding_id, list);
  }
  const coalesced = [];
  for (const [binding_id, coords] of byBinding.entries()) {
    for (const span of mergeHalfOpenIntervals(coords)) {
      coalesced.push({
        binding_id,
        startNs: span.startNs,
        endNs: span.endNs,
        start_utc: toUtcIsoFromNs(span.startNs),
      });
    }
  }
  return coalesced.sort((a, b) => (
    a.startNs !== b.startNs
      ? cmpNs(a.startNs, b.startNs)
      : a.endNs !== b.endNs
        ? cmpNs(a.endNs, b.endNs)
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
        at_ns: curr.startNs,
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
  const valTimes = new Set(valTransitions.map((t) => t.at_ns));
  const flowTimes = new Set(flowTransitions.map((t) => t.at_ns));
  const unmatchedTimes = [...new Set([
    ...valTransitions.filter((t) => !flowTimes.has(t.at_ns)).map((t) => t.at_ns),
    ...flowTransitions.filter((t) => !valTimes.has(t.at_ns)).map((t) => t.at_ns),
  ])].sort(cmpNs);
  if (unmatchedTimes.length === 0) return [];
  const startNs = unmatchedTimes[0];
  const endNs = unmatchedTimes.length > 1 ? unmatchedTimes[unmatchedTimes.length - 1] : parseInstantNs(evalEndIso);
  return [{
    start_utc: toUtcIsoFromNs(startNs),
    end_utc: toUtcIsoFromNs(endNs > startNs ? endNs : parseInstantNs(evalEndIso)),
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

  const reqStartNs = parseInstantNs(input.requested_interval?.start_utc);
  const reqEndNs = parseInstantNs(input.requested_interval?.end_utc);
  if (reqStartNs === null || reqEndNs === null || reqEndNs <= reqStartNs) {
    const nowIso = toUtcIsoFromNs(BigInt(Date.now()) * MS_TO_NS);
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

  const reqStartIso = toUtcIsoFromNs(reqStartNs);
  const reqEndIso = toUtcIsoFromNs(reqEndNs);

  // Independent 366-day retention boundary and 6-month Desk view boundary.
  const retentionFloorNs = reqEndNs - BigInt(RETENTION_LIMIT_DAYS) * DAY_NS;
  const retentionTruncated = reqStartNs < retentionFloorNs;
  const retentionEffectiveStartNs = retentionTruncated ? retentionFloorNs : reqStartNs;

  const deskApplicable = input.desk_view === true;
  const deskFloorNs = subtractUtcMonthsNs(reqEndNs, DESK_LIMIT_MONTHS);
  const deskTruncated = deskApplicable && reqStartNs < deskFloorNs;
  const deskEffectiveStartNs = deskTruncated ? deskFloorNs : reqStartNs;

  const truncated = retentionTruncated || deskTruncated;

  if (!brokerEnvValid) {
    return {
      schema_version: CONTINUITY_SCHEMA,
      account_id: accountId,
      broker_environment: null,
      requested_interval: { start_utc: reqStartIso, end_utc: reqEndIso },
      retention_clip: {
        limit_days: RETENTION_LIMIT_DAYS,
        effective_start_utc: toUtcIsoFromNs(retentionEffectiveStartNs),
        effective_end_utc: reqEndIso,
        truncated: retentionTruncated,
      },
      desk_window_clip: {
        limit_months: DESK_LIMIT_MONTHS,
        applicable: deskApplicable,
        effective_start_utc: toUtcIsoFromNs(deskEffectiveStartNs),
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

  const valEvalStart = maxNs(reqStartNs, retentionEffectiveStartNs, deskEffectiveStartNs);
  const valSeries = classifySeriesIntervals({
    rawIntervals: input.valuation_intervals,
    evidenceKind: "valuation",
    accountId,
    brokerEnv,
    allowedBindings: valBindings,
    reqStartNs: valEvalStart,
    reqEndNs,
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
    reqStartNs: valEvalStart,
    reqEndNs,
    defaultSourceClass: sourceClass,
    targetCurrency,
    hasExplicitInputCurrency,
  });

  const gapIntervals = [];
  if (truncated) {
    const clipEndNs = minNs(reqEndNs, valEvalStart);
    gapIntervals.push({
      start_utc: reqStartIso,
      end_utc: toUtcIsoFromNs(clipEndNs),
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
      effective_start_utc: toUtcIsoFromNs(retentionEffectiveStartNs),
      effective_end_utc: reqEndIso,
      truncated: retentionTruncated,
    },
    desk_window_clip: {
      limit_months: DESK_LIMIT_MONTHS,
      applicable: deskApplicable,
      effective_start_utc: toUtcIsoFromNs(deskEffectiveStartNs),
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
