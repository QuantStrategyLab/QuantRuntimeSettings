import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import worker, { __test } from "../web/strategy-switch-console/worker.js";

const profile = (id, patch = {}) => ({ profile: id, label: "HK · USD · live", domain: "us_equity", allowed_execution_modes: ["paper"], ...patch });
const normalized = __test.normalizeStrategyProfilesPayload([
  profile("unknown"),
  profile("research", { lifecycle_stage: "research", runtime_enabled: false, can_switch_live: false, allowed_execution_modes: ["paper", "dry_run"], blocked_live_reason: "research_only" }),
  profile("live", { lifecycle_stage: "live_enabled", can_switch_live: true, allowed_execution_modes: ["paper", "live", "paper"] }),
  profile("empty", { allowed_execution_modes: [] }),
  profile("missing_modes", { allowed_execution_modes: undefined }),
  profile("frozen", { frozen: true }),
  profile("other_domain", { domain: "hk_equity" }),
  profile("nonboolean", { can_switch_live: "invalid" }),
]);
const account = { supported_domains: ["us_equity"], account_scope: "HK", broker_environment: "live", label: "HK · USD" };
const choices = __test.accountDraftStrategyChoices("longbridge", account, normalized);
assert.deepEqual(choices.map(row => row.profile), ["unknown", "research", "live", "nonboolean"], "draft membership is unchanged by new metadata and never inferred from labels or entity scope");
const byId = Object.fromEntries(choices.map(row => [row.profile, row]));
assert.equal(byId.unknown.lifecycle_stage, null);
assert.equal(byId.unknown.can_switch_live, null);
assert.equal(byId.unknown.blocked_live_reason, null);
assert.deepEqual(byId.unknown.allowed_execution_modes, ["paper"]);
assert.equal(byId.nonboolean.can_switch_live, null);
assert.equal(byId.research.lifecycle_stage, "research_active", "explicit lifecycle aliases retain existing catalog normalization");
assert.equal(byId.research.can_switch_live, false, "explicit false is preserved without treating draft saving as live permission");
assert.deepEqual(byId.research.allowed_execution_modes, ["paper", "dry_run"]);
assert.equal(byId.research.blocked_live_reason, "research_only");
assert.equal(byId.live.can_switch_live, true);
assert.deepEqual(byId.live.allowed_execution_modes, ["paper", "live"]);
assert.equal(Object.hasOwn(byId.unknown, "runtime_enabled"), false, "normalized default false is not exposed as a source declaration");
assert.equal(Object.hasOwn(byId.unknown, "allocations"), false);
const draft = { platform: "longbridge", config: account, draft: { status: "current", overrides: {} } };
assert.doesNotThrow(() => __test.assertAccountDraftPatch(normalized, draft, { strategy_profile: "research" }, ""));
assert.throws(() => __test.assertAccountDraftPatch(normalized, draft, { strategy_profile: "frozen" }, ""), /account_settings_strategy_rejected/);
const bundledProfiles = __test.normalizeStrategyProfilesPayload(JSON.parse(readFileSync(new URL("../web/strategy-switch-console/strategy-profiles.example.json", import.meta.url), "utf8")));
const v7Id = "soxl_soxx_core_only_p2_v7_longterm_compounding_cash_reserve";
const v7Choice = __test.accountDraftStrategyChoices("longbridge", account, bundledProfiles).find(row => row.profile === v7Id);
assert.ok(v7Choice, "the existing research-only V7 remains draft-selectable");
assert.equal(v7Choice.lifecycle_stage, "research_active");
assert.equal(v7Choice.can_switch_live, false);
assert.deepEqual(v7Choice.allowed_execution_modes, ["paper", "dry_run"]);
assert.doesNotThrow(() => __test.assertAccountDraftPatch(bundledProfiles, draft, { strategy_profile: v7Id }, ""));
assert.throws(() => __test.assertStrategyAllowedForAccount({ platform: "longbridge", strategy_profile: v7Id, execution_mode: "live" }, account, bundledProfiles), /not live-enabled|blocked for live/);

const ticket = __test.normalizeResearchPromotionTicket({
  ticket_id: "smoke_idem_is_only_a_name", strategy_profile: "research", domain: "us_equity", state: "awaiting_human",
  created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-02T00:00:00Z", shadow_passed: false,
  live_authority_granted: false,
});
const overlay = { ...ticket, updated_at: "2026-10-05T00:00:00Z" };
const project = (authority, source = ticket) => __test.attachPromotionQueueReadMetadata(source, overlay, authority);
const unknownMaterial = { migrated: null, eligible: null, blocked: null, blocker_codes: null };
assert.deepEqual(project(null).decision_material, unknownMaterial);
assert.deepEqual(project({}).decision_material, unknownMaterial);
assert.deepEqual(project({ migrated: false, eligible: false, blocked: false, material_key: "internal", error: "private raw reason" }).decision_material,
  { ...unknownMaterial, migrated: false }, "absent material cannot claim a known gate result from default false");
assert.deepEqual(project({ migrated: true, eligible: true, blocked: false }).decision_material,
  { migrated: true, eligible: true, blocked: false, blocker_codes: [] });
assert.deepEqual(project({ migrated: true, eligible: true, blocked: true, material_key: "internal", reason: "private raw reason" }).decision_material,
  { migrated: true, eligible: true, blocked: true, blocker_codes: ["human_decision_legacy_blocked"] });
assert.deepEqual(project({ migrated: true, eligible: false, blocked: false }).decision_material,
  { migrated: true, eligible: false, blocked: false, blocker_codes: ["human_decision_material_conflict"] });
assert.deepEqual(project({ migrated: true, eligible: false, blocked: true }).decision_material.blocker_codes, ["human_decision_legacy_blocked"], "reason precedence matches the existing writer");
assert.deepEqual(project({ migrated: true }).decision_material,
  { migrated: true, eligible: null, blocked: null, blocker_codes: null });
assert.deepEqual(project({ migrated: true, eligible: "true", blocked: "false" }).decision_material,
  { migrated: true, eligible: null, blocked: null, blocker_codes: null });
assert.deepEqual(project(null).ticket_record_timestamps, { created_at: ticket.created_at, updated_at: ticket.updated_at });
assert.equal(project(null).updated_at, overlay.updated_at, "record timestamps do not overwrite existing overlay decision time");
assert.deepEqual(project(null, { created_at: "", updated_at: undefined }).ticket_record_timestamps, { created_at: null, updated_at: null });
assert.equal(project({ migrated: true, eligible: true, blocked: false }).live_authority_granted, false);
assert.equal(JSON.stringify(project({ migrated: true, eligible: true, blocked: true, material_key: "internal", reason: "private raw reason" })).includes("private raw reason"), false);
assert.equal(Object.hasOwn(project({ material_key: "internal" }).decision_material, "material_key"), false);

// Exercise the real read route with in-memory observations only. No provider,
// production browser, real credentials, trading call, or external fetch is used.
function readFixture(authority, record = ticket) {
  const reads = [];
  const commands = [];
  let writes = 0;
  const key = `research_promotion_ticket:${record.ticket_id}`;
  const env = {
    SESSION_SECRET: "synthetic-read-session",
    ALLOWED_GITHUB_LOGINS: "synthetic-reader,synthetic-admin",
    STRATEGY_SWITCH_ADMIN_LOGINS: "synthetic-admin",
    STRATEGY_SWITCH_STRATEGY_PROFILES_JSON: JSON.stringify(normalized),
    STRATEGY_SWITCH_ACCOUNT_OPTIONS_JSON: JSON.stringify({ longbridge: [{ key: "paper", target_name: "paper", label: "Synthetic", supported_domains: ["us_equity"], broker_environment: "paper" }] }),
    STRATEGY_SWITCH_CONFIG: {
      async get(name) { reads.push(name); return name === key ? JSON.stringify(record) : null; },
      async list(input) { reads.push({ list: input }); return { keys: [{ name: key }] }; },
      async put() { writes += 1; throw new Error("read route attempted a write"); },
      async delete() { writes += 1; throw new Error("read route attempted a delete"); },
    },
    STRATEGY_SWITCH_RUNTIME_INSTANCES: {
      idFromName(name) { return name; },
      get() { return { async fetch(_url, init = {}) {
        const command = init.body ? JSON.parse(init.body) : null;
        commands.push(command);
        if (!command) return Response.json({ initialized: false });
        if (command.action === "promotion_read") return Response.json(authority);
        if (command.action === "application_latest") return Response.json({ application: null });
        throw new Error(`unexpected read command: ${command.action}`);
      } }; },
    },
  };
  return { env, reads, commands, writes: () => writes };
}
async function queueRead(fixture, login) {
  const cookie = login ? `qsl_switch_session=${await __test.makeSession(login, [], fixture.env)}` : "";
  return worker.fetch(new Request("https://synthetic.invalid/api/research-promotion-tickets", { headers: cookie ? { Cookie: cookie } : {} }), fixture.env, {});
}
const fixture = readFixture({ migrated: true, eligible: false, blocked: false, material_key: "never-public", decision: null });
const readerResponse = await queueRead(fixture, "synthetic-reader");
assert.equal(readerResponse.status, 200, "allowed non-admin readers retain their existing queue access");
const queue = await readerResponse.json();
assert.equal(queue.tickets.length, 1, "smoke/idem names and old dates do not classify or invalidate material");
assert.deepEqual(queue.tickets[0].decision_material, { migrated: true, eligible: false, blocked: false, blocker_codes: ["human_decision_material_conflict"] });
assert.deepEqual(queue.applications[0].decision_material, queue.tickets[0].decision_material);
assert.deepEqual(queue.applications[0].ticket_record_timestamps, queue.tickets[0].ticket_record_timestamps);
assert.equal(queue.applications[0].application_preparation.dispatch_allowed, false, "intent material is distinct from application qualification");
assert.equal(queue.policy.admin_required_to_decide, true);
assert.equal(queue.policy.live_authority_granted, false);
assert.equal(queue.policy.no_order, true);
assert.equal(JSON.stringify(queue).includes("never-public"), false);
assert.equal(fixture.commands.filter(command => command?.action === "promotion_read").length, 1, "the existing authority observation is reused exactly once");
assert.equal(fixture.reads.filter(name => name === `research_promotion_ticket:${ticket.ticket_id}`).length, 1);
assert.equal(fixture.writes(), 0);
for (const login of [null, "synthetic-denied"]) {
  const denied = readFixture({ migrated: true, eligible: true, blocked: false });
  assert.equal((await queueRead(denied, login)).status, 401);
  assert.equal(denied.commands.length, 0, "unauthorized readers cannot inspect authority");
  assert.equal(denied.reads.some(item => typeof item === "object"), false, "unauthorized readers cannot list tickets");
}
const authorityAbsent = readFixture({ migrated: false, eligible: false, blocked: false, material_key: null, decision: null });
assert.deepEqual((await (await queueRead(authorityAbsent, "synthetic-admin")).json()).tickets[0].decision_material,
  { ...unknownMaterial, migrated: false });

// An optional supplied baseline proves this candidate does not alter the
// executable API client, any writer, DO method, ACL, normalizer, or old filter.
if (process.env.QRS_METADATA_BASELINE) {
  const require = createRequire(new URL("../web/strategy-switch-console/frontend/package.json", import.meta.url));
  const ts = require("typescript");
  const workerPath = "web/strategy-switch-console/worker.js";
  const currentText = readFileSync(new URL(`../${workerPath}`, import.meta.url), "utf8");
  const baselineText = readFileSync(resolve(process.env.QRS_METADATA_BASELINE, workerPath), "utf8");
  const parse = text => ts.createSourceFile("worker.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const baseline = parse(baselineText);
  const current = parse(currentText);
  const topKey = node => node.name?.text || (ts.isVariableStatement(node) ? node.declarationList.declarations[0]?.name?.getText() : null) || node.getText().slice(0, 160);
  const currentByKey = new Map(current.statements.map(node => [topKey(node), node]));
  const changed = new Set(["accountDraftStrategyChoices", "listResearchPromotionTickets", "__test"]);
  for (const oldNode of baseline.statements) {
    const key = topKey(oldNode);
    if (changed.has(key)) continue;
    assert.equal(currentByKey.get(key)?.getText(), oldNode.getText(), `all existing executable statements stay byte-identical: ${key}`);
  }
  const baselineKeys = new Set(baseline.statements.map(topKey));
  assert.deepEqual(current.statements.map(topKey).filter(key => !baselineKeys.has(key)), ["attachPromotionQueueReadMetadata"], "only one new pure helper is permitted");
  assert.equal(currentByKey.get("__test").getText().replace(/\n\s*attachPromotionQueueReadMetadata,/, ""), baseline.statements.find(node => topKey(node) === "__test").getText(), "existing test export bindings are unchanged");
  const cleanChoices = node => {
    const emitted = node.getText().replace(/\n\s*(lifecycle_stage|allowed_execution_modes|can_switch_live|blocked_live_reason):[^\n]*,/g, "");
    const source = parse(emitted);
    return ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, source.statements[0], source);
  };
  const oldChoices = baseline.statements.find(node => node.name?.text === "accountDraftStrategyChoices");
  assert.equal(cleanChoices(currentByKey.get("accountDraftStrategyChoices")), cleanChoices(oldChoices), "original draft filter and validation AST are identical after removing only new response properties");
  const assertNoIo = node => {
    const calls = [];
    const visit = child => { if (ts.isCallExpression(child)) calls.push(child.expression.getText()); ts.forEachChild(child, visit); };
    visit(node);
    assert.deepEqual(calls.filter(name => /fetch|read|write|runtimeInstance|configStore/i.test(name)), [], "new metadata helper performs no I/O");
  };
  assertNoIo(currentByKey.get("attachPromotionQueueReadMetadata"));
  const apiPath = "web/strategy-switch-console/frontend/src/api.ts";
  const stripApi = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  assert.equal(stripApi(readFileSync(new URL(`../${apiPath}`, import.meta.url), "utf8")), stripApi(readFileSync(resolve(process.env.QRS_METADATA_BASELINE, apiPath), "utf8")), "API executable AST and requests remain unchanged");
  const baselineWorker = (await import(pathToFileURL(resolve(process.env.QRS_METADATA_BASELINE, workerPath)).href)).default;
  const oldFixture = readFixture({ migrated: true, eligible: false, blocked: false, material_key: "never-public", decision: null });
  const cookie = `qsl_switch_session=${await __test.makeSession("synthetic-reader", [], oldFixture.env)}`;
  const oldResponse = await baselineWorker.fetch(new Request("https://synthetic.invalid/api/research-promotion-tickets", { headers: { Cookie: cookie } }), oldFixture.env, {});
  assert.equal(oldResponse.status, readerResponse.status);
  const oldQueue = await oldResponse.json();
  const stripMetadata = value => JSON.parse(JSON.stringify(value, (key, item) => ["decision_material", "ticket_record_timestamps", "computed_at"].includes(key) ? undefined : item));
  assert.deepEqual(stripMetadata(queue), stripMetadata(oldQueue), "the full queue response is unchanged except additive metadata");
  assert.deepEqual(fixture.reads, oldFixture.reads, "no additional KV reads or changed read target");
  assert.deepEqual(fixture.commands, oldFixture.commands, "no additional authority reads, changed permissions, or new DO command");
  console.log("console_evidence_metadata_validation: baseline writer/filter/client/read-I/O invariants PASS");
}
console.log("console_evidence_metadata_validation: PASS");
