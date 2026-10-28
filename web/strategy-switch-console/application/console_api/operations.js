/** Read-only page projections. Missing observations never imply a successful run. */
import { RUNTIME_DAILY_TIMEZONE, runtimeDailyBusinessDate } from "../../runtime_daily_contract.js";
import { configuredStrategyExecution } from "./strategy_execution.js";
import { runStatus, runStateCounts } from "./run_status.js";
export const READ_ONLY = { no_order: true, execution_authority_granted: false };
export function businessDate(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}
export async function todaySummary(request, env, deps, accounts, now = Date.now()) {
  // Daily records, their reader, and this summary must share one date domain.
  const date = runtimeDailyBusinessDate(now);
  const bindings = await deps.dailyBindings(env);
  const rows = await Promise.all(accounts.map(async (account) => {
    const base = { account_alias: account.key, platform: account.platform,
      status: "not_connected", unavailable_reason: "runtime_daily_not_connected",
      as_of: null, activity: null, completeness: null, run_count: null, runs: [] };
    const matches = bindings.filter(b => b.platform === account.platform && b.account_key === account.key && b.status === "bound");
    if (matches.length === 0) return base;
    if (matches.length > 1) return { ...base, status: "partial", unavailable_reason: "runtime_daily_binding_conflict" };
    const url = new URL("/api/runtime-daily", request.url);
    url.searchParams.set("date", date);
    url.searchParams.set("platform", account.platform);
    url.searchParams.set("account_key", account.key);
    url.searchParams.set("include_history", "false");
    try {
      const response = await deps.daily(new Request(url, { headers: request.headers }), env);
      if (response.status === 404) return base;
      if (!response.ok) throw Error("daily_read_failed");
      const body = await response.json();
      if (body.account_key !== account.key || body.platform !== account.platform || body.date !== date)
        throw Error("daily_binding_mismatch");
      if (!body.record) return { ...base, status: "no_data", unavailable_reason: "today_record_missing" };
      const record = body.record;
      if (record.business_date !== date || record.target_key !== matches[0].target_key)
        throw Error("daily_record_mismatch");
      const incomplete = record.completeness !== "complete" || body.read_error_count > 0 || body.unmatched_count > 0 || record.conflict_count > 0;
      return { ...base, status: body.data_status !== "fresh" ? "stale" : incomplete ? "partial" : "ok",
        unavailable_reason: body.data_status !== "fresh" ? "runtime_daily_stale" : incomplete ? "runtime_daily_incomplete" : null,
        as_of: record.observed_at, activity: record.status,
        run_status_reason: typeof record.block_reason_code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(record.block_reason_code) ? record.block_reason_code : null,
        completeness: incomplete ? "incomplete" : "complete",
        run_count: record.runs.length,
        runs: record.runs.map(run => ({ id: run.run_id, started_at: run.started_at,
          finished_at: run.finished_at, activity: run.activity,
          execution_lane: run.execution_lane, errors_present: run.errors_present, ...(run.issue ? { issue: run.issue } : {}) })),
      };
    } catch {
      return { ...base, status: "read_failed", unavailable_reason: "stored_records_unreadable" };
    }
  }));
  for (const row of rows) {
    row.run_status = runStatus(row);
    // Missing public execution block reasons stay unknown.
    row.run_status_reason ??= null;
  }
  return { status: rows.some(r => r.status === "read_failed") ? "read_failed"
    : rows.some(r => r.status !== "ok") ? "partial" : "ok",
    date, timezone: RUNTIME_DAILY_TIMEZONE, as_of: rows.map(r => r.as_of).filter(Boolean).sort()[0] || null,
    accounts: rows, counts: { configured: rows.length, by_state: runStateCounts(rows),
      observed: rows.filter(r => r.run_count !== null).length,
      runs: rows.some(r => r.run_count === null || r.completeness !== "complete") ? null : rows.reduce((n, r) => n + r.run_count, 0) },
    coverage: "configured_accounts_existing_bound_daily_records", ...READ_ONLY };
}
export async function strategySummary(request, env, deps, accounts, currentStrategies = {}) {
  const profiles = await deps.profiles(env);
  const response = await deps.health(request, env);
  if (!response.ok) throw Error("strategy_health_read_failed");
  const health = await response.json();
  const invalid = (health.errors || []).some(e => /invalid|unreadable|failed/.test(e));
  const status = invalid ? "read_failed" : health.data_status === "ready" ? "ok"
    : health.data_status === "stale" ? "stale" : "not_connected";
  const strategies = profiles.map(profile => {
      const observation = (health.strategies || []).find(s => s.profile === profile.profile);
      const rowStatus = observation && status === "ok" && observation.freshness?.status === "stale"
        ? "stale" : observation ? status : status === "read_failed" ? status : "not_connected";
      return { profile: profile.profile, domain: profile.domain,
        allowed_execution_modes: profile.allowed_execution_modes || [],
        configured_accounts: accounts.filter(a => currentStrategies[a.platform]?.[a.key]?.strategy_profile === profile.profile)
          .map(a => ({ account_alias: a.key, platform: a.platform, account_ref: `${a.platform}:${a.key}`,
            ...configuredStrategyExecution(currentStrategies[a.platform][a.key], profile, a.platform),
            execution_evidence: currentStrategies[a.platform][a.key].execution_evidence })),
        health_status: status === "ok" || status === "stale" ? observation?.status || null : null,
        health_score: status === "ok" || status === "stale" ? observation?.score ?? null : null,
        as_of: observation?.as_of || null,
        freshness: observation?.freshness || null,
        status: rowStatus,
        unavailable_reason: rowStatus === "stale" ? "strategy_health_stale"
          : observation && status !== "read_failed" ? null : invalid
          ? "stored_records_unreadable" : "strategy_health_not_connected" };
    });
  const assignmentFailures = accounts.flatMap(account => {
    const readStatus = currentStrategies[account.platform]?.[account.key]?.execution_evidence?.status;
    return ["read_failed", "permission_denied"].includes(readStatus)
      ? [{ platform: account.platform, account_alias: account.key, status: readStatus }] : [];
  });
  return { status: status === "read_failed" ? "read_failed"
      : assignmentFailures.length || status === "ok" && strategies.some(row => row.status !== "ok") ? "partial" : status,
    account_assignment_read_failures: assignmentFailures,
    configured_accounts_source: "currentStrategies",
    account_assignment_status: assignmentFailures.length ? "read_failed" : accounts.every(a => currentStrategies[a.platform]?.[a.key]?.strategy_profile) ? "complete"
      : accounts.some(a => currentStrategies[a.platform]?.[a.key]?.strategy_profile) ? "partial" : "unavailable",
    as_of: health.computed_at || health.generated_at || null,
    coverage: "configured_catalog_and_stored_health_not_runtime_deployment", strategies, ...READ_ONLY };
}
export function notificationLog(env = {}, deps = {}) {
  return deps.notificationReceipts ? deps.notificationReceipts(env) : {
    status: "not_connected", unavailable_reason: "notification_log_not_connected",
    read_status: "not_connected", read_reason_codes: ["notification_log_not_connected"],
    as_of: null, items: [], next_cursor: null, coverage: "no_delivery_source", ...READ_ONLY,
  };
}
