import { canonicalItem } from "./presentation.js";
import { riskTierPolicyCatalog } from "./risk_tiers.js";
import { directoryStatus } from "../../kv_directory.js";
import { readFailure } from "./read_failures.js";
import { projectCredentialCalendar } from "../credential_calendar/projector.js";
import { REGISTERED_CREDENTIALS } from "../credential_calendar/registry.js";

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

/**
 * Read the inbox projection. List routes take one bounded page; by-id detail
 * and action lookups pass `paginate: false` because a decision id is not
 * guaranteed to be on the first page.
 */
export async function inbox(request, env, deps, { paginate = true } = {}) {
  const page = paginate ? inboxPage(new URL(request.url)) : null;
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
        const incompleteSignal = Boolean(
          body.truncated
          || body.has_more
          || (Number.isFinite(Number(body.corrupt_omitted_count)) && Number(body.corrupt_omitted_count) > 0)
          || codes.some((code) => typeof code === "string" && /truncated|corrupt/.test(code)),
        );
        const unavailable = ["unavailable", "partial"].includes(
          body.data_status,
        ) || incompleteSignal;
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
  const items = page ? ordered.slice(page.offset, page.offset + page.limit) : ordered;
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
      page && ordered.length > page.offset + page.limit ? inboxCursor(page.offset + page.limit) : null,
    coverage: "existing_decision_sources",
    tier_policies: riskTierPolicyCatalog(),
    no_order: true,
    execution_authority_granted: false,
  };
}

export const EXPECTED_OWNER_QUEUE_FAMILIES_12A = Object.freeze([
  "owner_decisions",
  "promotion_applications",
  "reconciliation_recovery",
  "credential_maintenance",
]);

const RESOLVED_QUEUE_STATUSES = new Set(["decided", "completed", "superseded"]);
const TERMINAL_PROMOTION_STATES = new Set(["human_accepted", "human_rejected", "decided", "completed", "superseded"]);
const VALID_SOURCE_STATUSES = new Set(["ok", "stale", "unavailable", "read_failed"]);
const REGISTERED_BY_PLATFORM = (() => {
  const byPlatform = new Map();
  for (const reg of Object.values(REGISTERED_CREDENTIALS)) {
    if (!byPlatform.has(reg.platform)) byPlatform.set(reg.platform, reg);
  }
  return byPlatform;
})();

function normalizeIsoOrNull(raw) {
  if (typeof raw !== "string" || !raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace(/\.000Z$/, "Z") : null;
}

function projectCsa26QueueItems(csa26Records, sourceObservedAt, nowMs) {
  if (!Array.isArray(csa26Records) || !csa26Records.length) return [];
  const evalIso = new Date(nowMs).toISOString().replace(/\.000Z$/, "Z");
  const prepared = [];
  for (const rec of csa26Records) {
    if (!rec || typeof rec !== "object") continue;
    const reg = rec.credential_id && Object.hasOwn(REGISTERED_CREDENTIALS, rec.credential_id)
      ? REGISTERED_CREDENTIALS[rec.credential_id]
      : REGISTERED_BY_PLATFORM.get(rec.platform);
    if (!reg) continue;
    const expiresIso = normalizeIsoOrNull(rec.expires_at);
    const explicitObsIso = normalizeIsoOrNull(rec.observed_at) || normalizeIsoOrNull(rec.last_rotated_at);
    const evidenceSource = rec.evidence_source || (expiresIso || explicitObsIso ? "operator_declared" : "unobserved");
    const obsIso = evidenceSource === "unobserved"
      ? explicitObsIso
      : (explicitObsIso || sourceObservedAt || (expiresIso ? evalIso : null));
    prepared.push({
      credential_id: reg.credential_id,
      platform: reg.platform,
      credential_type: reg.credential_type,
      environment: rec.environment || reg.default_environment,
      account_slot: rec.account_slot || reg.account_slot,
      renewal_runbook_ref: rec.renewal_runbook_ref || reg.renewal_runbook_ref,
      applicability: rec.applicability || "applicable",
      ...(rec.suppression_reason ? { suppression_reason: rec.suppression_reason } : {}),
      expires_at: expiresIso,
      observed_at: obsIso,
      evaluated_at: evalIso,
      evidence_source: evidenceSource,
    });
  }
  if (!prepared.length) return [];
  const calendar = projectCredentialCalendar(prepared, { evaluated_at: evalIso });
  return calendar.records
    .filter((entry) => entry.requires_action)
    .map((entry) => ({
      id: `credential:${entry.platform}:${entry.credential_id}`,
      family: "credential_maintenance",
      platform: entry.platform,
      account_alias: null,
      target_id: null,
      status: entry.phase === "expired" ? "expired" : "pending",
      decision_state: "pending",
      actionable: true,
      blocked: false,
      expired: entry.phase === "expired",
      blocker_reasons: [],
      title: `Rotate ${entry.platform} ${entry.credential_type}`,
      detail: entry.status_reason || null,
      observed_at: entry.observed_at,
      expires_at: entry.expires_at,
      route: "/?page=health#credential-rotation",
    }));
}

function normalizeQueueItem12A(raw, family, nowMs) {
  const status = typeof raw.status === "string" && raw.status ? raw.status : "pending";
  const expiresAt = normalizeIsoOrNull(raw.expires_at);
  const expired = raw.expired === true
    || status === "expired"
    || (expiresAt !== null && Date.parse(expiresAt) <= nowMs);
  const blockerReasons = Array.isArray(raw.blocker_reasons)
    ? raw.blocker_reasons.filter((r) => typeof r === "string" && r)
    : Array.isArray(raw.blockers)
    ? raw.blockers.filter((r) => typeof r === "string" && r)
    : [];
  const isBlocked = raw.blocked === true
    || blockerReasons.length > 0
    || raw.actionable === false
    || (family !== "credential_maintenance" && expired);
  const actionable = raw.actionable === true && !isBlocked && (family === "credential_maintenance" || !expired);
  return {
    id: String(raw.id || `${family}:unnamed`),
    family,
    platform: typeof raw.platform === "string" ? raw.platform : null,
    account_alias: typeof raw.account_alias === "string" ? raw.account_alias : null,
    target_id: typeof raw.target_id === "string" ? raw.target_id : null,
    status,
    decision_state: typeof raw.decision_state === "string" ? raw.decision_state : null,
    actionable,
    blocked: isBlocked,
    expired,
    blocker_reasons: blockerReasons,
    title: typeof raw.title === "string" ? raw.title : String(raw.id || family),
    detail: typeof raw.detail === "string" ? raw.detail : null,
    observed_at: normalizeIsoOrNull(raw.observed_at),
    expires_at: expiresAt,
    route: typeof raw.route === "string" ? raw.route : null,
  };
}

/**
 * Projects a 4-family unified owner decision queue (12A / SA-A17) with
 * complete-source empty proof, cap/truncation/corrupt omission accounting,
 * C-SA-26 multi-platform credentials, and visible blocked/expired separation.
 */
export function projectUnifiedOwnerQueue12A({
  sources = {},
  expectedFamilies = EXPECTED_OWNER_QUEUE_FAMILIES_12A,
  now = Date.now(),
} = {}) {
  const nowMs = typeof now === "number" && Number.isFinite(now) ? now : Date.parse(now);
  const families = Array.isArray(expectedFamilies) && expectedFamilies.length
    ? expectedFamilies
    : EXPECTED_OWNER_QUEUE_FAMILIES_12A;
  const normalizedSources = [];
  const seenIds = new Set();
  const actionableItems = [];
  const blockedOrExpiredItems = [];
  const allErrors = [];
  const sourceTimes = [];

  for (const family of families) {
    const src = sources?.[family];
    if (!src || typeof src !== "object" || Array.isArray(src)) {
      const err = `${family}_source_missing`;
      normalizedSources.push({
        family,
        status: "read_failed",
        observed_at: null,
        count: 0,
        truncated: false,
        cap: null,
        corrupt_omitted_count: 0,
        errors: [err],
      });
      allErrors.push(err);
      continue;
    }
    const status = VALID_SOURCE_STATUSES.has(src.status) ? src.status : "read_failed";
    const observedAt = normalizeIsoOrNull(src.observed_at);
    if (observedAt) sourceTimes.push(Date.parse(observedAt));
    const cap = Number.isSafeInteger(src.cap) && src.cap >= 0 ? src.cap : null;
    const corruptOmitted = Number.isSafeInteger(src.corrupt_omitted_count) && src.corrupt_omitted_count >= 0
      ? src.corrupt_omitted_count
      : 0;
    const errors = Array.isArray(src.errors) ? src.errors.filter((e) => typeof e === "string" && e) : [];
    const baseItems = Array.isArray(src.items) ? src.items : [];
    const csa26Items = family === "credential_maintenance"
      ? projectCsa26QueueItems(src.csa26_records, observedAt, nowMs)
      : [];
    const combinedRaw = [...baseItems, ...csa26Items];
    const truncated = Boolean(
      src.truncated === true
      || src.has_more === true
      || src.next_cursor
      || (cap !== null && combinedRaw.length > cap)
      || errors.some((e) => /truncated|capped/.test(e)),
    );
    const itemsToProject = cap !== null && combinedRaw.length > cap ? combinedRaw.slice(0, cap) : combinedRaw;
    let unresolvedInSource = 0;
    for (const raw of itemsToProject) {
      if (!raw || typeof raw !== "object") continue;
      const item = normalizeQueueItem12A(raw, family, nowMs);
      if (RESOLVED_QUEUE_STATUSES.has(item.status)) continue;
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      unresolvedInSource += 1;
      if (item.actionable) actionableItems.push(item);
      else blockedOrExpiredItems.push(item);
    }
    normalizedSources.push({
      family,
      status,
      observed_at: observedAt,
      count: unresolvedInSource,
      truncated,
      cap,
      corrupt_omitted_count: corruptOmitted,
      errors,
    });
    allErrors.push(...errors);
  }

  const totalUnresolved = actionableItems.length + blockedOrExpiredItems.length;
  const anyTruncated = normalizedSources.some((s) => s.truncated);
  const corruptOmittedTotal = normalizedSources.reduce((acc, s) => acc + s.corrupt_omitted_count, 0);
  const anyReadFailed = normalizedSources.some((s) => s.status === "read_failed" || s.status === "unavailable");
  const anyStaleOrPartial = normalizedSources.some((s) => s.status === "stale" || s.truncated || s.corrupt_omitted_count > 0 || s.errors.length > 0);
  const queueState = totalUnresolved > 0
    ? "non_empty"
    : anyReadFailed
    ? "read_failed"
    : anyStaleOrPartial
    ? "partial_empty"
    : "verified_empty";

  const oldestObserved = sourceTimes.length && normalizedSources.every((s) => s.observed_at !== null)
    ? new Date(Math.min(...sourceTimes)).toISOString().replace(/\.000Z$/, "Z")
    : null;

  return {
    queue_state: queueState,
    expected_sources: [...families],
    sources: normalizedSources,
    actionable_items: actionableItems,
    blocked_or_expired_items: blockedOrExpiredItems,
    total_unresolved: totalUnresolved,
    truncated: anyTruncated,
    corrupt_omitted_total: corruptOmittedTotal,
    errors: [...new Set(allErrors)],
    observed_at: oldestObserved,
  };
}

function toQueueItem12A(row, category, fallbackObservedAt) {
  const item = canonicalItem(row, category);
  const blockers = Array.isArray(item.blocking_reason_codes) ? item.blocking_reason_codes : [];
  const decisionStatus = typeof item.decision_state?.status === "string"
    ? item.decision_state.status
    : null;
  return {
    id: item.id,
    platform: item.platform ?? null,
    account_alias: item.account_alias ?? null,
    target_id: null,
    status: item.status,
    decision_state: decisionStatus,
    actionable: item.actionable === true,
    blocked: blockers.length > 0 || (item.actionable !== true && item.status !== "decided"),
    expired: item.status === "expired",
    blocker_reasons: blockers,
    title: item.title_key || item.short_id || item.id,
    detail: item.short_id || null,
    observed_at: item.evidence_freshness?.as_of || item.created_at || fallbackObservedAt || null,
    expires_at: item.expires_at || null,
    route: item.action_endpoint || "/?page=decisions",
  };
}

function sourceStatusFromPayload(ok, body, errors = []) {
  if (!ok || !body || typeof body !== "object") return "read_failed";
  if (Array.isArray(errors) && errors.some(code => /(?:source_invalid|source_unavailable|read_failed|unreadable|storage_unavailable|do_unavailable)/.test(code))) {
    return "read_failed";
  }
  const ds = body.data_status;
  if (ds === "unavailable") return "unavailable";
  if (ds === "stale") return "stale";
  if (ds === "ready" || ds === "partial") return "ok";
  return "read_failed";
}

async function readQueueFamilyHttpSource(request, env, reader, {
  family,
  category,
  defaultCap,
  extractRows,
  readErrorCode,
}) {
  if (typeof reader !== "function") {
    return { status: "read_failed", observed_at: null, cap: null, truncated: false, corrupt_omitted_count: 0, errors: [readErrorCode], items: [] };
  }
  try {
    const response = await reader(request, env);
    if (!response || !response.ok) {
      return { status: "read_failed", observed_at: null, cap: null, truncated: false, corrupt_omitted_count: 0, errors: [readErrorCode], items: [] };
    }
    const body = await response.json();
    const observedAt = normalizeIsoOrNull(body?.computed_at) || normalizeIsoOrNull(body?.generated_at);
    const errors = Array.isArray(body?.errors) ? body.errors.filter(e => typeof e === "string" && e) : [];
    const cap = Number.isSafeInteger(body?.cap) && body.cap >= 0 ? body.cap : defaultCap;
    const corruptOmitted = Number.isSafeInteger(body?.corrupt_omitted_count) && body.corrupt_omitted_count >= 0
      ? body.corrupt_omitted_count
      : 0;
    const truncated = Boolean(body?.truncated === true || errors.some(e => /truncated|capped/.test(e)));
    return {
      status: sourceStatusFromPayload(true, body, errors),
      observed_at: observedAt,
      cap,
      truncated,
      corrupt_omitted_count: corruptOmitted,
      errors,
      items: extractRows(body, observedAt),
    };
  } catch {
    return { status: "read_failed", observed_at: null, cap: null, truncated: false, corrupt_omitted_count: 0, errors: [readErrorCode], items: [] };
  }
}

/**
 * Reads all 4 live/stored SA-4 12A owner-queue sources in-process for `/api/desk/overview`
 * using injected existing read handlers plus stored credential-maintenance metadata.
 */
export async function readOwnerQueueSources12A(request, env, {
  owner,
  promotion,
  recovery,
  credential,
  now = Date.now(),
  accountsCredentialCalendarProjection,
} = {}) {
  const [ownerSrc, promoSrc, recoverySrc] = await Promise.all([
    readQueueFamilyHttpSource(request, env, owner, {
      family: "owner_decisions",
      category: "owner_decision",
      defaultCap: 100,
      readErrorCode: "owner_decisions_read_failed",
      extractRows: (body, observedAt) => (Array.isArray(body?.candidates) ? body.candidates : [])
        .map(row => toQueueItem12A(row, "owner_decision", observedAt)),
    }),
    readQueueFamilyHttpSource(request, env, promotion, {
      family: "promotion_applications",
      category: "strategy_promotion",
      defaultCap: 200,
      readErrorCode: "promotion_applications_read_failed",
      extractRows: (body, observedAt) => {
        const merged = new Map((Array.isArray(body?.tickets) ? body.tickets : []).map(r => [r.ticket_id, r]));
        for (const row of (Array.isArray(body?.applications) ? body.applications : [])) {
          if (row.confirmation_execution_mode === "paper" || row.application?.broker_environment === "paper" || row.application_preparation?.preview_request) {
            merged.set(row.ticket_id, row);
          }
        }
        const items = [...merged.values()].map(row => toQueueItem12A(row, "strategy_promotion", observedAt));
        for (const inv of (Array.isArray(body?.invalid_tickets) ? body.invalid_tickets : [])) {
          const blockers = Array.isArray(inv?.decision_material?.blocker_codes) ? inv.decision_material.blocker_codes : ["research_promotion_review_material_invalid"];
          const rawState = typeof inv?.state === "string" ? inv.state : "";
          const isTerminal = TERMINAL_PROMOTION_STATES.has(rawState)
            || inv?.human_decision === "accept"
            || inv?.human_decision === "reject";
          items.push({
            id: `strategy_promotion:${inv?.ticket_id || "invalid"}`,
            platform: null,
            account_alias: null,
            target_id: null,
            status: isTerminal ? "decided" : "pending",
            decision_state: rawState || (isTerminal ? "decided" : "pending"),
            actionable: false,
            blocked: !isTerminal,
            expired: false,
            blocker_reasons: blockers,
            title: inv?.strategy_profile || inv?.ticket_id || "invalid_promotion_ticket",
            detail: inv?.state || null,
            observed_at: observedAt,
            expires_at: null,
            route: "/?page=decisions",
          });
        }
        return items;
      },
    }),
    readQueueFamilyHttpSource(request, env, recovery, {
      family: "reconciliation_recovery",
      category: "reconciliation_recovery",
      defaultCap: 100,
      readErrorCode: "reconciliation_recovery_read_failed",
      extractRows: (body, observedAt) => (Array.isArray(body?.recoveries) ? body.recoveries : [])
        .map(row => toQueueItem12A(row, "reconciliation_recovery", observedAt)),
    }),
  ]);

  let credSrc;
  if (!credential?.ok) {
    credSrc = {
      status: "read_failed",
      observed_at: null,
      cap: null,
      truncated: false,
      corrupt_omitted_count: 0,
      errors: ["credential_maintenance_read_failed"],
      items: [],
      csa26_records: [],
    };
  } else {
    const evalIso = new Date(now).toISOString().replace(/\.000Z$/, "Z");
    const calendar = typeof accountsCredentialCalendarProjection === "function"
      ? accountsCredentialCalendarProjection({ ibkrRecord: credential.raw || null, evaluatedAt: evalIso })
      : null;
    const rawObs = normalizeIsoOrNull(credential.raw?.observed_at)
      || normalizeIsoOrNull(credential.raw?.updated_at)
      || normalizeIsoOrNull(credential.raw?.last_rotated_at)
      || evalIso;
    credSrc = {
      status: "ok",
      observed_at: rawObs,
      cap: null,
      truncated: false,
      corrupt_omitted_count: 0,
      errors: [],
      items: [],
      csa26_records: Array.isArray(calendar?.records) ? calendar.records : [],
    };
  }

  return {
    owner_decisions: ownerSrc,
    promotion_applications: promoSrc,
    reconciliation_recovery: recoverySrc,
    credential_maintenance: credSrc,
  };
}
