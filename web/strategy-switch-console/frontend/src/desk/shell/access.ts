/**
 * Desk access gate. Fail closed: page content renders only for a session that was read
 * and says allowed. Loading, failed and malformed reads never fall through to "open",
 * and mock sessions are judged by the same rule.
 *
 * A failed read keeps its cause: 401 is a sign-in problem, 403 is a permission problem
 * for the current sign-in, and every other failure (network, 5xx, malformed body) is a
 * read failure. The three are deliberately not collapsed into one state.
 */
import { AccessError } from "../../api/client.ts";

export type AccessState = "loading" | "open" | "login" | "denied" | "error";
export type SessionFailure = "unauthorized" | "forbidden" | "network";

export type SessionLoad =
  | { state: "loading" }
  | { state: "failed"; failure?: SessionFailure }
  | { state: "ready"; result: { data: { authenticated?: unknown; allowed?: unknown; admin?: unknown } } };

export function deskAccess(session: SessionLoad): AccessState {
  if (session.state === "loading") return "loading";
  if (session.state !== "ready") {
    if (session.state === "failed") {
      if (session.failure === "unauthorized") return "login";
      if (session.failure === "forbidden") return "denied";
    }
    return "error";
  }
  const data = session.result?.data;
  if (!data || typeof data !== "object") return "error";
  if (data.allowed === true && data.authenticated === true) return "open";
  return data.authenticated === true ? "denied" : "login";
}

/** 401 -> sign in, 403 -> this sign-in lacks permission, anything else -> read failed. */
export function classifySessionFailure(error: unknown): SessionFailure {
  const status = error instanceof AccessError
    ? error.status
    : (error as { status?: unknown } | null)?.status;
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  return "network";
}

/** True only for a session whose data is an object with both booleans true. */
export function isOpenSession(session: SessionLoad): boolean {
  return deskAccess(session) === "open";
}
