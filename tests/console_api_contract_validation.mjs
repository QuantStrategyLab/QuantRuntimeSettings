import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { consoleApiFixture } from "../web/strategy-switch-console/frontend/scripts/console-api-synthetic.mjs";
import {
  consoleApiResponse,
  inbox,
} from "../web/strategy-switch-console/application/console_api/routes.js";
import {
  decisionFields,
  actorAlias,
  decisionHistoryRows,
} from "../web/strategy-switch-console/application/console_api/presentation.js";
import { performanceResponse } from "../web/strategy-switch-console/application/console_api/performance_routes.js";
const schemas = JSON.parse(
  readFileSync(
    new URL(
      "../web/strategy-switch-console/contracts/console-api.schema.json",
      import.meta.url,
    ),
  ),
).$defs;
export function validate(name, data) {
  const visit = (schema, value, path) => {
    if (schema.const !== undefined) assert.deepEqual(value, schema.const, path);
    if (schema.enum) assert.ok(schema.enum.includes(value), path + ": enum");
    if (schema.type) {
      const kinds = Array.isArray(schema.type) ? schema.type : [schema.type];
      assert.ok(
        kinds.some((t) =>
          t === "null"
            ? value === null
            : t === "array"
              ? Array.isArray(value)
              : t === "integer"
                ? Number.isSafeInteger(value)
                : t === "number"
                  ? typeof value === "number" && Number.isFinite(value)
                  : t === "object"
                    ? value !== null &&
                      typeof value === "object" &&
                      !Array.isArray(value)
                    : typeof value === t,
        ),
        path + ": type",
      );
    }
    if (schema.pattern) assert.match(value, new RegExp(schema.pattern), path);
    for (const key of schema.required || [])
      assert.ok(Object.hasOwn(value, key), path + "." + key + ": required");
    if (schema.properties)
      for (const [key, sub] of Object.entries(schema.properties))
        if (Object.hasOwn(value, key)) visit(sub, value[key], path + "." + key);
    if (schema.items)
      value.forEach((item, i) => visit(schema.items, item, `${path}[${i}]`));
  };
  assert.ok(schemas[name], name);
  visit(schemas[name], data, name);
}
assert.throws(() => validate("trades", { status: "ok" }));
const endpoints = {
  "/api/decisions-inbox": "inbox",
  "/api/owner-decisions/history": "decision_history",
  "/api/accounts": "accounts",
  "/api/account-settings/diff": "settings_diff",
  "/api/account-settings/history": "settings_history",
  "/api/account-settings/draft": "draft",
  ...Object.fromEntries(
    ["calendar", "summary", "returns", "assets", "holdings", "trades"].map(
      (x) => ["/api/performance/" + x, x],
    ),
  ),
};
for (const scenario of [
  "api-ready",
  "api-empty",
  "api-partial",
  "api-stale",
  "api-not-connected",
  "api-read-failed",
  "api-conflict",
])
  for (const [endpoint, name] of Object.entries(endpoints)) {
    const fixture = consoleApiFixture(
      endpoint,
      new URLSearchParams("month=10&year=2026"),
      scenario,
      endpoint.endsWith("/draft") ? "POST" : "GET",
      Date.parse("2026-10-15T12:00:00Z"),
    );
    validate(
      fixture.status === 409
        ? "conflict"
        : fixture.status === 503
          ? endpoint.startsWith("/api/performance/")
            ? "performance_unavailable"
            : "read_failed"
          : name,
      fixture.body,
    );
  }
const json = (b, status = 200) => Response.json(b, { status });
const login = async () => ({
  allowed: true,
  login: "synthetic-owner",
  admin: true,
});
const emptySource = async () =>
  json({ data_status: "ready", candidates: [], tickets: [], recoveries: [] });
const deps = {
  json,
  readSession: login,
  command: async () => ({ rows: [] }),
  owner: emptySource,
  promotion: emptySource,
  recovery: emptySource,
  credential: async () =>
    json({ id: "synthetic-expiry", requires_action: true, phase: "7" }),
  accountOptions: async () => ({
    options: { longbridge: [{ key: "synthetic-alpha" }] },
  }),
  settings: async () =>
    json({
      draft: {
        status: "current",
        revision: 1,
        overrides: { reserved_cash_ratio: "0.2" },
      },
      effective: { reserved_cash_ratio: { status: "known", value: "0.1" } },
    }),
  audit: async () => [],
  saveDraft: async () =>
    json({ ok: false, error: "account_settings_draft_revision_conflict" }, 409),
};
let result = await inbox(
  new Request("https://console.example/api/decisions-inbox"),
  {},
  deps,
);
validate("inbox", result);
assert.equal(result.items.length, 1);
assert.equal(result.items[0].id, "credential:synthetic-expiry");
assert.equal(result.items[0].priority, "medium");
result = await inbox(
  new Request("https://console.example/api/decisions-inbox"),
  {},
  {
    ...deps,
    owner: async () => {
      throw Error("offline");
    },
  },
);
assert.equal(result.status, "read_failed");
assert.equal(result.sources[0].status, "read_failed");
assert.equal(
  decisionFields({ recovery: {}, confirmation: {} }, "reconciliation_recovery")
    .status,
  "decided",
);
assert.equal(
  decisionFields(
    { ticket_id: "synthetic", expires_at: "2020-01-01" },
    "strategy_promotion",
  ).status,
  "expired",
);
assert.equal(
  decisionFields(
    {
      ticket_id: "synthetic",
      notes: ["audit prose"],
      proposed_params: { audit_note: "internal", rebalance_days: 5 },
    },
    "strategy_promotion",
  ).diff.length,
  1,
);
const alias = await actorAlias("synthetic-owner");
assert.match(alias, /^actor-[a-f0-9]{16}$/);
assert.equal(alias, await actorAlias("synthetic-owner"));
const rows = await decisionHistoryRows([
  {
    kind: "owner",
    subject_id: "fictional",
    actor: "synthetic-owner",
    action: "approve_limited_live_canary",
    decided_at: "2026-10-15T12:00:00Z",
    material_key: "a".repeat(64),
  },
]);
assert.equal(rows[0].action, "adopt_intent");
assert.ok(!JSON.stringify(rows).includes("synthetic-owner"));
for (const [endpoint, name] of Object.entries(endpoints).filter(
  ([p]) => !p.startsWith("/api/performance/"),
)) {
  const response = await consoleApiResponse(
    new Request(
      "https://console.example" + endpoint + "?account=synthetic-alpha",
      { method: endpoint.endsWith("/draft") ? "POST" : "GET" },
    ),
    {},
    { ...deps, command: async () => ({ rows: [], approvals: [] }) },
  );
  validate(
    endpoint.endsWith("/draft") ? "conflict" : name,
    await response.json(),
  );
}
const failed = await consoleApiResponse(
  new Request("https://console.example/api/owner-decisions/history"),
  {},
  {
    ...deps,
    command: async () => {
      throw Error("offline");
    },
  },
);
assert.equal(failed.status, 503);
validate("read_failed", await failed.json());
assert.equal(
  (
    await consoleApiResponse(
      new Request(
        "https://console.example/api/owner-decisions/history?limit=1000",
      ),
      {},
      deps,
    )
  ).status,
  400,
);
const now = Date.now(),
  dates = [
    new Date(now - 86400000).toISOString().slice(0, 10),
    new Date(now).toISOString().slice(0, 10),
  ];
const perfDeps = {
  json,
  readSession: login,
  accountOptions: async () => ({
    options: { ibkr: [{ key: "synthetic-alpha", broker_environment: "live" }] },
  }),
  facts: async () =>
    json({
      accounts: [
        {
          platform: "ibkr",
          account_key: "synthetic-alpha",
          binding_status: "bound",
          balances: [{ currency: "USD" }],
          positions: [
            {
              symbol: "SYNTH",
              quantity: "1",
              market_value: "120",
              currency: "USD",
            },
          ],
          positions_scope: "stocks_only",
        },
      ],
    }),
  history: async () =>
    json({
      platform: "ibkr",
      account_key: "synthetic-alpha",
      series: {
        currency: "USD",
        points: dates.map((date, i) => ({
          observation_date: date,
          currency: "USD",
          net_assets: String(100 + i),
        })),
      },
    }),
  wallet: async () => {
    throw Error("not expected");
  },
  benchmarks: async () =>
    json({
      points: dates.map((d, i) => ({
        seriesId: "synthetic-index",
        observationDate: d,
        close: String(100 + i),
      })),
    }),
};
for (const part of [
  "calendar",
  "summary",
  "returns",
  "assets",
  "holdings",
  "trades",
]) {
  const response = await performanceResponse(
    new Request(
      "https://console.example/api/performance/" +
        part +
        "?scope=synthetic-alpha",
    ),
    {},
    perfDeps,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  validate(part, body);
  if (part === "summary") {
    assert.equal(body.twr_return_percent, null);
    assert.equal(body.max_drawdown.percent, null);
    assert.equal(body.value_kind, "asset_change");
  }
  if (part === "trades") assert.ok(!("trade_count" in body));
}
assert.equal(
  (
    await performanceResponse(
      new Request("https://console.example/api/performance/assets?range=bad"),
      {},
      perfDeps,
    )
  ).status,
  400,
);
assert.equal(
  (
    await performanceResponse(
      new Request("https://console.example/api/performance/assets"),
      {},
      { ...perfDeps, readSession: async () => null },
    )
  ).status,
  401,
);
console.log("console_api_contract_validation: PASS");

const unspecifiedEnvironment = {
  ...perfDeps,
  accountOptions: async () => ({
    options: { ibkr: [{ key: "synthetic-alpha" }] },
  }),
};
const unspecifiedRead = await performanceResponse(
  new Request("https://console.example/api/performance/assets?scope=all"),
  {},
  unspecifiedEnvironment,
);
const unspecifiedBody = await unspecifiedRead.json();
assert.equal(
  unspecifiedBody.points.length,
  2,
  "all uses the existing chart cohort when an environment label is absent",
);
const paperRead = await performanceResponse(
  new Request("https://console.example/api/performance/assets?scope=all"),
  {},
  {
    ...unspecifiedEnvironment,
    facts: async () =>
      json({
        accounts: [
          {
            platform: "ibkr",
            account_key: "synthetic-alpha",
            broker_environment: "paper",
            binding_status: "bound",
            balances: [{ currency: "USD" }],
          },
        ],
      }),
  },
);
assert.equal(
  (await paperRead.json()).points.length,
  0,
  "facts still exclude a known paper account",
);
