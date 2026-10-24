import { isAggregateAssetAccount } from "../../performance_math.js";
import { MARKET_BENCHMARK_SERIES_IDS } from "../../infrastructure/market_benchmark/market_benchmark.js";
import { businessDate, performanceBlocks } from "./performance.js";
import { externalFlowEnabled } from "../account_facts/external_flow.js";
import { applyCashflowPerformance } from "./cashflow_performance.js";
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
    const makeRequest = (path, params = {}) => {
      const u = new URL(path, request.url);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      return new Request(u, { headers: request.headers });
    };
    const factsResponse = await deps.facts(
      makeRequest("/api/account-facts"),
      env,
    );
    if (endpoint === "holdings" && !factsResponse.ok) {
      const sourceError = await factsResponse.json().catch(() => null);
      if (factsResponse.status !== 404 || sourceError?.error !== "account_facts_disabled") {
        return json({ schema_version: "console_api.v1", scope, range,
          status: "unavailable", unavailable_reason: "stored_records_unreadable",
          rows: [], coverage: [], includes_cost_basis: false }, 503);
      }
    }
    const factsBody = factsResponse.ok
      ? await factsResponse.json()
      : { accounts: [] };
    const accounts = [],
      histories = [],
      failed = [],
      readFailures = [];
    let truncated = false;
    if (!factsResponse.ok) readFailures.push("account_facts_unreadable");
    for (const option of matches) {
      if (option.platform === "binance") {
        // Wallet history is not a current positions source.
        if (endpoint === "holdings") {
          accounts.push({ account_key: option.key, platform: option.platform });
          continue;
        }
        const response = await deps.wallet(
          makeRequest("/api/binance-account-facts/history", {
            account_key: option.key,
          }),
          env,
        );
        if (!response.ok) {
          readFailures.push(option.key);
          failed.push(option.key);
          accounts.push({ account_key: option.key, platform: option.platform });
          continue;
        }
        const body = await response.json();
        if (body.currency !== "USDT") {
          accounts.push({ account_key: option.key, platform: option.platform });
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
        failed.push(option.key);
        accounts.push({ account_key: option.key, platform: option.platform });
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
      const currencies = [
        ...new Set((fact.balances || []).map((b) => b.currency)),
      ];
      if (!currencies.length) failed.push(option.key);
      const accountHistories = [];
      for (const currency of currencies) {
        const member = { id: `${option.platform}:${option.key}:${currency}`, currency, points: [] };
        accountHistories.push(member);
        const response = await deps.history(
          makeRequest("/api/account-facts/history", {
            platform: option.platform,
            account_key: option.key,
            currency,
          }),
          env,
        );
        if (!response.ok) {
          readFailures.push(option.key);
          failed.push(option.key);
          continue;
        }
        const body = await response.json();
        truncated ||= body.series?.truncated === true;
        if (
          body.identity_mismatch ||
          body.platform !== option.platform ||
          body.account_key !== option.key ||
          body.series?.currency !== currency
        ) {
          failed.push(option.key);
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
      if (accountHistories.some((h) => !h.points.length)) failed.push(option.key);
    }
    if (endpoint === "holdings") {
      const block = performanceBlocks({ accounts, histories: [], today, year, month,
        freshnessThresholdHours: env.CONSOLE_ACCOUNT_FRESHNESS_HOURS }).holdings;
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
    const performanceInput = {
      now: Date.now(),
      freshnessThresholdHours: env.CONSOLE_ACCOUNT_FRESHNESS_HOURS,
      historyMaxStalenessDays: env.CONSOLE_HISTORY_MAX_STALENESS_DAYS,
      accounts,
      histories,
      benchmarks,
      range,
      today,
      year,
      month,
      failed: [...new Set(failed)],
    };
    const blocks = applyCashflowPerformance(performanceBlocks(performanceInput), performanceInput, env);
    const block = blocks[endpoint];
    if (["calendar", "summary", "returns", "assets"].includes(endpoint)) {
      block.coverage.truncated = truncated;
      block.coverage.read_failures = readFailures;
      if (endpoint === "assets") {
        for (const history of block.history_per_currency) {
          history.coverage.truncated = truncated;
          history.coverage.read_failures = readFailures;
          if ((truncated || readFailures.length) && history.status === "ok") history.status = "partial";
        }
        if ((truncated || readFailures.length) && block.curve_status === "ok") block.curve_status = "partial";
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
    return json({ schema_version: "console_api.v1", scope, range, ...block });
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
