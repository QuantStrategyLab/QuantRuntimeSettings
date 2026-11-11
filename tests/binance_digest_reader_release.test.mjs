import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {configureReader} from "../scripts/binance_digest_reader_release.mjs";

const ids = Object.fromEntries(["prior", "latest", "upload", "oldDeploy", "newDeploy"].map((name, index) =>
  [name, `00000000-0000-4000-8000-00000000000${index}`]));
const bytes = Buffer.from("export default { fetch() {} };");
const secret = {name: "BINANCE_DIGEST_READ_TOKEN", type: "secret_text"};
const token = "synthetic_reader_token_".repeat(3);
const inputs = {token, expectedVersion: ids.prior, expectedHash: createHash("sha256").update(bytes).digest("hex")};

function fixture(drift) {
  let wrote, activated, uploadBody;
  const baseline = [
    {name: "STRATEGY_SWITCH_CONFIG", type: "kv_namespace", namespace_id: "1".repeat(32)},
    {name: "STRATEGY_SWITCH_RUNTIME_INSTANCES", type: "durable_object_namespace", namespace_id: "2".repeat(32), class_name: "RuntimeInstances"},
    {name: "BINANCE_ACCOUNT_FACTS_SYNC_TOKEN", type: "secret_text"},
    {name: "TRADING_SETTING", type: "plain_text", text: "false"},
  ];
  const api = {
    deployments: async () => ({deployments: [{id: activated ? ids.newDeploy : ids.oldDeploy, strategy: "percentage",
      versions: [{version_id: activated ? ids.upload : ids.prior, percentage: 100}]}]}),
    versions: async () => ({items: (wrote ? [ids.upload, ids.latest, ids.prior] : [ids.latest, ids.prior]).map(id => ({id}))}),
    betaVersion: async id => ({id, modules: [{name: "worker.js", content_type: "application/javascript+module", content_base64: bytes.toString("base64")}]}),
    scriptVersion: async id => {
      const bindings = structuredClone(baseline);
      if (id === ids.upload) {
        bindings.push(secret);
        if (drift) bindings[3].text = "true";
      }
      return {id, resources: {bindings, script: {handlers: ["fetch"]},
        script_runtime: {compatibility_date: "2026-06-08", usage_model: "standard", migration_tag: "runtime-v1"}}};
    },
    upload: async body => { wrote = true; uploadBody = body; return {id: ids.upload}; },
    activate: async body => {
      assert.deepEqual(body.versions, [{version_id: ids.upload, percentage: 100}]);
      activated = true;
      return {id: ids.newDeploy};
    },
  };
  return {api, baseline, state: () => ({wrote, activated, uploadBody})};
}

test("inherits all existing bindings from the serving version and adds only the reader", async () => {
  const {api, baseline, state} = fixture(false);
  assert.deepEqual(await configureReader(api, inputs), {ok: true, only_reader_binding_added: true, code_unchanged: true});
  const {activated, uploadBody} = state();
  assert.equal(activated, true);
  assert.deepEqual(uploadBody.bindings, [
    ...baseline.map(({name}) => ({name, type: "inherit", version_id: ids.prior})),
    {...secret, text: token},
  ]);
  assert.equal(uploadBody.modules[0].content_base64, bytes.toString("base64"));
});

test("wrong serving version or bytes stop before any write", async () => {
  for (const override of [{expectedVersion: ids.latest}, {expectedHash: "0".repeat(64)}]) {
    const {api, state} = fixture(false);
    const result = await configureReader(api, {...inputs, ...override});
    assert.deepEqual(result, {ok: false, stage: "baseline", upload_attempted: false, activation_attempted: false});
    assert.equal(state().wrote, undefined);
  }
});

test("a different existing binding prevents activation", async () => {
  const {api, state} = fixture(true);
  const result = await configureReader(api, inputs);
  assert.deepEqual(result, {ok: false, stage: "verify_candidate", upload_attempted: true, activation_attempted: false});
  assert.equal(state().activated, undefined);
});
