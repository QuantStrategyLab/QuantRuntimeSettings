import assert from "node:assert/strict";
import worker, { __test } from "../web/strategy-switch-console/worker.js";

const now = new Date().toISOString();
const old = new Date(Date.now() - 35 * 86400_000).toISOString();
const retirement = {
  source_id: "example.one_shot_validation",
  retired_at: now,
  reason: "One-shot producer removed; retained as historical evidence by owner decision.",
};
const config = { schema_version: "qsl_control_plane_source_retirements.v1", retirements: [retirement] };
const candidate = {
  candidate_id: "historical_candidate",
  candidate_kind: "individual",
  domain: "us_equity",
  lifecycle: { stage: "P6", status: "owner_decision_required" },
  evidence: { p1_input_digest: "a".repeat(64), p2_config_digest: "b".repeat(64), p3_evidence_id: "research-run", source_revision: "c".repeat(40) },
  recommendation: { code: "owner_live_decision", reason: "Owner decision required" },
  freshness: { status: "fresh", age_seconds: 0 },
};
const historical = {
  schema_version: "qsl_control_plane_source_snapshot.v1",
  source_id: retirement.source_id,
  generated_at: old,
  computed_at: old,
  data_status: "ready",
  candidates: [candidate],
  errors: ["historical_notice"],
};
const sources = [historical, ...[1, 2, 3].map((index) => ({
  ...historical,
  source_id: `example.daily_research_${index}`,
  generated_at: now,
  computed_at: now,
  candidates: [{
    ...candidate,
    candidate_id: `active_candidate_${index}`,
    lifecycle: { stage: "P3", status: "verified" },
    recommendation: { code: "keep_research", reason: "Research only" },
  }],
  errors: [],
}))];
const store = new Map(sources.map((source) => [`control_plane_source:${source.source_id}`, JSON.stringify(source)]));
let writes = 0;
const env = {
  SESSION_SECRET: "synthetic-retirement-session",
  ALLOWED_GITHUB_LOGINS: "synthetic-reader",
  STRATEGY_SWITCH_ADMIN_LOGINS: "synthetic-reader",
  STRATEGY_SWITCH_CONFIG: {
    get: async (key) => store.get(key) ?? null,
    put: async () => { writes++; throw new Error("GET must not write"); },
    list: async ({ prefix, limit }) => ({ keys: [...store.keys()].filter((key) => key.startsWith(prefix)).slice(0, limit).map((name) => ({ name })) }),
  },
};
const cookie = await __test.makeSession("synthetic-reader", [], env);
const headers = { Cookie: `qsl_switch_session=${cookie}` };
const nativeFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("External network forbidden"); };
const read = async (path = "/api/control-plane") => {
  const response = await worker.fetch(new Request(`https://console.example${path}`, { headers }), env);
  assert.equal(response.status, 200);
  return response.json();
};
const setConfig = (value) => store.set("control_plane_source_retirements", JSON.stringify(value));

try {
  assert.equal((await read()).data_status, "stale", "reproduce one historical source dragging three fresh sources");
  assert.equal((await read("/api/owner-decisions")).data_status, "stale");
  setConfig(config);
  const result = await read();
  assert.equal(result.data_status, "ready");
  assert.equal(result.generated_at, now);
  assert.equal(result.computed_at, now);
  assert.equal(result.summary.candidate_count, 3);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.historical_sources, [{
    retirement,
    snapshot: historical,
    freshness: { data_status: "stale", age_seconds: result.historical_sources[0].freshness.age_seconds },
  }]);
  assert.ok(result.historical_sources[0].freshness.age_seconds >= 35 * 86400);
  assert.equal(store.get(`control_plane_source:${historical.source_id}`), JSON.stringify(historical), "original snapshot is unchanged");
  const queue = await read("/api/owner-decisions");
  assert.equal(queue.data_status, "ready");
  assert.deepEqual(queue.candidates, [], "retired P6 material is never actionable");
  assert.equal(queue.policy.no_order, true);
  assert.equal(queue.policy.execution_authority_granted, false);
  const rejectedDecision = await worker.fetch(new Request("https://console.example/api/owner-decisions", {
    method: "POST",
    headers: { ...headers, Origin: "https://console.example", "Content-Type": "application/json" },
    body: JSON.stringify({ candidate_id: candidate.candidate_id, decision: "keep_parked", candidate_evidence_sha256: "d".repeat(64) }),
  }), env);
  assert.equal(rejectedDecision.status, 409, "retired material cannot receive a new owner decision");

  store.set(`control_plane_source:${historical.source_id}`, JSON.stringify({ ...historical, candidates: [sources[1].candidates[0]] }));
  assert.equal((await read()).summary.candidate_count, 3, "historical duplicates do not suppress active candidates");
  assert.deepEqual((await read()).errors, []);
  store.set(`control_plane_source:${historical.source_id}`, JSON.stringify(historical));

  // A configured retirement cannot mask an expired or future-dated active source.
  for (const timestamp of [old, new Date(Date.now() + 3600_000).toISOString()]) {
    store.set(`control_plane_source:${sources[1].source_id}`, JSON.stringify({ ...sources[1], computed_at: timestamp, generated_at: timestamp }));
    assert.equal((await read()).data_status, "stale");
    assert.equal((await read("/api/owner-decisions")).data_status, "stale");
  }
  store.set(`control_plane_source:${sources[1].source_id}`, JSON.stringify(sources[1]));
  setConfig({ ...config, retirements: [{ ...retirement, source_id: "example.other_source" }] });
  assert.equal((await read()).data_status, "stale", "retirement matches an exact source ID");

  for (const invalid of [
    null, {}, { ...config, schema_version: "unsupported" },
    { ...config, retirements: [retirement, retirement] },
    ...[{ reason: "" }, { retired_at: "invalid" }, { retired_at: null },
      { retired_at: new Date(Date.now() + 3600_000).toISOString() },
      { source_id: "example.*" }, { source_id: "unavailable" }, { unexpected: true }].map((fields) => ({ ...config, retirements: [{ ...retirement, ...fields }] })),
  ]) {
    setConfig(invalid);
    const invalidResult = await read();
    assert.equal(invalidResult.data_status, "unavailable");
    assert.ok(invalidResult.errors.includes("control_plane_source_retirements_invalid"));
  }
  store.set("control_plane_source_retirements", "");
  assert.equal((await read()).data_status, "unavailable");
  store.set("control_plane_source_retirements", "invalid-json");
  assert.equal((await read()).data_status, "unavailable");
  setConfig(config);
  store.set(`control_plane_source:${sources[1].source_id}`, JSON.stringify(historical));
  const mismatched = await read();
  assert.ok(mismatched.errors.includes("control_plane_source_invalid"), "a mismatched stored identity cannot claim retirement");
  assert.equal(mismatched.historical_sources.length, 1);
  store.set(`control_plane_source:${sources[1].source_id}`, JSON.stringify(sources[1]));
  const originalGet = env.STRATEGY_SWITCH_CONFIG.get;
  env.STRATEGY_SWITCH_CONFIG.get = async (key) => {
    if (key === "control_plane_source_retirements") throw new Error("configuration read failed");
    return originalGet(key);
  };
  assert.equal((await read()).data_status, "unavailable");
  env.STRATEGY_SWITCH_CONFIG.get = originalGet;

  // No active source means unavailable, even with a fresh legacy aggregate.
  for (const source of sources.slice(1)) store.delete(`control_plane_source:${source.source_id}`);
  store.set("control_plane_snapshot", JSON.stringify({
    schema_version: "qsl_control_plane_dashboard.v1", generated_at: now, computed_at: now, data_status: "ready",
    summary: {}, candidates: [], errors: [],
    policy: { p4_p5_automation: "not_configured", p6_owner_decision_required: true, notice: "Owner decision required" },
  }));
  assert.equal((await read()).data_status, "unavailable");
  assert.equal((await read()).historical_sources.length, 1);
  store.delete(`control_plane_source:${historical.source_id}`);
  assert.equal((await read()).data_status, "unavailable", "legacy aggregate cannot resurrect retired evidence");
  store.delete("control_plane_source_retirements");
  assert.equal((await read()).data_status, "ready", "unconfigured installations retain legacy fallback");
  assert.equal(writes, 0);
} finally {
  globalThis.fetch = nativeFetch;
}
console.log("control_plane_retirement_validation: ok");
