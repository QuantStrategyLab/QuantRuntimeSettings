// N1 §4.B: GET /api/desk/ribbon[?date=YYYY-MM-DD] (qsl.desk.ribbon.v2).
//
// The ribbon date is a UTC day, a Desk display slice only. Runs come from the
// existing stored runtime-daily records, whose business day stays
// America/New_York; a UTC day spans at most two NY business days, and only
// those are read. Tape entries are placed by their stored instant. Nothing
// here triggers a collection, readback job or provider request.
//
// Activity → tape mapping (docs/desk-n1-read-projection-contract.md):
//   finished_at instant present → state "done", otherwise "unknown";
//   runtimeDailyRunIssue(run) === "failure" → outcome "error";
//   unconfirmed runs → outcome null (never "filled" from a transport acceptance);
//   confirmed "filled" → "filled"; confirmed no_submission/no_signal/no_rebalance → "no_op".
import { runtimeDailyRunIssue, RUNTIME_DAILY_TIMEZONE } from "../../runtime_daily_contract.js";
import { DeskError } from "./http.js";
import { readbackTargets } from "./readback.js";
import {
  coverage, freshness, known, n1Response, n1Route, notSupported, partial, readOnce, stale, timeBasis,
  unknown, utcDay, utcInstant, validDate, zonedDate,
} from "./n1.js";

const LABELS = { ibkr: "IBKR", schwab: "Schwab", longbridge: "LongBridge", binance: "Binance", firstrade: "Firstrade" };
const TAPE_LIMIT = 100;
export const RIBBON_STALE_SECONDS = 36 * 60 * 60;
const NO_OP = new Set(["no_submission", "no_signal", "no_rebalance"]);

export function platformLabel(platform) {
  return LABELS[platform] || platform.charAt(0).toUpperCase() + platform.slice(1);
}

/** Configured accounts in the shape the existing runtime-daily reader expects. */
export function configuredAccounts(config) {
  return readbackTargets(config).map(target => ({ ...target.config, platform: target.platform, key: target.key, target_id: target.id }));
}

/** The NY business dates a UTC day can overlap, oldest first, never beyond NY today. */
export function ribbonBusinessDates(date, now) {
  const first = zonedDate(Date.parse(`${date}T00:00:00Z`), RUNTIME_DAILY_TIMEZONE);
  const last = zonedDate(Date.parse(`${date}T23:59:59Z`), RUNTIME_DAILY_TIMEZONE);
  const today = zonedDate(now, RUNTIME_DAILY_TIMEZONE);
  return [...new Set([first, last])].filter(day => day <= today);
}

export function tapeOutcome(run) {
  const issue = runtimeDailyRunIssue(run);
  if (issue === "failure") return "error";
  if (issue !== null) return null;
  if (run.activity === "filled") return "filled";
  return NO_OP.has(run.activity) ? "no_op" : null;
}

/** Fully read stored record: fresh or stale, but always complete; or a verified weekend. */
export function runRowCovered(row) {
  return (["ok", "stale"].includes(row?.status) && row.completeness === "complete")
    || (row?.status === "no_data" && row.unavailable_reason === "non_trading_weekend");
}


/**
 * Pure tape projection. `days` holds one stored-reader summary per business date
 * (null when that read failed). Coverage counts configured accounts whose every
 * relevant business day was read completely.
 */
export function ribbonTape({ days, accounts, date, readAt }) {
  const total = accounts.length;
  if (total === 0) return { tape: known([], readAt, coverage("verified_empty", 0, 0)), observed: [], stale: false };
  if (!days.length) {
    // The UTC day has not reached any NY business day yet: nothing can have run.
    return { tape: known([], readAt, coverage("verified_empty", total, total)), observed: [], stale: false };
  }
  const entries = [];
  const observed = [];
  let anyStale = false;
  let anyFailure = false;
  let undated = false;
  const coveredAccounts = new Set(accounts.map(account => account.target_id));
  for (const day of days) {
    if (!day.summary) {
      anyFailure = true;
      coveredAccounts.clear();
      continue;
    }
    for (const account of accounts) {
      const row = (day.summary.accounts || []).find(item => item.platform === account.platform && item.account_alias === account.key);
      if (!row) { coveredAccounts.delete(account.target_id); continue; }
      if (row.status === "read_failed") anyFailure = true;
      if (!runRowCovered(row)) coveredAccounts.delete(account.target_id);
      if (row.status === "stale") anyStale = true;
      if (row.as_of && (runRowCovered(row) || row.status === "partial")) observed.push(row.as_of);
      for (const run of Array.isArray(row.runs) ? row.runs : []) {
        const at = utcInstant(run.started_at);
        if (at === null) { undated = true; continue; }
        if (at.slice(0, 10) !== date) continue;
        const done = utcInstant(run.finished_at) !== null;
        entries.push({
          id: `${account.target_id}#${String(run.id ?? "").slice(0, 80)}`,
          at,
          target_id: account.target_id,
          label: platformLabel(account.platform),
          kind: "runtime_run",
          outcome: done ? tapeOutcome(run) : null,
          outcome_detail: null,
          state: done ? "done" : "unknown",
          source_business_date: day.date,
          source_timezone: RUNTIME_DAILY_TIMEZONE,
        });
      }
    }
  }
  entries.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const truncated = entries.length > TAPE_LIMIT;
  const value = truncated ? entries.slice(-TAPE_LIMIT) : entries;
  const included = coveredAccounts.size;
  const reasons = [];
  if (included < total) reasons.push(anyFailure ? "read_failed" : "coverage_incomplete");
  if (undated) reasons.push("time_basis_unavailable");
  if (truncated && !reasons.includes("coverage_incomplete")) reasons.push("coverage_incomplete");
  const observedAt = observed.map(utcInstant).filter(Boolean).sort()[0] ?? readAt;
  let tape;
  if (included === total && !undated && !truncated) {
    const cover = coverage(value.length ? "complete" : "verified_empty", included, total);
    tape = anyStale ? stale(value, observedAt, readAt, cover) : known(value, observedAt, cover);
  } else if (value.length === 0 && included === 0) {
    tape = unknown(anyFailure ? "read_failed" : "source_unavailable", coverage("unavailable", 0, total, reasons));
  } else {
    tape = partial(value, observedAt, coverage("partial", included, total, reasons));
  }
  return { tape, observed, stale: anyStale };
}

export function ribbonDate(url, now) {
  const values = url.searchParams.getAll("date");
  if ([...url.searchParams.keys()].some(key => key !== "date") || values.length > 1) throw new DeskError("invalid_query", 400);
  if (!values.length) return utcDay(now);
  if (!validDate(values[0]) || values[0] > utcDay(now)) throw new DeskError("invalid_date", 400);
  return values[0];
}

export async function ribbonProjection(request, env, deps, { date, now, config }) {
  const accounts = configuredAccounts(config);
  const dates = ribbonBusinessDates(date, now);
  const days = [];
  for (const businessDate of dates) {
    const read = await readOnce(() => deps.runtimeDay(request, env, accounts, businessDate));
    days.push({ date: businessDate, summary: read.ok && read.value && Array.isArray(read.value.accounts) ? read.value : null });
  }
  const result = ribbonTape({ days, accounts, date, readAt: now });
  return {
    date,
    date_basis: "utc_day",
    freshness: freshness(result.observed, { now, ttlSeconds: RIBBON_STALE_SECONDS, staleKnown: result.stale }),
    console_state: {
      // No single trusted global runtime mode source exists (N1 default).
      mode: notSupported(),
      gateways: { status: "unknown", reason: "not_supported" },
    },
    // No alerts store exists: unknown, never zero.
    alert_badge: notSupported(),
    sessions: ["US", "HK", "CN"].map(market => ({ market, state: "unknown", open_utc: null, close_utc: null, next_change_at: null, holiday: null })),
    // No verified schedule source is read here; "no next run" is never inferred.
    next_run: unknown("source_unavailable", coverage("unavailable", 0, null, ["source_unavailable"])),
    tape: result.tape,
  };
}

export async function deskRibbonResponse(request, env, deps) {
  return n1Route(request, env, deps, async (url) => {
    const now = deps.now();
    const date = ribbonDate(url, now);
    const config = await readOnce(() => deps.options(env));
    let body;
    if (!config.ok || !config.value?.options || typeof config.value.options !== "object") {
      body = {
        date, date_basis: "utc_day", freshness: { data_status: "unavailable", age_seconds: null },
        console_state: { mode: notSupported(), gateways: { status: "unknown", reason: "not_supported" } },
        alert_badge: notSupported(),
        sessions: ["US", "HK", "CN"].map(market => ({ market, state: "unknown", open_utc: null, close_utc: null, next_change_at: null, holiday: null })),
        next_run: unknown("source_unavailable", coverage("unavailable", 0, null, ["source_unavailable"])),
        tape: unknown("read_failed", coverage("unavailable", 0, null, ["read_failed"])),
      };
    } else {
      body = await ribbonProjection(request, env, deps, { date, now, config: config.value });
    }
    return n1Response("ribbon", {
      time_basis: timeBasis("UTC", [["runtime_daily", RUNTIME_DAILY_TIMEZONE]]),
      ...body,
    }, { now });
  });
}
