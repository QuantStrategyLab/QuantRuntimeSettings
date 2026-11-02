/**
 * Mock source for desk endpoints. Fixtures load lazily so they never reach the console's
 * entry bundle. Scenarios: ok, degraded (unknown/stale reads), fail (HTTP 503).
 */
import { HttpError } from "../../api/client.ts";
import type { DeskErrorBody } from "../contract/types";

export type MockScenario = "ok" | "degraded" | "fail";
export const MOCK_STORAGE_KEY = "qslDeskMock";

/**
 * `?mock=1|ok|degraded|fail` wins over localStorage.qslDeskMock; `?mock=0` turns it off.
 * Returns null when mocks are not forced.
 */
export function resolveMockScenario(search: string, stored: string | null): MockScenario | null {
  const query = new URLSearchParams(search).get("mock");
  const pick = (value: string | null): MockScenario | null | undefined => {
    if (value === null) return undefined;
    if (value === "1" || value === "ok" || value === "true") return "ok";
    if (value === "degraded" || value === "fail") return value;
    return null;
  };
  const fromQuery = pick(query);
  if (fromQuery !== undefined) return fromQuery;
  return pick(stored) ?? null;
}

export const MOCK_FAILURE: DeskErrorBody = {
  ok: false,
  error: "store_unavailable",
  reason_code: "store_unavailable",
  reason: "Mock scenario: the read model store is unavailable.",
};

const FIXTURES = {
  session: () => import("./fixtures/session.ts"),
  ribbon: () => import("./fixtures/ribbon.ts"),
  overview: () => import("./fixtures/overview.ts"),
};
export type MockEndpoint = keyof typeof FIXTURES;

const wait = (ms: number) => (ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve());

/** Deep copy so a caller mutating a response cannot change the next one. */
export async function loadMock(endpoint: MockEndpoint, scenario: MockScenario, delayMs: number): Promise<unknown> {
  await wait(delayMs);
  if (scenario === "fail") throw new HttpError(503, MOCK_FAILURE);
  const module = await FIXTURES[endpoint]();
  return structuredClone(module[scenario]);
}
