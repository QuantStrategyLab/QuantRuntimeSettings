import { canonicalItem } from "./presentation.js";
import { directoryStatus } from "../../kv_directory.js";
import { readFailure } from "./read_failures.js";

/** Bounded page size; the inbox is a read projection, not an export. */
export const INBOX_PAGE_DEFAULT = 25;
export const INBOX_PAGE_MAX = 100;

const base64url = (value) =>
  btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Opaque cursor: clients must not derive meaning from it. */
export const inboxCursor = (offset) =>
  base64url(JSON.stringify({ v: 1, o: offset }));

export function inboxCursorOffset(cursor) {
  if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(cursor)) return null;
  try {
    const parsed = JSON.parse(
      atob(cursor.replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (parsed?.v !== 1 || !Number.isSafeInteger(parsed.o) || parsed.o < 0) return null;
    return parsed.o;
  } catch {
    return null;
  }
}

export function inboxPage(url) {
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null || rawLimit === "" ? INBOX_PAGE_DEFAULT : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > INBOX_PAGE_MAX)
    throw new Error("invalid_pagination");
  const rawCursor = url.searchParams.get("cursor");
  const offset = rawCursor === null || rawCursor === "" ? 0 : inboxCursorOffset(rawCursor);
  if (!Number.isSafeInteger(offset)) throw new Error("invalid_pagination");
  return { limit, offset };
}

export async function inbox(request, env, deps) {
  const { limit, offset } = inboxPage(new URL(request.url));
  const definitions = [
    ["owner", "owner_decision", "candidates"],
    ["promotion", "strategy_promotion", "tickets"],
    ["recovery", "reconciliation_recovery", "recoveries"],
    ["credential", "credential_maintenance", null],
  ];
  const results = await Promise.all(
    definitions.map(async ([source, category, field]) => {
      try {
        const response = await deps[source](request, env);
        if (response.status === 401 || response.status === 403)
          return { source, status: "read_failed", items: [], ...readFailure(null, response.status) };
        const body = await response.json();
        const codes = [body.error, ...(Array.isArray(body.errors) ? body.errors : [])];
        const known = codes.map(code => readFailure(code)).find(failure => failure.error_state !== "unknown");
        const failed = !response.ok || !!known || codes.some(code =>
          typeof code === "string" && /unavailable|invalid|unreadable|failed/.test(code));
        const failure = failed ? (response.status === 401 || response.status === 403
          ? readFailure(null, response.status) : known || readFailure()) : null;
        const unavailable = ["unavailable", "partial"].includes(
          body.data_status,
        );
        let rows = field
          ? body[field] || []
          : body.requires_action
            ? [body]
            : [];
        // The existing promotion controller remains the only application path.
        // Include accepted paper requests once, using their original ticket binding.
        if (source === "promotion") {
          const merged = new Map(rows.map(row => [row.ticket_id, row]));
          for (const row of body.applications || []) {
            if (row.confirmation_execution_mode === "paper" || row.application?.broker_environment === "paper" || row.application_preparation?.preview_request)
              merged.set(row.ticket_id, row);
          }
          rows = [...merged.values()];
        }
        return {
          source,
          status: failed
            ? "read_failed"
            : unavailable
              ? "unavailable"
              : body.data_status === "stale"
                ? "stale"
                : "ok",
          items: rows.map((row) => canonicalItem(row, category)),
          ...(source === "recovery" ? { current_reconciliation_observation: body.current_reconciliation_observation } : {}),
          ...(failure || {}),
        };
      } catch (error) {
        return { source, status: "read_failed", items: [], ...readFailure(error?.message, error?.status) };
      }
    }),
  );
  // Read status only when directory discovery failed. This cannot maintain or scan
  // the index; it provides the saved retry time without another browser request.
  let directory = null;
  if (results.some(result => ["quota_exhausted", "index_missing", "index_incomplete", "index_unavailable"].includes(result.error_state))) {
    try { directory = await directoryStatus(env); } catch { /* Source failures remain authoritative. */ }
  }
  const failure = results.find(result => result.error_state && result.error_state !== "unknown")
    || results.find(result => result.status === "read_failed");
  const unique = new Map(
    results.flatMap((r) => r.items).map((item) => [item.id, item]),
  );
  const priority = { high: 0, medium: 1, normal: 2 };
  // Stable, deterministic order: priority, then age, then id. The id tiebreak
  // keeps equal priority and timestamp rows from reordering between pages.
  const ordered = [...unique.values()].sort(
    (a, b) =>
      (priority[a.priority] ?? 3) - (priority[b.priority] ?? 3) ||
      (a.created_at || "").localeCompare(b.created_at || "") ||
      String(a.id ?? "").localeCompare(String(b.id ?? "")),
  );
  const items = ordered.slice(offset, offset + limit);
  return {
    schema_version: "qsl.decision_inbox.v1",
    server_time: new Date().toISOString(),
    status: results.some((r) => r.status === "read_failed")
      ? "read_failed"
      : results.some((r) => r.status !== "ok")
        ? "partial"
        : "ok",
    error_state: failure?.error_state || null,
    directory,
    sources: results.map(({ source, status, failure_reason, error_state, current_reconciliation_observation }) => ({ source, status,
      ...(current_reconciliation_observation ? { current_reconciliation_observation } : {}),
      ...(failure_reason ? { failure_reason, error_state } : {}) })),
    items,
    next_cursor:
      ordered.length > offset + limit ? inboxCursor(offset + limit) : null,
    coverage: "existing_decision_sources",
    no_order: true,
    execution_authority_granted: false,
  };
}
