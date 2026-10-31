import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
    sha256Hex: async value => createHash("sha256").update(value).digest("hex"),
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

// Declarations are joined by the account key, without changing broker facts.
{
  const deps = baseDeps({
    loadAccountOptionsConfig: async () => ({options:{longbridge:[{key:"synthetic-a"},{key:"synthetic-b"}]}}),
    runtimeInstanceCommand: async (_env, command) => command.action === "account_declarations_read" ? {declarations:[
      {platform:"longbridge",key:"synthetic-a",status:"current",environment:"live",account_type:"cash",source:"user_declared"},
      {platform:"longbridge",key:"synthetic-b",status:"identity_conflict",environment:"paper",account_type:"margin",source:"user_declared"},
    ]} : {},
  });
  const result = await accountFactsResponse(new Request("https://console.example/api/account-facts"), {ACCOUNT_FACTS_READ_MODEL_ENABLED:"true"}, deps);
  const body = await result.json();
  const a = body.accounts.find(row => row.account_key === "synthetic-a");
  const b = body.accounts.find(row => row.account_key === "synthetic-b");
  assert.deepEqual(a.user_declaration,{environment:"live",account_type:"cash",source:"user_declared"});
  assert.equal(a.broker_environment,null);
  assert.equal(b.user_declaration,undefined);
}

// The identity projection must never fall through to financial history.
{
  const option = { key: "synthetic", account_scope: "live", target_name: "target",
    service_name: "service", deployment_selector: "deployment", account_selector: "selector" };
  const binding = { ...option, platform: "schwab", account_key: option.key,
    target_id: "synthetic-target", broker_account_hash: "private-hash-sentinel",
    source_binding: { id: "f".repeat(64) } };
  const params = "platform=schwab&account_key=synthetic&currency=USD&projection=identity&from=2026-10-15&to=2026-10-16";
  let commands = [];
  const deps = baseDeps({
    loadAccountOptionsConfig: async () => ({ options: { schwab: [option] } }),
    loadAccountFactsBindings: async () => ({ bindings: [binding] }),
    runtimeInstanceCommand: async (_env, command) => {
      commands.push(command);
      return { records: [
        { observation_date: "2026-10-15", observed_finished_at: "2026-10-15T19:45:05.443766Z",
          target_id_matches: true, source_binding_id_matches: false, account_scope_matches: null,
          row_present: true, source_binding_id_trusted: false, stored_source_binding_id: "a".repeat(64),
          stored_source_binding_sha256: "forged-hash",
          record_revision: "invented", payload_json: "private-asset-sentinel" },
      ], unexpected: "private-asset-sentinel" };
    },
  });
  const invoke = async (query = params, overrides = {}) => {
    const url = new URL(`https://console.example/api/account-facts/history?${query}`);
    return accountFactsHistoryResponse(new Request(url), { ACCOUNT_FACTS_READ_MODEL_ENABLED: "true" }, url, { ...deps, ...overrides });
  };
  const response = await invoke();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.projection, "identity");
  assert.deepEqual(Object.keys(body).sort(), ["ok", "projection", "records", "source_binding_id", "target_id"]);
  assert.equal(body.target_id, binding.target_id);
  assert.equal(body.source_binding_id, binding.source_binding.id);
  assert.deepEqual(body.records, [
    { observation_date: "2026-10-15", observed_finished_at: "2026-10-15T19:45:05.443766Z",
      target_id_matches: true, source_binding_id_matches: false, account_scope_matches: null, record_revision: null,
      row_present: true, source_binding_id_trusted: false,
      stored_source_binding_sha256: createHash("sha256").update("a".repeat(64)).digest("hex") },
    { observation_date: "2026-10-16", observed_finished_at: null,
      target_id_matches: null, source_binding_id_matches: null, account_scope_matches: null, record_revision: null,
      row_present: null, source_binding_id_trusted: null, stored_source_binding_sha256: null },
  ]);
  assert.equal(JSON.stringify(body).includes("sentinel"), false);
  assert.equal(JSON.stringify(body).includes("a".repeat(64)), false, "the stored source id never leaves HTTP");
  assert.equal(commands[0].projection, "identity");
  assert.equal(commands[0].from, "2026-10-15");
  for (const query of [params.replace("identity", "unknown"), params.replace("schwab", "unsupported"),
    params.replace("USD", "usd"), params.replace("2026-10-16", "2026-10-18"),
    params.replace("2026-10-15", "2026-02-30"), params + "&from=2026-10-15"]) {
    commands = [];
    assert.equal((await invoke(query)).status, 400);
    assert.equal(commands.length, 0);
  }
  commands = [];
  assert.equal((await invoke(params, { readSession: async () => null })).status, 401);
  assert.equal((await invoke(params, { loadAccountFactsBindings: async () => null })).status, 409);
  assert.equal(commands.length, 0);
  const failed = await invoke(params, { runtimeInstanceCommand: async () => { throw new Error("private-asset-sentinel"); } });
  assert.equal(failed.status, 503);
  assert.equal((await failed.text()).includes("private-asset-sentinel"), false);
  for (const platform of ["longbridge", "ibkr", "schwab", "firstrade"]) {
    const configured = { ...option, account_scope: platform === "longbridge" ? "paper" : "live",
      account_selector: platform === "ibkr" ? "U100001" : platform === "longbridge" ? "PAPER" : "selector" };
    const configuredBinding = { ...binding, ...configured, platform, account_key: configured.key,
      history_source_binding_ids: ["a".repeat(64)], ...(platform === "firstrade" ? { broker_account_id: "synthetic-native" } : {}) };
    commands = [];
    const result = await invoke(params.replace("schwab", platform).replace("USD", "EUR"), {
      loadAccountOptionsConfig: async () => ({ options: { [platform]: [configured] } }),
      loadAccountFactsBindings: async () => ({ bindings: [configuredBinding] }),
    });
    assert.equal(result.status, 200);
    assert.deepEqual(commands[0].history_source_binding_ids, ["a".repeat(64)]);
    assert.equal(commands[0].broker_account_hash, platform === "schwab" ? configuredBinding.broker_account_hash : undefined);
    assert.equal(commands[0].broker_account_id, platform === "firstrade" ? configuredBinding.broker_account_id : undefined);
  }
  for (const time of ["2026-10-15T19:45:05.443766+00:00", "2026-10-15T19:45:05Z",
    "2026-02-30T19:45:05Z", "2026-10-15T24:00:00Z", "2026-10-15T19:45:60Z", "2026-10-15T19:45:05+08:00"]) {
    const result = await invoke(params, { runtimeInstanceCommand: async () => ({ records: [{
      observation_date: "2026-10-15", observed_finished_at: time, stored_source_binding_id: "not-64-hex", row_present: true,
    }] }) });
    const record = (await result.json()).records[0];
    assert.equal(record.observed_finished_at, ["2026-10-15T19:45:05.443766+00:00", "2026-10-15T19:45:05Z"].includes(time) ? time : null);
    assert.equal(record.stored_source_binding_sha256, null);
  }
  const duplicate = await invoke(params, { runtimeInstanceCommand: async () => ({ records: [
    { observation_date: "2026-10-15", stored_source_binding_id: "a".repeat(64), row_present: true },
    { observation_date: "2026-10-15", stored_source_binding_id: "b".repeat(64), row_present: true },
  ] }) });
  const duplicateRow = (await duplicate.json()).records[0];
  assert.equal(duplicateRow.row_present, null);
  assert.equal(duplicateRow.stored_source_binding_sha256, null);
  const noRow = await invoke(params, { runtimeInstanceCommand: async () => ({ records: [{
    observation_date: "2026-10-15", stored_source_binding_id: "a".repeat(64), row_present: false, source_binding_id_trusted: true,
  }] }) });
  const absentRow = (await noRow.json()).records[0];
  assert.equal(absentRow.row_present, false);
  assert.equal(absentRow.stored_source_binding_sha256, null);
  assert.equal(absentRow.source_binding_id_trusted, null);
}

console.log("account_facts_readonly_extract_validation: ok");

// Coverage must not claim an empty account inventory after a source read failure.
for (const [name, code] of [["loadAccountOptionsConfig", "account_options_unreadable"],
  ["loadAccountFactsBindings", "account_facts_bindings_unreadable"]]) {
  let reads = 0;
  const response = await accountFactsResponse(new Request("https://console.example/api/account-facts"),
    { ACCOUNT_FACTS_READ_MODEL_ENABLED: "true" }, baseDeps({
      [name]: async () => { throw new Error("private-provider-sentinel"); },
      loadStoredAccountFactsMap: async () => { reads++; return new Map(); },
    }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {ok: false, error: code});
  assert.equal(reads, 0);
}

{
  const response = await accountFactsResponse(new Request("https://console.example/api/account-facts"),
    { ACCOUNT_FACTS_READ_MODEL_ENABLED: "true" }, baseDeps({loadAccountOptionsConfig: async () => ({
      revision: 9, options: {firstrade: [{key: "synthetic-missing"}], binance: [{key: "synthetic-wallet"}]},
    })}));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.account_options_revision, 9);
  assert.equal(body.asset_coverage.accounts.length, 2);
  assert.ok(body.asset_coverage.accounts.every(a => a.status === "unavailable" && a.observation_date === null));
  assert.equal(body.asset_coverage.accounts.find(a => a.platform === "firstrade").reason, "binding_missing");
  assert.equal(body.asset_coverage.accounts.find(a => a.platform === "binance").reason, "source_not_supported");
}

// Coverage endpoint rebuilds fixed metadata and never forwards private storage values.
{
 const option={key:'synthetic',account_scope:'live',target_name:'target',service_name:'service',deployment_selector:'deployment',account_selector:'selector'};
 const binding={...option,platform:'schwab',account_key:option.key,target_id:'target',broker_account_hash:'private-native-sentinel',source_binding:{id:'f'.repeat(64)}};
 const params='platform=schwab&account_key=synthetic&projection=external-flow-coverage';
 const safe={ok:true,read_status:'stored',precision:'instant',window_count:1,record_count:1,observed_from:'2026-01-01T12:00:00.000Z',observed_to:'2026-01-02T12:00:00.000Z',
   groups:[{precision:'instant',coverage:'complete',window_count:1,record_count:1,observed_from:'2026-01-01T12:00:00.000Z',observed_to:'2026-01-02T12:00:00.000Z',amount:'PRIVATE_AMOUNT',source_ref:'PRIVATE_SOURCE',transfer_ref:'PRIVATE_TRANSFER'}],native_id:'private-native-sentinel'};
 const deps=baseDeps({loadAccountOptionsConfig:async()=>({options:{schwab:[option]}}),loadAccountFactsBindings:async()=>({bindings:[binding]}),runtimeInstanceCommand:async()=>safe});
 const invoke=async(query=params,override={})=>{const url=new URL(`https://console.example/api/account-facts/history?${query}`);return accountFactsHistoryResponse(new Request(url),{ACCOUNT_FACTS_READ_MODEL_ENABLED:'true'},url,{...deps,...override});};
 let response=await invoke();let body=await response.json();assert.equal(response.status,200);assert.equal(body.computation_enabled,false);
 assert.equal(body.read_status,'stored');assert.doesNotMatch(JSON.stringify(body),/PRIVATE_|private-native|source_ref|transfer_ref|amount/);
 const enabledUrl=new URL(`https://console.example/api/account-facts/history?${params}`);
 const enabledResponse=await accountFactsHistoryResponse(new Request(enabledUrl),{ACCOUNT_FACTS_READ_MODEL_ENABLED:'true',CONSOLE_EXTERNAL_FLOW_ENABLED:'true'},enabledUrl,deps);
 assert.equal((await enabledResponse.json()).computation_enabled,true);
 for(const query of [params+'&currency=USD',params+'&projection=external-flow-coverage',params+'&extra=x',params.replace('schwab','other')]) assert.equal((await invoke(query)).status,400);
 assert.equal((await invoke(params,{readSession:async()=>null})).status,401);
 assert.equal((await invoke(params,{loadAccountFactsBindings:async()=>null})).status,409);
 response=await invoke(params,{runtimeInstanceCommand:async()=>{throw Error('PRIVATE_ERROR');}});body=await response.json();
 assert.equal(response.status,503);assert.equal(body.read_status,'read_error');assert.equal(body.record_count,null);assert.doesNotMatch(JSON.stringify(body),/PRIVATE/);
 response=await invoke(params,{runtimeInstanceCommand:async()=>({...safe,groups:[{...safe.groups[0],coverage:'PRIVATE_ERROR'}]})});
 assert.equal(response.status,503);assert.equal((await response.json()).read_status,'read_error');
}
