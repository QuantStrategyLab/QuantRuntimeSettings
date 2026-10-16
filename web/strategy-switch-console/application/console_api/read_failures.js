// Keep provider exceptions private while retaining an actionable read diagnosis.
export const KV_LIST_DAILY_LIMIT = "kv_list_daily_limit_exceeded";
export function sourceListFailure(error, fallback) {
  if (/^kv_directory_(uninitialized|unavailable|truncated|migration_pending|migration_failed)$/.test(error?.message || "")) return error.message;
  return ["KV list() limit exceeded for the day.", KV_LIST_DAILY_LIMIT].includes(error?.message) ? KV_LIST_DAILY_LIMIT : fallback;
}
