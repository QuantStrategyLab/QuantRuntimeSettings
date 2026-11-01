import {
  actorAlias,
  decisionHistoryRows,
  pageQuery,
  settingsDiff,
  shortId,
} from "./presentation.js";
import { todaySummary, strategySummary, notificationLog } from "./operations.js";
import { inbox } from "./inbox.js";
export { inbox } from "./inbox.js";

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
    page = pageQuery(url);
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
      });
      const audit = await deps.audit(env);
      const saves = audit.filter(
        (row) =>
          row.action === "save_account_settings" &&
          row.platform === account.platform &&
          row.key === account.key &&
          Number.isInteger(row.draft_revision),
      );
      const items = await Promise.all(
        [
          ...saves.map((row) => ({
            id: `draft:${account.platform}:${account.key}:${row.draft_revision}:${row.ts}`,
            event: "draft_saved",
            time: row.ts,
            actor: row.login,
            draft_revision: row.draft_revision ?? null,
            source: "bounded_audit_log",
          })),
          ...result.approvals.map((row) => ({
            id: row.request_key || `approval:${account.platform}:${account.key}:${row.draft_revision}:${row.approved_at}`,
            event: "approved",
            time: row.approved_at,
            actor: row.approved_by,
            draft_revision: row.draft_revision,
            source: "profile_application",
          })),
        ].map(async (row) => {
          const { actor, ...rest } = row;
          return { ...rest, short_id: shortId(rest.id, "CH"), actor_alias: await actorAlias(actor) };
        }),
      );
      items.sort((a, b) => b.time.localeCompare(a.time));
      return json({
        status: "partial",
        account_alias: account.key,
        platform: account.platform,
        items: items.slice(page.offset, page.offset + page.limit),
        next_cursor:
          items.length > page.offset + page.limit
            ? String(page.offset + page.limit)
            : null,
        coverage: "bounded_audit_log_and_profile_applications",
        availability: {
          draft_saved: {
            status: "partial",
            unavailable_reason: "bounded_audit_log",
          },
          approved: { status: "ok", unavailable_reason: null },
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
