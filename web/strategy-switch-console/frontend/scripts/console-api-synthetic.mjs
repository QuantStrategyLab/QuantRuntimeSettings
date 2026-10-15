// Fictional local-only API examples. No Worker, credentials or provider access.
import { performanceBlocks } from "../../application/console_api/performance.js";
import {
  canonicalItem,
  settingsDiff,
} from "../../application/console_api/presentation.js";
export function consoleApiFixture(
  path,
  query,
  scenario = "api-ready",
  method = "GET",
  now = Date.now(),
) {
  const paths = [
    "/api/decisions-inbox",
    "/api/owner-decisions/history",
    "/api/accounts",
    "/api/account-settings/diff",
    "/api/account-settings/history",
    "/api/account-settings/draft",
  ];
  if (!paths.includes(path) && !path.startsWith("/api/performance/"))
    return undefined;
  if (
    method !== "GET" &&
    !(path === "/api/account-settings/draft" && method === "POST")
  )
    return { status: 405, body: { ok: false, error: "synthetic_read_only" } };
  if (scenario === "api-read-failed")
    return {
      status: 503,
      body: path.startsWith("/api/performance/")
        ? {
            schema_version: "console_api.v1",
            scope: "all",
            range: "ALL",
            status: "unavailable",
            unavailable_reason: "stored_records_unreadable",
            as_of: null,
            coverage: {},
            value_kind: "asset_change",
          }
        : {
            status: "read_failed",
            unavailable_reason: "stored_records_unreadable",
          },
    };
  const empty = scenario === "api-empty",
    date = new Date(now - (scenario === "api-stale" ? 10 : 0) * 86400000)
      .toISOString()
      .slice(0, 10);
  const at = `${date}T12:00:00Z`;
  const item = canonicalItem(
    {
      ticket_id: "synthetic-proposal",
      strategy_profile: "synthetic-growth",
      created_at: at,
      proposed_params: { rebalance_days: 20 },
      shadow_passed: true,
    },
    "strategy_promotion",
  );
  const recovery = canonicalItem(
    {
      recovery: {
        recovery_id: "synthetic-recovery",
        platform: "longbridge",
        strategy_profile: "synthetic-balanced",
        first_observed_at: at,
        last_observed_at: at,
      },
      freshness: { data_status: scenario === "api-stale" ? "stale" : "ready" },
    },
    "reconciliation_recovery",
  );
  const credential = canonicalItem(
    {
      id: "synthetic-credential",
      phase: "7",
      expires_at: new Date(now + 7 * 86400000).toISOString(),
    },
    "credential_maintenance",
  );
  const settings = {
    ok: true,
    platform: "longbridge",
    key: "synthetic-alpha",
    instance_revision: 1,
    identity: { platform: "longbridge", key: "synthetic-alpha" },
    draft: {
      status: "current",
      revision: 2,
      identity: {},
      current_identity: {},
      overrides: {
        strategy_profile: "synthetic-growth",
        reserved_cash_ratio: "0.15",
        income_layer_enabled: false,
      },
    },
    effective: {
      strategy_profile: { status: "known", value: "synthetic-balanced" },
      reserved_cash_ratio: { status: "known", value: "0.1" },
    },
    adopted: false,
    no_order: true,
    execution_authority_granted: false,
  };
  const status = scenario === "api-partial" ? "partial" : "ok";
  if (path === "/api/decisions-inbox")
    return {
      body: {
        status,
        sources: [
          { source: "owner", status: "ok" },
          { source: "promotion", status: "ok" },
          {
            source: "recovery",
            status: scenario === "api-stale" ? "stale" : "ok",
          },
          { source: "credential", status: "ok" },
        ],
        items: empty ? [] : [recovery, item, credential],
        coverage: "synthetic",
        no_order: true,
        execution_authority_granted: false,
      },
    };
  if (path === "/api/owner-decisions/history")
    return {
      body: {
        status: "ok",
        items: empty
          ? []
          : [
              {
                item_id: item.id,
                category: item.category,
                actor_alias: "actor-synthetic",
                time: at,
                action: "decline_intent",
                evidence_sha256: "a".repeat(64),
              },
            ],
        next_cursor: null,
        coverage: "synthetic",
      },
    };
  if (path === "/api/accounts")
    return {
      body: {
        status,
        coverage: "synthetic",
        unassigned_decision_count: 1,
        accounts: empty
          ? []
          : [
              {
                account_alias: "synthetic-alpha",
                platform: "longbridge",
                pending_draft_count: 3,
                pending_decision_count: 1,
                last_change_at: at,
              },
            ],
      },
    };
  if (path === "/api/account-settings/diff")
    return {
      body: {
        status: "ok",
        account_alias: settings.key,
        platform: settings.platform,
        draft_revision: 2,
        identity_status: "current",
        rows: empty ? [] : settingsDiff(settings),
        no_order: true,
        execution_authority_granted: false,
      },
    };
  if (path === "/api/account-settings/draft")
    return scenario === "api-conflict"
      ? {
          status: 409,
          body: {
            ok: false,
            error: "account_settings_draft_revision_conflict",
          },
        }
      : { body: settings };
  if (path === "/api/account-settings/history")
    return {
      body: {
        status: "partial",
        account_alias: settings.key,
        platform: settings.platform,
        items: empty
          ? []
          : [
              {
                event: "draft_saved",
                time: at,
                actor_alias: "actor-synthetic",
                draft_revision: 2,
                source: "synthetic",
              },
              {
                event: "approved",
                time: at,
                actor_alias: "actor-synthetic",
                draft_revision: 1,
                source: "synthetic",
              },
            ],
        next_cursor: null,
        coverage: "synthetic",
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
      },
    };
  const dates = Array.from({ length: 10 }, (_, i) =>
    new Date(Date.parse(`${date}T00:00:00Z`) - (9 - i) * 86400000)
      .toISOString()
      .slice(0, 10),
  );
  const points = empty
    ? []
    : dates
        .filter((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()))
        .map((d, i) => ({
          date: d,
          value: 1000 + i * 10 + (i >= 3 ? 500 : 0),
          externalFlow: scenario === "api-partial" ? null : i === 3 ? 500 : 0,
        }));
  const accounts = [
    {
      account_key: "synthetic-alpha",
      platform: "longbridge",
      observed_finished_at: at,
      positions_scope: "stocks_only",
      positions: empty
        ? []
        : [
            {
              symbol: "SYNTH_A",
              currency: "USD",
              quantity: "5",
              market_value: "550",
              avg_cost: "100",
            },
            {
              symbol: "SYNTH_B",
              currency: "USD",
              quantity: "2",
              market_value: "200",
            },
          ],
    },
  ];
  const blocks = performanceBlocks({
    accounts,
    histories: [{ id: "synthetic-alpha", currency: "USD", points }],
    benchmarks: [
      {
        id: "synthetic-index",
        points: points.map((p, i) => ({ date: p.date, value: 100 + i })),
      },
    ],
    range: query.get("range") || "ALL",
    today: new Date(now).toISOString().slice(0, 10),
    year: Number(query.get("year") || date.slice(0, 4)),
    month: query.has("month") ? Number(query.get("month")) : null,
  });
  const block = blocks[path.split("/").at(-1)];
  return block
    ? {
        body: {
          schema_version: "console_api.v1",
          scope: query.get("scope") || "all",
          range: query.get("range") || "ALL",
          ...block,
        },
      }
    : { status: 404, body: { ok: false, error: "not_found" } };
}
