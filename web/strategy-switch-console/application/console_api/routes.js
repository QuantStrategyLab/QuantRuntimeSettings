import {
  actorAlias,
  decisionHistoryRows,
  pageQuery,
  settingsDiff,
  shortId,
} from "./presentation.js";
import { todaySummary, strategySummary, notificationLog } from "./operations.js";
import { inbox } from "./inbox.js";
import { deskDelivery } from "./desk_delivery.js";
export { inbox } from "./inbox.js";

// Settings history order: newest first, then id, then source, then occurrence
// within the verified window so the ordering key is total.
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const compareNumber = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const historyOrder = (left, right) => compareText(right.time, left.time)
  || compareText(left.id, right.id)
  || compareText(left.source, right.source)
  || (left.occ !== undefined && right.occ !== undefined ? compareNumber(left.occ, right.occ) : 0);
const HISTORY_CURSOR = /^h1\.[A-Za-z0-9_-]{1,2048}$/;
const encodeHistoryCursor = payload => `h1.${btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
const decodeHistoryCursor = text => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0))));
// The first page's stable version: an insertion-sequence high-water mark and
// row count per append-only source, and a full-content digest of the bounded
// legacy log's ordered first-read window with its length and initial
// availability (`d` is absent on an older descriptor, which cannot prove the
// window and expires on continuation).
const sourceMark = value => value && Number.isSafeInteger(value.hwm) && Number.isSafeInteger(value.count) && value.hwm >= 0 && value.count >= 0;
const validHistorySnapshot = value => Boolean(value) && sourceMark(value.journal) && sourceMark(value.approvals)
  && value.legacy && (value.legacy.d === undefined ? (value.legacy.h === null || /^[0-9a-f]{16}$/.test(value.legacy.h)) : /^[0-9a-f]{32}$/.test(value.legacy.d))
  && Number.isSafeInteger(value.legacy.n) && value.legacy.n >= 0 && typeof value.legacy.ok === "boolean";
// Digest of the ordered window (entries in stored order), its length and its availability.
async function legacyWindowDigest(entries, ok) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([ok, entries.length, entries])));
  return [...new Uint8Array(bytes)].slice(0, 16).map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function historyPageQuery(url) {
  const limit = Number(url.searchParams.get("limit") || 25);
  const cursor = url.searchParams.get("cursor") || "";
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (cursor && !HISTORY_CURSOR.test(cursor))) throw new Error("invalid_pagination");
  if (!cursor) return { limit, cursor: null };
  let payload;
  try { payload = decodeHistoryCursor(cursor.slice(3)); } catch { throw new Error("invalid_pagination"); }
  if (!payload || ["a", "t", "i", "s"].some(field => typeof payload[field] !== "string")
    || (Object.hasOwn(payload, "o") && (!Number.isSafeInteger(payload.o) || payload.o < 0))
    || !validHistorySnapshot(payload.v)) throw new Error("invalid_pagination");
  return { limit, cursor: { a: payload.a, snapshot: payload.v, key: { time: payload.t, id: payload.i, source: payload.s,
    ...(Object.hasOwn(payload, "o") ? { occ: payload.o } : {}) } } };
}

export async function consoleApiResponse(request, env, deps) {
  const { json, readSession, command } = deps;
  const url = new URL(request.url),
    path = url.pathname;
  const session = await readSession(request, env);
  if (!session?.allowed)
    return json({ ok: false, error: "login required", error_state: "unauthorized" }, 401);
  if (path === "/api/account-settings/draft") {
    if (request.method !== "POST")
      return json({ ok: false, error: "method_not_allowed" }, 405);
    // The existing handler owns origin/admin/identity checks and the atomic save.
    return deps.saveDraft(request, env);
  }
  if (request.method !== "GET")
    return json({ ok: false, error: "method_not_allowed" }, 405);
  const includeInbox = path === "/api/accounts" && url.searchParams.has("include");
  if (includeInbox && (url.searchParams.getAll("include").length !== 1
    || url.searchParams.get("include") !== "decisions-inbox"
    || [...url.searchParams.keys()].some(key => key !== "include"))) {
    return json({ ok: false, error: "invalid_accounts_include" }, 400);
  }
  // The inbox owns its opaque cursor; the numeric page cursor below does not apply.
  if (path === "/api/decisions-inbox") {
    try {
      return json(await inbox(request, env, deps));
    } catch (error) {
      if (error?.message === "invalid_pagination")
        return json({ ok: false, error: "invalid_pagination" }, 400);
      throw error;
    }
  }
  let page;
  try {
    page = path === "/api/account-settings/history" ? historyPageQuery(url) : pageQuery(url);
  } catch {
    return json({ ok: false, error: "invalid_pagination" }, 400);
  }
  try {
    if (path === "/api/owner-decisions/history") {
      const result = await command(env, {
        action: "console_decision_history",
        actor: session.login,
        ...page,
      });
      return json({
        status: "ok",
        items: await decisionHistoryRows(result.rows.slice(0, page.limit)),
        next_cursor:
          result.rows.length > page.limit
            ? String(page.offset + page.limit)
            : null,
        coverage: "durable_human_decision_records",
      });
    }
    if (path === "/api/desk/alerts/delivery") return json(await deskDelivery(env, deps));
    if (path === "/api/notifications/send-log") return json(await notificationLog(env, deps));
    const config = await deps.accountOptions(env);
    const accounts = Object.entries(config.options || {}).flatMap(
      ([platform, rows]) => rows.map((row) => ({ ...row, platform })),
    );
    if (path === "/api/runtime/today") return json(await todaySummary(request, env, deps, accounts));
    if (path === "/api/strategies/summary") return json(await strategySummary(request, env, deps, accounts,
      await deps.currentStrategies(config.options, env)));
    if (path === "/api/accounts") {
      const meta = await command(env, {
        action: "console_account_metadata",
        actor: session.login,
      });
      const queue = await inbox(request, env, deps);
      const accountBody = {
        status: queue.status !== "ok" ? "partial" : "ok",
        coverage: "configured_accounts_explicit_decision_bindings",
        unassigned_decision_count: queue.items.filter(
          (i) => !i.account_alias && i.status === "pending",
        ).length,
        accounts: accounts.map((a) => {
          const row = meta.rows.find(
            (r) => r.platform === a.platform && r.account_key === a.key,
          );
          return {
            account_alias: a.key,
            platform: a.platform,
            pending_draft_count: row?.pending_draft_count || 0,
            pending_decision_count:
              queue.status !== "ok"
                ? null
                : queue.items.filter(
                    (i) =>
                      i.account_alias === a.key &&
                      (!i.platform || i.platform === a.platform) &&
                      i.status === "pending",
                  ).length,
            last_change_at: row?.last_change_at || null,
          };
        }),
      };
      // The accounts projection already needs this exact inbox for its counts.
      // Share only this request's value; fresh review/POST paths stay separate.
      return json(includeInbox ? { accounts: accountBody, inbox: queue } : accountBody);
    }
    const alias = url.searchParams.get("account"),
      platform = url.searchParams.get("platform");
    const key = url.searchParams.get("key");
    const matches = accounts.filter(
      (a) => (!platform || a.platform === platform) && a.key === (alias || key),
    );
    if (matches.length !== 1)
      return json(
        { ok: false, error: "account_alias_required_or_ambiguous" },
        400,
      );
    const account = matches[0];
    if (path === "/api/accounts/run-controls")
      return json(await deps.runControls(request, env, account, session));
    if (path === "/api/account-settings/diff") {
      const readUrl = new URL("/api/account-settings", request.url);
      readUrl.searchParams.set("platform", account.platform);
      readUrl.searchParams.set("key", account.key);
      const response = await deps.settings(
        new Request(readUrl, { headers: request.headers }),
        env,
      );
      if (!response.ok) return response;
      const settings = await response.json();
      return json({
        status:
          settings.draft.status === "identity_conflict" ? "partial" : "ok",
        account_alias: account.key,
        platform: account.platform,
        draft_revision: settings.draft.revision,
        identity_status: settings.draft.status,
        rows: settingsDiff(settings),
        no_order: true,
        execution_authority_granted: false,
      });
    }
    if (path === "/api/account-settings/history") {
      const result = await command(env, {
        action: "console_settings_history",
        actor: session.login,
        platform: account.platform,
        key: account.key,
        ...(page.cursor ? { snapshot: page.cursor.snapshot } : {}),
      });
      const expired = () => json({ ok: false, error: "history_snapshot_expired" }, 409);
      if (result.expired === true) return expired();
      let audit = [];
      let auditStatus = {
        status: "partial",
        unavailable_reason: "bounded_audit_log",
      };
      try {
        const loaded = await deps.audit(env);
        if (Array.isArray(loaded)) {
          audit = loaded;
        } else {
          auditStatus = {
            status: "unavailable",
            unavailable_reason: "stored_records_unreadable",
          };
        }
      } catch {
        auditStatus = {
          status: "unavailable",
          unavailable_reason: "stored_records_unreadable",
        };
      }
      // The bounded legacy log is newest-first: the first read pins its whole
      // ordered window and initial availability. A continuation keeps the
      // pinned availability and, for a readable non-empty window, only the
      // original suffix, which must match the pinned content as a whole; a
      // prepend leaves it intact, while a replaced, evicted or unreadable
      // window means the pinned version is gone.
      const legacyOk = auditStatus.status === "partial";
      let legacy;
      if (!page.cursor) {
        legacy = { d: await legacyWindowDigest(legacyOk ? audit : [], legacyOk), n: legacyOk ? audit.length : 0, ok: legacyOk };
      } else {
        legacy = page.cursor.snapshot.legacy;
        if (legacy.d === undefined) return expired();
        if (!legacy.ok) {
          audit = [];
          auditStatus = { status: "unavailable", unavailable_reason: "stored_records_unreadable" };
        } else if (legacy.n === 0) {
          audit = [];
          auditStatus = { status: "partial", unavailable_reason: "bounded_audit_log" };
        } else {
          if (!legacyOk || audit.length < legacy.n) return expired();
          const original = audit.slice(audit.length - legacy.n);
          if (await legacyWindowDigest(original, true) !== legacy.d) return expired();
          audit = original;
          auditStatus = { status: "partial", unavailable_reason: "bounded_audit_log" };
        }
      }
      const saves = audit.filter(
        (row) =>
          row.action === "save_account_settings" &&
          row.platform === account.platform &&
          row.key === account.key &&
          Number.isInteger(row.draft_revision),
      );
      const managementChanges = Array.isArray(result.management_changes)
        ? result.management_changes
        : [];
      const entries = (await Promise.all(
        [
          ...saves.map((row, occ) => ({
            id: `draft:${account.platform}:${account.key}:${row.draft_revision}:${row.ts}`,
            event: "draft_saved",
            time: row.ts,
            actor: row.login,
            draft_revision: row.draft_revision ?? null,
            source: "bounded_audit_log",
            occ,
          })),
          ...(result.approvals || []).map((row) => ({
            id: row.request_key || `approval:${account.platform}:${account.key}:${row.draft_revision}:${row.approved_at}`,
            event: "approved",
            time: row.approved_at,
            actor: row.approved_by,
            draft_revision: row.draft_revision,
            source: "profile_application",
            occ: 0,
          })),
          ...managementChanges.map((row) => ({
            id: row.event_id,
            event: "account_management_change",
            time: row.occurred_at,
            actor: row.actor,
            draft_revision: row.draft_revision ?? null,
            management_revision: row.new_applied_revision ?? null,
            old_management_revision: row.old_applied_revision ?? null,
            old_management_enabled:
              row.old_management_enabled === 1
                ? true
                : row.old_management_enabled === 0
                  ? false
                  : null,
            new_management_enabled: row.new_management_enabled === 1,
            change_ref: row.event_id,
            source: "account_management_change",
            occ: 0,
          })),
        ].map(async ({ actor, occ, ...rest }) => {
          const item = { ...rest, short_id: shortId(rest.id, "CH"), actor_alias: await actorAlias(actor) };
          return { item, key: { time: item.time, id: item.id, source: item.source, occ } };
        }),
      )).sort((left, right) => historyOrder(left.key, right.key));
      // A later page is the remainder of the first page's snapshot: membership
      // is the pinned version of every source, and the last emitted ordering
      // key only positions the traversal inside it.
      const accountRef = `${account.platform}/${account.key}`;
      if (page.cursor && page.cursor.a !== accountRef) return json({ ok: false, error: "invalid_pagination" }, 400);
      if (page.cursor && page.cursor.key.occ === undefined) {
        const matches = entries.filter(entry => entry.key.time === page.cursor.key.time
          && entry.key.id === page.cursor.key.id && entry.key.source === page.cursor.key.source);
        if (matches.length > 1) return expired();
      }
      const snapshot = page.cursor ? page.cursor.snapshot : { ...result.snapshot, legacy };
      const remaining = entries.filter(entry => !page.cursor || historyOrder(page.cursor.key, entry.key) < 0);
      const emitted = remaining.slice(0, page.limit);
      const last = emitted.at(-1);
      return json({
        status: "partial",
        account_alias: account.key,
        platform: account.platform,
        items: emitted.map(entry => entry.item),
        next_cursor: remaining.length > emitted.length
          ? encodeHistoryCursor({ a: accountRef, v: snapshot, t: last.key.time, i: last.key.id, s: last.key.source, o: last.key.occ })
          : null,
        coverage: "bounded_audit_log_and_durable_account_records",
        availability: {
          draft_saved: auditStatus,
          approved: { status: "ok", unavailable_reason: null },
          management_change: Array.isArray(result.management_changes)
            ? { status: "ok", unavailable_reason: null }
            : {
                status: "unavailable",
                unavailable_reason: "management_journal_unavailable",
              },
          effect_verification: {
            status: "unavailable",
            unavailable_reason: "effect_verification_not_recorded",
          },
        },
      });
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch {
    return json(
      {
        status: "read_failed",
        unavailable_reason: "stored_records_unreadable",
      },
      503,
    );
  }
}
