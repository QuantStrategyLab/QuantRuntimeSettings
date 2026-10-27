import { cleanPoints, chainReturns, dateMs, sliceRange } from "../../performance_math.js";
const HOUR = 3600000;
const number = (value) => ["number", "string"].includes(typeof value)
  && String(value).trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;

export function accountFreshness(accounts, now, thresholdHours = 36) {
  const threshold = number(thresholdHours) > 0 ? Number(thresholdHours) : 36;
  const rows = accounts.map((account) => {
    const time = Date.parse(account.observed_finished_at);
    const known = Number.isFinite(time) && time <= now;
    const stale = known ? now - time > threshold * HOUR : null;
    return {
      platform: account.platform || null,
      account_alias: account.account_key,
      account_ref: account.platform ? `${account.platform}:${account.account_key}` : null,
      as_of: known ? account.observed_finished_at : null,
      freshness: known ? stale ? "stale" : "fresh" : "unknown",
      fresh: known ? !stale : null,
      stale,
      unavailable_reason: account.snapshot_unavailable_reason
        || (known ? stale ? "snapshot_stale" : null : "no_snapshot"),
    };
  });
  return { accounts: rows, summary: {
    fresh: rows.filter((row) => row.fresh === true).length,
    stale: rows.filter((row) => row.stale === true).length,
    unknown: rows.filter((row) => row.stale === null).length,
    threshold_hours: threshold,
  } };
}

/** Latest known native balances, independent of return history and chart cohorts. */
export function currencyTotals(accounts, freshness, excluded = []) {
  const currencies = [...new Set(accounts.flatMap((a) => (a.balances || []).map((b) => b.currency)))].sort();
  return currencies.map((currency) => {
    const members = accounts.flatMap((account, index) => {
      const balances = (account.balances || []).filter((b) => b.currency === currency);
      if (!balances.length) return [];
      // A duplicate currency or unknown amount cannot be silently counted as zero.
      const value = balances.length === 1 ? number(balances[0].net_assets) : null;
      const date = account.observation_date;
      const validDate = typeof date === "string" && Number.isFinite(dateMs(date));
      return [{ value, date: validDate ? date : null, freshness: freshness.accounts[index],
        account, balance_count: balances.length }];
    });
    // These are each account's latest admitted balances, not one historical
    // portfolio valuation. Keep their actual observation dates and time range.
    const included = members.filter((m) => m.value !== null && m.date && m.freshness.as_of);
    const observationDates = [...new Set(included.map((m) => m.date))];
    const observedTimes = included.map((m) => m.freshness.as_of).sort((a, b) => Date.parse(a) - Date.parse(b));
    const stale = included.length ? included.some((m) => m.freshness.stale) : null;
    const accountCoverage = accounts.flatMap((account, index) => {
      const member = members.find((m) => m.account === account);
      // Accounts known to hold another currency are outside this currency cohort.
      // A missing snapshot has unknown currencies and cannot silently disappear.
      if (!member && account.balances?.length) return [];
      const current = freshness.accounts[index];
      const counted = Boolean(member && included.includes(member));
      const reason = account.snapshot_unavailable_reason
        || (!member ? "no_snapshot"
          : member.balance_count !== 1 ? "duplicate_currency"
          : member.value === null ? "invalid_balance"
          : !member.date ? "invalid_valuation_date"
          : !current.as_of ? "no_snapshot"
          : current.unavailable_reason);
      return [{ ...current, included: counted, observation_date: member?.date || null,
        unavailable_reason: reason }];
    });
    const complete = included.length === accountCoverage.length && !excluded.length;
    return {
      currency,
      total: included.length ? included.reduce((sum, m) => sum + m.value, 0) : null,
      account_count: included.length,
      expected_account_count: accountCoverage.length,
      excluded_account_count: excluded.length,
      account_coverage: accountCoverage,
      as_of: observedTimes[0] || null,
      latest_as_of: observedTimes.at(-1) || null,
      observation_date: observationDates.length === 1 ? observationDates[0] : null,
      stale,
      status: !included.length ? "no_data" : !complete ? "partial" : stale ? "stale" : "ok",
      unavailable_reason: !included.length ? "no_snapshot"
        : !complete ? "incomplete_account_coverage" : stale ? "snapshot_stale" : null,
    };
  });
}

export function returnUnavailableReason(points) {
  if (!points.length) return "no_snapshot";
  if (points.length < 2) return "insufficient_history";
  const result = chainReturns(points);
  if (result.invalidPeriod) return "invalid_return_period";
  return result.unknownFlow ? "no_cashflow_data" : null;
}

/** Uses the existing cohort intersection; this does not change history aggregation. */
export function currencyDrawdowns(histories, range, today, aggregateEquity, maxDrawdown) {
  return [...new Set(histories.map((h) => h.currency))].sort().map((currency) => {
    const group = aggregateEquity(histories.filter((h) => h.currency === currency));
    const points = sliceRange(group.points, range.toLowerCase(), today);
    const reason = group.missingAccounts.length && points.length
      ? "snapshot_history_missing" : returnUnavailableReason(points);
    return { currency, max_drawdown: reason
      ? { percent: null, peak_date: null, trough_date: null, unavailable_reason: reason }
      : maxDrawdown(chainReturns(cleanPoints(points)).index) };
  });
}
