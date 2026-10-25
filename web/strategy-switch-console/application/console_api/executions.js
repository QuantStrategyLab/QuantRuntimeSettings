import { rangeStart } from "../../performance_math.js";

/** Only broker executions. Snapshot, benchmark and wallet failures are unrelated. */
export async function executionStatsResponse(options, { scope, range, today }, env, deps) {
  const coverage = [], rows = [];
  let asOf = null, connected = 0, failures = 0;
  const start = range === "ALL" ? null : rangeStart(range.toLowerCase(), today);
  for (const option of options) {
    let source;
    try { source = deps.executions ? await deps.executions(option, env) : null; }
    catch {
      failures++;
      coverage.push({ platform: option.platform, account_alias: option.key, status: "unavailable",
        unavailable_reason: "stored_records_unreadable" });
      continue;
    }
    if (!source) {
      coverage.push({ platform: option.platform, account_alias: option.key, status: "not_connected",
        unavailable_reason: "fills_not_connected" });
      continue;
    }
    connected++;
    coverage.push({ platform: option.platform, account_alias: option.key, status: "partial",
      unavailable_reason: "execution_coverage_unverified", coverage: source.coverage, reports: source.reports });
    for (const report of source.reports) if (!asOf || report.observed_at > asOf) asOf = report.observed_at;
    for (const row of source.records) {
      if (row.trade_date > today || start && row.trade_date < start) continue;
      rows.push({ platform: option.platform, account_alias: option.key, ...row });
    }
  }
  rows.sort((a, b) => b.trade_date.localeCompare(a.trade_date)
    || (b.local_time || "").localeCompare(a.local_time || "") || a.execution_ref.localeCompare(b.execution_ref));
  const status = connected ? "partial" : failures ? "unavailable" : "not_connected";
  return deps.json({ schema_version: "console_api.v1", scope, range, status,
    unavailable_reason: connected ? "execution_coverage_unverified"
      : failures ? "stored_records_unreadable" : "fills_not_connected",
    as_of: asOf, coverage, value_kind: "pnl", rows,
    // Count only the actual observed rows. These are neither closed trades nor a full history.
    reported_execution_count: connected ? rows.length : null,
    per_currency: [...new Set(rows.map(row => row.currency))].sort().map(currency => {
      const group = rows.filter(row => row.currency === currency);
      return { currency, reported_execution_count: group.length,
        buy_execution_count: group.filter(row => row.side === "BUY").length,
        sell_execution_count: group.filter(row => row.side === "SELL").length };
    }), win_rate_percent: null, realized_pnl: null,
  }, status === "unavailable" ? 503 : 200);
}
