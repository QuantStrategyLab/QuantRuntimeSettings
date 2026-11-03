/**
 * Desk endpoints (API-CONTRACT.md §3.1–§3.3 for phase 1). Each endpoint has a source:
 * "live" calls the Worker, "mock" reads fixtures. Flipping one endpoint to live when its
 * backend lands is a one-line change in DESK_SOURCES. Forcing mocks (`?mock=`) switches
 * every endpoint, so the desk can be reviewed without a session.
 */
import { getJson } from "../../api/client.ts";
import type { DeskSession, Overview, Ribbon } from "../contract/types";
import { isOverview, isRibbon, isSession } from "./guards.ts";
import { loadMock, type MockEndpoint, type MockScenario } from "./mock.ts";

export type DeskSource = "live" | "mock";

/** Session is live (server_time landed in #1051); ribbon waits for BE-4, overview for BE-3. */
export const DESK_SOURCES: Record<MockEndpoint, DeskSource> = {
  session: "live",
  ribbon: "mock",
  overview: "mock",
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
  };
}
