import { alignReturns, chainReturns, cleanPoints, dateMs, rebase, sliceRange } from "../../performance_math.js";

const DAY = 86_400_000;
export const DEFAULT_HISTORY_MAX_STALENESS_DAYS = 3;

export function historyMaxStalenessDays(value) {
  const days = typeof value === "number" || (typeof value === "string" && value.trim() !== "")
    ? Number(value) : NaN;
  return Number.isSafeInteger(days) && days >= 0 ? days : DEFAULT_HISTORY_MAX_STALENESS_DAYS;
}

/** Native-currency observed subtotals, on real dates only. No FX or pre-observation backfill. */
export function aggregateEquityHistory(histories, currency, { maxStalenessDays } = {}) {
  const limit = historyMaxStalenessDays(maxStalenessDays);
  const members = histories.filter(h => h.currency === currency)
    .map(h => ({ id: h.id, points: cleanPoints(h.points), cursor: -1 }));
  const dates = [...new Set(members.flatMap(h => h.points.map(p => p.date)))].sort();
  const points = [];
  for (const date of dates) {
    const contributing = [], missing = [], forwarded = [], values = [];
    for (const member of members) {
      while (member.points[member.cursor + 1]?.date <= date) member.cursor++;
      const point = member.points[member.cursor];
      if (!point || (dateMs(date) - dateMs(point.date)) / DAY > limit) {
        missing.push(member.id);
        continue;
      }
      contributing.push(member.id);
      if (point.date !== date) forwarded.push(member.id);
      values.push({ member, point });
    }
    const previous = points.at(-1);
    const membershipChanged = !!previous &&
      JSON.stringify(previous.contributing_accounts) !== JSON.stringify(contributing);
    const partial = missing.length > 0 || forwarded.length > 0;
    // A carried valuation says nothing about cashflows on the missing date.
    const flowKnown = !partial && !membershipChanged && values.every(({ member, point }) =>
      Number.isFinite(point.externalFlow) && (!previous || member.points[member.cursor - 1]?.date === previous.date));
    points.push({
      date,
      value: values.reduce((sum, { point }) => sum + point.value, 0),
      externalFlow: flowKnown ? values.reduce((sum, { point }) => sum + point.externalFlow, 0) : null,
      contributing_accounts: contributing,
      missing_accounts: missing,
      forward_filled_accounts: forwarded,
      partial,
      membership_changed: membershipChanged,
      breakBefore: !!previous && (membershipChanged || dateMs(date) - dateMs(previous.date) > DAY ||
        values.some(({ point }) => point.date === date && point.breakBefore)),
    });
  }
  return {
    currency,
    points,
    missingAccounts: members.filter(h => !h.points.length).map(h => h.id),
    omittedDates: 0,
    maxStalenessDays: limit,
  };
}

/** Keep coverage on percentage points; membership changes begin independent segments. */
export function equityHistoryCurve(group, { range = "ALL", today, benchmarks = [] } = {}) {
  const points = sliceRange(group.points, range.toLowerCase(), today);
  const membershipChanged = points.slice(1).some(p => p.membership_changed);
  const segments = [];
  for (const point of points) {
    if (!segments.length || point.membership_changed) segments.push([]);
    segments.at(-1).push(point);
  }
  const results = segments.map(segment => chainReturns(segment));
  const qualified = points.length > 1 && !membershipChanged && !points.some(p => p.partial) &&
    results.every(r => !r.unknownFlow && !r.invalidPeriod);
  const result = results[0] || { index: [], unknownFlow: false, invalidPeriod: false };
  const aligned = membershipChanged
    ? { start: points[0]?.date, primary: results.flatMap(r => rebase(r.index)), benchmarks: [], noCommonDate: false }
    : alignReturns(result.index, benchmarks);
  const byDate = new Map(points.map(p => [p.date, p]));
  const returnPoints = aligned.primary.map(p => ({ ...byDate.get(p.date), ...p,
    breakBefore: p.breakBefore || byDate.get(p.date).membership_changed }));
  const invalid = results.some(r => r.invalidPeriod);
  const stale = points.length > 0 && dateMs(today) - dateMs(points.at(-1).date) > group.maxStalenessDays * DAY;
  const reason = !points.length ? "snapshot_history_missing"
    : invalid ? "invalid_return_period"
      : points.length < 2 ? "insufficient_observations"
        : !qualified ? "external_cashflow_required" : null;
  return {
    currency: group.currency,
    as_of: points.at(-1)?.date || null,
    coverage: {
      omitted_dates: group.omittedDates,
      missing_accounts: group.missingAccounts,
      max_staleness_days: group.maxStalenessDays,
      partial_points: points.filter(p => p.partial).length,
      membership_changed: membershipChanged,
      return_comparison: membershipChanged ? "within_contributing_cohort_only" : "fixed_contributing_cohort",
      fx: "not_applied",
    },
    status: !points.length ? "no_data" : stale ? "stale" : qualified ? "ok" : "partial",
    unavailable_reason: reason,
    return_kind: qualified ? "twr" : "unadjusted_asset_ratio",
    aligned_start: aligned.start || null,
    points: returnPoints,
    benchmarks: aligned.benchmarks,
    no_common_date: aligned.noCommonDate,
    asset_points: points,
  };
}
