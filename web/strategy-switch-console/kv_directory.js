// One existing Durable Object owns the discovery manifest. KV remains the
// record store; the manifest contains names only and grants no authority.
export const DIRECTORY_PATH = "/kv-directory";
const STATE_KEY = "console-kv-directory-v1";
export const MANIFEST_KEY = "console_kv_directory:v1";
const SCHEMA = "qsl_console_kv_directory.v1";
const PREFIXES = ["control_plane_source:", "adaptive_selection_source:",
  "reconciliation_recovery_source:", "execution_evidence_source:",
  "runtime_target_lifecycle_source:", "research_task_source:",
  "research_promotion_ticket:", "runtime_daily:"];

export function indexedKey(key) {
  return typeof key === "string" && PREFIXES.some(prefix => key.startsWith(prefix));
}

function bounded(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

async function sharedManifest(store) {
  const text = await store.get(MANIFEST_KEY);
  if (!text) return null;
  let state;
  try { state = JSON.parse(text); } catch { throw Error("kv_directory_unavailable"); }
  if (state.schema !== SCHEMA || !Array.isArray(state.keys) || !state.keys.every(indexedKey)
    || typeof state.complete !== "boolean" || !Number.isFinite(state.retry_at)
    || (state.complete && !Number.isFinite(state.scanned_at))) throw Error("kv_directory_unavailable");
  return state;
}

async function mirrorManifest(store, state) {
  await store.put(MANIFEST_KEY, JSON.stringify({ ...state, mirror_dirty: false, schema: SCHEMA }));
}

function manifestRead(state, prefix, limit) {
  if (!state?.complete) {
    const error = new Error(state?.error || "kv_directory_uninitialized");
    error.retry_after = Math.max(60, Math.ceil(((state?.retry_at || 0) - Date.now()) / 1000));
    throw error;
  }
  const keys = state.keys.filter(key => key.startsWith(prefix)).sort();
  if (keys.length > limit) throw Error("kv_directory_truncated");
  return { ok: true, keys: keys.map(name => ({ name })), list_complete: true };
}

export class KvDirectory {
  constructor(storage, store, env = {}, now = Date.now) {
    this.storage = storage;
    this.store = store;
    this.env = env;
    this.now = now;
    this.queue = Promise.resolve();
  }

  command(command) {
    // Serialize across awaited KV I/O as well as storage writes. A concurrent
    // publisher must never lose another publisher's manifest entry.
    const work = this.queue.then(() => this.run(command));
    this.queue = work.catch(() => {});
    return work;
  }

  async run(command) {
    const state = await this.storage.get(STATE_KEY) || await sharedManifest(this.store) || {
      keys: [], complete: false, cursor: null, retry_at: 0, failures: 0,
    };
    if (command.action === "put") {
      if (!indexedKey(command.key) || typeof command.value !== "string") throw Error("kv_directory_invalid_write");
      // Register before writing the record. A failed response can be retried
      // without leaving a successfully written record undiscoverable.
      if (!state.keys.includes(command.key)) {
        const maximum = bounded(this.env.KV_DIRECTORY_MAX_KEYS, 10000, 100, 100000);
        if (state.keys.length >= maximum || new TextEncoder().encode(JSON.stringify(state) + command.key).byteLength + 1024 > 120000)
          throw Error("kv_directory_capacity_exceeded");
        state.keys.push(command.key);
        state.mirror_dirty = true;
        await this.storage.put(STATE_KEY, state);
      }
      await this.store.put(command.key, command.value);
      if (state.mirror_dirty) {
        await mirrorManifest(this.store, state);
        state.mirror_dirty = false;
        await this.storage.put(STATE_KEY, state);
      }
      return { ok: true };
    }
    if (command.action === "maintain") {
      const interval = bounded(this.env.KV_DIRECTORY_RECONCILE_SECONDS, 21600, 3600, 86400) * 1000;
      if (state.complete && ((!command.refresh && this.now() < state.scanned_at + interval)
        || this.now() < state.scanned_at + 60000))
        return { ok: true, complete: true, count: state.keys.length, scanned_at: state.scanned_at, cached: true };
      if (state.retry_at > this.now()) return this.unavailable(state);
      state.complete = false;
      try {
        // Migration only: at most one page per maintenance invocation, shared
        // across every prefix and every Worker isolate. Reads never call list.
        const listing = await this.store.list({ limit: 1000, ...(state.cursor ? { cursor: state.cursor } : {}) });
        if (!Array.isArray(listing?.keys) || typeof listing.list_complete !== "boolean"
          || (!listing.list_complete && !listing.cursor)) throw Error("invalid_listing");
        const keys = new Set(state.keys);
        for (const entry of listing.keys) if (indexedKey(entry.name)) keys.add(entry.name);
        const maximum = bounded(this.env.KV_DIRECTORY_MAX_KEYS, 10000, 100, 100000);
        if (keys.size > maximum || new TextEncoder().encode(JSON.stringify([...keys])).byteLength + 1024 > 120000) throw Error("directory_too_large");
        state.keys = [...keys].sort();
        state.complete = listing.list_complete;
        if (state.complete) state.scanned_at = this.now();
        state.cursor = listing.list_complete ? null : listing.cursor;
        state.failures = 0;
        state.error = state.complete ? null : "kv_directory_migration_pending";
        state.retry_at = state.complete ? 0 : this.now() + bounded(this.env.KV_DIRECTORY_PAGE_DELAY_SECONDS, 60, 30, 3600) * 1000;
      } catch (error) {
        state.failures += 1;
        const quota = error.message === "KV list() limit exceeded for the day.";
        state.error = quota ? "kv_list_daily_limit_exceeded" : "kv_directory_migration_failed";
        const delay = bounded(this.env.KV_DIRECTORY_RETRY_SECONDS, 300, 60, 3600);
        state.retry_at = quota ? (Math.floor(this.now() / 86400000) + 1) * 86400000 + 60000
          : this.now() + Math.min(3600000, delay * 1000 * 2 ** Math.min(state.failures - 1, 4));
      }
      await this.storage.put(STATE_KEY, state);
      await mirrorManifest(this.store, state);
      return state.complete ? { ok: true, complete: true, count: state.keys.length, scanned_at: state.scanned_at } : this.unavailable(state);
    }
    if (command.action !== "read" || !indexedKey(command.prefix)) throw Error("kv_directory_invalid_request");
    if (!state.complete) return this.unavailable(state);
    const keys = state.keys.filter(key => key.startsWith(command.prefix)).sort();
    const limit = bounded(command.limit, 100, 1, 100000);
    if (keys.length > limit) return { ok: false, error: "kv_directory_truncated", retry_after: 300 };
    return { ok: true, keys: keys.map(name => ({ name })), list_complete: true };
  }

  unavailable(state) {
    return { ok: false, complete: false, error: state.error || "kv_directory_uninitialized",
      retry_after: Math.max(60, Math.ceil((state.retry_at - this.now()) / 1000)) };
  }
}

export async function directoryCommand(env, command) {
  if (testAdapters.has(env)) return testAdapters.get(env)(command);
  const namespace = env.STRATEGY_SWITCH_RUNTIME_INSTANCES;
  if (!namespace?.idFromName || !namespace?.get) throw Error("kv_directory_unavailable");
  const stub = namespace.get(namespace.idFromName("console-kv-directory-v1"));
  const response = await stub.fetch(`https://runtime-instances${DIRECTORY_PATH}`, {
    method: "POST", body: JSON.stringify(command),
  });
  const result = await response.json();
  if (response.status === 400 && result.error === "runtime_instance_actor_required") throw Error("kv_directory_legacy_receiver");
  if (!response.ok || !result.ok) {
    const error = new Error(/^(kv_directory_|kv_list_daily_limit_exceeded)/.test(result.error || "") ? result.error : "kv_directory_unavailable");
    error.retry_after = result.retry_after || 300;
    throw error;
  }
  if ((command.action === "read" && (!Array.isArray(result.keys) || result.list_complete !== true))
    || (command.action === "maintain" && result.complete !== true)) throw Error("kv_directory_unavailable");
  return result;
}

export async function directoryList(env, prefix, limit) {
  if (!env.STRATEGY_SWITCH_RUNTIME_INSTANCES)
    return manifestRead(await sharedManifest(env.STRATEGY_SWITCH_CONFIG), prefix, limit);
  try { return await directoryCommand(env, { action: "read", prefix, limit }); }
  catch (error) {
    if (error.message !== "kv_directory_legacy_receiver") throw error;
    // A 0% Worker override does not override the Durable Object's version.
    // A complete maintained KV mirror allows receiver-first compatibility.
    return manifestRead(await sharedManifest(env.STRATEGY_SWITCH_CONFIG), prefix, limit);
  }
}

export async function maintainDirectory(env) {
  try { return await directoryCommand(env, { action: "maintain", refresh: true }); }
  catch (error) {
    if (error.message !== "kv_directory_legacy_receiver") throw error;
    // Only the authenticated explicit admin operation reaches this fallback.
    // No public read or background loop may bootstrap through the old object.
    const migration = new KvDirectory({ async get() { return null; }, async put() {} }, env.STRATEGY_SWITCH_CONFIG, env);
    const result = await migration.command({ action: "maintain", refresh: true });
    if (!result.ok) {
      const failure = new Error(result.error); failure.retry_after = result.retry_after; throw failure;
    }
    return result;
  }
}

// Unit fixtures can substitute the private service without changing whether
// runtime-instance authority is bound. No HTTP input can install an adapter.
const testAdapters = new WeakMap();
export function installDirectoryTestAdapter(env, adapter) { testAdapters.set(env, adapter); }
