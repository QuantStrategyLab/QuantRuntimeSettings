import assert from "node:assert/strict";
import worker, { __test } from "./helpers/directory_worker.mjs";
const env = { SESSION_SECRET: "synthetic-quota-only", ALLOWED_GITHUB_LOGINS: "fixture-reader",
  STRATEGY_SWITCH_CONFIG: {
    async get() { return null; }, async put() { throw Error("unexpected_write"); },
    async list() { throw Error("KV list() limit exceeded for the day."); },
  } };
const session = await __test.makeSession("fixture-reader", [], env);
const get = async path => {
  const response = await worker.fetch(new Request(`https://synthetic.invalid${path}`, {
    headers: { Cookie: `qsl_switch_session=${session}` } }), env);
  return { status: response.status, body: await response.json() };
};
for (const path of ["/api/owner-decisions", "/api/reconciliation-recovery"]) {
  const result = await get(path);
  assert.equal(result.status, 200);
  assert.equal(result.body.data_status, "unavailable");
  assert.ok(result.body.errors.includes("kv_list_daily_limit_exceeded"));
}
const promotion = await get("/api/research-promotion-tickets");
assert.equal(promotion.status, 503);
assert.equal(promotion.body.error, "kv_list_daily_limit_exceeded");
const inbox = await get("/api/decisions-inbox");
assert.equal(inbox.body.status, "read_failed");
assert.deepEqual(inbox.body.sources.slice(0, 3).map(source => source.failure_reason),
  Array(3).fill("kv_list_daily_limit_exceeded"));
assert.equal(inbox.body.items.length, 0);
console.log("console_source_quota_validation: PASS");
