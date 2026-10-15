import { MARKET_BENCHMARK_SERIES_IDS } from "../../infrastructure/market_benchmark/market_benchmark.js";
import { businessDate, performanceBlocks } from "./performance.js";
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
        ? a.broker_environment === "live"
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
          failed.push(option.key);
          continue;
        }
        accounts.push({ account_key: option.key, platform: option.platform });
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
        continue;
      }
      accounts.push(fact);
      const currencies = [
        ...new Set((fact.balances || []).map((b) => b.currency)),
      ];
      if (!currencies.length) failed.push(option.key);
      const accountHistories = [];
      for (const currency of currencies) {
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
        accountHistories.push({
          id: `${option.platform}:${option.key}:${currency}`,
          currency,
          points: (body.series.points || []).flatMap((p) =>
            p.currency !== currency || number(p.net_assets) === null
              ? []
              : [
                  {
                    date: p.observation_date,
                    value: number(p.net_assets),
                    externalFlow: null,
                  },
                ],
          ),
        });
      }
      if (
        accountHistories.length === currencies.length &&
        accountHistories.every((h) => h.points.length)
      )
        histories.push(...accountHistories);
      else failed.push(option.key);
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
    const blocks = performanceBlocks({
      accounts,
      histories,
      benchmarks,
      range,
      today,
      year,
      month,
      failed: [...new Set(failed)],
    });
    const block = blocks[endpoint];
    if (["calendar", "summary", "returns", "assets"].includes(endpoint)) {
      block.coverage.truncated = truncated;
      block.coverage.read_failures = readFailures;
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
