import { AccessError, HttpError } from "../api/client";
import type { InboxErrorState, InboxResponse } from "../api/contracts";

const states = new Set<InboxErrorState>(["quota_exhausted", "unauthorized", "index_missing",
  "index_incomplete", "index_unavailable", "unknown"]);

export function inboxFailureState(data?: InboxResponse | null, error?: Error | null): InboxErrorState {
  if (error instanceof AccessError) return "unauthorized";
  if (error instanceof HttpError) {
    const code = (error.payload as { error_state?: InboxErrorState } | null)?.error_state;
    if (code && states.has(code)) return code;
  }
  if (data?.error_state && states.has(data.error_state)) return data.error_state;
  return "unknown";
}
