import assert from "node:assert/strict";
import { test } from "node:test";
import { inbox } from "../web/strategy-switch-console/application/console_api/inbox.js";
const material = "a".repeat(64), review = "b".repeat(64);
const row = { ticket_id: "<PROJECT_ID>-todo", state: "awaiting_human", expires_at: "2099-01-01T00:00:00Z",
  decision_binding: { kind: "promotion", subject_id: "<PROJECT_ID>-todo", material_sha256: material, review_binding: { review_sha256: review } },
  decision_authority: { material_sha256: material, eligible: true, expires_at: "2099-01-01T00:00:00Z" } };
const request = new Request("https://fixture.invalid/api/decisions-inbox");
const empty = async () => Response.json({ data_status: "ready", candidates: [], tickets: [], recoveries: [] });
const ack = { status: "found", kind: "promotion", subject_id: row.ticket_id, material_sha256: material, review_sha256: review,
  action: "accept", actor_alias: "actor-0123456789abcdef", acknowledged_at: "2030-01-01T00:00:00Z", receipt_sha256: "c".repeat(64) };
async function read(entry = row, reader = async () => ({ status: "not_found" }), options) {
  return inbox(request, {}, { owner: empty, recovery: empty, credential: empty,
    promotion: async () => Response.json({ data_status: "ready", tickets: [entry] }), decisionCompletion: reader }, options);
}
const marked = { ...row, human_decision: "accept", state: "human_accepted", application: { status: "applied_paused" },
  completion: { status: "acknowledged", decided_by: "<PROJECT_ID>-private@example.invalid" }, blocker_codes: ["<PROJECT_ID>-private@example.invalid"] };

test("owner and revision-bound setup link", async () => {
const first = (await read()).items[0];
assert.ok(first.todo_lifecycle, "existing list must expose lifecycle, not only decision fields");
assert.equal(first.todo_lifecycle.owner.assignment_status, "not_recorded");
assert.equal(first.todo_lifecycle.owner.required_role, "admin");
assert.equal(first.todo_lifecycle.completion.status, "pending");
assert.equal(first.todo_lifecycle.setup_decision.revision, first.revision);
assert.equal(first.todo_lifecycle.setup_decision.material_sha256, material);
assert.equal(first.todo_lifecycle.setup_decision.href, `?page=decisions&decision=${encodeURIComponent(first.id)}`);
});
test("redaction and explicit resume conditions", async () => {
const unverified = (await read(marked)).items[0].todo_lifecycle;
assert.equal(unverified.completion.status, "pending");
assert.notEqual(unverified.state, "acknowledged");
assert.doesNotMatch(JSON.stringify(unverified), /private|example\.invalid|applied_paused/);
assert.ok(unverified.blockers.some(b => b.code === "decision_blocked_unknown" && b.resume_condition === "restore_verified_decision_material"));
const blocked = (await read({ ...row, blocker_codes: ["decision_evidence_stale", "recovery_blocked"] })).items[0].todo_lifecycle;
assert.ok(blocked.blockers.some(b => b.resume_condition === "refresh_evidence"));
assert.ok(blocked.blockers.some(b => b.resume_condition === "restore_recovery_readiness"));
const missing = (await read({ ...row, decision_binding: null })).items[0].todo_lifecycle;
assert.equal(missing.setup_decision.status, "unavailable");
assert.equal(missing.setup_decision.href, null);
assert.equal(missing.completion.status, "unknown");
});
test("completion requires exact verified durable acknowledgement", async () => {
const completed = (await read(marked, async () => ack)).items[0].todo_lifecycle;
assert.equal(completed.state, "acknowledged");
assert.equal(completed.completion.scope, "decision_intent");
assert.equal(completed.completion.actor_alias, ack.actor_alias);
assert.equal(completed.completion.receipt_sha256, ack.receipt_sha256);
assert.equal(completed.execution_authority_granted, false);
for (const bad of [{ ...ack, material_sha256: "d".repeat(64) }, { ...ack, subject_id: "<PROJECT_ID>-other" },
  { ...ack, kind: "owner" }, { ...ack, review_sha256: "d".repeat(64) }, { ...ack, actor_alias: "<PROJECT_ID>-private@example.invalid" },
  { ...ack, receipt_sha256: null }, { ...ack, acknowledged_at: "invalid" }, { ...ack, action: "unexpected" }]) {
  const result = await read(marked, async () => bad);
  assert.equal(result.status, "partial");
  assert.equal(result.items[0].todo_lifecycle.completion.status, "unknown");
}
for (const reader of [async () => { throw Error("<PROJECT_ID>-private@example.invalid"); }, async () => ({ status: "unavailable" }), async () => null]) {
  const result = await read(marked, reader);
  assert.equal(result.status, "partial");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].todo_lifecycle.state, "unknown");
  assert.doesNotMatch(JSON.stringify(result.items[0].todo_lifecycle), /private|example\.invalid/);
}
});
test("current reads survive restart and authority drift without cached ACK", async () => {
let current = ack;
assert.equal((await read(marked, async () => current)).items[0].todo_lifecycle.completion.status, "acknowledged");
current = { status: "not_found" };
assert.equal((await read(marked, async () => current)).items[0].todo_lifecycle.completion.status, "pending");
let calls = 0;
await read(row, async () => { calls++; return ack; }, { paginate: false });
assert.equal(calls, 0, "by-id detail owns its own exact receipt read");
});

test("bounded page reads and concurrent requests keep independent authority", async () => {
  const rows = Array.from({ length: 30 }, (_, n) => ({ ...row, ticket_id: `<PROJECT_ID>-${n}`,
    decision_binding: { ...row.decision_binding, subject_id: `<PROJECT_ID>-${n}` } }));
  let reads = 0;
  const queue = await inbox(new Request("https://fixture.invalid/api/decisions-inbox?limit=3"), {}, {
    owner: empty, recovery: empty, credential: empty,
    promotion: async () => Response.json({ data_status: "ready", tickets: rows }),
    decisionCompletion: async () => { reads++; return { status: "not_found" }; },
  });
  assert.equal(reads, 3);
  assert.equal(queue.items.length, 3);
  const [found, missing] = await Promise.all([read(row, async () => ack), read(row, async () => ({ status: "not_found" }))]);
  assert.equal(found.items[0].todo_lifecycle.completion.status, "acknowledged");
  assert.equal(missing.items[0].todo_lifecycle.completion.status, "pending");
});

test("malformed blockers and mismatched revisions cannot leak or invent setup links", async () => {
  const { todoLifecycle } = await import("../web/strategy-switch-console/application/console_api/todo_lifecycle.js");
  const item = (await read()).items[0];
  const result = todoLifecycle({ ...item, revision: "rev1-" + "0".repeat(16),
    blocking_reason_codes: [{ toString: null }, "<PROJECT_ID>-private@example.invalid"] }, ack);
  assert.equal(result.setup_decision.status, "unavailable");
  assert.equal(result.completion.status, "unknown");
  assert.doesNotMatch(JSON.stringify(result), /private|example\.invalid/);
});

test("promotion acknowledgement rejects unqualified historical review digests", async () => {
  const { todoLifecycle } = await import("../web/strategy-switch-console/application/console_api/todo_lifecycle.js");
  const { decisionRevision } = await import("../web/strategy-switch-console/application/console_api/decision_contract.js");
  const current = (await read()).items[0];
  for (const category of ["strategy_promotion", "paper_account_application"]) {
    for (const reviewBinding of [undefined, null, {}, { review_sha256: null },
      { review_sha256: "invalid" }, { review_sha256: "b".repeat(63) }]) {
      const binding = { ...row.decision_binding, review_binding: reviewBinding };
      const id = `${category}:${row.ticket_id}`;
      const item = { ...current, id, category, decision_binding: binding, revision: decisionRevision(binding, id) };
      for (const receiptReview of [undefined, null, reviewBinding?.review_sha256]) {
        const result = todoLifecycle(item, { ...ack, review_sha256: receiptReview });
        assert.equal(result.completion.status, "unknown", `${category}: unqualified digest must not ACK`);
        assert.equal(result.state, "unknown");
        assert.equal(result.completion.actor_alias, null);
        assert.equal(result.completion.receipt_sha256, null);
        assert.ok(result.blockers.some(b => b.code === "decision_completion_unknown"));
      }
    }
    const qualified = { ...current, id: `${category}:${row.ticket_id}`, category };
    assert.equal(todoLifecycle(qualified, ack).completion.status, "acknowledged");
    for (const receiptReview of [undefined, null, "invalid", "d".repeat(64)])
      assert.equal(todoLifecycle(qualified, { ...ack, review_sha256: receiptReview }).completion.status, "unknown");
  }
  const legacy = { ...row, decision_binding: { ...row.decision_binding, review_binding: null } };
  const result = await read(legacy, async () => ({ ...ack, review_sha256: null }));
  assert.equal(result.status, "partial");
  assert.equal(result.items[0].todo_lifecycle.completion.status, "unknown");
});
