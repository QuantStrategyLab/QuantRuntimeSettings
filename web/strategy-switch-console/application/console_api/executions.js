import { rangeStart } from "../../performance_math.js";
import { mergeExecutionRecord } from "../account_facts/executions.js";

const REQUIRED_FIELDS = ["execution_ref", "trade_date", "symbol", "asset_category", "side", "quantity", "price", "currency"];
const OPTIONAL_FIELDS = ["local_time", "time_zone", "commission", "commission_currency", "taxes"];
const SUBSTANTIVE_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const fieldTupleKey = (row, fields) => JSON.stringify(fields.map(field => row[field] ?? null));

function reduceExecutionBucket(bucket) {
  const byRequired = new Map();
  for (const entry of bucket) {
    const reqKey = fieldTupleKey(entry.row, REQUIRED_FIELDS);
    const list = byRequired.get(reqKey) || [];
    list.push(entry);
    byRequired.set(reqKey, list);
  }
  const out = [];
  for (const partition of byRequired.values()) {
    // When an optional field carries multiple conflicting non-null values in
    // the same bucket, keep both distinct values and missing-field rows in
    // separate deterministic sub-groups so a missing value never depends on
    // arrival order to choose which conflicting version it merges with.
    const conflictingOptional = OPTIONAL_FIELDS.filter(field =>
      new Set(partition.map(entry => entry.row[field] ?? null).filter(value => value !== null)).size > 1);
    const subGroups = new Map();
    for (const entry of partition) {
      const key = fieldTupleKey(entry.row, conflictingOptional);
      const list = subGroups.get(key) || [];
      list.push(entry);
      subGroups.set(key, list);
    }
    for (const entries of subGroups.values()) {
      const sorted = [...entries].sort((left, right) =>
        compareText(fieldTupleKey(left.row, SUBSTANTIVE_FIELDS), fieldTupleKey(right.row, SUBSTANTIVE_FIELDS))
        || compareText(left.platform, right.platform)
        || compareText(left.account_alias, right.account_alias)
        || compareText(left.row.report_ref || "", right.row.report_ref || ""));
      let merged = { ...sorted[0].row };
      for (const entry of sorted.slice(1)) merged = mergeExecutionRecord(merged, entry.row);
      out.push({ platform: sorted[0].platform, account_alias: sorted[0].account_alias, ...merged });
    }
  }
  return out;
}

/** Only broker executions. Snapshot, benchmark and wallet failures are unrelated. */
export async function executionStatsResponse(options, { scope, range, today, groupOf = null }, env, deps) {
  const coverage = [], rows = [], buckets = new Map();
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
      unavailable_reason: "execution_coverage_unverified", coverage: source.coverage, reports: source.reports, reports_truncated: source.reports_truncated ?? false });
    const observations = source.as_of ? [source.as_of] : source.reports.map(report => report.observed_at);
    for (const observedAt of observations) if (!asOf || Date.parse(observedAt) > Date.parse(asOf)) asOf = observedAt;
    // Sibling deployments of one physical account observe the same executions:
    // one execution reference in one group is bucketed across all reports.
    // Compatible supplemental fields merge deterministically across the bucket;
    // each substantively conflicting version is retained once.
    const owner = groupOf?.(option) ?? JSON.stringify([option.platform, option.key]);
    for (const row of source.records) {
      if (row.trade_date > today || start && row.trade_date < start) continue;
      const identity = JSON.stringify([owner, row.execution_ref]);
      const bucket = buckets.get(identity) || [];
      bucket.push({ platform: option.platform, account_alias: option.key, row });
      buckets.set(identity, bucket);
    }
  }
  for (const bucket of buckets.values()) rows.push(...reduceExecutionBucket(bucket));
  rows.sort((a, b) => compareText(b.trade_date, a.trade_date)
    || compareText(b.local_time || "", a.local_time || "")
    || compareText(a.execution_ref, b.execution_ref)
    || compareText(fieldTupleKey(a, SUBSTANTIVE_FIELDS), fieldTupleKey(b, SUBSTANTIVE_FIELDS))
    || compareText(a.platform, b.platform)
    || compareText(a.account_alias, b.account_alias)
    || compareText(a.report_ref || "", b.report_ref || ""));
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
