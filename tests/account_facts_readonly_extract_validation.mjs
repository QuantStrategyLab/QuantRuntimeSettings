import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  accountFactsHistoryResponse,
  accountFactsResponse,
} from "../web/strategy-switch-console/application/account_facts/read.js";

const workerSource = await readFile(
  new URL("../web/strategy-switch-console/worker.js", import.meta.url),
  "utf8",
);
const readSource = await readFile(
  new URL("../web/strategy-switch-console/application/account_facts/read.js", import.meta.url),
  "utf8",
);

assert.equal(
  workerSource.includes('from "./application/account_facts/read.js"'),
  true,
  "Worker imports the B10-a account-facts read module",
);
assert.match(workerSource, /\/api\/account-facts"/);
assert.match(workerSource, /\/api\/account-facts\/history"/);
assert.match(workerSource, /async function syncAccountFactsResponse/);
assert.equal(
  /transactionSync/.test(readSource),
  false,
  "read module must not open Durable Object transactions",
);
assert.equal(
  /class RuntimeInstances|RUNTIME_INSTANCE|DURABLE_OBJECT/.test(readSource),
  false,
  "read module must not own DO identity",
);
assert.equal(
  readSource.includes('from "./worker.js"') || readSource.includes("from '../worker.js'"),
  false,
  "application module must not import worker.js",
);
assert.equal(
  /account_facts_put|syncAccountFactsResponse/.test(readSource),
  false,
  "B10-a stays read-only; sync/write is outside read.js (B10-b: application/account_facts/sync.js)",
);

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function baseDeps(overrides = {}) {
  return {
    json,
    readSession: async () => ({ allowed: true, login: "facts-reader" }),
    hasConfigStore: () => true,
    hasRuntimeInstanceStore: () => true,
    loadAccountOptionsConfig: async () => ({ options: {}, revision: 1 }),
    loadAccountFactsBindings: async () => null,
    loadStoredAccountFactsMap: async () => new Map(),
    runtimeInstanceCommand: async () => {
      throw new Error("runtimeInstanceCommand should not run in this case");
    },
    periodReturnCommand: () => ({ action: "account_period_return_read" }),
    accountFactsErrorResponse: (error) => json({ ok: false, error: error?.message || "error" }, error?.status || 400),
    ...overrides,
  };
}

{
  const disabled = await accountFactsResponse(
    new Request("https://console.example/api/account-facts"),
    {},
    baseDeps(),
  );
  assert.equal(disabled.status, 404);
  assert.equal((await disabled.json()).error, "account_facts_disabled");
}

{
  const unauthorized = await accountFactsResponse(
    new Request("https://console.example/api/account-facts"),
    { ACCOUNT_FACTS_READ_MODEL_ENABLED: "true" },
    baseDeps({ readSession: async () => null }),
  );
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error, "login required");
}

{
  const badQuery = await accountFactsHistoryResponse(
    new Request("https://console.example/api/account-facts/history"),
    { ACCOUNT_FACTS_READ_MODEL_ENABLED: "true" },
    new URL("https://console.example/api/account-facts/history?platform=ibkr&account_key=U1&currency=usd"),
    baseDeps(),
  );
  assert.equal(badQuery.status, 400);
  assert.equal((await badQuery.json()).error, "invalid_account_facts_history_query");
}

{
  let listed = false;
  const empty = await accountFactsResponse(
    new Request("https://console.example/api/account-facts"),
    { ACCOUNT_FACTS_READ_MODEL_ENABLED: "true" },
    baseDeps({
      loadStoredAccountFactsMap: async () => {
        listed = true;
        return new Map();
      },
    }),
  );
  assert.equal(empty.status, 200);
  assert.equal(listed, true);
  const body = await empty.json();
  assert.equal(body.enabled, true);
  assert.equal(body.configured, false);
  assert.ok(Array.isArray(body.accounts));
}

console.log("account_facts_readonly_extract_validation: ok");
