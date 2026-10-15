/** Read-only page projections. Missing observations never imply a successful run. */
export const READ_ONLY = { no_order: true, execution_authority_granted: false };
export function businessDate(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}
export async function todaySummary(request, env, deps, accounts, now = Date.now()) {
  const date = businessDate(now);
  const bindings = await deps.dailyBindings(env);
  const rows = await Promise.all(accounts.map(async (account) => {
    const base = { account_alias: account.key, platform: account.platform,
      status: "not_connected", unavailable_reason: "runtime_daily_not_connected",
      as_of: null, activity: null, run_count: null, runs: [] };
    const matches = bindings.filter(b => b.platform === account.platform && b.account_key === account.key && b.status === "bound");
    if (matches.length !== 1) return base;
    const url = new URL("/api/runtime-daily", request.url);
    url.searchParams.set("date", date);
    url.searchParams.set("platform", account.platform);
    url.searchParams.set("account_key", account.key);
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
      return { ...base, status: body.data_status === "fresh" ? "ok" : "stale",
        unavailable_reason: body.data_status === "fresh" ? null : "runtime_daily_stale",
        as_of: record.observed_at, activity: record.status,
        run_count: record.runs.length,
        runs: record.runs.map(run => ({ id: run.run_id, started_at: run.started_at,
          finished_at: run.finished_at, activity: run.activity,
          execution_lane: run.execution_lane, errors_present: run.errors_present })),
      };
    } catch {
      return { ...base, status: "read_failed", unavailable_reason: "stored_records_unreadable" };
    }
  }));
  return { status: rows.some(r => r.status === "read_failed") ? "read_failed"
    : rows.some(r => r.status !== "ok") ? "partial" : "ok",
    date, timezone: "Asia/Shanghai", as_of: rows.map(r => r.as_of).filter(Boolean).sort()[0] || null,
    accounts: rows, counts: { configured: rows.length,
      observed: rows.filter(r => r.run_count !== null).length,
      runs: rows.some(r => r.run_count === null) ? null : rows.reduce((n, r) => n + r.run_count, 0) },
    coverage: "configured_accounts_existing_bound_daily_records", ...READ_ONLY };
}
export async function strategySummary(request, env, deps, accounts) {
  const profiles = await deps.profiles(env);
  const response = await deps.health(request, env);
  if (!response.ok) throw Error("strategy_health_read_failed");
  const health = await response.json();
  const invalid = (health.errors || []).some(e => /invalid|unreadable|failed/.test(e));
  const status = invalid ? "read_failed" : health.data_status === "ready" ? "ok"
    : health.data_status === "stale" ? "stale" : "not_connected";
  const strategies = profiles.map(profile => {
      const observation = (health.strategies || []).find(s => s.profile === profile.profile);
      return { profile: profile.profile, domain: profile.domain,
        allowed_execution_modes: profile.allowed_execution_modes || [],
        configured_accounts: accounts.filter(a => a.default_strategy_profile === profile.profile)
          .map(a => ({ account_alias: a.key, platform: a.platform })),
        health_status: status === "ok" || status === "stale" ? observation?.status || null : null,
        health_score: status === "ok" || status === "stale" ? observation?.score ?? null : null,
        status: observation ? status : status === "read_failed" ? status : "not_connected",
        unavailable_reason: observation && status !== "read_failed" ? null : invalid
          ? "stored_records_unreadable" : "strategy_health_not_connected" };
    });
  return { status: status === "ok" && strategies.some(row => row.status !== "ok") ? "partial" : status,
    as_of: health.computed_at || health.generated_at || null,
    coverage: "configured_catalog_and_stored_health_not_runtime_deployment", strategies, ...READ_ONLY };
}
export function notificationLog() {
  // There is no stored delivery source in this console. Queue intent is not delivery.
  return { status: "not_connected", unavailable_reason: "notification_log_not_connected",
    as_of: null, items: [], next_cursor: null, coverage: "no_delivery_source", ...READ_ONLY };
}
