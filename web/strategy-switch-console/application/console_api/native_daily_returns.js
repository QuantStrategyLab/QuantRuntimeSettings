import { cleanPoints, dateMs, hasGap, rangeStart, sliceRange } from "../../performance_math.js";

// Amounts have already passed the private period-return receiver. Sum their
// decimal text exactly before converting the final display value to a number.
function navAmountSum(rows) {
  if (!rows.length || rows.some(row => typeof row.navAmount !== "string"
    || row.navAmount.length > 64 || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(row.navAmount))) return null;
  const parts = rows.map(row => {
    const [whole, fraction = ""] = row.navAmount.split(".");
    return { value: BigInt(whole + fraction), scale: fraction.length };
  });
  const scale = Math.max(...parts.map(part => part.scale));
  const total = parts.reduce((sum, part) => sum + part.value * 10n ** BigInt(scale - part.scale), 0n);
  const number = Number(total) / 10 ** scale;
  return Number.isFinite(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER ? number : null;
}

function nativeBenchmarks(index, input, gaps) {
  const benchmarks = [], benchmark_availability = [];
  for (const series of input.benchmarks || []) {
    // Keep the real preceding close even when it falls before the query range.
    const prices = cleanPoints(series.points).filter(point => point.value > 0 && point.date <= input.today);
    const byDate = new Map(prices.map(point => [point.date, point]));
    const opening = prices.filter(point => point.date < index[0].date).at(-1);
    const closes = index.map(point => byDate.get(point.date));
    const complete = opening && !hasGap(opening, { date: index[0].date })
      && closes.every(point => point && point.breakBefore !== true);
    const points = complete ? closes.map((point, i) => ({
      date: point.date,
      value: (point.value / opening.value - 1) * 100,
      daily_return_percent: (point.value / (i ? closes[i - 1].value : opening.value) - 1) * 100,
    })) : [];
    const reason = gaps ? "snapshot_history_missing"
      : !prices.length ? "benchmark_history_missing"
        : !closes.some(Boolean) ? "no_common_date"
          : !complete || points.some(point => !Number.isFinite(point.value) || !Number.isFinite(point.daily_return_percent))
            ? "benchmark_history_missing" : null;
    const asOf = prices.at(-1)?.date || null;
    benchmark_availability.push({ id: series.id,
      status: reason ? "unavailable" : dateMs(input.today) - dateMs(asOf) > 3 * 86400000 ? "stale" : "ok",
      unavailable_reason: reason, as_of: asOf });
    // Incomplete comparisons stay absent; never rebase both series halfway
    // through the native window or fill a missing price with a zero return.
    if (!reason) benchmarks.push({ id: series.id, points });
  }
  return { benchmarks, benchmark_availability };
}

/** Broker-native daily TWR for one account. Never average account returns. */
export function applyNativeDailyReturns(blocks, input) {
  if (input.accounts.length !== 1) return blocks;
  const account = input.accounts[0];
  if (!Array.isArray(account.return?.daily)) return blocks;
  const rows = account.return.daily.filter(row => row.status === "available"
    && row.method === "native_ibkr_twr" && row.unit === "ratio" && row.source === "ChangeInNAV.twr"
    && row.period && row.period.from === row.period.to && Number.isFinite(dateMs(row.period.to))
    && typeof row.value === "string" && Number.isFinite(Number(row.value)) && Number(row.value) >= -1);
  const currencies = [...new Set(rows.map(row => row.currency))];
  if (currencies.length !== 1) return blocks;
  const currency = currencies[0];
  const daily = sliceRange(rows.map(row => ({ date: row.period.to, value: Number(row.value),
    navAmount: row.nav_change?.method === "ibkr_nav_reconciliation" && row.nav_change.source === "ChangeInNAV"
      ? row.nav_change.amount : null })), input.range.toLowerCase(), input.today);
  if (!daily.length) return blocks;
  let expectedStart = rangeStart(input.range.toLowerCase(), input.today);
  if (input.range !== "ALL") {
    while ([0, 6].includes(new Date(dateMs(expectedStart)).getUTCDay())) expectedStart = new Date(dateMs(expectedStart) + 86400000).toISOString().slice(0, 10);
  }
  const incompleteRange = input.range !== "ALL" && daily[0].date > expectedStart;
  const gaps = daily.slice(1).some((row, i) => hasGap(daily[i], row));
  let growth = 1;
  const index = daily.map(row => { growth *= 1 + row.value; return { date: row.date, value: growth }; });
  const stale = dateMs(input.today) - dateMs(daily.at(-1).date) > 3 * 86400000;
  const status = gaps || incompleteRange ? "partial" : stale ? "stale" : "ok";
  const reason = gaps || incompleteRange ? "snapshot_history_missing" : null;
  const amount = gaps || incompleteRange ? null : navAmountSum(daily);
  const coverage = { ...blocks.returns.coverage, account_aliases: [account.account_key], currencies: [currency],
    cashflows: "complete", native_return_source: "ChangeInNAV.twr", period_from: daily[0].date,
    period_to: daily.at(-1).date, range_complete: !gaps && !incompleteRange,
    requested_period_from: input.range === "ALL" ? daily[0].date : expectedStart, trading_dates: "broker_reported_daily_returns",
    native_amount_source: amount === null ? null : "ChangeInNAV", native_amount_method: amount === null ? null : "ibkr_nav_reconciliation" };
  // Native daily returns already have a starting capital boundary. Rebasing the
  // first close to zero would silently remove the first day's actual return.
  const comparisons = nativeBenchmarks(index, input, gaps);
  Object.assign(blocks.returns, { status, unavailable_reason: reason, currency, value_kind: "pnl",
    return_kind: "twr", cashflow_method: undefined, approximate: undefined,
    as_of: daily.at(-1).date, coverage, aligned_start: daily[0].date, no_common_date: false,
    points: gaps ? [] : index.map((row, i) => ({ date: row.date, value: (row.value - 1) * 100, daily_return_percent: daily[i].value * 100 })),
    ...comparisons, per_currency: [] });
  let peak = 1, peakDate = daily[0].date, worst = 0, lossPeakDate = peakDate, troughDate = peakDate;
  for (const point of index) {
    const loss = peak > 0 ? (1 - point.value / peak) * 100 : 0;
    if (loss > worst) { worst = loss; lossPeakDate = peakDate; troughDate = point.date; }
    if (point.value > peak) { peak = point.value; peakDate = point.date; }
  }
  Object.assign(blocks.summary, { status, unavailable_reason: reason, currency, value_kind: "pnl",
    as_of: daily.at(-1).date, coverage, twr_return_percent: gaps || incompleteRange ? null : (growth - 1) * 100,
    amount, simple_weighted_return_percent: null, best_day: null, worst_day: null,
    max_drawdown: gaps || incompleteRange ? { percent: null, peak_date: null, trough_date: null, unavailable_reason: reason }
      : { percent: worst, peak_date: lossPeakDate, trough_date: troughDate, unavailable_reason: null },
    metric_reasons: { ...blocks.summary.metric_reasons, twr: reason },
    excess_returns: comparisons.benchmarks.map(comparison => ({ benchmark: comparison.id,
      start: daily[0].date, end: comparison.points.at(-1).date,
      percentage_points: gaps || incompleteRange ? null : (growth - 1) * 100 - comparison.points.at(-1).value,
      unavailable_reason: reason })) });
  const currencySummary = blocks.summary.per_currency.find(item => item.currency === currency) || {
    currency, total: null, account_count: 0, expected_account_count: 1, as_of: null,
    stale: null, status: "no_data", unavailable_reason: "no_snapshot" };
  blocks.summary.per_currency = [...blocks.summary.per_currency.filter(item => item.currency !== currency),
    { ...currencySummary, max_drawdown: blocks.summary.max_drawdown,
      twr_return_percent: blocks.summary.twr_return_percent, cashflow_method: undefined, approximate: undefined }];
  delete blocks.summary.cashflow_per_currency;
  delete blocks.returns.cashflow_per_currency;
  // A native percentage alone never supplies money P/L. The optional, separately
  // qualified NAV reconciliation can fill only the exact native days it covers.
  const byDate = new Map(daily.map(row => [row.date, row]));
  let displayed = 0;
  blocks.calendar.cells = blocks.calendar.cells.map(cell => {
    if (cell.month) {
      const monthly = daily.filter(row => row.date.startsWith(`${cell.month}-`) && row.date <= input.today);
      if (!monthly.length) return cell;
      const [year, month] = cell.month.split("-").map(Number);
      const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
      const through = last < input.today ? last : input.today;
      const expected = [];
      for (let day = dateMs(`${cell.month}-01`); day <= dateMs(through); day += 86400000) {
        if (![0, 6].includes(new Date(day).getUTCDay())) expected.push(new Date(day).toISOString().slice(0, 10));
      }
      // Missing weekdays remain incomplete until a native closure calendar is
      // supplied. Never turn an unobserved session into a zero-return day.
      const complete = expected.length === monthly.length && expected.every(date => byDate.has(date));
      displayed++;
      return { ...cell, amount: complete ? navAmountSum(monthly) : null, observed_amount: null, currency, value_kind: "pnl",
        return_percent: complete ? (monthly.reduce((growth, row) => growth * (1 + row.value), 1) - 1) * 100 : null,
        status: complete ? "ok" : "partial", unavailable_reason: complete ? null : "incomplete_month",
        coverage: { observed_days: monthly.length, expected_weekdays: expected.length } };
    }
    const row = byDate.get(cell.date);
    if (!row) return cell;
    displayed++;
    return { ...cell, amount: navAmountSum([row]), observed_amount: null, return_percent: row.value * 100, currency,
      value_kind: "pnl", status: "ok", unavailable_reason: null };
  });
  if (displayed) Object.assign(blocks.calendar, { status, unavailable_reason: reason, currency,
    as_of: daily.at(-1).date, value_kind: "pnl", coverage });
  const ranked = [...daily].sort((a, b) => b.value - a.value).map(row => ({ date: row.date, return_percent: row.value * 100,
      amount: navAmountSum([row]), value_kind: "pnl", status: "ok", unavailable_reason: null }));
  blocks.summary.best_day = gaps || incompleteRange ? null : ranked[0] || null;
  blocks.summary.worst_day = gaps || incompleteRange ? null : ranked.at(-1) || null;
  return blocks;
}
