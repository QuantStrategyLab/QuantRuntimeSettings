// Keep provider exceptions private while retaining an actionable read diagnosis.
export const KV_LIST_DAILY_LIMIT = "kv_list_daily_limit_exceeded";
export function sourceListFailure(error, fallback) {
  if (/^kv_directory_(uninitialized|unavailable|truncated|migration_pending|migration_failed|record_unavailable)$/.test(error?.message || "")) return error.message;
  return ["KV list() limit exceeded for the day.", KV_LIST_DAILY_LIMIT].includes(error?.message) ? KV_LIST_DAILY_LIMIT : fallback;
}

// Only fixed codes reach the public inbox. Provider messages and credentials stay private.
export function readFailure(code, status) {
  if (status === 401 || status === 403) return { failure_reason: "unauthorized", error_state: "unauthorized" };
  const reason = sourceListFailure({ message: code }, null);
  if (reason === KV_LIST_DAILY_LIMIT) return { failure_reason: reason, error_state: "quota_exhausted" };
  if (reason === "kv_directory_uninitialized") return { failure_reason: reason, error_state: "index_missing" };
  if (reason === "kv_directory_migration_pending") return { failure_reason: reason, error_state: "index_incomplete" };
  if (reason?.startsWith("kv_directory_")) return { failure_reason: reason, error_state: "index_unavailable" };
  return { failure_reason: "unknown", error_state: "unknown" };
}
