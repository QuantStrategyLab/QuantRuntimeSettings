import { isAggregateAssetAccount } from "../../performance_math.js";
import { MARKET_BENCHMARK_SERIES_IDS } from "../../infrastructure/market_benchmark/market_benchmark.js";
import { applyNativeDailyReturns } from "./native_daily_returns.js";
import { businessDate, performanceBlocks } from "./performance.js";
import { externalFlowEnabled } from "../account_facts/external_flow.js";
import { applyCashflowPerformance } from "./cashflow_performance.js";
import { executionStatsResponse } from "./executions.js";
const ENDPOINTS = {
  calendar: "calendar",
  summary: "summary",
  returns: "returns",
  assets: "assets",
  holdings: "holdings",
  trades: "trades",
};
const number = (value) =>
  typeof value === "string" &&
  value.trim() !== "" &&
  Number.isFinite(Number(value))
    ? Number(value)
    : null;
export async function performanceResponse(request, env, deps) {
  const { json } = deps;
  const session = await deps.readSession(request, env);
  if (!session?.allowed)
    return json({ ok: false, error: "login required" }, 401);
  if (request.method !== "GET")
    return json({ ok: false, error: "method_not_allowed" }, 405);
  const url = new URL(request.url),
    endpoint = url.pathname.split("/").at(-1);
  if (!ENDPOINTS[endpoint]) return json({ ok: false, error: "not_found" }, 404);
  const scope = url.searchParams.get("scope") || "all",
    range = url.searchParams.get("range") || "ALL";
  const today = businessDate(Date.now()),
    year = Number(url.searchParams.get("year") || today.slice(0, 4));
  const month = url.searchParams.has("month")
    ? Number(url.searchParams.get("month"))
    : null;
  if (
    !["1M", "3M", "YTD", "1Y", "ALL"].includes(range) ||
    !Number.isInteger(year) ||
    year < 1970 ||
    year > 9999 ||
    (month !== null && (!Number.isInteger(month) || month < 1 || month > 12))
  )
    return json({ ok: false, error: "invalid_performance_query" }, 400);
  try {
    const config = await deps.accountOptions(env);
    const options = Object.entries(config.options || {}).flatMap(
      ([platform, rows]) => rows.map((a) => ({ ...a, platform })),
    );
    const matches = options.filter((a) =>
      scope === "all"
        ? isAggregateAssetAccount({
            brokerEnvironment: a.broker_environment ?? null,
            facts: null,
          })
        : a.key === scope &&
          (!url.searchParams.has("platform") ||
            a.platform === url.searchParams.get("platform")),
    );
    if (scope !== "all" && matches.length !== 1)
      return json(
        { ok: false, error: "account_alias_required_or_ambiguous" },
        400,
      );
    if (endpoint === "trades") return executionStatsResponse(matches, { scope, range, today }, env, deps);
    const makeRequest = (path, params = {}) => {
      const u = new URL(path, request.url);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      return new Request(u, { headers: request.headers });
    };
    const nativeBinanceOnly = matches.length > 0
      && matches.every(option => option.platform === "binance");
    const factsResponse = nativeBinanceOnly ? Response.json({ accounts: [] }) : await deps.facts(
      makeRequest("/api/account-facts"),
      env,
    );
    const sourceError = !factsResponse.ok ? await factsResponse.json().catch(() => null) : null;
    const factsDisabled = factsResponse.status === 404 && sourceError?.error === "account_facts_disabled";
    const factsUnreadable = !factsResponse.ok && !factsDisabled;
    const independentWalletCalendar = endpoint === "calendar" && scope === "all"
      && url.searchParams.get("currency") === "USDT"
      && matches.some(option => option.platform === "binance");
    if (factsUnreadable && !independentWalletCalendar) {
      return json({ schema_version: "console_api.v1", scope, range,
        status: "unavailable", unavailable_reason: "stored_records_unreadable", as_of: null,
        ...(endpoint === "holdings" ? { rows: [], coverage: [], includes_cost_basis: false }
          : { coverage: { account_aliases: matches.map(option => option.key),
            read_failures: ["account_facts_unreadable"] }, value_kind: "asset_change" }),
      }, 503);
    }
    const factsBody = factsResponse.ok
      ? await factsResponse.json()
      : { accounts: [] };
    const accounts = [],
      histories = [],
      failed = [],
      excludedCommonAccounts = [],
      readFailures = factsUnreadable ? ["account_facts_unreadable"] : [],
      unreadableHistoryCurrencies = new Set(),
      historyOnlyCandidates = new Set();
    let truncated = false;
    for (const option of matches) {
      if (option.platform === "binance") {
        // Current native quantities and wallet valuation history are separate sources.
        if (endpoint === "holdings") {
          const account = { account_key: option.key, platform: option.platform };
          if (deps.binanceCurrent) {
            try {
              const response = await deps.binanceCurrent(makeRequest("/api/binance-account-facts"), env);
              if (!response.ok) throw Error("native_source_unreadable");
              const body = await response.json(), report = body.report;
              if (body.report_status === "unavailable") throw Error("native_source_unreadable");
              if (body.report_status === "available" && report?.platform === option.platform
                  && report.account_key === option.key && report.scope === "spot+flexible_earn"
                  && Array.isArray(report.assets)) {
                Object.assign(account, {
                  observed_finished_at: report.observed_finished_at,
                  positions_scope: report.scope,
                  positions_complete: true,
                  uncovered_scopes: report.uncovered_scopes,
                  positions: report.assets.filter(asset => number(asset.quantity) > 0).map(asset => ({
                    symbol: asset.asset, quantity: asset.quantity,
                    // No quote currency, valuation or cost is supplied by this quantity source.
                    currency: "", market_value: null, avg_cost: null,
                  })),
                });
              }
            } catch { account.positions_read_error = "stored_records_unreadable"; }
          }
          accounts.push(account);
          continue;
        }
        const response = await deps.wallet(
          makeRequest("/api/binance-account-facts/history", {
            account_key: option.key,
          }),
          env,
        );
        if (!response.ok) {
          if (!readFailures.includes(option.key)) readFailures.push(option.key);
          unreadableHistoryCurrencies.add("USDT");
          failed.push(option.key);
          accounts.push({ account_key: option.key, platform: option.platform,
            snapshot_unavailable_reason: "stored_records_unreadable" });
          continue;
        }
        const body = await response.json();
        if (body.currency !== "USDT") {
          accounts.push({ account_key: option.key, platform: option.platform,
            snapshot_unavailable_reason: "currency_mismatch" });
          failed.push(option.key);
          continue;
        }
        const latest = [...(body.points || [])].sort((a, b) => a.observation_date.localeCompare(b.observation_date)).at(-1);
        accounts.push({ account_key: option.key, platform: option.platform,
          observed_finished_at: latest?.observed_at || null,
          observation_date: latest?.observation_date || null,
          balances: latest ? [{ currency: "USDT", net_assets: latest.amount }] : [],
        });
        histories.push({
          id: `${option.platform}:${option.key}`,
          currency: "USDT",
          crypto: true,
          points: (body.points || []).flatMap((p) =>
            number(p.amount) === null
              ? []
              : [
                  {
                    date: p.observation_date,
                    value: number(p.amount),
                    externalFlow: null,
                    breakBefore: p.break_before,
                  },
                ],
          ),
        });
        continue;
      }
      const fact = (factsBody.accounts || []).find(
        (a) => a.platform === option.platform && a.account_key === option.key,
      );
      if (
        !fact ||
        fact.identity_mismatch ||
        fact.binding_status !== "bound" ||
        ["duplicate", "conflict"].includes(fact.aggregation_status)
      ) {
        // An explicit native-wallet calendar can show its observed asset
        // changes independently. Unreadable brokers stay excluded in coverage;
        // wallet failures still participate in the ordinary cohort guard.
        if (factsUnreadable && independentWalletCalendar) excludedCommonAccounts.push(option.key);
        else failed.push(option.key);
        accounts.push({ account_key: option.key, platform: option.platform,
          snapshot_unavailable_reason: !fact ? factsUnreadable ? "stored_records_unreadable"
            : factsDisabled ? "account_facts_disabled" : "no_snapshot"
            : fact.identity_mismatch ? "identity_mismatch"
            : fact.binding_status !== "bound" ? "identity_not_bound"
            : `aggregation_${fact.aggregation_status}` });
        continue;
      }
      if (
        scope === "all" &&
        !isAggregateAssetAccount({
          brokerEnvironment: option.broker_environment ?? null,
          facts: fact,
        })
      )
        continue;
      accounts.push(fact);
      if (endpoint === "holdings") continue;
      const currentCurrencies = (fact.balances || []).map((b) => b.currency);
      if (!currentCurrencies.length && !failed.includes(option.key)) failed.push(option.key);
      let historicalCurrencies = [];
      let firstHistory = null;
      const firstCurrency = currentCurrencies[0];
      try {
        const params = firstCurrency
          ? { platform: option.platform, account_key: option.key, currency: firstCurrency, include_currencies: "true" }
          : { platform: option.platform, account_key: option.key, projection: "currencies" };
        const response = await deps.history(makeRequest("/api/account-facts/history", params), env);
        if (!response.ok) throw Error("history_currencies_unavailable");
        const body = await response.json();
        if (body.platform !== option.platform || body.account_key !== option.key
            || (!firstCurrency && (body.ok !== true || body.projection !== "currencies"))
            || (firstCurrency && (body.identity_mismatch || body.series?.currency !== firstCurrency))
            || !Array.isArray(body.currencies)
            || body.currencies.some(currency => typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))
            || new Set(body.currencies).size !== body.currencies.length) throw Error("history_currencies_unavailable");
        historicalCurrencies = body.currencies;
        if (firstCurrency) firstHistory = body;
      } catch {
        if (!readFailures.includes(option.key)) readFailures.push(option.key);
        if (!failed.includes(option.key)) failed.push(option.key);
      }
      const currencies = [...new Set([...currentCurrencies, ...historicalCurrencies])];
      const accountHistories = [];
      for (const currency of currencies) {
        const member = { id: `${option.platform}:${option.key}:${currency}`, currency, points: [] };
        accountHistories.push(member);
        const response = currency === firstCurrency && firstHistory
          ? null : await deps.history(
            makeRequest("/api/account-facts/history", {
              platform: option.platform,
              account_key: option.key,
              currency,
            }),
            env,
          );
        if (response && !response.ok) {
          if (!readFailures.includes(option.key)) readFailures.push(option.key);
          unreadableHistoryCurrencies.add(currency);
          if (!failed.includes(option.key)) failed.push(option.key);
          continue;
        }
        const body = firstHistory && currency === firstCurrency ? firstHistory : await response.json();
        truncated ||= body.series?.truncated === true;
        if (
          body.identity_mismatch ||
          body.platform !== option.platform ||
          body.account_key !== option.key ||
          body.series?.currency !== currency
        ) {
          if (!failed.includes(option.key)) failed.push(option.key);
          continue;
        }
        if (externalFlowEnabled(env) && body.externalFlow) member.externalFlow = body.externalFlow;
        member.points = (body.series.points || []).flatMap((p) =>
          p.currency !== currency || number(p.net_assets) === null
            ? []
            : [
                {
                  date: p.observation_date,
                  value: number(p.net_assets),
                  externalFlow: null,
                  ...(externalFlowEnabled(env) ? { observed_at: Number.isFinite(Date.parse(p.observed_finished_at))
                    ? new Date(p.observed_finished_at).toISOString() : null } : {}),
                },
              ],
        );
      }
      histories.push(...accountHistories);
      if (!currentCurrencies.length && accountHistories.length > 0
          && accountHistories.every(h => h.points.length > 0 && h.externalFlow)
          && matches.filter(candidate => candidate.key === option.key).length === 1) historyOnlyCandidates.add(option.key);
      if (accountHistories.some((h) => !h.points.length) && !failed.includes(option.key)) failed.push(option.key);
    }
    if (endpoint === "holdings") {
      const block = performanceBlocks({ accounts, histories: [], today, year, month,
        freshnessThresholdHours: env.CONSOLE_ACCOUNT_FRESHNESS_HOURS }).holdings;
      for (const [index, account] of accounts.entries()) {
        if (account.positions_read_error) block.coverage[index].unavailable_reason = account.positions_read_error;
        if (Array.isArray(account.uncovered_scopes)) block.coverage[index].uncovered_scopes = account.uncovered_scopes;
      }
      if (block.status === "no_data" && accounts.some(account => account.positions_read_error)) {
        return json({ schema_version: "console_api.v1", scope, range, ...block,
          status: "unavailable", unavailable_reason: "stored_records_unreadable" }, 503);
      }
      return json({ schema_version: "console_api.v1", scope, range, ...block });
    }
    let benchmarks = [],
      benchmarkFailed = false;
    try {
      const response = await deps.benchmarks(
        makeRequest("/api/market-benchmark"),
        env,
      );
      if (!response.ok) throw new Error("unavailable");
      const body = await response.json();
      const ids = [
        ...new Set([
          ...MARKET_BENCHMARK_SERIES_IDS,
          ...(body.points || []).map((p) => p.seriesId),
        ]),
      ];
      benchmarks = ids.map((id) => ({
        id,
        points: body.points
          .filter((p) => p.seriesId === id && number(p.close) !== null)
          .map((p) => ({ date: p.observationDate, value: number(p.close) })),
      }));
    } catch {
      benchmarkFailed = true;
    }
    // A calendar is one native-currency cohort. Select before running the same
    // cashflow/native-return calculation used by the single-currency view.
    const availableCurrencies = [...new Set(histories.map(history => history.currency))].sort();
    const requestedCurrency = endpoint === "calendar" ? url.searchParams.get("currency") : null;
    if (requestedCurrency !== null && (!/^[A-Z0-9]{2,12}$/.test(requestedCurrency)
        || (availableCurrencies.length && !availableCurrencies.includes(requestedCurrency)))) {
      return json({ ok: false, error: "invalid_performance_query" }, 400);
    }
    const calendarCurrency = endpoint === "calendar"
      ? requestedCurrency || availableCurrencies[0] || null : null;
    const calendarAccounts = calendarCurrency ? accounts
      // Unknown members remain in the cohort; selection cannot erase a failed read.
      .filter(account => !account.balances?.length
        || account.balances.some(balance => balance.currency === calendarCurrency))
      .map(account => ({ ...account,
        balances: account.balances?.filter(balance => balance.currency === calendarCurrency),
        ...(Array.isArray(account.return?.daily) ? { return: { ...account.return,
          daily: account.return.daily.filter(row => row.currency === calendarCurrency) } } : {}),
      })) : accounts;
    const performanceInput = {
      now: Date.now(),
      freshnessThresholdHours: env.CONSOLE_ACCOUNT_FRESHNESS_HOURS,
      historyMaxStalenessDays: env.CONSOLE_HISTORY_MAX_STALENESS_DAYS,
      accounts: calendarAccounts,
      histories: calendarCurrency ? histories.filter(history => history.currency === calendarCurrency) : histories,
      benchmarks,
      range,
      today,
      year,
      month,
      failed: [...new Set(failed)],
    };
    // Missing current balances affect current-value coverage, but do not invalidate
    // an independently qualified historical return chain and its real cash flows.
    const cashflowInput = { ...performanceInput, failed: performanceInput.failed.filter(key =>
      !historyOnlyCandidates.has(key) || readFailures.includes(key)) };
    const blocks = applyNativeDailyReturns(applyCashflowPerformance(performanceBlocks(performanceInput), cashflowInput, env), performanceInput);
    const block = blocks[endpoint];
    if (endpoint === "calendar") {
      block.available_currencies = availableCurrencies;
      if (calendarCurrency) block.currency = calendarCurrency;
      if (factsUnreadable && independentWalletCalendar) {
        block.coverage.excluded_accounts = [...new Set([
          ...block.coverage.excluded_accounts, ...excludedCommonAccounts,
        ])];
        block.unavailable_reason = "stored_records_unreadable";
      }
    }
    if (["calendar", "summary", "returns", "assets"].includes(endpoint)) {
      block.coverage.truncated = truncated;
      block.coverage.read_failures = readFailures;
      // Assets status describes current balances; its separate curve status
      // carries history failures without hiding a readable current snapshot.
      if (endpoint !== "assets" && readFailures.length && block.status === "ok") block.status = "partial";
      if (endpoint === "assets") {
        for (const history of block.history_per_currency) {
          history.coverage.truncated = truncated;
          history.coverage.read_failures = readFailures;
          if ((truncated || readFailures.length) && history.status === "ok") history.status = "partial";
          if (unreadableHistoryCurrencies.has(history.currency) && history.status === "no_data") {
            history.status = "unavailable";
            history.unavailable_reason = "stored_records_unreadable";
          }
        }
        if ((truncated || readFailures.length) && block.curve_status === "ok") block.curve_status = "partial";
        if (readFailures.length && block.curve_status === "no_data") {
          block.curve_status = "unavailable";
          block.curve_unavailable_reason = "stored_records_unreadable";
        }
      }
      if (readFailures.length && block.status === "no_data") {
        block.status = "unavailable";
        block.unavailable_reason = "stored_records_unreadable";
      }
    }
    if (benchmarkFailed && ["returns", "summary"].includes(endpoint)) {
      block.benchmark_status = "unavailable";
      block.benchmark_unavailable_reason = "benchmark_history_unreadable";
    }
    const noIndependentWalletHistory = factsUnreadable && independentWalletCalendar
      && !histories.some(history => history.crypto && history.currency === "USDT" && history.points.length);
    return json({ schema_version: "console_api.v1", scope, range, ...block }, noIndependentWalletHistory ? 503 : 200);
  } catch {
    return json(
      {
        schema_version: "console_api.v1",
        scope,
        range,
        status: "unavailable",
        unavailable_reason: "stored_records_unreadable",
        as_of: null,
        coverage: { account_aliases: [] },
        value_kind: "asset_change",
      },
      503,
    );
  }
}
