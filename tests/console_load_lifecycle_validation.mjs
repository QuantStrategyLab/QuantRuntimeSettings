import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { createContext, runInContext } from "node:vm";
import { AccessError, getJson, invalidatePrivateSession, loadAdminModel, loadReadModel, loadHumanDecisionReceipt, postJson } from "../web/strategy-switch-console/frontend/src/api.ts";
import { createRequestGate } from "../web/strategy-switch-console/frontend/src/requestGate.js";
import { createHumanDecisionController, humanDecisionExpectation, humanDecisionDigest, createHkStopController, createRequestLock, createUnknownSubmitLock, pageFromWorkspace } from "../web/strategy-switch-console/frontend/src/operations.ts";

// Exercise the actual App boot/selection hooks with deterministic React-like
// lifecycle and timers. This is not DOM rendering or browser evidence.
const app = readFileSync(new URL("../web/strategy-switch-console/frontend/src/App.tsx", import.meta.url), "utf8");
const makeRows = app.slice(app.indexOf("function currentFor("), app.indexOf("function QslIcon("));
const start = app.indexOf("function App() {");
const stop = app.indexOf("    const setPageAndRoute", start);
assert.ok(start >= 0 && stop > start);
const recordStart = app.indexOf("    const recordHumanDecision =", stop);
const recordStop = app.indexOf("    const decideOwner =", recordStart);
const lifecycle = stripTypeScriptTypes(`${makeRows}\n${app.slice(start, stop)}\n${app.slice(recordStart, recordStop)}
  return { refresh, model, bootState, diagnosis, overviewReadModelRefreshVersion, selectedId,
    setSelectedId, setPage, setUxDraft, clearPrivateState, humanDecisions, errorMessage, recordHumanDecision };
}\nApp();`);
assert.doesNotMatch(app, /startVisibleRefreshLoop|window\.setInterval/, "App must not schedule autonomous network loads");

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, callback) {
      const callbacks = listeners.get(name) || new Set(); callbacks.add(callback); listeners.set(name, callbacks);
    },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    dispatchEvent(event) { for (const callback of listeners.get(event.type) || []) callback(event); },
  };
}
function harness() {
  const documentTarget = Object.assign(eventTarget(), { visibilityState: "visible", documentElement: { dataset: {} }, title: "" });
  const timers = new Map(); let nextTimer = 0; let clock = 0;
  const windowTarget = Object.assign(eventTarget(), {
    location: { pathname: "/", search: "" },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    setInterval(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay, due: clock + delay }); return id; },
    clearInterval(id) { timers.delete(id); },
  });
  let slots = []; let cursor = 0; let dirty = false; let effects = []; let mounted = true; let result;
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const context = createContext({
    URLSearchParams, Map, Error, Event, AccessError, getJson, loadHumanDecisionReceipt, postJson, invalidatePrivateSession, loadReadModel, loadAdminModel,
    createRequestGate, createHumanDecisionController, humanDecisionExpectation, humanDecisionDigest, createHkStopController, createRequestLock, createUnknownSubmitLock, pageFromWorkspace,
    window: windowTarget, document: documentTarget, requestAnimationFrame: () => 0,
    normalizeThemePreference: () => "system", resolveTheme: () => "light", THEME_STORAGE_KEY: "synthetic-theme",
    safeGet: () => null, safeSet() {}, initialLanguage: () => "en", translate: key => key,
    emptyUxDraft: () => ({ draft: {}, revision: 0, preview: null, intent: null }),
    accountRuntimeLinkDetail: () => null, copy: (key, values = {}) => ({ key, values }), requestErrorKey: () => "request_failed",
    NAV: [{ id: "overview", label: "overview" }, { id: "accounts", label: "accounts" }, { id: "strategy", label: "strategy" }],
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, value => {
        const next = typeof value === "function" ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { current: initial }; return slots[index]; },
    useMemo(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || !equal(slots[index].dependencies, dependencies)) slots[index] = { value: callback(), dependencies: Array.from(dependencies) };
      return slots[index].value;
    },
    useCallback(callback, dependencies) { return context.useMemo(() => callback, dependencies); },
    useEffect(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || !equal(slots[index].dependencies, dependencies)) {
        const prior = slots[index];
        slots[index] = { dependencies: Array.from(dependencies), cleanup: prior?.cleanup };
        effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = callback(); });
      }
    },
  });
  return {
    window: windowTarget, document: documentTarget,
    get current() { return result; },
    render() {
      assert.equal(mounted, true);
      let renders = 0;
      do {
        dirty = false; cursor = 0; effects = [];
        result = runInContext(lifecycle, context, { timeout: 1000 });
        for (const effect of effects) effect();
        assert.ok(++renders < 20, "hooks settle without a rendering loop");
      } while (dirty);
    },
    async settle() {
      for (let i = 0; i < 4; i++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) this.render(); }
    },
    advance(ms) {
      const until = clock + ms;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        clock = next[1].due; next[1].due += next[1].delay; next[1].callback();
      }
      clock = until;
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); mounted = false; },
  };
}

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const calls = [];
const pendingDiagnosis = [];
const pendingReads = [];
let denySessionStatus = 0; let deferDiagnosis = false; let deferRead = false;
const fixture = path => {
  if (path === "/api/session") return { authenticated: true, login: "synthetic", allowed: true, admin: false };
  if (path === "/api/config") return { accountOptions: { longbridge: [{ key: "synthetic-a" }, { key: "synthetic-b" }] }, platformMeta: { longbridge: { label: "synthetic" } } };
  if (path === "/api/ux1/draft") return { draft: {}, job: { status: "running" } };
  if (path.startsWith("/api/account-diagnosis?")) return { task: { status: "running", recheck_status: "sent" } };
  return {};
};
const response = (payload, status = 200) => ({ status, ok: status === 200, json: async () => payload });
globalThis.fetch = async (path, options) => {
  assert.ok(typeof path === "string" && path.startsWith("/api/"), "test permits only internal synthetic reads");
  assert.equal(options.method, "GET"); assert.equal(options.cache, "no-store"); assert.equal(options.credentials, "same-origin");
  calls.push(path);
  if (path === "/api/session" && denySessionStatus) return response({}, denySessionStatus);
  if (path === "/api/session" && deferRead) return new Promise(resolve => pendingReads.push(resolve));
  if (path.startsWith("/api/account-diagnosis?") && deferDiagnosis) return new Promise(resolve => pendingDiagnosis.push({ path, resolve }));
  return response(fixture(path));
};
const mounted = harness(); globalThis.window = mounted.window;
try {
  mounted.render(); await mounted.settle();
  assert.equal(mounted.current.bootState, "ready");
  assert.equal(calls.filter(path => path === "/api/session").length, 1, "opening loads the read model once");
  for (const path of new Set(calls)) assert.equal(calls.filter(value => value === path).length, 1, `opening reads ${path} only once`);
  for (const path of ["/api/strategy-health", "/api/execution-evidence", "/api/research-tasks", "/api/runtime-catalog", "/api/m0-research", "/api/adaptive-selection"])
    assert.equal(calls.includes(path), false, `${path} is not part of the current read model`);
  assert.equal(mounted.current.overviewReadModelRefreshVersion, 1, "successful boot commits one model revision");
  const openingCount = calls.length;
  for (const page of ["strategy", "accounts"]) {
    mounted.current.setPage(page); mounted.render();
    mounted.advance(3000); mounted.advance(300_000);
    mounted.window.dispatchEvent(new Event("focus"));
    mounted.document.visibilityState = "hidden"; mounted.document.dispatchEvent(new Event("visibilitychange"));
    mounted.document.visibilityState = "visible"; mounted.document.dispatchEvent(new Event("visibilitychange"));
    await mounted.settle();
  }
  assert.equal(calls.length, openingCount, "3s/5min, focus and visibility changes never reload even with running jobs");

  await mounted.current.refresh(); await mounted.settle();
  assert.equal(calls.filter(path => path === "/api/session").length, 2, "explicit readback loads exactly one new read model");
  assert.equal(mounted.current.overviewReadModelRefreshVersion, 2);

  deferDiagnosis = true;
  mounted.current.setSelectedId("longbridge:synthetic-b"); mounted.render();
  mounted.current.setSelectedId("longbridge:synthetic-a"); mounted.render();
  assert.equal(pendingDiagnosis.length, 2, "each explicit account selection reads its own diagnosis once");
  pendingDiagnosis[1].resolve(response({ task: { status: "succeeded", marker: "new-a" } })); await mounted.settle();
  pendingDiagnosis[0].resolve(response({ task: { status: "succeeded", marker: "late-b" } })); await mounted.settle();
  assert.equal(mounted.current.diagnosis["longbridge:synthetic-a"].task.marker, "new-a");
  assert.notEqual(mounted.current.diagnosis["longbridge:synthetic-b"]?.task?.marker, "late-b", "late old-account data cannot write after selection changes");

  deferRead = true;
  const lateRead = mounted.current.refresh();
  assert.equal(pendingReads.length, 1);
  deferRead = false; denySessionStatus = 401;
  await mounted.current.refresh(); await mounted.settle();
  assert.equal(mounted.current.model, null); assert.equal(mounted.current.bootState, "denied", "401 clears private state");
  assert.equal(Object.keys(mounted.current.diagnosis).length, 0);
  pendingReads[0](response(fixture("/api/session"))); await lateRead; await mounted.settle();
  assert.equal(mounted.current.model, null, "a late read cannot restore data after private-session invalidation");
  denySessionStatus = 403;
  await mounted.current.refresh(); await mounted.settle();
  assert.equal(mounted.current.model, null); assert.equal(mounted.current.bootState, "denied", "403 also clears private state");
  mounted.unmount();
  denySessionStatus = 0; deferDiagnosis = false;
  const decisionApp = harness(); globalThis.window = decisionApp.window;
  const owner = { candidate: { candidate_id: "synthetic-history" }, candidate_evidence_sha256: "d".repeat(64), decision_binding: { kind: "owner", subject_id: "synthetic-history", material_sha256: "d".repeat(64) } };
  const body = { candidate_id: owner.candidate.candidate_id, candidate_evidence_sha256: owner.candidate_evidence_sha256, decision: "keep_parked" };
  const expected = await humanDecisionExpectation("owner", owner, body);
  const material = { schema_version: "qsl_human_decision_receipt.v1", kind: "owner", subject_id: expected.subject_id, material_sha256: expected.material_sha256, action: expected.action, target: expected.target, decided_at: "2026-10-07T06:00:00.123456Z", decided_by: "synthetic-original-actor", no_order: true, execution_authority_granted: false };
  const receipt = { ...material, receipt_sha256: await humanDecisionDigest(material) };
  let postCount = 0, exactCount = 0, failQueue = true, failRuntime = false, losePost = false, found = true, deferPost = null;
  globalThis.fetch = async (path, options) => {
    assert.ok(path.startsWith("/api/"));
    assert.equal(options.credentials, "same-origin"); assert.equal(options.cache, "no-store");
    if (options.method === "POST") {
      assert.equal(path, "/api/owner-decisions"); postCount++;
      const request = JSON.parse(options.body);
      assert.equal(request.expected_material_sha256, expected.material_sha256);
      if (deferPost) return new Promise(resolve => { deferPost.resolve = resolve; });
      if (losePost) throw new Error("synthetic lost response after durable commit");
      return response({ ok: true, decision_receipt: receipt });
    }
    assert.equal(options.method, "GET");
    if (path.includes("decision_subject_id=")) {
      exactCount++;
      const u = new URL(path, "https://synthetic.invalid");
      assert.equal(u.pathname, "/api/owner-decisions"); assert.equal(u.searchParams.get("decision_subject_id"), expected.subject_id);
      assert.equal(u.searchParams.get("decision_material_sha256"), expected.material_sha256);
      return response({ ok: true, decision_readback: { schema_version: "qsl_human_decision_readback.v1", source: "durable_human_decision_record", kind: expected.kind, subject_id: expected.subject_id, requested_material_sha256: expected.material_sha256, observed_at: "2026-10-07T09:00:00Z", lookup_status: found ? "found" : "not_found", receipt: found ? receipt : null, current_material: { status: "not_current" } } });
    }
    if (path === "/api/session") return response({ authenticated: true, login: "synthetic", allowed: true, admin: true });
    if (path === "/api/runtime-target-lifecycle" && failRuntime) return response({}, 503);
    if (path === "/api/owner-decisions") return failQueue ? response({}, 503) : response({ data_status: "ready", candidates: [] });
    return response(fixture(path));
  };
  decisionApp.render(); await decisionApp.settle();
  await decisionApp.current.recordHumanDecision("owner", owner, body, "/api/owner-decisions", "owner:synthetic-history"); await decisionApp.settle();
  assert.equal(postCount, 1); assert.equal(exactCount, 1);
  assert.equal(decisionApp.current.humanDecisions.current.entries()[0].status, "unresolved");
  assert.equal(decisionApp.current.humanDecisions.current.entries()[0].receipt.decided_at, receipt.decided_at);
  assert.equal(decisionApp.current.errorMessage.key, "决定已记录：{time}。{detail}");
  assert.equal(decisionApp.current.errorMessage.values.detail.key, "最新资料未确认；请刷新核对，避免重复提交。");
  await decisionApp.current.recordHumanDecision("owner", owner, { ...body, decision: "approve_limited_live_canary" }, "/api/owner-decisions", "owner:synthetic-history");
  assert.equal(postCount, 1, "unresolved original material blocks a new/conflicting POST");
  failQueue = false;
  await decisionApp.current.refresh(); await decisionApp.settle();
  assert.equal(postCount, 1); assert.equal(exactCount, 2);
  assert.equal(decisionApp.current.humanDecisions.current.entries()[0].status, "recorded");
  assert.equal(decisionApp.current.humanDecisions.current.entries()[0].receipt.decided_at, receipt.decided_at);
  assert.equal(decisionApp.current.errorMessage.values.detail.key, "本次只记录决定，不会提交订单或改变交易权限。");
  failRuntime = true; await decisionApp.current.refresh(); await decisionApp.settle();
  assert.equal(decisionApp.current.humanDecisions.current.entries()[0].status, "recorded", "runtime failure is independent of durable intent");
  assert.equal(decisionApp.current.humanDecisions.current.entries()[0].receipt.decided_at, receipt.decided_at);
  assert.equal(decisionApp.current.model.runtime.error, "http_503");
  assert.equal(decisionApp.current.humanDecisions.current.entries()[0].receipt.execution_authority_granted, false);
  failRuntime = false;
  decisionApp.current.humanDecisions.current.clear(); losePost = true; found = false;
  await decisionApp.current.recordHumanDecision("owner", owner, body, "/api/owner-decisions", "owner:synthetic-history"); await decisionApp.settle();
  assert.equal(postCount, 2); assert.equal(decisionApp.current.humanDecisions.current.entries()[0].status, "unresolved");
  await decisionApp.current.recordHumanDecision("owner", owner, body, "/api/owner-decisions", "owner:synthetic-history");
  assert.equal(postCount, 2, "lost response and HTTP200/not_found never cause another POST");
  found = true; await decisionApp.current.refresh(); await decisionApp.settle();
  assert.equal(postCount, 2); assert.equal(decisionApp.current.humanDecisions.current.entries()[0].status, "recorded");
  assert.equal(decisionApp.current.humanDecisions.current.entries()[0].receipt.decided_by, "synthetic-original-actor");
  decisionApp.current.humanDecisions.current.clear(); losePost = false; deferPost = {};
  const lateDecision = decisionApp.current.recordHumanDecision("owner", owner, body, "/api/owner-decisions", "owner:synthetic-history");
  await decisionApp.settle(); assert.equal(postCount, 3);
  decisionApp.current.setSelectedId("longbridge:synthetic-b"); decisionApp.render();
  decisionApp.current.clearPrivateState(); decisionApp.render();
  deferPost.resolve(response({ ok: true, decision_receipt: receipt })); await lateDecision; await decisionApp.settle();
  assert.equal(decisionApp.current.model, null); assert.deepEqual(decisionApp.current.humanDecisions.current.entries(), []);
  decisionApp.unmount();
  for (const version of [1, 2]) {
    const source = { ticket_id: `synthetic-promotion-v${version}`, strategy_profile: "demo", domain: "us_equity", proposed_params: { candidate: "synthetic-only" }, shadow_passed: true, shadow_evidence_kind: "synthetic-shadow", drift_status: "stable", drift_score: 0, budget: {}, search_iterations: 1, suggested_risk_profile: "CAPITAL_PRESERVATION", notification_subject: "Synthetic", notification_body: "Synthetic review only", notes: [], research_summary: null };
    const legacy = Object.fromEntries(["ticket_id", "strategy_profile", "domain", "proposed_params", "shadow_passed", "shadow_evidence_kind"].map(k => [k, source[k]]));
    source.decision_binding = { kind: "promotion", subject_id: source.ticket_id, material_sha256: await humanDecisionDigest(legacy), review_binding: version === 2 ? { schema_version: "qsl_promotion_review_binding.v2", review_sha256: await humanDecisionDigest({ schema_version: "qsl_promotion_review_material.v2", ...source }) } : null };
    const body = { ticket_id: source.ticket_id, decision: version === 2 ? "accept" : "reject", confirmation: version === 2 ? { target_platform: "longbridge", execution_mode: "paper", risk_profile: "CAPITAL_PRESERVATION" } : null, ...(version === 2 ? { selected_account: { platform: "longbridge", key: "synthetic-a" } } : {}) };
    const wanted = await humanDecisionExpectation("promotion", source, body); assert.ok(wanted);
    const raw = { schema_version: `qsl_human_decision_receipt.v${version}`, ...(version === 2 ? { review_binding: source.decision_binding.review_binding } : {}), kind: "promotion", subject_id: source.ticket_id, material_sha256: wanted.material_sha256, action: wanted.action, target: wanted.target, decided_at: "2026-10-07T06:00:00.123456Z", decided_by: "synthetic-original-actor", no_order: true, execution_authority_granted: false };
    const receipt = { ...raw, receipt_sha256: await humanDecisionDigest(raw) };
    let posts = 0, reads = 0, completePost, markPostStarted;
    const postStarted = new Promise(resolve => { markPostStarted = resolve; });
    globalThis.fetch = async (path, options) => {
      assert.ok(path.startsWith("/api/"));
      if (options.method === "POST") {
        posts++; assert.equal(path, "/api/research-promotion-decisions");
        const request = JSON.parse(options.body); assert.equal(request.expected_material_sha256, wanted.material_sha256);
        assert.equal(request.expected_review_sha256, wanted.review_sha256 || undefined);
        assert.deepEqual(request.selected_account ?? null, wanted.target.selected_account);
        return new Promise(resolve => {
          completePost = () => resolve(response({ ok: true, decision_receipt: receipt }));
          markPostStarted();
        });
      }
      assert.equal(options.method, "GET");
      if (path.includes("decision_subject_id=")) {
        reads++; const url = new URL(path, "https://synthetic.invalid");
        assert.equal(url.pathname, "/api/research-promotion-tickets"); assert.equal(url.searchParams.get("decision_subject_id"), source.ticket_id);
        assert.equal(url.searchParams.get("decision_material_sha256"), wanted.material_sha256);
        return response({ ok: true, decision_readback: { schema_version: "qsl_human_decision_readback.v1", source: "durable_human_decision_record", kind: "promotion", subject_id: source.ticket_id, requested_material_sha256: wanted.material_sha256, observed_at: "2026-10-07T09:00:00Z", lookup_status: "found", receipt, current_material: { status: "not_current" } } });
      }
      if (path === "/api/session") return response({ authenticated: true, login: "synthetic", allowed: true, admin: true });
      if (path === "/api/research-promotion-tickets") return response({ data_status: "ready", tickets: [] });
      return response(fixture(path));
    };
    const app = harness(); globalThis.window = app.window; app.render(); await app.settle();
    const submitted = app.current.recordHumanDecision("promotion", source, body, "/api/research-promotion-decisions", "promotion");
    // WebCrypto completion is not bounded by settle()'s event-loop turns.
    // Wait for the deliberately suspended POST before testing account changes.
    let postDeadline;
    try {
      await Promise.race([
        postStarted,
        submitted.then(() => { throw new Error("decision ended before its POST started"); }),
        new Promise((_, reject) => { postDeadline = setTimeout(() => reject(new Error("decision POST did not start")), 5000); }),
      ]);
    } finally {
      clearTimeout(postDeadline);
    }
    await app.settle(); assert.equal(posts, 1);
    app.current.setSelectedId("longbridge:synthetic-b"); app.render();
    completePost(); await submitted; await app.settle();
    const result = app.current.humanDecisions.current.entries()[0];
    assert.equal(result.status, "recorded"); assert.equal(reads, 1);
    assert.deepEqual(result.receipt.target, wanted.target, "late decision remains bound to the original selected account/target");
    assert.equal(result.receipt.decided_at, raw.decided_at); assert.equal(result.receipt.decided_by, raw.decided_by);
    app.unmount();
  }
  console.log("actual App v1/v2 promotion roundtrips: PASS (original account/target, complete review hash, historical reject and one POST)");
  console.log("actual App decision readback: PASS (durable receipt/queue failure, one POST, historical GET, lost response, explicit retry and session isolation)");
console.log("console load lifecycle: PASS (one boot, no unused reads or polling/focus GETs, explicit readback, selection races, 401/403 and late-response isolation)");
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
}
