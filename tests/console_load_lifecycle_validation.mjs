import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { createContext, runInContext } from "node:vm";
import { AccessError, getJson, invalidatePrivateSession, loadAdminModel, loadReadModel } from "../web/strategy-switch-console/frontend/src/api.ts";
import { createRequestGate } from "../web/strategy-switch-console/frontend/src/requestGate.js";
import { createHkStopController, createRequestLock, createUnknownSubmitLock, pageFromWorkspace } from "../web/strategy-switch-console/frontend/src/operations.ts";

// Exercise the actual App boot/selection hooks with deterministic React-like
// lifecycle and timers. This is not DOM rendering or browser evidence.
const app = readFileSync(new URL("../web/strategy-switch-console/frontend/src/App.tsx", import.meta.url), "utf8");
const makeRows = app.slice(app.indexOf("function currentFor("), app.indexOf("function QslIcon("));
const start = app.indexOf("function App() {");
const stop = app.indexOf("    const setPageAndRoute", start);
assert.ok(start >= 0 && stop > start);
const lifecycle = stripTypeScriptTypes(`${makeRows}\n${app.slice(start, stop)}
  return { refresh, model, bootState, diagnosis, overviewReadModelRefreshVersion, selectedId,
    setSelectedId, setPage, setUxDraft, clearPrivateState };
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
    URLSearchParams, Map, Error, Event, AccessError, getJson, invalidatePrivateSession, loadReadModel, loadAdminModel,
    createRequestGate, createHkStopController, createRequestLock, createUnknownSubmitLock, pageFromWorkspace,
    window: windowTarget, document: documentTarget, requestAnimationFrame: () => 0,
    normalizeThemePreference: () => "system", resolveTheme: () => "light", THEME_STORAGE_KEY: "synthetic-theme",
    safeGet: () => null, safeSet() {}, initialLanguage: () => "en", translate: key => key,
    emptyUxDraft: () => ({ draft: {}, revision: 0, preview: null, intent: null }),
    accountRuntimeLinkDetail: () => null, copy: key => ({ key }), requestErrorKey: () => "request_failed",
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
  console.log("console load lifecycle: PASS (one boot, no unused reads or polling/focus GETs, explicit readback, selection races, 401/403 and late-response isolation)");
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
}
