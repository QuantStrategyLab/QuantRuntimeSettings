// N1 §4.D: GET /api/desk/performance[?range=&scope=] (qsl.desk.performance.v2).
//
// Minimum set: the requested window, real stored-history coverage, the return
// basis per target and a portfolio curve only for a qualified cohort. Sources
// are the stored account-facts snapshots (`account_facts_list`) and stored
// daily history (`account_facts_history_read`) through the existing pure
// builders. A curve needs identity-bound, single-currency, complete-cohort
// history with known external cash flows; asset change is never presented as
// a time-weighted return. Sharpe/Sortino/volatility/benchmark spread,
// scorecard, contribution and monthly cells are not computed here.
import {
  ACCOUNT_FACTS_HISTORY_MAX_DAYS, FIRSTRADE_ACCOUNT_FACTS_PLATFORM, SCHWAB_ACCOUNT_FACTS_PLATFORM,
  buildAccountFactsHistoryReadModel, projectAccountFactsHistoryCurrencies,
} from "../../account_facts.js";
import { aggregateEquity, chainReturns, cleanPoints, dateMs, isAggregateAssetAccount, rangeStart } from "../../performance_math.js";
import { factsRowFor, readConfig, readFactsModel } from "./accounts.js";
import { DeskError } from "./http.js";
import { readbackTargets } from "./readback.js";
import {
  coverage, known, n1Response, n1Route, notSupported, partial, readOnce, stale, timeBasis, unknown, utcInstant, zonedDate,
} from "./n1.js";

export const PERFORMANCE_TIMEZONE = "Asia/Shanghai";
export const N1_RANGES = Object.freeze(["1M", "3M", "6M", "YTD", "1Y", "ALL"]);
export const DEFAULT_RANGE = "6M";
const STALE_DAYS = 3;
const DAY_MS = 86_400_000;
const NUMBER = (value) => typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;

/** Fixed decimal text; never exponent notation, never "-0". */
export function decimal(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const text = value.toFixed(digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return text === "-0" ? "0" : text;
}

/** Query: range (default 6M) and scope (all only). Anything else is rejected. */
export function performanceQuery(url) {
  const keys = [...url.searchParams.keys()];
  if (keys.some(key => !["range", "scope", "target_id"].includes(key))
      || ["range", "scope", "target_id"].some(key => url.searchParams.getAll(key).length > 1)) {
    throw new DeskError("invalid_query", 400);
  }
  const range = url.searchParams.get("range") ?? DEFAULT_RANGE;
  const scope = url.searchParams.get("scope") ?? "all";
  if (!N1_RANGES.includes(range)) throw new DeskError("invalid_range", 400);
  if (scope === "strategy") throw new DeskError("scope_not_supported", 422);
  if (scope !== "all" || url.searchParams.has("target_id")) throw new DeskError("invalid_scope", 400);
  return { range, scope };
}

/** Closed window [start, end] in the history's own date domain; ALL starts at the first stored date. */
export function performanceWindow(range, end, firstDate) {
  if (range === "ALL") return { start: firstDate, end };
  return { start: rangeStart(range.toLowerCase(), end), end };
}

/** The existing `account_facts_history_read` command for one bound account. */
export function historyCommand(binding) {
  return {
    action: "account_facts_history_read",
    platform: binding.platform,
    account_key: binding.account_key,
    account_scope: binding.account_scope,
    account_selector: binding.account_selector,
    ...(binding.platform === SCHWAB_ACCOUNT_FACTS_PLATFORM ? { broker_account_hash: binding.broker_account_hash } : {}),
    ...(binding.platform === FIRSTRADE_ACCOUNT_FACTS_PLATFORM ? { broker_account_id: binding.broker_account_id } : {}),
    target_id: binding.target_id,
    source_binding_id: binding.source_binding.id,
    ...(binding.history_source_binding_ids ? { history_source_binding_ids: binding.history_source_binding_ids } : {}),
  };
}

/**
 * Cohort members and their stored daily series. Binance wallet history and
 * unbound/unreadable accounts are not covered by this read path; they make the
 * cohort incomplete instead of silently shrinking it.
 */
export async function readCohortHistories(env, deps, { config, facts }) {
  const targets = readbackTargets(config.value);
  const members = [];
  for (const target of targets) {
    const row = facts.ok ? factsRowFor(facts.model, target) : null;
    if (!isAggregateAssetAccount({ brokerEnvironment: target.config?.broker_environment ?? null, facts: row })) continue;
    const member = { target_id: target.id, platform: target.platform, key: target.key, series: [], failure: null, truncated: false };
    members.push(member);
    if (target.platform === "binance") { member.failure = "not_supported"; continue; }
    if (!facts.ok) { member.failure = "read_failed"; continue; }
    const bindings = (facts.bindings?.bindings || []).filter(item => item.platform === target.platform && item.account_key === target.key);
    if (!row || row.binding_status !== "bound" || row.identity_mismatch || bindings.length !== 1) {
      member.failure = "identity_unverified";
      continue;
    }
    const binding = bindings[0];
    const listed = await readOnce(() => deps.command(env, historyCommand(binding)));
    if (!listed.ok || listed.value?.ok !== true || !Array.isArray(listed.value.days)) { member.failure = "read_failed"; continue; }
    const days = listed.value.days;
    for (const currency of projectAccountFactsHistoryCurrencies({ days, binding })) {
      const model = buildAccountFactsHistoryReadModel({
        platform: target.platform, accountKey: target.key, currency, option: target.config, binding, days,
      });
      if (model.identity_mismatch || model.binding_status !== "bound") { member.failure = "identity_unverified"; break; }
      member.truncated ||= model.series?.truncated === true;
      member.series.push({
        currency,
        // The stored snapshot carries no qualified external cash flow: unknown, never zero.
        points: (model.series?.points || []).flatMap(point => NUMBER(point.net_assets) === null || point.currency !== currency ? []
          : [{ date: point.observation_date, value: NUMBER(point.net_assets), externalFlow: null,
            observed_at: utcInstant(point.observed_finished_at) }]),
      });
    }
  }
  return members;
}

function businessAge(lastDate, end) {
  return Math.round((dateMs(end) - dateMs(lastDate)) / DAY_MS);
}

/**
 * Pure performance projection over cohort member series. `members` entries carry
 * `{target_id, failure, truncated, series:[{currency, points:[{date,value,externalFlow}]}]}`.
 */
export function performanceProjection({ members, range, end, now, readable = true }) {
  const unknownAll = (reason) => unknown(reason, coverage("unavailable", 0, null, [reason]));
  const allPoints = members.flatMap(member => member.series.flatMap(series => series.points));
  const firstDate = cleanPoints(allPoints.map(point => ({ date: point.date, value: 0 })))[0]?.date ?? null;
  const window = performanceWindow(range, end, firstDate);
  const anyTruncated = members.some(member => member.truncated);
  const truncatedBy = firstDate && window.start && window.start < firstDate ? (anyTruncated ? "retention" : "inception") : null;
  const history = {
    first_date: firstDate,
    requested_from: window.start,
    truncated_by: truncatedBy,
    retention_days: ACCOUNT_FACTS_HISTORY_MAX_DAYS,
  };
  const perTarget = {};
  for (const member of members) {
    perTarget[member.target_id] = !member.failure && member.series.some(series => series.points.length)
      ? "nav_change_unadjusted" : "unavailable";
  }
  const bases = [...new Set(Object.values(perTarget))];
  const returnBasis = { kind: bases.length === 1 ? bases[0] : bases.length ? "mixed" : "unavailable", per_target: perTarget };

  const total = members.length;
  const failed = members.filter(member => member.failure);
  const included = total - failed.length;
  const currencies = [...new Set(members.flatMap(member => member.series.filter(series => series.points.length).map(series => series.currency)))];
  const failureReasons = [...new Set(failed.map(member => member.failure))];
  const cohortCover = (reasons) => coverage(included > 0 ? "partial" : "unavailable", included, total, reasons);
  let equity;
  let qualified = null;
  if (!readable) equity = unknownAll("read_failed");
  else if (total === 0) equity = unknown("insufficient_history", coverage("unavailable", 0, 0, ["insufficient_history"]));
  else if (failed.length) {
    equity = unknown(failureReasons.length === 1 && failureReasons[0] !== "not_supported" ? failureReasons[0] : "coverage_incomplete",
      cohortCover(["coverage_incomplete", ...failureReasons]));
  } else if (currencies.length > 1) {
    // No server FX: a mixed-currency cohort has no combined curve.
    equity = unknown("mixed_currency", coverage("unavailable", 0, total, ["mixed_currency"]));
  } else {
    const combined = aggregateEquity(members.flatMap(member => member.series.map(series => ({ id: `${member.target_id}:${series.currency}`, points: series.points }))));
    const points = combined.points.filter(point => (!window.start || point.date >= window.start) && point.date <= window.end);
    const chained = chainReturns(points);
    if (combined.missingAccounts.length || points.length < 2 || chained.invalidPeriod || chained.index.length < 2) {
      equity = unknown("insufficient_history", coverage("unavailable", 0, total, ["insufficient_history"]));
    } else if (chained.unknownFlow) {
      // Asset change without a qualified cash-flow source is not a return series.
      equity = unknown("source_unavailable", coverage("unavailable", 0, total, ["source_unavailable"]));
    } else {
      qualified = chained.index;
    }
  }
  let risk = {
    return_ratio: notSupported(), max_drawdown_ratio: notSupported(), best_day_ratio: notSupported(), worst_day_ratio: notSupported(),
  };
  if (qualified) {
    const base = qualified[0].value;
    let peak = -Infinity;
    const indexed = [], drawdown = [], gaps = [];
    const days = [];
    qualified.forEach((point, index) => {
      const level = point.value / base;
      peak = Math.max(peak, level);
      indexed.push(decimal(100 * level));
      drawdown.push(decimal(level / peak - 1));
      if (point.breakBefore) gaps.push(point.date);
      else if (index > 0) days.push(point.value / qualified[index - 1].value - 1);
    });
    const value = {
      dates: qualified.map(point => point.date), portfolio_indexed: indexed, drawdown_ratio: drawdown,
      gap_dates: gaps, gap_semantics: "break_before_observation",
    };
    const lastDate = qualified.at(-1).date;
    // The stored observation instant of the last day, never the response time.
    const lastTimes = allPoints.filter(point => point.date === lastDate).map(point => point.observed_at ?? null);
    const observedAt = lastTimes.length && lastTimes.every(Boolean) ? lastTimes.sort().at(-1) : null;
    const wrap = (payload) => truncatedBy
      ? partial(payload, observedAt, coverage("partial", included, total, ["insufficient_history"]))
      : businessAge(lastDate, end) > STALE_DAYS
        ? stale(payload, observedAt, now, coverage("complete", included, total))
        : known(payload, observedAt, coverage("complete", included, total));
    equity = wrap(value);
    const minDrawdown = Math.min(...drawdown.map(Number));
    risk = {
      return_ratio: wrap(decimal(qualified.at(-1).value / base - 1)),
      max_drawdown_ratio: wrap(decimal(-Math.abs(minDrawdown))),
      best_day_ratio: days.length ? wrap(decimal(Math.max(...days))) : unknownAll("insufficient_history"),
      worst_day_ratio: days.length ? wrap(decimal(Math.min(...days))) : unknownAll("insufficient_history"),
    };
  } else if (equity.status === "unknown") {
    const reason = equity.reason;
    risk = Object.fromEntries(Object.keys(risk).map(key => [key, unknown(reason, equity.coverage)]));
  }
  return {
    range,
    scope: "all",
    history,
    return_basis: returnBasis,
    equity,
    risk: {
      ...risk,
      // Not computed in this package (N2): unknown, never a UI-side fallback.
      vs_benchmark_pts: notSupported(),
      volatility_ann_ratio: notSupported(),
      sharpe: notSupported(),
      sortino: notSupported(),
      time_under_water_days: notSupported(),
    },
    scorecard: notSupported(),
    contribution: notSupported(),
    monthly: notSupported(),
  };
}

/** Shared read used by the performance and overview routes. */
export async function readPerformance(env, deps, { range, now, config, facts }) {
  const end = zonedDate(now, PERFORMANCE_TIMEZONE);
  if (!config.ok) return performanceProjection({ members: [], range, end, now, readable: false });
  const members = await readCohortHistories(env, deps, { config, facts });
  return performanceProjection({ members, range, end, now });
}

export async function deskPerformanceResponse(request, env, deps) {
  return n1Route(request, env, deps, async (url) => {
    const { range } = performanceQuery(url);
    const now = deps.now();
    const config = await readConfig(env, deps);
    const facts = await readFactsModel(env, deps, config, now);
    const body = await readPerformance(env, deps, { range, now, config, facts });
    return n1Response("performance", {
      time_basis: timeBasis(PERFORMANCE_TIMEZONE, [["account_facts_history", PERFORMANCE_TIMEZONE]]),
      ...body,
    }, { now });
  });
}
