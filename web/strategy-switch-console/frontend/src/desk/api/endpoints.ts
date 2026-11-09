/**
 * Desk endpoints (API-CONTRACT.md §3.1–§3.3 for phase 1). Each endpoint has a source:
 * "live" calls the Worker, "mock" reads fixtures. Flipping one endpoint to live when its
 * backend lands is a one-line change in DESK_SOURCES. Forcing mocks (`?mock=`) switches
 * every endpoint, so the desk can be reviewed without a session.
 */
import { getJson } from "../../api/client.ts";
import type {
  Accounts, AlertDelivery, Alerts, Credentials, DeskSession, Logs, Overview, Performance, Ribbon,
  SwitchStrategies, SwitchTargets,
} from "../contract/types";
import {
  isAccounts, isAlertDelivery, isAlerts, isCredentials, isLogs, isOverview, isPerformance, isRibbon,
  isSession, isSwitchStrategies, isSwitchTargets,
} from "./guards.ts";
import { PERF_BENCH_API } from "../performance/benchmarks.ts";
import { loadMock, type MockEndpoint, type MockScenario } from "./mock.ts";

export type DeskSource = "live" | "mock";

/** Session is live (server_time landed in #1051); the rest wait for their backend routes. */
export const DESK_SOURCES: Record<MockEndpoint, DeskSource> = {
  session: "live",
  ribbon: "mock",
  overview: "mock",
  accounts: "mock",
  credentials: "live",
  switchTargets: "live",
  switchStrategies: "mock",
  // /api/desk/performance has no backend yet; the benchmark curves follow this source (see benchmarks()).
  performance: "mock",
  // Phase 8 pages (API-CONTRACT.md §3.17–§3.19); no backend route yet.
  alerts: "mock",
  alertDelivery: "mock",
  logs: "mock",
};

export interface DeskResult<T> {
  data: T;
  source: DeskSource;
  /** Which fixture produced the data; null for live data. */
  scenario: MockScenario | null;
}

export class DeskContractError extends Error {
  readonly endpoint: string;
  constructor(endpoint: string) {
    super(`desk_contract_mismatch:${endpoint}`);
    this.endpoint = endpoint;
  }
}

export interface DeskApiOptions {
  /** Forced mock scenario (from ?mock= or storage); null uses DESK_SOURCES. */
  forcedScenario: MockScenario | null;
  /** Simulated mock latency. */
  delayMs?: number;
  /** Injected for tests; defaults to the console's same-origin getJson. */
  fetchJson?: (path: string) => Promise<unknown>;
  sources?: Record<MockEndpoint, DeskSource>;
}

export interface DeskApi {
  session(): Promise<DeskResult<DeskSession>>;
  ribbon(date?: string): Promise<DeskResult<Ribbon>>;
  overview(): Promise<DeskResult<Overview>>;
  accounts(): Promise<DeskResult<Accounts>>;
  credentials(): Promise<DeskResult<Credentials>>;
  switchTargets(): Promise<DeskResult<SwitchTargets>>;
  switchStrategies(targetId: string): Promise<DeskResult<SwitchStrategies>>;
  performance(): Promise<DeskResult<Performance>>;
  alerts(): Promise<DeskResult<Alerts>>;
  alertDelivery(): Promise<DeskResult<AlertDelivery>>;
  logs(cursor?: string): Promise<DeskResult<Logs>>;
  /** Raw `qsl.performance_benchmarks.v1` body for the strategy window; the caller validates it. */
  benchmarks(window: { start: string; end: string }, source: DeskSource, scenario: MockScenario | null): Promise<unknown>;
}

export function createDeskApi(options: DeskApiOptions): DeskApi {
  const fetchJson = options.fetchJson ?? ((path: string) => getJson<unknown>(path));
  const sources = options.sources ?? DESK_SOURCES;
  const delayMs = options.delayMs ?? 250;

  async function read<T>(endpoint: MockEndpoint, path: string, guard: (value: unknown) => value is T): Promise<DeskResult<T>> {
    const scenario = options.forcedScenario ?? (sources[endpoint] === "mock" ? "ok" : null);
    const payload = scenario ? await loadMock(endpoint, scenario, delayMs) : await fetchJson(path);
    if (!guard(payload)) throw new DeskContractError(endpoint);
    return { data: payload, source: scenario ? "mock" : "live", scenario };
  }

  return {
    session: () => read("session", "/api/session", isSession),
    ribbon: date => read("ribbon", `/api/desk/ribbon${date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${date}` : ""}`, isRibbon),
    overview: () => read("overview", "/api/desk/overview", isOverview),
    accounts: () => read("accounts", "/api/desk/accounts", isAccounts),
    credentials: () => read("credentials", "/api/desk/credentials", isCredentials),
    switchTargets: () => read("switchTargets", "/api/desk/switch/targets", isSwitchTargets),
    async switchStrategies(targetId) {
      const scenario = options.forcedScenario ?? (sources.switchStrategies === "mock" ? "ok" : null);
      if (scenario) {
        // The mock catalog follows the selected target; the request still goes through
        // the same failure/delay path as every other mock endpoint.
        await loadMock("switchStrategies", scenario, delayMs);
        const fixtures = await import("./fixtures/switchStrategies.ts");
        const data = fixtures.forTarget(targetId, scenario === "degraded" ? "degraded" : "ok");
        if (!isSwitchStrategies(data)) throw new DeskContractError("switchStrategies");
        return { data, source: "mock", scenario };
      }
      const payload = await fetchJson(`/api/desk/switch/targets/${encodeURIComponent(targetId)}/strategies`);
      if (!isSwitchStrategies(payload)) throw new DeskContractError("switchStrategies");
      return { data: payload, source: "live", scenario: null };
    },
    performance: () => read("performance", "/api/desk/performance", isPerformance),
    alerts: () => read("alerts", "/api/desk/alerts", isAlerts),
    alertDelivery: () => read("alertDelivery", "/api/desk/alerts/delivery", isAlertDelivery),
    logs: cursor => read(
      "logs",
      `/api/desk/logs${cursor && /^[A-Za-z0-9_-]{1,64}$/.test(cursor) ? `?cursor=${cursor}` : ""}`,
      isLogs,
    ),
    async benchmarks(window, source, scenario) {
      if (source === "mock") {
        if (scenario === "fail") throw new Error("benchmarks_mock_failure");
        const fixtures = await import("./fixtures/performance.ts");
        return fixtures.benchmarkResponse(window.start, window.end, scenario === "degraded" ? "degraded" : "ok");
      }
      // Public, market-only GET with the strategy curve's actual first and last observation dates.
      return fetchJson(`${PERF_BENCH_API}?start=${window.start}&end=${window.end}`);
    },
  };
}
