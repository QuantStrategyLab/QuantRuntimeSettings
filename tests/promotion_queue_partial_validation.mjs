// Synthetic persisted-JSON fixtures only. Deny all network before Worker import.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { buildSync } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
import { decisionActionState, listDailyDecisions } from "../web/strategy-switch-console/frontend/src/presentation.ts";
import { translate } from "../web/strategy-switch-console/frontend/src/locales.ts";
const original = { fetch: globalThis.fetch, connect: net.Socket.prototype.connect, httpRequest: http.request, httpGet: http.get, httpsRequest: https.request, httpsGet: https.get };
let networkAttempts = 0;
const deny = () => { networkAttempts++; throw new Error("promotion_fixture_network_forbidden"); };
globalThis.fetch = deny; net.Socket.prototype.connect = deny;
http.request = deny; http.get = deny; https.request = deny; https.get = deny; syncBuiltinESMExports();
const code = "research_promotion_review_material_invalid";
const makeTicket = (id, patch = {}) => ({
  ticket_id: id, strategy_profile: "fixture-profile", domain: "us_equity", state: "awaiting_human",
  drift_status: "review", drift_score: 0, created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z",
  budget: {}, proposed_params: {}, search_iterations: 1, shadow_evidence_kind: "synthetic-shadow", shadow_passed: true,
  notification_subject: "Fixture", notification_body: "Synthetic fixture", human_decision: "", human_decided_at: "",
  live_authority_granted: false, suggested_risk_profile: "CAPITAL_PRESERVATION",
  confirmation_target_platform: "", confirmation_execution_mode: "", confirmation_risk_profile: "", notes: [], ...patch,
});
try {
  const worker = await import("../web/strategy-switch-console/worker.js");
  async function fixture(tickets, failAuthority = false, migrated = true) {
    const rows = new Map(tickets.map(ticket => [`research_promotion_ticket:${ticket.ticket_id}`, JSON.stringify(ticket)]));
    const before = [...rows]; let writes = 0; const commands = [];
    const env = {
      RESEARCH_PROMOTION_SYNC_TOKEN: "synthetic-sync-only",
      SESSION_SECRET: "synthetic-partial-fixture-only", ALLOWED_GITHUB_LOGINS: "fixture-admin,fixture-reader", STRATEGY_SWITCH_ADMIN_LOGINS: "fixture-admin",
      STRATEGY_SWITCH_CONFIG: {
        async get(key) { return rows.get(key) ?? null; },
        async list({ prefix = "" }) { return { keys: [...rows.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })) }; },
        async put() { writes++; throw new Error("unexpected_fixture_write"); },
      },
      STRATEGY_SWITCH_RUNTIME_INSTANCES: { idFromName: name => name, get() { return { async fetch(_url, init) {
        const command = init?.body ? JSON.parse(init.body) : null; commands.push(command?.action || "instance_read");
        if (!command) return Response.json({ ok: true, initialized: false, revision: 0, instances: [], account_options: {}, history: [] });
        if (command.action === "promotion_read") {
          if (failAuthority) throw new Error("synthetic_do_failure");
          return Response.json({ ok: true, migrated, blocked: false, eligible: true, material_key: "a".repeat(64), review_binding: null, decision: null });
        }
        if (command.action === "application_latest") return Response.json({ ok: true, application: null });
        writes++; throw new Error(`unexpected_fixture_command:${command.action}`);
      } }; } },
    };
    const token = await worker.__test.makeSession("fixture-admin", [], env);
    const reader = await worker.__test.makeSession("fixture-reader", [], env);
    const call = async (body, opts = {}) => {
      const response = await worker.default.fetch(new Request(`https://synthetic.invalid/api/research-promotion-${body ? "decisions" : "tickets"}`, {
        method: body ? "POST" : "GET", headers: { Cookie: `qsl_switch_session=${opts.reader ? reader : token}`, ...(body ? { "Content-Type": "application/json", ...(!opts.noOrigin ? { Origin: "https://synthetic.invalid" } : {}) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
      }), env);
      assert.match(response.headers.get("cache-control"), /no-store/);
      return { status: response.status, payload: await response.json() };
    };
    return { env, call, assertUnwritten() { assert.equal(writes, 0); assert.deepEqual([...rows], before); assert.equal(commands.includes("promotion_decide"), false); } };
  }
  const good = makeTicket("fixture-good");
  const control = await fixture([good, makeTicket("fixture-other")]);
  const controlRead = await control.call();
  assert.equal(controlRead.status, 200); assert.equal(controlRead.payload.data_status, "ready"); assert.equal(controlRead.payload.tickets.length, 2); control.assertUnwritten();
  let mixed;
  for (const patch of [{ drift_score: "legacy-invalid" }, { search_iterations: "1e999" }]) {
    const bad = makeTicket("fixture-invalid", patch);
    assert.deepEqual(JSON.parse(JSON.stringify(bad)), bad, "raw fixture is JSON representable, not native NaN/Infinity");
    const normalized = worker.__test.normalizeResearchPromotionTicket(bad);
    assert.equal(Number.isFinite(normalized.drift_score) && Number.isFinite(normalized.search_iterations), false, "legacy normalizer reaches invalid canonical review material");
    const test = await fixture([bad, good]); const read = await test.call();
    assert.equal(read.status, 200, "one malformed review must not discard valid queue material");
    mixed = read.payload;
    assert.equal(mixed.data_status, "partial"); assert.deepEqual(mixed.errors, [code]);
    assert.equal(mixed.summary.invalid_review_count, 1); assert.equal(mixed.summary.ticket_count, 1);
    assert.deepEqual(mixed.tickets.map(ticket => ticket.ticket_id), [good.ticket_id]);
    assert.deepEqual(mixed.applications.map(ticket => ticket.ticket_id), [good.ticket_id]);
    assert.equal(mixed.tickets[0].drift_score, 0, "genuine numeric zero stays zero");
    assert.match(mixed.tickets[0].decision_binding.material_sha256, /^[a-f0-9]{64}$/);
    assert.equal(mixed.tickets[0].decision_binding.review_binding, null, "old DO rows are not silently v2-certified");
    assert.equal(mixed.invalid_tickets.length, 1);
    const invalid = mixed.invalid_tickets[0];
    assert.equal(invalid.ticket_id, bad.ticket_id); assert.equal(invalid.decision_binding, null);
    assert.deepEqual(invalid.decision_material, { eligible: false, blocked: true, blocker_codes: [code] });
    assert.equal(invalid.live_authority_granted, false); assert.equal(invalid.no_order, true);
    assert.equal("drift_score" in invalid, false); assert.equal("search_iterations" in invalid, false, "invalid numbers are not fabricated as zero/null");
    for (const decision of ["accept", "reject"]) for (const version of [1, 2]) {
      const result = await test.call({ ticket_id: bad.ticket_id, decision, expected_strategy_profile: bad.strategy_profile, expected_proposed_params: {}, ...(version === 2 ? { expected_review_sha256: "b".repeat(64) } : {}) });
      assert.equal(result.status, 400); assert.equal(result.payload.error, code);
    }
    assert.equal((await test.call({ ticket_id: bad.ticket_id, decision: "reject" }, { reader: true })).status, 403);
    assert.equal((await test.call({ ticket_id: bad.ticket_id, decision: "reject" }, { noOrigin: true })).status, 403);
    const sync = await worker.default.fetch(new Request("https://synthetic.invalid/api/internal/sync-research-promotion-ticket", {
      method: "POST", headers: { Authorization: "Bearer synthetic-sync-only", "Content-Type": "application/json" }, body: JSON.stringify(bad),
    }), test.env);
    assert.equal(sync.status, 400); assert.equal((await sync.json()).error, code);
    test.assertUnwritten();
  }
  for (const state of ["human_accepted", "human_rejected"]) {
    const terminal = await fixture([good, makeTicket("fixture-terminal-invalid", { state, drift_score: "legacy-invalid" })], false, false);
    const read = await terminal.call(); assert.equal(read.status, 200); assert.equal(read.payload.data_status, "partial");
    assert.deepEqual(read.payload.tickets.map(ticket => ticket.ticket_id), [good.ticket_id]);
    assert.deepEqual(read.payload.applications.map(ticket => ticket.ticket_id), [good.ticket_id]);
    assert.equal(read.payload.invalid_tickets[0].state, state); terminal.assertUnwritten();
  }
  const allInvalid = await fixture(Array.from({ length: 101 }, (_, index) => makeTicket(`invalid-${index}`, { drift_score: "legacy-invalid" })));
  const empty = await allInvalid.call(); assert.equal(empty.status, 200); assert.equal(empty.payload.data_status, "partial");
  assert.equal(empty.payload.summary.invalid_review_count, 100); assert.equal(empty.payload.invalid_tickets.length, 100);
  assert.deepEqual(empty.payload.tickets, []); assert.deepEqual(empty.payload.applications, []); allInvalid.assertUnwritten();
  const missingDO = await fixture([good]); delete missingDO.env.STRATEGY_SWITCH_RUNTIME_INSTANCES;
  assert.equal((await missingDO.call()).status, 503); missingDO.assertUnwritten();
  const failedDO = await fixture([good], true);
  const unavailable = await failedDO.call(); assert.equal(unavailable.status, 503); assert.notEqual(unavailable.payload.data_status, "partial"); failedDO.assertUnwritten();
  const cryptoFixture = await fixture([good]); const digest = crypto.subtle.digest;
  try {
    for (const message of ["synthetic_hash_unavailable", "research task must use finite JSON values"]) {
      crypto.subtle.digest = async () => { throw new Error(message); };
      const hashFailure = await cryptoFixture.call(); assert.equal(hashFailure.status, 500); assert.equal(hashFailure.payload.error, message);
      assert.notEqual(hashFailure.payload.data_status, "partial", "crypto failures cannot impersonate canonical-data errors");
    }
  } finally { crypto.subtle.digest = digest; }
  cryptoFixture.assertUnwritten();

  const ready = value => ({ value: { data_status: "ready", ...value } });
  const input = { language: "zh", profiles: [{ profile: "fixture-profile", label_zh: "正常方案", label_en: "Valid proposal" }], owners: ready({ candidates: [] }), recovery: ready({ recoveries: [] }), accountsFor: () => [] };
  const derive = (value, extras = {}) => listDailyDecisions({ ...input, promotions: { value }, ...extras });
  const result = derive(mixed);
  assert.equal(result.blocked, true, "partial warning must stay present");
  assert.deepEqual(result.items.map(item => item.reference), [good.ticket_id]);
  assert.equal(result.items[0].canAdopt, false); assert.equal(result.items[0].canReject, true, "existing account gates remain");
  const qualified = derive({ ...mixed, tickets: [{ ...mixed.tickets[0], decision_binding: { ...mixed.tickets[0].decision_binding, review_binding: { schema_version: "qsl_promotion_review_binding.v2", review_sha256: "b".repeat(64) } } }] }, {
    accountsFor: () => [{ platform: "longbridge", key: "one", label: "One" }, { platform: "longbridge", key: "two", label: "Two" }],
  });
  assert.equal(qualified.blocked, true); assert.equal(qualified.items.length, 1); assert.equal(qualified.items[0].accountChoices.length, 2);
  assert.equal(decisionActionState(qualified.items[0], { admin: true, busy: false, selectedAccountId: "" }).adoptEnabled, false);
  assert.equal(decisionActionState(qualified.items[0], { admin: true, busy: false, selectedAccountId: "longbridge:two" }).adoptEnabled, true);
  assert.equal(decisionActionState(qualified.items[0], { admin: true, busy: true, selectedAccountId: "longbridge:two" }).adoptEnabled, false);
  assert.equal(decisionActionState(qualified.items[0], { admin: false, busy: false, selectedAccountId: "longbridge:two" }).rejectEnabled, false);
  assert.equal(derive(controlRead.payload).blocked, false);
  assert.equal(derive(empty.payload).items.length, 0); assert.equal(derive(empty.payload).blocked, true);
  assert.equal(derive({ ...mixed, tickets: [{ ...mixed.tickets[0], source_check_required: true }] }).items.length, 0);
  for (const patch of [
    { schema_version: "unknown" }, { data_status: "stale" }, { data_status: "unavailable" },
    { errors: [] }, { errors: [code, "unknown"] }, { errors: ["unknown"] },
    { summary: { ...mixed.summary, invalid_review_count: 0 } }, { summary: { ...mixed.summary, invalid_review_count: 101 } },
    { summary: { ...mixed.summary, invalid_review_count: 1.5 } }, { summary: { ...mixed.summary, ticket_count: 2 } },
    { invalid_tickets: [] }, { invalid_tickets: [{ ...mixed.invalid_tickets[0], decision_binding: {} }] },
    { invalid_tickets: [{ ...mixed.invalid_tickets[0], ticket_id: good.ticket_id }] },
    { invalid_tickets: [{ ...mixed.invalid_tickets[0], decision_material: { eligible: true, blocked: false, blocker_codes: [] } }] },
    { tickets: [{ ...mixed.tickets[0], decision_binding: { ...mixed.tickets[0].decision_binding, material_sha256: "invalid" } }] },
  ]) { const value = derive({ ...mixed, ...patch }); assert.equal(value.items.length, 0, JSON.stringify(patch)); assert.equal(value.blocked, true); }
  assert.equal(derive(mixed, { promotions: { value: mixed, error: "transport_failed" } }).items.length, 0);
  assert.equal(derive(mixed, { owners: { value: { ...mixed, candidates: [{ candidate: { candidate_id: "fake" } }] } }, recovery: { value: { ...mixed, recoveries: [{}] } } }).items.length, 1, "recognized partial is promotion-only");

  // Actual unchanged React component SSR, including its existing partial warning.
  const temporary = mkdtempSync(join(tmpdir(), "qsl-promotion-partial-"));
  try {
    const frontend = fileURLToPath(new URL("../web/strategy-switch-console/frontend", import.meta.url));
    const bundle = buildSync({ stdin: { contents: `
      import React from "react"; import { renderToStaticMarkup } from "react-dom/server";
      import { LocaleContext } from "./src/locales"; import { DecisionsPage } from "./src/DecisionsPage";
      export const render = (result, language) => renderToStaticMarkup(<LocaleContext.Provider value={language}><DecisionsPage {...result} admin={false} busy={false} selectedAccountId="" onSelectAccount={()=>{}} onDecide={()=>{}}/></LocaleContext.Provider>);
    `, resolveDir: frontend, loader: "tsx" }, bundle: true, platform: "node", format: "cjs", jsx: "automatic", write: false, nodePaths: [join(frontend, "node_modules")] });
    const path = join(temporary, "render.cjs"); writeFileSync(path, bundle.outputFiles[0].text);
    const { render } = createRequire(import.meta.url)(path);
    for (const language of ["zh", "en"]) {
      const html = render(result, language);
      assert.equal(html.includes(good.ticket_id), true); assert.equal(html.includes("fixture-invalid"), false);
      assert.equal(html.includes(translate("部分待办暂时无法读取", language)), true); assert.match(html, /role="status"/);
      assert.equal(html.includes(translate("{sources} 暂时读不到。以下仅显示已读取的事项，待办列表可能不完整。", language, { sources: translate("晋级方案", language) })), true);
      assert.match(html, /disabled=""/, "non-admin action remains disabled");
      assert.equal(render(derive(controlRead.payload), language).includes(translate("部分待办暂时无法读取", language)), false);
      const emptyBlocked = render(derive({ ...mixed, errors: ["unknown"] }), language);
      assert.equal(emptyBlocked.includes(translate("暂时读不到：{sources}", language, { sources: translate("晋级方案", language) })), true);
      assert.equal(emptyBlocked.includes(translate("待办暂不可用", language)), false);
      assert.equal(emptyBlocked.includes(translate("暂无需要你决定的事项", language)), false);
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
  assert.equal(networkAttempts, 0);
  console.log("Promotion queue partial validation: PASS (mixed JSON, zero invalid writes, adapter, actual React SSR, host_network_attempts=0)");
} finally {
  globalThis.fetch = original.fetch; net.Socket.prototype.connect = original.connect;
  http.request = original.httpRequest; http.get = original.httpGet; https.request = original.httpsRequest; https.get = original.httpsGet; syncBuiltinESMExports();
}
