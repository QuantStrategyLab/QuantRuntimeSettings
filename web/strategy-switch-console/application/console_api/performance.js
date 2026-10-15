import {
  aggregateEquity,
  alignReturns,
  chainReturns,
  cleanPoints,
  dateMs,
  sliceRange,
} from "../../performance_math.js";
const DAY = 86400000;
const finite = (value) =>
  ["string", "number"].includes(typeof value) &&
  value !== "" &&
  Number.isFinite(Number(value))
    ? Number(value)
    : null;
export const businessDate = (now) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
export function maxDrawdown(index) {
  const rows = cleanPoints(index);
  if (rows.length < 2)
    return {
      percent: null,
      peak_date: null,
      trough_date: null,
      unavailable_reason: "insufficient_observations",
    };
  let peak = rows[0],
    worst = 0,
    peakDate = peak.date,
    troughDate = peak.date;
  for (const point of rows) {
    if (!(peak.value > 0)) continue;
    const loss = (1 - point.value / peak.value) * 100;
    if (loss > worst) {
      worst = loss;
      peakDate = peak.date;
      troughDate = point.date;
    }
    if (point.value > peak.value) peak = point;
  }
  return {
    percent: worst,
    peak_date: peakDate,
    trough_date: troughDate,
    unavailable_reason: null,
  };
}
export function dailyChanges(points, { crypto = false } = {}) {
  const rows = cleanPoints(points),
    byDate = new Map(rows.map((p) => [p.date, p]));
  return rows.map((point) => {
    let before = dateMs(point.date) - DAY;
    // No market holiday source exists. Only weekends can be classified.
    if (!crypto)
      while ([0, 6].includes(new Date(before).getUTCDay())) before -= DAY;
    const previous = byDate.get(new Date(before).toISOString().slice(0, 10));
    const interval = previous
      ? rows.filter((p) => p.date > previous.date && p.date <= point.date)
      : [point];
    const known = interval.every((p) => finite(p.externalFlow) !== null);
    const flow = known
      ? interval.reduce((sum, p) => sum + Number(p.externalFlow), 0)
      : null;
    const amount = previous
      ? point.value - previous.value - (known ? flow : 0)
      : null;
    // P/L daily convention follows the requested prior-close plus investment denominator.
    const denominator = previous ? previous.value + (known ? flow : 0) : null;
    return {
      date: point.date,
      amount,
      return_percent:
        amount !== null && denominator > 0 && known
          ? (amount / denominator) * 100
          : null,
      value_kind: known ? "pnl" : "asset_change",
      status: !previous
        ? "no_data"
        : known && denominator > 0
          ? "ok"
          : "partial",
      unavailable_reason: !previous
        ? "previous_snapshot_missing"
        : !known
          ? "external_cashflow_required"
          : denominator > 0
            ? null
            : "invalid_return_period",
    };
  });
}
export function calendarCells(points, year, month, options = {}) {
  const daily = new Map(dailyChanges(points, options).map((p) => [p.date, p]));
  const monthCells = (m) => {
    const start = `${year}-${String(m).padStart(2, "0")}-01`,
      count = new Date(Date.UTC(year, m, 0)).getUTCDate();
    return Array.from({ length: count }, (_, i) => {
      const date = `${start.slice(0, 8)}${String(i + 1).padStart(2, "0")}`;
      const weekend =
        !options.crypto &&
        [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
      return {
        date,
        ...(weekend
          ? {
              amount: null,
              return_percent: null,
              value_kind: "asset_change",
              status: "unavailable",
              unavailable_reason: "non_trading_weekend",
            }
          : daily.get(date) || {
              amount: null,
              return_percent: null,
              value_kind: "asset_change",
              status: "no_data",
              unavailable_reason: "snapshot_missing",
            }),
      };
    });
  };
  if (month) return monthCells(month);
  return Array.from({ length: 12 }, (_, i) => {
    const cells = monthCells(i + 1).filter(
      (c) => c.unavailable_reason !== "non_trading_weekend",
    );
    const values = cells.filter((c) => c.amount !== null),
      complete = values.length === cells.length;
    const kind =
      values.length && values.every((c) => c.value_kind === "pnl")
        ? "pnl"
        : "asset_change";
    const monthStart = `${year}-${String(i + 1).padStart(2, "0")}-01`;
    const rows = cleanPoints(points);
    const baseline = rows.filter((p) => p.date < monthStart).at(-1);
    const monthlyPoints = rows.filter((p) =>
      p.date.startsWith(monthStart.slice(0, 7)),
    );
    const twr = chainReturns(
      baseline ? [baseline, ...monthlyPoints] : monthlyPoints,
    );
    return {
      month: `${year}-${String(i + 1).padStart(2, "0")}`,
      amount: complete ? values.reduce((s, c) => s + c.amount, 0) : null,
      observed_amount: values.length
        ? values.reduce((s, c) => s + c.amount, 0)
        : null,
      return_percent:
        complete &&
        kind === "pnl" &&
        baseline &&
        !twr.unknownFlow &&
        !twr.invalidPeriod
          ? (twr.index.at(-1).value - 1) * 100
          : null,
      value_kind: kind,
      status: !values.length
        ? "no_data"
        : complete && kind === "pnl" && !twr.invalidPeriod
          ? "ok"
          : "partial",
      unavailable_reason: !complete
        ? "incomplete_month"
        : kind !== "pnl"
          ? "external_cashflow_required"
          : twr.invalidPeriod
            ? "invalid_return_period"
            : null,
      coverage: {
        observed_days: values.length,
        expected_weekdays: cells.length,
      },
    };
  });
}
export function holdingsRows(accounts) {
  return accounts
    .flatMap((a) =>
      (a.positions || []).map((p) => {
        const cost = finite(p.avg_cost),
          quantity = finite(p.quantity),
          value = finite(p.market_value);
        return {
          account_alias: a.account_key,
          platform: a.platform,
          symbol: p.symbol,
          quantity,
          market_value: value,
          currency: p.currency,
          avg_cost: cost,
          unrealized_pnl:
            cost !== null && quantity !== null && value !== null
              ? value - cost * quantity
              : null,
          unavailable_reason:
            cost === null
              ? "avg_cost_missing"
              : quantity === null || value === null
                ? "position_value_missing"
                : null,
          coverage: a.positions_scope || "unknown",
          status: cost === null ? "partial" : "ok",
        };
      }),
    )
    .sort(
      (a, b) =>
        a.currency.localeCompare(b.currency) ||
        (b.unrealized_pnl ?? -Infinity) - (a.unrealized_pnl ?? -Infinity),
    );
}
export function closedTradeStats(closedTrades) {
  const rows = closedTrades.filter((t) => finite(t.realized_pnl) !== null);
  return {
    win_rate_percent: rows.length
      ? (rows.filter((t) => Number(t.realized_pnl) > 0).length / rows.length) *
        100
      : null,
    unavailable_reason: rows.length ? null : "no_closed_trades",
  };
}
export function performanceBlocks({
  accounts,
  histories,
  benchmarks = [],
  range = "ALL",
  today,
  year,
  month,
  failed = [],
}) {
  const currencies = [...new Set(histories.map((h) => h.currency))];
  const mixed = currencies.length > 1;
  const combined = aggregateEquity(
    histories.map((h) => ({ id: h.id, points: h.points })),
  );
  const allPoints = mixed ? [] : combined.points;
  const points = sliceRange(allPoints, range.toLowerCase(), today);
  const asOf = points.at(-1)?.date || null;
  const chained = chainReturns(points);
  const unknownFlow =
    points.length < 2 ||
    points.slice(1).some((p) => finite(p.externalFlow) === null);
  const missing =
    failed.length || combined.missingAccounts.length || combined.omittedDates;
  const reason = mixed
    ? "mixed_currency"
    : !points.length
      ? "snapshot_history_missing"
      : chained.invalidPeriod
        ? "invalid_return_period"
        : chained.unknownFlow
          ? "external_cashflow_required"
          : points.length < 2
            ? "insufficient_observations"
            : null;
  const stale = asOf && dateMs(today) - dateMs(asOf) > 3 * DAY;
  const status = mixed
    ? "unavailable"
    : !points.length
      ? "no_data"
      : stale
        ? "stale"
        : reason || missing
          ? "partial"
          : "ok";
  const coverage = {
    account_aliases: accounts.map((a) => a.account_key),
    currencies,
    excluded_accounts: failed,
    omitted_dates: combined.omittedDates,
    cashflows: unknownFlow
      ? "unknown"
      : points.length > 1
        ? "complete"
        : "unknown",
    fx: mixed ? "not_applied" : "native_currency",
    trading_dates: accounts.every((a) => a.platform === "binance")
      ? "calendar_days"
      : "stored_observation_date_weekends_excluded_holidays_unknown",
  };
  const meta = {
    status,
    unavailable_reason: reason,
    as_of: asOf,
    coverage,
    currency: mixed ? null : currencies[0] || null,
    value_kind: unknownFlow ? "asset_change" : "pnl",
  };
  const availableBenchmarks = benchmarks.map((b) => ({
    ...b,
    points: sliceRange(b.points, range.toLowerCase(), today),
  }));
  const aligned = alignReturns(chained.index, availableBenchmarks);
  const qualified =
    points.length > 1 && !chained.unknownFlow && !chained.invalidPeriod;
  const drawdown = qualified
    ? maxDrawdown(chained.index)
    : {
        percent: null,
        peak_date: null,
        trough_date: null,
        unavailable_reason: reason,
      };
  const daily = dailyChanges(allPoints, {
    crypto: accounts.every((a) => a.platform === "binance"),
  }).filter((d) => d.date >= (points[0]?.date || today) && d.date <= today);
  const validDays = daily.filter((d) => d.amount !== null);
  const ranked = validDays
    .filter((d) => d.return_percent !== null)
    .sort((a, b) => b.return_percent - a.return_percent);
  const first = points[0],
    last = points.at(-1),
    flowKnown =
      points.length > 1 &&
      points.slice(1).every((p) => finite(p.externalFlow) !== null);
  const netFlow = flowKnown
    ? points.slice(1).reduce((s, p) => s + p.externalFlow, 0)
    : null;
  const amount =
    points.length > 1
      ? last.value - first.value - (flowKnown ? netFlow : 0)
      : null;
  const primaryByDate = new Map(aligned.primary.map((p) => [p.date, p.value]));
  const cells = calendarCells(allPoints, year, month, {
    crypto: accounts.every((a) => a.platform === "binance"),
  });
  const calendarHasValues = cells.some(
    (c) =>
      c.amount !== null ||
      (c.observed_amount !== undefined && c.observed_amount !== null),
  );
  const byCurrency = mixed
    ? currencies.map((currency) => {
        const group = aggregateEquity(
          histories
            .filter((h) => h.currency === currency)
            .map((h) => ({ id: h.id, points: h.points })),
        );
        const result = chainReturns(
          sliceRange(group.points, range.toLowerCase(), today),
        );
        const alignedGroup = alignReturns(result.index, availableBenchmarks);
        return {
          currency,
          as_of: result.index.at(-1)?.date || null,
          coverage: { omitted_dates: group.omittedDates },
          return_kind: result.unknownFlow ? "unadjusted_asset_ratio" : "twr",
          status: !result.index.length
            ? "no_data"
            : result.unknownFlow
              ? "partial"
              : "ok",
          unavailable_reason: result.unknownFlow
            ? "external_cashflow_required"
            : null,
          aligned_start: alignedGroup.start || null,
          points: alignedGroup.primary,
          benchmarks: alignedGroup.benchmarks,
        };
      })
    : [];
  return {
    calendar: {
      ...meta,
      status: mixed
        ? "unavailable"
        : !calendarHasValues
          ? "no_data"
          : meta.status === "no_data"
            ? "partial"
            : meta.status,
      unavailable_reason: mixed
        ? "mixed_currency"
        : !calendarHasValues
          ? "snapshot_history_missing"
          : meta.unavailable_reason,
      year,
      month: month || null,
      cells: cells.map((c) => ({ ...c, currency: meta.currency })),
      as_of: allPoints.at(-1)?.date || null,
    },
    summary: {
      ...meta,
      twr_return_percent: qualified
        ? (chained.index.at(-1).value - 1) * 100
        : null,
      amount,
      simple_weighted_return_percent:
        flowKnown && first.value + netFlow > 0
          ? (amount / (first.value + netFlow)) * 100
          : null,
      max_drawdown: drawdown,
      best_day: ranked[0] || null,
      worst_day: ranked.at(-1) || null,
      excess_returns: aligned.benchmarks.map((b) => {
        const end = b.points.filter((p) => primaryByDate.has(p.date)).at(-1);
        return {
          benchmark: b.id,
          start: aligned.start,
          end: end?.date || null,
          percentage_points:
            end && qualified ? primaryByDate.get(end.date) - end.value : null,
          unavailable_reason: qualified
            ? end
              ? null
              : "no_common_date"
            : reason,
        };
      }),
    },
    returns: {
      ...meta,
      aligned_start: aligned.start || null,
      return_kind: qualified ? "twr" : "unadjusted_asset_ratio",
      points: aligned.primary,
      benchmarks: aligned.benchmarks,
      per_currency: byCurrency,
      no_common_date: aligned.noCommonDate,
      benchmark_availability: availableBenchmarks.map((b) => ({
        id: b.id,
        status:
          b.points.length && !aligned.noCommonDate
            ? dateMs(today) - dateMs(b.points.at(-1).date) > 3 * DAY
              ? "stale"
              : "ok"
            : "unavailable",
        unavailable_reason: !b.points.length
          ? "benchmark_history_missing"
          : aligned.noCommonDate
            ? "no_common_date"
            : null,
        as_of: b.points.at(-1)?.date || null,
      })),
    },
    assets: { ...meta, points },
    holdings: {
      status: accounts.some((a) => a.data_status === "stale")
        ? "stale"
        : accounts.some((a) => a.positions?.length)
          ? "partial"
          : "no_data",
      unavailable_reason: accounts.some((a) => a.data_status === "stale")
        ? "positions_stale"
        : accounts.some((a) => a.positions?.length)
          ? "positions_partial_coverage"
          : "positions_not_connected",
      as_of:
        accounts
          .map((a) => a.observed_finished_at)
          .filter(Boolean)
          .sort()
          .at(0) || null,
      coverage: accounts.map((a) => ({
        account_alias: a.account_key,
        scope: a.positions_scope || "not_connected",
      })),
      label_key: "performance.current_holdings_unrealized",
      value_kind: "pnl",
      rows: holdingsRows(accounts),
    },
    trades: {
      status: "not_connected",
      unavailable_reason: "fills_not_connected",
      as_of: null,
      coverage: "fills_not_connected",
      value_kind: "pnl",
    },
  };
}
