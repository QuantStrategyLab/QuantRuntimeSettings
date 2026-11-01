import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initializeSecretRotation } from "../web/strategy-switch-console/secretRotation.js";
import { RuntimeInstances } from "../web/strategy-switch-console/worker.js";
import { auditPageQuery, auditNextCursor } from "../web/strategy-switch-console/application/console_api/audit_pagination.js";

// Exercise the production query against SQLite, including all three durable
// sources and enough rows to cross the old fixed projection ceiling.
const db = new DatabaseSync(":memory:");
try {
  db.exec(`CREATE TABLE human_decision_record (kind, subject_id, material_key, action, actor, decided_at, request_key);
    CREATE TABLE research_promotion_applications (ticket_id, status, updated_at, application_id);
    CREATE TABLE account_setting_profile_application (platform, account_key, status, approved_by, approved_at, request_key);`);
  const at = "2026-11-01T00:00:00.000Z", now = Date.parse("2026-11-01T01:00:00.000Z");
  const insert = db.prepare("INSERT INTO human_decision_record VALUES ('owner', 'demo', '', 'keep_parked', 'demo', ?, ?)");
  for (let index = 0; index < 1005; index++) insert.run(at, `demo-${String(index).padStart(4, "0")}`);
  db.prepare("INSERT INTO research_promotion_applications VALUES ('demo', 'recorded', ?, 'demo-promotion')").run(at);
  db.prepare("INSERT INTO account_setting_profile_application VALUES ('longbridge', 'demo', 'recorded', 'demo', ?, 'demo-account')").run(at);
  const sql = { exec(query, ...parameters) { const rows = db.prepare(query).all(...parameters); return { toArray: () => rows }; } };
  initializeSecretRotation(sql);
  sql.exec('INSERT INTO credential_rotation_audit VALUES (?, ?, ?, ?, ?, ?, ?)', 'synthetic-rotation', at, 'demo', 'credential_rotation_stage', 'synthetic-operation', 'staged', null);
  const read = page => RuntimeInstances.prototype.consoleReadCommand.call({ sql }, {
    action: "console_audit_events", actor: "demo", limit: page.limit + 1, snapshot: page.snapshot, before: page.before,
  }).rows;
  let page = auditPageQuery(new URL("https://example.invalid/api/audit-events?limit=100"), now);
  const seen = [];
  for (let index = 0; index < 20; index++) {
    const rows = read(page), current = rows.slice(0, page.limit);
    seen.push(...current.map(row => row.event_id));
    if (rows.length <= page.limit) break;
    const last = current.at(-1);
    const cursor = auditNextCursor({ occurred_at: last.occurred_at, id: last.event_id }, page);
    page = auditPageQuery(new URL(`https://example.invalid/api/audit-events?limit=100&cursor=${cursor}`), now);
    if (index === 0) insert.run("2026-11-01T02:00:00.000Z", "newer");
  }
  assert.equal(seen.length, 1008);
  assert.equal(new Set(seen).size, 1008);
  assert.deepEqual(seen, [...seen].sort());
  assert.ok(seen.includes("research_promotion_application:demo-promotion"));
  assert.ok(seen.includes("account_settings_application:demo-account"));
  assert.ok(seen.includes('credential_rotation:synthetic-rotation'));
  assert.ok(!seen.includes("durable_human_decision:newer"));
  const end = auditPageQuery(new URL("https://example.invalid/api/audit-events?cursor=" + auditNextCursor({ occurred_at: at, id: seen.at(-1) }, page)), now);
  assert.deepEqual(read(end), []);
  for (const value of ["1", "", "bad!", btoa(JSON.stringify({ v: 9, snapshot: at, at, id: "demo" }))]) {
    assert.throws(() => auditPageQuery(new URL(`https://example.invalid/api/audit-events?cursor=${value}`), now), /invalid_pagination/);
  }
  console.log("Audit pagination validation passed: 1008 durable rows, four sources, ties, concurrent insert, terminal cursor");
} finally { db.close(); }
