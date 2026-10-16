import { cleanPoints, dateMs, sliceRange, alignReturns } from "../../performance_math.js";
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
  const rows = windows.filter(w => w.currency === currency && w.coverage === "complete"
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
  let growth = 1;
  let multiDay = false;
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
    index.push({ date: common[i], value: growth, breakBefore: dateMs(common[i]) - dateMs(common[i - 1]) > 86400000 });
  }
  return { currency, status: "ok", unavailable_reason: null, twr_return_percent: (growth - 1) * 100,
    max_drawdown: maxDrawdown(index), index, points: alignReturns(index, []).primary,
    return_kind: "twr", cashflow_method: "modified_dietz", approximate: true, multi_day_intervals: multiDay };
}

// Leave the legacy response byte-for-byte equivalent when OFF or no source data
// exists. The asset union/forward-fill path (#711) is deliberately not consumed.
export function applyCashflowPerformance(blocks, input, env) {
  if (!externalFlowEnabled(env) || !input.histories.some(h => h.externalFlow)) return blocks;
  const currencies = [...new Set(input.histories.map(h => h.currency))];
  const results = currencies.map(c => cashflowCurrencyResult(input.histories.filter(h => h.currency === c), input));
  const publicResult = r => { const { index, ...rest } = r; return rest; };
  const perCurrency = results.map(publicResult);
  blocks.summary.cashflow_per_currency = perCurrency;
  blocks.returns.cashflow_per_currency = perCurrency;
  if (blocks.summary.per_currency) blocks.summary.per_currency = blocks.summary.per_currency.map(old => {
    const r = results.find(x => x.currency === old.currency);
    return r?.status === "ok" ? { ...old, max_drawdown: r.max_drawdown, twr_return_percent: r.twr_return_percent,
      cashflow_method: r.cashflow_method, approximate: true } : old;
  });
  if (currencies.length > 1) {
    blocks.returns.per_currency = (blocks.returns.per_currency || []).map(old => {
      const r = results.find(x => x.currency === old.currency);
      return r?.status === "ok" ? { ...old, ...publicResult(r), benchmarks: [], aligned_start: r.index[0].date } : old;
    });
    return blocks;
  }
  const r = results[0];
  if (!r || r.status !== "ok") return blocks;
  const benchmarks = input.benchmarks.map(b => ({ ...b, points: sliceRange(b.points, input.range.toLowerCase(), input.today) }));
  const aligned = alignReturns(r.index, benchmarks);
  Object.assign(blocks.summary, { twr_return_percent: r.twr_return_percent, max_drawdown: r.max_drawdown,
    cashflow_method: r.cashflow_method, approximate: true });
  if (blocks.summary.metric_reasons) blocks.summary.metric_reasons.twr = null;
  // Legacy daily P/L/calendar use another denominator; they remain untouched.
  blocks.summary.excess_returns = [];
  for (const block of [blocks.summary, blocks.returns]) {
    block.unavailable_reason = null;
    block.status = block.status === "stale" ? "stale" : "ok";
    block.coverage = { ...block.coverage, cashflows: "complete" };
  }
  Object.assign(blocks.returns, { points: aligned.primary, benchmarks: aligned.benchmarks,
    aligned_start: aligned.start, no_common_date: aligned.noCommonDate, return_kind: "twr",
    cashflow_method: r.cashflow_method, approximate: true });
  return blocks;
}
