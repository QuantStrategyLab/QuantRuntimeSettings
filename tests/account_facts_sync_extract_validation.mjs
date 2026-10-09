import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { syncAccountFactsResponse } from "../web/strategy-switch-console/application/account_facts/sync.js";

const workerSource = await readFile(
  new URL("../web/strategy-switch-console/worker.js", import.meta.url),
  "utf8",
);
const syncSource = await readFile(
  new URL("../web/strategy-switch-console/application/account_facts/sync.js", import.meta.url),
  "utf8",
);

assert.equal(
  workerSource.includes('from "./application/account_facts/sync.js"'),
  true,
  "Worker imports the B10-b account-facts sync module",
);
assert.match(workerSource, /\/api\/account-facts\/sync"/);
assert.match(workerSource, /async function syncAccountFactsResponse/);
assert.match(workerSource, /syncAccountFactsResponseImpl/);
const syncSourceNoComments = syncSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
assert.equal(
  /transactionSync/.test(syncSourceNoComments),
  false,
  "sync module must not open Durable Object transactions",
);
assert.equal(
  /class RuntimeInstances|RUNTIME_INSTANCE|DURABLE_OBJECT/.test(syncSource),
  false,
  "sync module must not own DO identity",
);
assert.equal(
  syncSource.includes('from "./worker.js"') || syncSource.includes("from '../worker.js'"),
  false,
  "application module must not import worker.js",
);
assert.equal(
  syncSource.includes("action: \"account_facts_put\""),
  true,
  "sync still issues account_facts_put via injected repository",
);
assert.match(workerSource, /async function syncAccountPeriodReturnResponse/);
assert.equal(
  /syncAccountPeriodReturnResponse/.test(syncSource),
  false,
  "B10-b smallest slice: period-return sync stays in worker",
);

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function baseDeps(overrides = {}) {
  return {
    json,
    hasConfigStore: () => true,
    hasRuntimeInstanceStore: () => true,
    loadAccountOptionsConfig: async () => ({ options: {} }),
    loadAccountFactsBindings: async () => ({ bindings: [] }),
    runtimeInstanceCommand: async () => {
      throw new Error("runtimeInstanceCommand should not run in this case");
    },
    readBoundedJson: async () => ({}),
    requireDedicatedAccountFactsSyncToken: () => {
      throw new HttpError("account_facts_sync_token_invalid", 401);
    },
    accountFactsErrorResponse: (error) =>
      json({ ok: false, error: error?.message || error?.code || "error" }, error?.status || 400),
    ...overrides,
  };
}

{
  const disabled = await syncAccountFactsResponse(
    new Request("https://console.example/api/account-facts/sync", { method: "POST" }),
    {},
    baseDeps(),
  );
  assert.equal(disabled.status, 404);
  assert.equal((await disabled.json()).error, "account_facts_disabled");
}

{
  const unauthorized = await syncAccountFactsResponse(
    new Request("https://console.example/api/account-facts/sync", { method: "POST" }),
    { ACCOUNT_FACTS_READ_MODEL_ENABLED: "true" },
    baseDeps(),
  );
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error, "account_facts_sync_token_invalid");
}

{
  const missingBindings = await syncAccountFactsResponse(
    new Request("https://console.example/api/account-facts/sync", { method: "POST" }),
    { ACCOUNT_FACTS_READ_MODEL_ENABLED: "true" },
    baseDeps({
      requireDedicatedAccountFactsSyncToken: () => "longbridge",
      loadAccountFactsBindings: async () => ({ bindings: [] }),
    }),
  );
  assert.equal(missingBindings.status, 409);
  assert.equal((await missingBindings.json()).error, "account_facts_bindings_missing");
}

{
  const forbiddenCallerIdentity = await syncAccountFactsResponse(
    new Request("https://console.example/api/account-facts/sync", { method: "POST" }),
    { ACCOUNT_FACTS_READ_MODEL_ENABLED: "true" },
    baseDeps({
      requireDedicatedAccountFactsSyncToken: () => "longbridge",
      loadAccountFactsBindings: async () => ({
        bindings: [{
          platform: "longbridge",
          account_key: "demo",
          account_scope: "paper",
          account_selector: null,
          target_id: "longbridge.paper",
          source_binding: { id: "a".repeat(64) },
        }],
      }),
      readBoundedJson: async () => ({
        account_key: "caller-must-not-set",
        target_id: "longbridge.paper",
      }),
    }),
  );
  assert.equal(forbiddenCallerIdentity.status, 400);
  assert.equal((await forbiddenCallerIdentity.json()).error, "account_facts_caller_identity_forbidden");
}

console.log("account_facts_sync_extract_validation: ok");
