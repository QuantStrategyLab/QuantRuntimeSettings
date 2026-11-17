// Child runner for one case of the bounded executable read contract. The
// parent (`tests/read_contract_boundaries_validation.mjs`) writes the case
// spec and the temporary graph G, then runs this file in a fresh process.
//
// Before any fixture module evaluates, the runner claims the writer-entry
// monitor, installs module hooks that admit only G's files (verified by
// digest, one canonical URL each), the declared builtins and the case's
// pinned synthetic packages, and replaces the asynchronous host facilities:
// zero-delay timers, immediates, microtasks and waitUntil work, including
// the promise a scheduled callback returns, are tracked against the frozen
// task budget, intervals, delayed timers and network access are rejected and
// recorded. Every observation is appended synchronously to the result file;
// the parent judges the case from that file, and a run without its final
// `complete` record is a failure.
import { openSync, readFileSync, realpathSync } from "node:fs";
import { builtinModules, registerHooks } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { claimControl } from "./read_contract_monitor.mjs";
import { classifySql, createReadOnlyKv, normalizeSql, ReadOnlyViolation } from "./read_only_storage.mjs";

const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const control = claimControl(openSync(spec.result, "w"));
const { emit } = control;
const started = Date.now();
let current = { name: "load", mode: "load" };
const setPhase = (name, mode, allow = []) => { current = { name, mode }; control.setPhase(name, mode, allow); };
setPhase("load", "load");

// --- G: module admission -------------------------------------------------
const files = new Map(Object.entries(spec.graph.files));
const trusted = new Set(spec.graph.trusted);
const pins = spec.graph.pins;
const builtins = new Set(spec.graph.builtins);
const loaded = new Set();
const graphError = (kind, detail) => { emit({ t: "graph", kind, detail }); return new Error(`read_contract_graph:${kind}`); };
const where = context => (context.parentURL?.startsWith("file:") ? fileURLToPath(context.parentURL).slice(spec.graph.root.length + 1) : context.parentURL || "entry");
registerHooks({
  resolve(specifier, context, next) {
    const builtin = specifier.startsWith("node:") ? specifier : builtinModules.includes(specifier) ? `node:${specifier}` : null;
    if (builtin) {
      if (!builtins.has(builtin)) throw graphError("builtin_rejected", `${builtin} from ${where(context)}`);
      return { url: builtin, shortCircuit: true };
    }
    if (!/^(?:\.{1,2}\/|\/|file:)/.test(specifier)) {
      if (!Object.hasOwn(pins, specifier)) throw graphError("unpinned_package", `${specifier} from ${where(context)}`);
      return { url: pathToFileURL(pins[specifier]).href, format: "module", shortCircuit: true };
    }
    let resolved;
    try { resolved = next(specifier, context); } catch { throw graphError("unresolved", `${specifier} from ${where(context)}`); }
    const url = new URL(resolved.url);
    if (url.protocol !== "file:" || url.search || url.hash) throw graphError("noncanonical_url", `${resolved.url} from ${where(context)}`);
    const path = fileURLToPath(url);
    let real;
    try { real = realpathSync(path); } catch { throw graphError("unresolved", `${specifier} from ${where(context)}`); }
    if (real !== path) throw graphError("noncanonical_path", `${specifier} from ${where(context)}`);
    if (!files.has(path) && !trusted.has(path)) throw graphError("outside_graph", `${path} from ${where(context)}`);
    return { url: url.href, format: trusted.has(path) ? resolved.format : "module", shortCircuit: true };
  },
  load(url, context, next) {
    if (url.startsWith("node:")) { emit({ t: "load", builtin: url }); return next(url, context); }
    if (!url.startsWith("file:")) throw graphError("outside_graph", url);
    const path = fileURLToPath(url);
    if (trusted.has(path)) return next(url, context);
    if (!files.has(path)) throw graphError("outside_graph", path);
    if (loaded.has(path)) throw graphError("duplicate_instance", path);
    const source = readFileSync(path, "utf8");
    if (createHash("sha256").update(source).digest("hex") !== files.get(path)) throw graphError("digest_mismatch", path);
    loaded.add(path);
    emit({ t: "load", file: path.slice(spec.graph.root.length + 1) });
    return { format: "module", source, shortCircuit: true };
  },
});

// --- B: asynchronous facilities -------------------------------------------
const real = { setTimeout, clearTimeout, setImmediate, clearImmediate, queueMicrotask };
const { bounds } = spec;
const pending = new Map();
const tracked = [];
let scheduled = 0;
const residual = [];
const unsupported = facility => { emit({ t: "unsupported", facility, phase: current.name }); throw new Error(`read_contract_unsupported:${facility}`); };
const callbackErrors = [];
/** Track a returned thenable until it settles: an unsettled one is residual work at the drain bound. */
const settle = value => { if (value && typeof value.then === "function") tracked.push(Promise.resolve(value).catch(error => { emit({ t: "async_error", name: error?.name, phase: current.name }); })); };
// A scheduled callback leaves `pending` only as its returned value enters
// `tracked`, in the same synchronous turn, so drain never sees it finished.
const runTracked = (token, fn, args) => {
  pending.delete(token);
  try { settle(fn(...args)); } catch (error) { callbackErrors.push(error?.name || "Error"); emit({ t: "callback_error", name: error?.name, phase: current.name }); }
};
const schedule = (kind, starter, fn, args) => {
  if (typeof fn !== "function") unsupported(`${kind}:non-function`);
  scheduled += 1;
  if (scheduled > bounds.max_scheduled_tasks) { emit({ t: "budget", kind: "tasks", scheduled }); throw new Error("read_contract_task_budget"); }
  const token = Symbol(kind);
  pending.set(token, starter(() => runTracked(token, fn, args)));
  return token;
};
globalThis.setTimeout = (fn, delay = 0, ...args) => {
  if (Number(delay) > bounds.max_timer_delay_ms) unsupported(`setTimeout:${delay}`);
  return schedule("setTimeout", run => real.setTimeout(run, 0), fn, args);
};
globalThis.setImmediate = (fn, ...args) => schedule("setImmediate", run => real.setImmediate(run), fn, args);
globalThis.queueMicrotask = fn => { schedule("queueMicrotask", run => real.queueMicrotask(run), fn, []); };
globalThis.clearTimeout = token => { if (pending.has(token)) { real.clearTimeout(pending.get(token)); pending.delete(token); } };
globalThis.clearImmediate = token => { if (pending.has(token)) { real.clearImmediate(pending.get(token)); pending.delete(token); } };
globalThis.setInterval = () => unsupported("setInterval");
globalThis.fetch = async () => unsupported("fetch");
for (const name of ["WebSocket", "EventSource", "MessageChannel", "BroadcastChannel", "Worker"]) {
  if (name in globalThis) globalThis[name] = function () { unsupported(name); };
}
const unhandled = [];
process.on("unhandledRejection", reason => { unhandled.push(reason?.name || "Error"); emit({ t: "unhandled", name: reason?.name, phase: current.name }); });
process.on("uncaughtException", error => { emit({ t: "uncaught", name: error?.name, message: String(error?.message).slice(0, 200) }); process.exit(3); });

const turn = () => new Promise(resolve => real.setImmediate(resolve));
const sleep = ms => new Promise(resolve => real.setTimeout(resolve, ms));

/** Wait for the response's tracked work: promises, waitUntil, timers. Two quiet turns end the phase. */
async function drain(phase) {
  let quiet = 0;
  for (let turns = 1; ; turns += 1) {
    const batch = tracked.splice(0);
    if (batch.length) {
      const remaining = bounds.case_ms - (Date.now() - started) - 500;
      const settled = await Promise.race([Promise.allSettled(batch).then(() => true), sleep(Math.max(remaining, 0)).then(() => false)]);
      if (!settled) { residual.push(`${phase}: tracked promise did not settle`); emit({ t: "residual", phase, kind: "tracked_promise" }); return false; }
    }
    // A pending zero-delay timer fires in the next timers phase; wait for
    // one so each counted turn can advance it.
    await (pending.size ? sleep(1) : turn());
    quiet = !batch.length && !pending.size && !tracked.length ? quiet + 1 : 0;
    if (quiet >= 2) { emit({ t: "drained", phase, turns }); return true; }
    if (turns >= bounds.max_drain_turns) {
      residual.push(`${phase}: ${pending.size} timers, ${tracked.length} promises after ${turns} turns`);
      emit({ t: "residual", phase, kind: "turn_budget", timers: pending.size, promises: tracked.length });
      return false;
    }
  }
}

// --- Synthetic storage ------------------------------------------------------
const writes = [];
function write(kind, detail) {
  const record = { phase: current.name, kind, detail };
  writes.push(record);
  emit({ t: "storage", ...record });
  if (current.mode !== "debt") throw new ReadOnlyViolation(kind, detail);
}
const cursor = rows => ({ toArray: () => rows.map(row => ({ ...row })), one: () => ({ ...rows[0] }), [Symbol.iterator]: () => rows[Symbol.iterator](), rowsRead: rows.length, rowsWritten: 0 });
const initial = spec.initial_state || {};
const sql = {
  exec(query, ...args) {
    const kind = classifySql(query);
    if (kind) { write(kind, normalizeSql(query).split(" ").slice(0, 4).join(" ")); return cursor([]); }
    return cursor(initial.sql?.find(rule => String(query).includes(rule.match))?.rows || []);
  },
};
const doKv = new Map(Object.entries(initial.do_kv || {}));
const txn = {
  get: async key => doKv.get(key),
  put: async () => write("do_kv_put", ""),
  delete: async () => write("do_kv_delete", ""),
  list: async () => new Map(doKv),
  getAlarm: async () => null,
  setAlarm: async () => write("alarm_set", ""),
  deleteAlarm: async () => write("alarm_delete", ""),
};
const storage = { sql, ...txn, deleteAll: async () => write("do_kv_delete_all", ""), transactionSync: fn => fn(), transaction: async fn => fn(txn) };
const kv = createReadOnlyKv(initial.kv || {});
const env = { STRATEGY_SWITCH_CONFIG: kv.namespace };
const waitUntil = promise => { tracked.push(Promise.resolve(promise)); };

// --- Drivers ---------------------------------------------------------------
const consoleModule = rel => import(pathToFileURL(join(spec.graph.root, spec.graph.console, rel)).href);
const DO = "application/runtime_instances/durable_object.js";
const LEGACY = { state: "valid", bindings: [] };

async function summarize(response) {
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* text body */ }
  return body && typeof body === "object" && !Array.isArray(body)
    ? { status: response.status, ok: body.ok, error: body.error }
    : { status: response.status, text: text.slice(0, 80) };
}

/** A value that records every operation on it: the body of a latched entry never touches one. */
function sentinel(label, touched) {
  return new Proxy(function sentinelTarget() {}, Object.fromEntries(["get", "set", "has", "apply", "construct", "ownKeys", "getOwnPropertyDescriptor", "defineProperty", "deleteProperty", "getPrototypeOf"].map(trap => [trap, (...args) => {
    touched.push(`${label}.${trap}${trap === "get" ? `:${String(args[1])}` : ""}`);
    return trap === "getPrototypeOf" ? Object.prototype : trap === "has" || trap === "set" || trap === "defineProperty" || trap === "deleteProperty" ? true : trap === "ownKeys" ? [] : undefined;
  }])));
}

const outcome = fn => {
  try { const value = fn(); settle(value); return { outcome: "returned" }; } catch (error) { return { outcome: "threw", error: error?.name }; }
};

let instance = null;
// A ready instance: no constructor, storage already initialized (as after the
// first ordinary request), so its requests start at dispatch. Cold
// construction and its first initialization are explicit `construct` steps
// and requests in their own phases.
const readyInstance = async () => {
  const { RuntimeInstances } = await consoleModule(DO);
  return Object.assign(Object.create(RuntimeInstances.prototype), { sql, storage, reviewEnv: env, storageInitialized: true });
};
const instanceFor = async () => (instance ||= await readyInstance());
const writerArgs = [env, { synthetic: true }, 1];
const runtimeSupport = () => consoleModule("application/worker/runtime_support.js");

const SCRIPTS = {
  "pristine-read": async () => { const self = await instanceFor(); return outcome(() => self.read()); },
  "b1-alias": async () => {
    const { RuntimeInstances } = await consoleModule(DO);
    const writer = RuntimeInstances.prototype.ensureRiskProfileAuthority;
    const alias = writer;
    return outcome(() => alias.call({ sql }, LEGACY));
  },
  "b1-recovered-receiver": async () => { const self = await instanceFor(); return outcome(() => ({}).valueOf.call(self)[["ensureRisk", "ProfileAuthority"].join("")](LEGACY)); },
  "b1-caught-sentinel": async () => {
    const self = await instanceFor();
    let swallowed = null;
    try { self.ensureRiskProfileAuthority(LEGACY); } catch (error) { swallowed = error?.name; }
    return { outcome: "returned", swallowed };
  },
  "b1-noop-input": async () => { const self = await instanceFor(); return outcome(() => self.ensureRiskProfileAuthority(LEGACY)); },
  "b1-deferred-callback": async () => { const self = await instanceFor(); setTimeout(() => self.ensureRiskProfileAuthority(LEGACY), 0); return { outcome: "scheduled" }; },
  "b7-alias": async () => { const module = await runtimeSupport(); const alias = module.writeCurrentStrategiesCache; return outcome(() => alias(...writerArgs)); },
  "b7-recovered-receiver": async () => {
    const { __test } = await consoleModule("worker.js");
    return outcome(() => __test.valueOf()[["writeCurrent", "StrategiesCache"].join("")](...writerArgs));
  },
  "b7-caught-sentinel": async () => {
    const module = await runtimeSupport();
    let swallowed = null;
    try { await module.writeCurrentStrategiesCache(...writerArgs); } catch (error) { swallowed = error?.name; }
    return { outcome: "returned", swallowed };
  },
  "b7-noop-input": async () => { const module = await runtimeSupport(); return outcome(() => module.writeCurrentStrategiesCache(env, initial.b7_payload, initial.b7_ts)); },
  // Every inventory section in order on the current instance, each sealed by
  // the schema page's scan, then an unknown section; then whether storage
  // was initialized.
  "inventory-sections": async () => {
    const self = await instanceFor();
    const { INVENTORY_DO_PATH, INVENTORY_TABLES } = await consoleModule("application/account_identity_inventory/constants.js");
    const call = async body => {
      const response = await self.fetch(new Request(`https://runtime-instances.invalid${INVENTORY_DO_PATH}`, { method: "POST", body: JSON.stringify({ object: "runtime", ...body }) }));
      return { section: body.section, ...await summarize(response.clone()), scan: (await response.json()).scan };
    };
    const schema = await call({ section: "schema" });
    const { scan } = schema;
    const results = [schema];
    for (const body of [{ section: "sql", table: Object.keys(INVENTORY_TABLES)[0], page_size: 10, scan }, { section: "do_kv", page_size: 10, scan }, { section: "finalize", scan }, { section: "probe_section" }]) {
      results.push(await call(body));
    }
    return { outcome: "returned", sections: results.map(({ scan: _scan, ...rest }) => rest), initialized: self.storageInitialized };
  },
  "b7-deferred-callback": async () => {
    const module = await runtimeSupport();
    waitUntil(Promise.resolve().then(() => module.writeCurrentStrategiesCache(...writerArgs)).catch(error => { emit({ t: "async_error", name: error?.name, phase: current.name }); }));
    return { outcome: "scheduled" };
  },
};

/** Isolated invocation of one W entry with sentinel arguments and receiver. */
async function invokeEntry(id) {
  const entry = spec.entries.find(item => item.id === id);
  const module = await consoleModule(entry.file.slice(spec.graph.console.length + 1));
  const touched = [];
  const args = [0, 1, 2].map(index => sentinel(`arg${index}`, touched));
  const call = entry.kind === "function" ? () => module[entry.symbol](...args)
    : entry.kind === "method" ? () => module[entry.class].prototype[entry.name].call(sentinel("this", touched), ...args)
      : () => new module[entry.class](...args);
  const before = control.entries().length;
  const result = outcome(call);
  const latched = control.entries().slice(before).map(record => record.id);
  return { ...result, latched_before_return: latched, touched };
}

async function step(item) {
  if (item.construct) {
    const { RuntimeInstances } = await consoleModule(DO);
    return outcome(() => { instance = new RuntimeInstances({ storage, waitUntil, blockConcurrencyWhile: async fn => fn() }, env); });
  }
  if (item.request) {
    const self = await instanceFor();
    const { method = "GET", url = "https://runtime-instances.invalid/", body } = item.request;
    let response;
    try {
      response = await self.fetch(new Request(url, body === undefined ? { method } : { method, body: JSON.stringify(body) }));
    } catch (error) { return { outcome: "threw", error: error?.name }; }
    if (self.pending) { tracked.push(Promise.resolve(self.pending).catch(error => { emit({ t: "async_error", name: error?.name, phase: current.name }); })); self.pending = undefined; }
    return summarize(response);
  }
  if (item.invoke) return invokeEntry(item.invoke);
  if (item.script) return SCRIPTS[item.script]();
  throw new Error(`unknown step ${JSON.stringify(item)}`);
}

const steps = [];
const phases = [];
try {
  for (const phase of spec.phases) {
    setPhase(phase.name, phase.mode, phase.allow || []);
    for (const item of phase.steps) {
      const result = await step(item);
      steps.push({ phase: phase.name, ...result });
      emit({ t: "step", phase: phase.name, result });
    }
    const drained = await drain(phase.name);
    phases.push({ name: phase.name, drained, debt_not_entered: control.remaining() });
  }
} catch (error) {
  emit({ t: "driver_error", name: error?.name, message: String(error?.message).slice(0, 200) });
}
setPhase("closed", "closed");
emit({
  t: "result", steps, phases, storage: writes, kv: kv.violations.map(item => item.kind), unhandled, callback_errors: callbackErrors,
  residual, scheduled, elapsed_ms: Date.now() - started,
});
emit({ t: "complete" });
// Leftover host timers (the drain deadline) must not hold the process.
process.exit(0);
