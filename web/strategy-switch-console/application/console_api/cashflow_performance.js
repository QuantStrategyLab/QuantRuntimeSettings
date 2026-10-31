import { cleanPoints, dateMs, sliceRange, alignReturns, hasGap } from "../../performance_math.js";
import { externalFlowEnabled, instant, normalizeExternalFlow } from "../account_facts/external_flow.js";
import { maxDrawdown } from "./performance.js";

// Complete source windows cover (start, end]. Cash flows at start belong to the
// previous valuation; at end their Dietz weight is zero.
export function intervalFlows(payload, currency, start, end) {
  let windows;
  try { windows = normalizeExternalFlow(payload, { maxWindows: 4096, maxRecords: 4096 }).windows; }
  catch { return null; }
  const a = instant(start), b = instant(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  const rows = windows.filter(w => !w.time_precision && w.currency === currency && w.coverage === "complete"
    && instant(w.period_end) > a && instant(w.period_start) < b)
    .sort((x, y) => instant(x.period_start) - instant(y.period_start));
  let cursor = a;
  const records = new Map();
  for (const w of rows) {
    if (instant(w.period_start) > cursor) return null;
    cursor = Math.max(cursor, instant(w.period_end));
    for (const r of w.records) {
      const at = instant(r.effective_at);
      if (at > a && at <= b) records.set(r.source_ref, { ...r, weight: (b - at) / (b - a) });
    }
  }
  return cursor >= b ? [...records.values()] : null;
}

// Only expose the original eligible one-day period, never a return inferred
// from points removed by alignment or spanning a gap.
function withDailyReturns(points, periods, index) {
  const byDate = new Map(periods.map(period => [period.date, period]));
  const source = new Map(index.map(point => [point.date, point]));
  return points.map((point, i) => {
    const period = byDate.get(point.date);
    const previous = points[i - 1];
    const valid = previous && period && period.daily_eligible && Number.isFinite(period.return_percent)
      && previous.date === period.previous_date
      && dateMs(period.date) - dateMs(period.previous_date) === 86400000
      && !point.breakBefore && !source.get(point.date)?.breakBefore;
    return { ...point, daily_return_percent: valid ? period.return_percent : null };
  });
}

export function cashflowCurrencyResult(histories, { range, today, failed = [] }) {
  const currency = histories[0]?.currency;
  const normalized = histories.map(h => ({ ...h, points: sliceRange(h.points, range.toLowerCase(), today) }));
  const dates = [...new Set(normalized.flatMap(h => h.points.map(p => p.date)))].sort();
  const maps = normalized.map(h => new Map(h.points.map(p => [p.date, p])));
  const common = dates.filter(d => maps.every(m => m.has(d)));
  const unavailable = reason => ({ currency, status: "partial", unavailable_reason: reason,
    twr_return_percent: null, max_drawdown: { percent: null, peak_date: null, trough_date: null, unavailable_reason: reason },
    index: [], points: [], return_kind: "unadjusted_asset_ratio", cashflow_method: "modified_dietz", approximate: true });
  if (!normalized.length || failed.length || normalized.some(h => !h.points.length)) return unavailable("snapshot_history_missing");
  if (histories.some(h => {
    const valid = h.points.filter(p => Number.isFinite(dateMs(p.date)) && Number.isFinite(p.value));
    return cleanPoints(h.points).length !== new Set(valid.map(p => p.date)).size;
  })) return unavailable("snapshot_history_missing");
  if (normalized.some(h => h.points.some(p => p.value < 0))) return unavailable("invalid_return_period");
  if (common.length < 2) return unavailable("insufficient_observations");
  // Omitting another member's real valuation must not manufacture a daily return.
  if (common.length !== dates.length) return unavailable("snapshot_history_missing");
  const index = [{ date: common[0], value: 1 }];
  const periods = [];
  let growth = 1;
  let multiDay = false;
  let approximate = false;
  for (let i = 1; i < common.length; i++) {
    const prev = maps.map(m => m.get(common[i - 1])), next = maps.map(m => m.get(common[i]));
    if ([...prev, ...next].some(p => p.forwardFilled === true || p.partial === true || p.forward_filled_accounts?.length)) {
      return unavailable("snapshot_history_missing");
    }
    const starts = new Set(prev.map(p => p.observed_at)), ends = new Set(next.map(p => p.observed_at));
    // Aggregation needs simultaneous real valuations, not merely matching dates.
    if (starts.size !== 1 || ends.size !== 1) return unavailable("snapshot_history_missing");
    const start = prev[0].observed_at, end = next[0].observed_at;
    if (!Number.isFinite(instant(start)) || !Number.isFinite(instant(end))
        || start.slice(0, 10) !== common[i - 1] || end.slice(0, 10) !== common[i]) return unavailable("snapshot_history_missing");
    multiDay ||= dateMs(common[i]) - dateMs(common[i - 1]) > 86400000;
    const flows = normalized.map(h => intervalFlows(h.externalFlow, currency, start, end));
    if (flows.some(f => f === null)) return unavailable("external_cashflow_required");
    const v0 = prev.reduce((s, p) => s + p.value, 0), v1 = next.reduce((s, p) => s + p.value, 0);
    const records = flows.flat();
    approximate ||= records.some(record => instant(record.effective_at) !== instant(end));
    // A cross-account transfer needs both marked legs in this exact cohort and
    // interval. Unpaired legs and unsettled in-transit capital stay unavailable.
    const transfers = new Map();
    for (const r of records.filter(r => r.type.startsWith("transfer_"))) {
      if (!r.transfer_ref && normalized.length > 1) return unavailable("external_cashflow_required");
      const pair = transfers.get(r.transfer_ref) || [];
      pair.push(r); transfers.set(r.transfer_ref, pair);
    }
    for (const pair of transfers.values()) {
      if (normalized.length > 1 && (pair.length !== 2 || pair[0].type === pair[1].type
          || Math.abs(Number(pair[0].amount) + Number(pair[1].amount)) > 1e-8
          || pair[0].effective_at !== pair[1].effective_at)) return unavailable("external_cashflow_required");
    }
    const net = records.reduce((s, r) => s + Number(r.amount), 0);
    const weighted = records.reduce((s, r) => s + r.weight * Number(r.amount), 0);
    const denominator = v0 + weighted;
    const r = (v1 - v0 - net) / denominator;
    if (!(v0 > 0) || v1 < 0 || !(denominator > 0) || !Number.isFinite(r) || r < -1) return unavailable("invalid_return_period");
    growth *= 1 + r;
    if (!Number.isFinite(growth)) return unavailable("invalid_return_period");
    periods.push({ date: common[i], previous_date: common[i - 1], opening_value: v0, amount: v1 - v0 - net,
      net_flow: net, return_percent: r * 100, daily_eligible: next.every(point => point.membership_changed !== true),
      value_kind: "pnl", status: "ok", unavailable_reason: null });
    index.push({ date: common[i], value: growth,
      breakBefore: hasGap(index.at(-1), { date: common[i] }) || next.some(point => point.breakBefore === true) });
  }
  return { currency, status: "ok", unavailable_reason: null, twr_return_percent: (growth - 1) * 100,
    max_drawdown: maxDrawdown(index), index, points: withDailyReturns(alignReturns(index, []).primary, periods, index),
    return_kind: "twr", ...(approximate ? { cashflow_method: "modified_dietz", approximate: true } : {}),
    periods, multi_day_intervals: multiDay };
}

// Leave the legacy response byte-for-byte equivalent when OFF or no source data
// exists. The asset union/forward-fill path (#711) is deliberately not consumed.
export function applyCashflowPerformance(blocks, input, env) {
  if (!externalFlowEnabled(env) || !input.histories.some(h => h.externalFlow)) return blocks;
  const currencies = [...new Set(input.histories.map(h => h.currency))];
  const results = currencies.map(c => cashflowCurrencyResult(input.histories.filter(h => h.currency === c), input));
  const publicResult = r => { const { index, periods, ...rest } = r; return rest; };
  const perCurrency = results.map(publicResult);
  blocks.summary.cashflow_per_currency = perCurrency;
  blocks.returns.cashflow_per_currency = perCurrency;
  if (blocks.summary.per_currency) blocks.summary.per_currency = blocks.summary.per_currency.map(old => {
    const r = results.find(x => x.currency === old.currency);
    return r ? { ...old, max_drawdown: r.max_drawdown, twr_return_percent: r.twr_return_percent,
      cashflow_method: r.cashflow_method, approximate: r.approximate } : old;
  });
  if (currencies.length > 1) {
    blocks.returns.per_currency = (blocks.returns.per_currency || []).map(old => {
      const r = results.find(x => x.currency === old.currency);
      return r ? { ...old, ...publicResult(r), status: old.status === "stale" ? "stale" : r.status,
        as_of: r.index.at(-1)?.date || null, benchmarks: [], aligned_start: r.index[0]?.date || null } : old;
    });
    return blocks;
  }
  const r = results[0];
  if (!r) return blocks;
  if (r.status !== "ok") {
    // A failed return chain says nothing about observation-date overlap. Use
    // real dates from every fixed member, never the asset union/forward-fill.
    const memberDates = input.histories.map(h => new Set(sliceRange(h.points, input.range.toLowerCase(), input.today)
      .filter(p => p.forwardFilled !== true && p.partial !== true && !p.forward_filled_accounts?.length)
      .map(p => p.date)));
    const benchmarkDates = input.benchmarks.map(b => new Set(sliceRange(b.points, input.range.toLowerCase(), input.today)
      .map(p => p.date))).filter(dates => dates.size);
    // Preserve the legacy flag when a member has no real dates to compare.
    const noCommonDate = memberDates.some(dates => !dates.size) ? blocks.returns.no_common_date
      : benchmarkDates.length > 0 && ![...(memberDates[0] || [])].some(date =>
        memberDates.every(dates => dates.has(date)) && benchmarkDates.every(dates => dates.has(date)));
    Object.assign(blocks.summary, { twr_return_percent: null, max_drawdown: r.max_drawdown,
      unavailable_reason: r.unavailable_reason });
    if (blocks.summary.metric_reasons) blocks.summary.metric_reasons.twr = r.unavailable_reason;
    Object.assign(blocks.returns, { unavailable_reason: r.unavailable_reason, no_common_date: noCommonDate,
      points: [], benchmarks: [], aligned_start: null });
    return blocks;
  }
  const benchmarks = input.benchmarks.map(b => ({ ...b, points: sliceRange(b.points, input.range.toLowerCase(), input.today) }));
  const aligned = alignReturns(r.index, benchmarks);
  Object.assign(blocks.summary, { twr_return_percent: r.twr_return_percent, max_drawdown: r.max_drawdown,
    amount: r.periods.reduce((sum, period) => sum + period.amount, 0), value_kind: "pnl",
    cashflow_method: r.cashflow_method, approximate: r.approximate });
  if (blocks.summary.metric_reasons) blocks.summary.metric_reasons.twr = null;
  const crypto = input.accounts.every(account => account.platform === "binance");
  const daily = r.periods.flatMap(({ date }) => {
    if (!crypto && [0, 6].includes(new Date(dateMs(date)).getUTCDay())) return [];
    let previous = dateMs(date) - 86400000;
    if (!crypto) while ([0, 6].includes(new Date(previous).getUTCDay())) previous -= 86400000;
    const previousDate = new Date(previous).toISOString().slice(0, 10);
    const periods = r.periods.filter(period => period.date > previousDate && period.date <= date);
    if (periods[0]?.previous_date !== previousDate || periods.at(-1)?.date !== date) return [];
    const amount = periods.reduce((sum, period) => sum + period.amount, 0);
    const compounded = periods.reduce((value, period) => value * (1 + period.return_percent / 100), 1);
    return [{ date, amount, return_percent: (compounded - 1) * 100,
      value_kind: "pnl", status: "ok", unavailable_reason: null }];
  });
  const byDate = new Map(daily.map(period => [period.date, period]));
  blocks.calendar.cells = blocks.calendar.cells.map(cell => byDate.has(cell.date)
    ? { ...cell, ...byDate.get(cell.date), currency: r.currency } : cell);
  if (blocks.calendar.cells.some(cell => byDate.has(cell.date))) {
    const unresolved = blocks.calendar.cells.find(cell => cell.amount !== null && (cell.value_kind !== "pnl" || cell.status !== "ok"));
    const missing = blocks.calendar.cells.some(cell => cell.date > r.index[0].date && cell.date <= r.index.at(-1).date
      && cell.status === "no_data");
    Object.assign(blocks.calendar, { value_kind: unresolved?.value_kind === "asset_change" ? "asset_change" : "pnl",
      status: blocks.calendar.status === "stale" ? "stale" : unresolved || missing ? "partial" : "ok",
      unavailable_reason: unresolved?.unavailable_reason || (missing ? "snapshot_history_missing" : null),
      coverage: { ...blocks.calendar.coverage, cashflows: unresolved ? "unknown" : "complete" } });
  }
  const ranked = [...byDate.values()].filter(period => period.return_percent !== null)
    .sort((first, second) => second.return_percent - first.return_percent);
  blocks.summary.best_day = ranked[0] || null;
  blocks.summary.worst_day = ranked.at(-1) || null;
  blocks.summary.excess_returns = [];
  for (const block of [blocks.summary, blocks.returns]) {
    block.unavailable_reason = null;
    block.status = block.status === "stale" ? "stale" : "ok";
    block.coverage = { ...block.coverage, cashflows: "complete" };
  }
  const comparisonTruncated = aligned.primary.at(-1)?.date < r.index.at(-1)?.date;
  Object.assign(blocks.returns, { points: withDailyReturns(aligned.primary, r.periods, r.index), benchmarks: aligned.benchmarks,
    as_of: aligned.primary.at(-1)?.date || null,
    status: comparisonTruncated && blocks.returns.status !== "stale" ? "partial" : blocks.returns.status,
    unavailable_reason: comparisonTruncated ? "benchmark_history_missing" : null,
    aligned_start: aligned.start, no_common_date: aligned.noCommonDate, return_kind: "twr",
    value_kind: "pnl", cashflow_method: r.cashflow_method, approximate: r.approximate });
  return blocks;
}
