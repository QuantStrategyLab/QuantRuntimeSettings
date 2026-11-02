/**
 * Desk access gate. Fail closed: page content renders only for a session that was read
 * and says allowed. Loading, failed and malformed reads never fall through to "open",
 * and mock sessions are judged by the same rule.
 */
export type AccessState = "loading" | "open" | "login" | "denied" | "error";

export type SessionLoad =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "ready"; result: { data: { authenticated?: unknown; allowed?: unknown } } };

export function deskAccess(session: SessionLoad): AccessState {
  if (session.state === "loading") return "loading";
  if (session.state !== "ready") return "error";
  const data = session.result?.data;
  if (!data || typeof data !== "object") return "error";
  if (data.allowed === true && data.authenticated === true) return "open";
  return data.authenticated === true ? "denied" : "login";
}
