import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import worker, { __test } from "../web/strategy-switch-console/worker.js";
import { KvDirectory, MANIFEST_KEY } from "../web/strategy-switch-console/kv_directory.js";
import { inbox, consoleApiResponse } from "../web/strategy-switch-console/application/console_api/routes.js";
import { readFailure } from "../web/strategy-switch-console/application/console_api/read_failures.js";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import React from "../web/strategy-switch-console/frontend/node_modules/react/index.js";
import { renderToStaticMarkup } from "../web/strategy-switch-console/frontend/node_modules/react-dom/server.node.js";

const originalFetch = globalThis.fetch;
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw Error("external_fetch_forbidden"); };

const request = new Request("https://fixture.invalid/api/decisions-inbox");
const empty = async () => Response.json({ data_status: "ready", candidates: [], tickets: [], recoveries: [], requires_action: false });
const deps = { owner: empty, promotion: empty, recovery: empty, credential: empty };
for (const [code, status, state] of [
  ["kv_list_daily_limit_exceeded", 503, "quota_exhausted"],
  ["kv_directory_uninitialized", 503, "index_missing"],
  ["kv_directory_migration_pending", 503, "index_incomplete"],
  ["kv_directory_migration_failed", 503, "index_unavailable"],
  ["kv_directory_record_unavailable", 503, "index_unavailable"],
  ["private-provider-token", 503, "unknown"],
  ["private-provider-token", 401, "unauthorized"],
  ["private-provider-token", 403, "unauthorized"],
]) {
  const result = await inbox(request, {}, { ...deps, promotion: async () => Response.json({ error: code }, { status }) });
  assert.equal(result.status, "read_failed");
  assert.equal(result.error_state, state);
  assert.equal(result.sources[1].error_state, state);
  assert.doesNotMatch(JSON.stringify(result), /private-provider-token/);
}
const htmlUnauthorized = await inbox(request, {}, { ...deps, owner: async () => new Response("private-auth-page", { status: 401 }) });
assert.equal(htmlUnauthorized.error_state, "unauthorized");
const businessQuota = await inbox(request, {}, { ...deps,
  owner: async () => Response.json({ data_status: "unavailable", errors: ["kv_list_daily_limit_exceeded"] }) });
assert.equal(businessQuota.error_state, "quota_exhausted", "HTTP 200 business errors must be classified");
const thrownQuota = await inbox(request, {}, { ...deps, owner: async () => { throw Error("KV list() limit exceeded for the day."); } });
assert.equal(thrownQuota.error_state, "quota_exhausted");
assert.equal(readFailure("unrecognized").failure_reason, "unknown");
assert.equal((await inbox(request, {}, deps)).error_state, null);
const unauthenticated = await consoleApiResponse(request, {}, { json: (body, status) => Response.json(body, { status }), readSession: async () => null });
assert.equal(unauthenticated.status, 401);
assert.equal((await unauthenticated.json()).error_state, "unauthorized");

// Exercise the actual Worker read routes with a poison list/write implementation,
// not the legacy test adapter (which deliberately discovers fixtures via list).
const now = Date.now();
for (const receiver of ["durable", "mirror", "legacy"]) {
  for (const state of [null,
    { keys: [], complete: false, retry_at: now + 3600000, error: "kv_list_daily_limit_exceeded" },
    { keys: [], complete: false, retry_at: now + 60000, cursor: "synthetic-next", error: "kv_directory_migration_pending" },
    { keys: ["research_promotion_ticket:synthetic-indexed"], complete: true, retry_at: 0, scanned_at: now },
    { keys: [], complete: true, retry_at: 0, scanned_at: now,
      last_error: { code: "kv_list_daily_limit_exceeded", at: now - 86400000 } },
  ]) {
    let lists = 0, writes = 0, manifestGets = 0, recordGets = 0;
    const actions = [];
    const store = {
      async get(key) { if (key === MANIFEST_KEY) { manifestGets++; return state ? JSON.stringify({ ...state, schema: "qsl_console_kv_directory.v1" }) : null; } if (key === "research_promotion_ticket:synthetic-indexed") recordGets++; return null; },
      async list() { lists++; throw Error("read_path_must_not_list"); },
      async put() { writes++; throw Error("read_path_must_not_write"); },
    };
    const directory = new KvDirectory({ async get() { return structuredClone(state); }, async put() { writes++; throw Error("read_path_must_not_write"); } }, store);
    const env = { SESSION_SECRET: "synthetic-todo-test", ALLOWED_GITHUB_LOGINS: "fixture-reader", STRATEGY_SWITCH_CONFIG: store };
    if (receiver !== "mirror") env.STRATEGY_SWITCH_RUNTIME_INSTANCES = {
      idFromName: name => name,
      get: name => ({ async fetch(_url, init) {
        const command = JSON.parse(init.body); actions.push(command.action);
        if (name !== "console-kv-directory-v1") {
          assert.equal(command.action, "credential_maintenance_read");
          return Response.json({ ok: true, requires_action: false });
        }
        assert.ok(["read", "status"].includes(command.action), "GET may only read the index");
        if (receiver === "legacy") return Response.json({ error: "runtime_instance_actor_required" }, { status: 400 });
        const result = await directory.command(command);
        return Response.json(result, { status: result.ok ? 200 : 503 });
      } }),
    };
    const cookie = `qsl_switch_session=${await __test.makeSession("fixture-reader", [], env)}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const path of ["/api/admin/kv-directory", "/api/decisions-inbox", "/api/owner-decisions", "/api/research-promotion-tickets", "/api/reconciliation-recovery"]) {
        const response = await worker.fetch(new Request(`https://fixture.invalid${path}`, { headers: { Cookie: cookie } }), env);
        const body = await response.json();
        if (path === "/api/decisions-inbox") {
          assert.equal(body.status, "read_failed", JSON.stringify(body.sources));
          if (!state?.complete) {
            assert.equal(body.error_state, !state ? "index_missing" : state.error === "kv_list_daily_limit_exceeded" ? "quota_exhausted" : "index_incomplete");
            assert.equal(body.directory.complete, state ? false : null);
            assert.equal(body.directory.retry_at, state?.retry_at || null);
          } else if (state.keys.length) {
            assert.equal(body.error_state, "index_unavailable");
            assert.equal(body.sources[1].failure_reason, "kv_directory_record_unavailable");
            assert.equal(body.directory.complete, true);
          } else assert.equal(body.directory, null, "a historical error must not cause a new status read on healthy sources");
        }
      }
    }
    if (state?.keys.length) assert.ok(recordGets > 0, "indexed records use a targeted key GET");
    assert.equal(lists, 0, `${receiver}: all repeated read routes must avoid list`);
    assert.equal(writes, 0, `${receiver}: reads must not migrate or initialize storage`);
    if (receiver !== "durable") assert.ok(manifestGets > 0, "compatibility reads use a targeted manifest GET");
  }
}

const frontend = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const temporary = await mkdtemp(frontend + "node_modules/.todo-state-");
try {
  const compiled = await build({ stdin: { contents: `export { InboxReadFailed } from "./components/InboxReadFailed"; export { I18nProvider, translate } from "./i18n"; export { inboxFailureState } from "./lib/inboxFailure"; export { AccessError, HttpError } from "./api/client";`, resolveDir: frontend + "src", loader: "tsx" }, bundle: true, platform: "node", format: "esm", packages: "external", write: false });
  const file = temporary + "/ui.mjs"; await writeFile(file, compiled.outputFiles[0].text);
  const ui = await import(pathToFileURL(file));
  assert.equal(ui.inboxFailureState(null, new ui.AccessError(401)), "unauthorized");
  assert.equal(ui.inboxFailureState(null, new ui.HttpError(503, { error_state: "quota_exhausted" })), "quota_exhausted");
  for (const language of ["zh", "en"]) for (const state of ["quota_exhausted", "unauthorized", "index_missing", "index_incomplete", "index_unavailable", "unknown"]) {
    const data = { status: "read_failed", error_state: state, sources: [{ source: "promotion", status: "read_failed", error_state: state }], items: [], directory: { complete: false, retry_at: now + 60000 } };
    const html = renderToStaticMarkup(React.createElement(ui.I18nProvider, { language }, React.createElement(ui.InboxReadFailed, { data, onRetry() {} })));
    assert.ok(html.includes(ui.translate(language, `inbox.error.${state}.title`)));
    assert.ok(html.includes(`data-state="${state}"`), "the failure state is exposed as non-sensitive data-state");
    assert.ok(html.includes(ui.translate(language, "inbox.count_unknown")), "an unreadable inbox never shows a zero count");
    assert.ok(!html.includes("<details"), "no audit details block remains");
    assert.ok(!html.includes(ui.translate(language, `inbox.error.${state}.detail`)), "the long audit detail is not repeated");
    assert.equal(html.includes(ui.translate(language, "inbox.auth_hint")), state === "unauthorized");
    assert.doesNotMatch(html, /inbox\.|decisions\.|private-|kv_directory_|kv_list_/);
    assert.equal(html.includes("<button"), state !== "unauthorized");
    assert.doesNotMatch(html, /暂无待办|No pending/);
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
globalThis.fetch = originalFetch;
assert.equal(externalCalls, 0, "offline read fixtures cannot access external services");
console.log("console_todo_state_validation: PASS (real Worker zero-list/zero-write reads; API classification; zh/en React errors)");
