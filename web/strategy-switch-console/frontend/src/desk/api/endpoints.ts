/**
 * Desk endpoints (API-CONTRACT.md §3.1–§3.3 for phase 1). Each endpoint has a source:
 * "live" calls the Worker, "mock" reads fixtures. Flipping one endpoint to live when its
 * backend lands is a one-line change in DESK_SOURCES. Forcing mocks (`?mock=`) switches
 * every endpoint, so the desk can be reviewed without a session.
 */
import { getJson } from "../../api/client.ts";
import type {
  AlertDelivery, Alerts, Credentials, DeskSession, Logs, SwitchStrategies, SwitchTargets,
} from "../contract/types";
import type { N1Accounts, N1Overview, N1Performance, N1Ribbon } from "../contract/n1";
import {
  isAccounts, isAlertDelivery, isAlerts, isCredentials, isLogs, isOverview, isPerformance, isRibbon,
  isSession, isSwitchStrategies, isSwitchTargets,
} from "./guards.ts";
import {
  accountsFromMock, isN1Accounts, isN1Overview, isN1Performance, isN1Ribbon, overviewFromMock,
  performanceFromMock, ribbonFromMock,
} from "./n1.ts";
import { PERF_BENCH_API } from "../performance/benchmarks.ts";
import { loadMock, type MockEndpoint, type MockScenario } from "./mock.ts";
import type { DeskPage } from "../router.ts";

export type DeskSource = "live" | "mock";

/** Session is live (server_time landed in #1051); credentials, switch targets and alert
    delivery are live. Ribbon, overview, accounts and performance read the N1 v2
    projections when live (strict guard in ./n1.ts); their v1 fixtures are normalised to
    N1 only under source=mock. Switch strategies keeps its v1 client for now. Alerts and
    logs stay fixtures. */
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
  // Phase 8 pages (API-CONTRACT.md §3.17–§3.19). Alerts and logs have no backend route yet.
  alerts: "mock",
  // GET /api/desk/alerts/delivery (#1108): sender-log read projection; receiver ACK stays unknown.
  alertDelivery: "live",
  logs: "mock",
};

/** Which endpoints each desk page actually renders. Fixture labelling follows
    this map, not just the two global reads: a page with one live endpoint must
    still name the fixtures it shows. Keep in sync with the pages' api.* calls. */
export const DESK_PAGE_ENDPOINTS: Record<DeskPage, readonly MockEndpoint[]> = {
  overview: ["overview", "ribbon"],
  accounts: ["accounts", "credentials"],
  switch: ["switchTargets", "switchStrategies"],
  performance: ["performance"],
  alerts: ["alerts", "alertDelivery"],
  logs: ["ribbon", "logs"],
};

/** Endpoints the shell renders on every page: the ribbon feeds the gateway chip
    and the alert badge. (The session only gates access and the clock.) */
export const DESK_SHELL_ENDPOINTS: readonly MockEndpoint[] = ["ribbon"];

export type FixtureExposure = "none" | "all" | "partial";

/** Whether the current page (including the shell around it) shows fixtures, and
    whether any of its data is live. `?mock=` forces every endpoint to a fixture,
    so that is always "all". */
export function fixtureExposure(page: DeskPage, forcedScenario: MockScenario | null): FixtureExposure {
  if (forcedScenario) return "all";
  const endpoints = [...new Set([...(DESK_PAGE_ENDPOINTS[page] ?? []), ...DESK_SHELL_ENDPOINTS])];
  const fixtures = endpoints.filter(endpoint => DESK_SOURCES[endpoint] === "mock");
  if (!fixtures.length) return "none";
  return fixtures.length === endpoints.length ? "all" : "partial";
}

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
  ribbon(date?: string): Promise<DeskResult<N1Ribbon>>;
  overview(): Promise<DeskResult<N1Overview>>;
  accounts(): Promise<DeskResult<N1Accounts>>;
  credentials(): Promise<DeskResult<Credentials>>;
  switchTargets(): Promise<DeskResult<SwitchTargets>>;
  switchStrategies(targetId: string): Promise<DeskResult<SwitchStrategies>>;
  performance(): Promise<DeskResult<N1Performance>>;
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

  /** N1 read: live accepts only the strict v2 payload; a mock v1 fixture passes its v1
      guard first and is then normalised. A live v1 payload is a contract mismatch. */
  async function readN1<V1, T>(endpoint: MockEndpoint, path: string, v1Guard: (value: unknown) => value is V1,
    normalise: (value: V1) => T, guard: (value: unknown) => value is T): Promise<DeskResult<T>> {
    const scenario = options.forcedScenario ?? (sources[endpoint] === "mock" ? "ok" : null);
    if (scenario) {
      const payload = await loadMock(endpoint, scenario, delayMs);
      if (!v1Guard(payload)) throw new DeskContractError(endpoint);
      const data = normalise(payload);
      if (!guard(data)) throw new DeskContractError(endpoint);
      return { data, source: "mock", scenario };
    }
    const payload = await fetchJson(path);
    if (!guard(payload)) throw new DeskContractError(endpoint);
    return { data: payload, source: "live", scenario: null };
  }

  return {
    session: () => read("session", "/api/session", isSession),
    ribbon: date => readN1("ribbon", `/api/desk/ribbon${date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${date}` : ""}`,
      isRibbon, ribbonFromMock, isN1Ribbon),
    overview: () => readN1("overview", "/api/desk/overview", isOverview, overviewFromMock, isN1Overview),
    accounts: () => readN1("accounts", "/api/desk/accounts", isAccounts, accountsFromMock, isN1Accounts),
    credentials: () => read("credentials", "/api/desk/credentials", isCredentials),
    switchTargets: () => read("switchTargets", "/api/desk/switch/targets", isSwitchTargets),
    // The strategies page still consumes the v1 catalog shape; its N1 adoption is a
    // separate step (docs/desk-n1-read-projection-contract.md, open item).
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
    performance: () => readN1("performance", "/api/desk/performance", isPerformance, performanceFromMock, isN1Performance),
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
