// N1 §4.E: GET /api/desk/overview (qsl.desk.overview.v2).
//
// Composed from the same internal read projections as the accounts, ribbon and
// performance routes (no HTTP fan-out): stored account facts, stored daily
// history, the stored runtime-daily records for the current New York business
// day and the stored credential-maintenance record. There is no server FX
// aggregation: only a single-currency, identity-verified, complete cohort gets
// a combined NAV. Missing sources stay unknown; empty lists are never offered
// as "nothing to do" or "no accounts".
import { RUNTIME_DAILY_TIMEZONE } from "../../runtime_daily_contract.js";
import {
  FACTS_STALE_SECONDS, factsObservedAt, factsRowFor, maskedAccount, platformLabel, readConfig, readCredential, readFactsModel,
} from "./accounts.js";
import { DeskError } from "./http.js";
import { readPerformance } from "./performance.js";
import { readbackTargets } from "./readback.js";
import { configuredAccounts, tapeOutcome } from "./ribbon.js";
import {
  coverage, freshness, known, n1Response, n1Route, notSupported, partial, readOnce, stale, timeBasis, unknown, utcInstant, zonedDate,
} from "./n1.js";

const OVERVIEW_RANGE = "6M";
const nonPaper = (target, row) => target.config?.broker_environment !== "paper" && target.config?.account_scope !== "paper"
  && row?.broker_environment !== "paper" && row?.account_scope !== "paper";
const legacyUnknown = (reason) => ({ status: "unknown", reason });
const RUN_COVERED = new Set(["ok", "stale"]);
// A stale record still counts only when its source coverage is complete.
const runCovered = (row) => Boolean(row) && RUN_COVERED.has(row.status) && row.completeness === "complete";

/** v1 Nav from one stored snapshot; several balances or a missing one stay unknown. */
export function bookNav(row, facts, now) {
  if (!facts.ok) return legacyUnknown("read_failed");
  if (!row) return legacyUnknown("source_unavailable");
  if (row.binding_status !== "bound" || row.identity_mismatch) return legacyUnknown("identity_unverified");
  const at = factsObservedAt(row);
  if (at === null) return legacyUnknown("source_unavailable");
  const balances = Array.isArray(row.balances) ? row.balances : [];
  if (balances.length !== 1 || typeof balances[0].net_assets !== "string" || typeof balances[0].currency !== "string") {
    return legacyUnknown("not_supported");
  }
  const { currency, net_assets: amount } = balances[0];
  const base = { currency, amount, usd: currency === "USD" ? amount : null, observed_at: at };
  if (row.data_status === "stale") {
    return { status: "stale", ...base, age_seconds: Math.max(0, Math.floor((Number(now) - Date.parse(at)) / 1000)) };
  }
  return { status: "known", ...base };
}

/**
 * The latest finished run for one target as an N1 read. Known null only when the
 * stored daily record was read completely and holds no finished run; a failed,
 * missing, unbound or incomplete record stays unknown, never "no run".
 */
export function lastRun(summary, summaryRow, now) {
  if (!summary) return unknown("read_failed", coverage("unavailable", 0, 1, ["read_failed"]));
  if (!runCovered(summaryRow)) {
    const reason = summaryRow?.status === "read_failed" ? "read_failed" : "source_unavailable";
    return unknown(reason, coverage("unavailable", 0, 1, [reason]));
  }
  const finished = (summaryRow.runs || []).map(run => ({ run, at: utcInstant(run.finished_at) })).filter(item => item.at !== null);
  finished.sort((a, b) => a.at.localeCompare(b.at));
  const latest = finished.at(-1);
  const observedAt = utcInstant(summaryRow.as_of) ?? now;
  const value = latest ? { at: latest.at, outcome: tapeOutcome(latest.run) } : null;
  const cover = coverage("complete", 1, 1);
  return summaryRow.status === "stale" ? stale(value, observedAt, now, cover) : known(value, observedAt, cover);
}

function summaryRowFor(summary, target) {
  const rows = Array.isArray(summary?.accounts) ? summary.accounts : [];
  const matches = rows.filter(row => row.platform === target.platform && row.account_alias === target.key);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Runs today, in the runtime-daily source business day (America/New_York).
 * No verified schedule source exists, so `expected` and `pending` stay null and
 * the read is never more than partial; `done` counts only covered accounts.
 */
export function runsToday({ targets, summary, businessDate, now }) {
  const source = { source_business_date: businessDate, source_timezone: RUNTIME_DAILY_TIMEZONE };
  if (!targets.length) return known({ done: 0, expected: 0, pending: [], ...source }, now, coverage("verified_empty", 0, 0));
  if (!summary) return unknown("read_failed", coverage("unavailable", 0, targets.length, ["read_failed"]));
  const covered = targets.map(target => summaryRowFor(summary, target)).filter(runCovered);
  if (!covered.length) return unknown("source_unavailable", coverage("unavailable", 0, targets.length, ["source_unavailable"]));
  const done = covered.reduce((count, row) => count + (row.runs || []).filter(run => utcInstant(run.finished_at) !== null).length, 0);
  const times = covered.map(row => utcInstant(row.as_of)).filter(Boolean).sort();
  const reasons = ["not_supported", ...(covered.length < targets.length ? ["coverage_incomplete"] : [])];
  return partial({ done, expected: null, pending: null, ...source }, times[0] ?? null,
    coverage("partial", covered.length, targets.length, reasons));
}

const EXCLUDED = {
  physical_identity_unverified: "physical_identity_unverified",
  coverage_incomplete: "coverage_incomplete",
  duplicate_account_mapping: "coverage_incomplete",
  no_non_paper_accounts: "no_non_paper_accounts",
};

/** Totals from the existing account-facts aggregation; no FX and no partial sums. */
export function overviewTotals({ targets, facts, now }) {
  const cohort = targets.filter(target => nonPaper(target, facts.ok ? factsRowFor(facts.model, target) : null));
  const total = cohort.length;
  const included = facts.ok ? cohort.filter(target => {
    const row = factsRowFor(facts.model, target);
    return row?.binding_status === "bound" && row.data_status === "fresh" && factsObservedAt(row) !== null;
  }).length : 0;
  const base = {
    fx: { status: "unknown", reason: "not_supported" },
    nav: null, day_change: null, drawdown: null, gross_exposure_ratio: null, leveraged_etf_exposure_ratio: null,
  };
  if (!facts.ok) {
    return { reporting: "USD", totals: { ...base, status: "unavailable", excluded_reasons: ["coverage_incomplete"],
      coverage: coverage("unavailable", 0, total || null, ["read_failed"]) } };
  }
  const aggregate = facts.model.totals || { status: "unavailable", reason: "coverage_incomplete", by_currency: [] };
  if (aggregate.status === "by_currency" && aggregate.by_currency.length === 1 && included === total && total > 0) {
    return { reporting: aggregate.by_currency[0].currency, totals: { ...base, status: "complete", excluded_reasons: [],
      nav: aggregate.by_currency[0].net_assets, coverage: coverage("complete", included, total) } };
  }
  if (aggregate.status === "by_currency" && aggregate.by_currency.length > 1) {
    // Display-only USD convention: no converted value is claimed.
    return { reporting: "USD", totals: { ...base, status: "unavailable", excluded_reasons: ["fx_unavailable"],
      coverage: coverage("unavailable", 0, total, ["mixed_currency"]) } };
  }
  if (total === 0) {
    return { reporting: "USD", totals: { ...base, status: "unavailable", excluded_reasons: ["no_non_paper_accounts"],
      coverage: coverage("verified_empty", 0, 0) } };
  }
  const excluded = EXCLUDED[aggregate.reason] || "coverage_incomplete";
  return { reporting: "USD", totals: { ...base, status: included > 0 ? "partial" : "unavailable", excluded_reasons: [excluded],
    coverage: coverage(included > 0 ? "partial" : "unavailable", included, total,
      [excluded === "physical_identity_unverified" ? "identity_unverified" : "coverage_incomplete"]) } };
}

const SEVERITY = { expired: "critical", 1: "critical", 7: "warning", 30: "info" };

/** Needs-you items from stored sources read here; pending decisions are not read, so the list is partial. */
export function needsYou(credential, now) {
  if (!credential.ok) return unknown("read_failed", coverage("unavailable", 0, null, ["read_failed"]));
  const items = credential.item.requires_action ? [{
    id: "credential:ibkr:flex_token",
    kind: "credential_expiring",
    severity: SEVERITY[credential.item.phase] || "warning",
    target_id: null,
    // Dictionary keys: the Desk translates title, detail and action label.
    title: "overview.needs.credential.title",
    detail: credential.item.expiry.status === "known" ? "overview.needs.credential.detail_known" : "overview.needs.credential.detail_unknown",
    action: { label: "overview.needs.credential.action", route: "#/desk/accounts?tab=credentials" },
  }] : [];
  return partial(items, now, coverage("partial", 1, null, ["not_supported"]));
}

function equityCurve(performance) {
  const equity = performance.equity;
  if (equity.status === "unknown") return equity;
  const value = {
    range: performance.range,
    portfolio: { dates: equity.value.dates, indexed: equity.value.portfolio_indexed },
    drawdown: equity.value.drawdown_ratio,
    history_starts: performance.history.first_date,
    return_basis: performance.return_basis.kind,
  };
  return { ...equity, value };
}

export function overviewProjection({ config, facts, credential, summary, businessDate, performance, now }) {
  if (!config.ok) {
    const failed = unknown("read_failed", coverage("unavailable", 0, null, ["read_failed"]));
    return {
      snapshot_at: null, freshness: { data_status: "unavailable", age_seconds: null }, reporting_currency: "USD",
      totals: {
        status: "unavailable", excluded_reasons: ["coverage_incomplete"], coverage: coverage("unavailable", 0, null, ["read_failed"]),
        fx: { status: "unknown", reason: "not_supported" }, nav: null, day_change: null, drawdown: null,
        gross_exposure_ratio: null, leveraged_etf_exposure_ratio: null,
        runs_today: failed, config_drift: failed, data_age_seconds: null,
      },
      book: failed, equity_curve: equityCurve(performance), needs_you: needsYou(credential, now),
    };
  }
  const targets = readbackTargets(config.value);
  const { reporting, totals } = overviewTotals({ targets, facts, now });
  const includedTimes = facts.ok ? targets.map(target => factsRowFor(facts.model, target))
    .filter(row => row?.data_status === "fresh" || row?.data_status === "stale").map(factsObservedAt).filter(Boolean) : [];
  const fresh = totals.coverage.included > 0 && includedTimes.length
    ? freshness(includedTimes, { now, ttlSeconds: FACTS_STALE_SECONDS }) : { data_status: "unavailable", age_seconds: null };
  const rows = targets.map(target => {
    const label = platformLabel(target.platform);
    const row = facts.ok ? factsRowFor(facts.model, target) : null;
    return {
      target_id: target.id,
      platform: target.platform,
      platform_label: label,
      ...maskedAccount(target.config, label),
      // Configuration is not evidence of the running strategy, mode or runtime.
      strategy: legacyUnknown("never_read"),
      mode: legacyUnknown("not_supported"),
      runtime: legacyUnknown("not_supported"),
      nav: bookNav(row, facts, now),
      day_change: null,
      sparkline_30d: { points: [], dates_from: null, dates_to: null, gap_dates: [] },
      drawdown: { ratio: null, limit_ratio: null, state: "unknown" },
      config: { state: "unknown", drift_count: unknown("not_supported", coverage("unavailable", 0, 1, ["not_supported"])), checked_at: null },
      last_run: lastRun(summary, summaryRowFor(summary, target), now),
      return_basis: "unavailable",
    };
  });
  const book = rows.length ? known(rows, now, coverage("complete", rows.length, rows.length)) : known([], now, coverage("verified_empty", 0, 0));
  return {
    snapshot_at: includedTimes.sort()[0] ?? null,
    freshness: fresh,
    reporting_currency: reporting,
    totals: {
      ...totals,
      runs_today: runsToday({ targets, summary, businessDate, now }),
      // Drift needs a stored, identity-bound readback comparison; none is read here.
      config_drift: unknown("not_supported", coverage("unavailable", 0, targets.length, ["not_supported"])),
      data_age_seconds: fresh.age_seconds,
    },
    book,
    equity_curve: equityCurve(performance),
    needs_you: needsYou(credential, now),
  };
}

export async function deskOverviewResponse(request, env, deps) {
  return n1Route(request, env, deps, async (url) => {
    if ([...url.searchParams.keys()].length) throw new DeskError("invalid_query", 400);
    const now = deps.now();
    const config = await readConfig(env, deps);
    const facts = await readFactsModel(env, deps, config, now);
    const credential = await readCredential(env, deps);
    const businessDate = zonedDate(now, RUNTIME_DAILY_TIMEZONE);
    let summary = null;
    if (config.ok) {
      const read = await readOnce(() => deps.runtimeDay(request, env, configuredAccounts(config.value), businessDate));
      summary = read.ok && read.value && Array.isArray(read.value.accounts) ? read.value : null;
    }
    const performance = await readPerformance(env, deps, { range: OVERVIEW_RANGE, now, config, facts });
    return n1Response("overview", {
      time_basis: timeBasis("UTC", [
        ["account_facts", "UTC"], ["account_facts_history", "Asia/Shanghai"], ["runtime_daily", RUNTIME_DAILY_TIMEZONE],
      ]),
      ...overviewProjection({ config, facts, credential, summary, businessDate, performance, now }),
    }, { now });
  });
}
