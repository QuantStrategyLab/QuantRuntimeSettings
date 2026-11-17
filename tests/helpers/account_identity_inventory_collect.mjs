// Collect a synthetic account-identity inventory export through the real
// Worker route and RuntimeInstances class, then assemble it with the real
// #1173 assembler. Each object is a fresh SQLite file seeded through the
// unmodified initializeStorage(); the inventory reads it read-only. KV and
// environment sections are optional so partial collections can be replayed.
// Synthetic identities only; no network.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const CONSOLE = new URL("../../web/strategy-switch-console/", import.meta.url);
const { default: worker, RuntimeInstances } = await import(new URL("worker.js", CONSOLE));
const { assemble, EXPORT_FORMAT } = await import(new URL("inspect_account_identity_inventory.mjs", CONSOLE));
const { makeSession } = await import(new URL("application/auth/session.js", CONSOLE));

const ROUTE = "/api/admin/account-identity-inventory";
const ORIGIN = "https://console.example";
const ENV = { SESSION_SECRET: "synthetic-only-session-key", STRATEGY_SWITCH_ADMIN_LOGINS: "fixture-admin" };
const cookie = `qsl_switch_session=${await makeSession("fixture-admin", [], ENV)}`;
const utf8Compare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
const cursorOf = items => Object.assign(items.values(), { toArray: () => items, one: () => items[0] });

async function seed(path, statements) {
  const db = new DatabaseSync(path);
  const instance = Object.create(RuntimeInstances.prototype);
  instance.sqlStorage = { exec: (statement, ...bindings) => cursorOf(db.prepare(statement).all(...bindings)) };
  instance.storageInitialized = false;
  instance.initializeStorage();
  for (const [statement, ...bindings] of statements) db.prepare(statement).run(...bindings);
  db.close();
}

function objectOver(path, kv) {
  const db = new DatabaseSync(path, { readOnly: true });
  const sql = { exec: (statement, ...bindings) => cursorOf(db.prepare(statement).all(...bindings)) };
  const storage = {
    sql,
    list: async ({ limit = Infinity, startAfter } = {}) => new Map(Object.entries(kv).sort(([a], [b]) => utf8Compare(a, b))
      .filter(([key]) => startAfter === undefined || utf8Compare(key, startAfter) > 0).slice(0, limit).map(([key, value]) => [key, structuredClone(value)])),
    getAlarm: async () => null,
  };
  return { db, ctx: { storage, id: { toString: () => "synthetic" } } };
}

function memoryKv(values) {
  const names = Object.keys(values).sort(utf8Compare);
  return {
    async get(name) { return values[name] ?? null; },
    async list({ limit = 1000, cursor } = {}) {
      const start = cursor ? Number(cursor) : 0, page = names.slice(start, start + limit), end = start + page.length;
      return { keys: page.map(name => ({ name })), list_complete: end >= names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
    },
  };
}

// `statements` seed the runtime object; `kvPasses` is how many KV passes to
// collect (0 leaves groups 16-22 to the provider export); `collectEnv`
// controls the environment section.
export async function collectInventory({ statements = [], kv = {}, envBindings = {}, kvPasses = 2, collectEnv = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "qrt-mapping-inventory-"));
  const opened = [];
  try {
    const objects = {};
    for (const [name, rows] of [["runtime-instances", statements], ["console-kv-directory-v1", []]]) {
      const path = join(dir, `${name}.sqlite`);
      await seed(path, rows);
      const object = objectOver(path, {});
      opened.push(object.db);
      objects[name] = new RuntimeInstances(object.ctx, { STRATEGY_SWITCH_CONFIG: memoryKv(kv), ...ENV });
    }
    const env = { ...ENV, ...envBindings, STRATEGY_SWITCH_CONFIG: memoryKv(kv), ACCOUNT_IDENTITY_INVENTORY_KV_ENABLED: "true", ACCOUNT_IDENTITY_INVENTORY_ENV_ENABLED: "true",
      STRATEGY_SWITCH_RUNTIME_INSTANCES: { idFromName: name => ({ name }), get: id => ({ fetch: (url, init) => objects[id.name].fetch(new Request(url, init)) }) } };
    const responses = [];
    const call = async params => {
      const response = await worker.fetch(new Request(`${ORIGIN}${ROUTE}?${new URLSearchParams(params)}`, { headers: { Cookie: cookie } }), env, {});
      const body = JSON.parse(await response.text());
      const { cursor: _cursor, ...request } = params;
      responses.push({ request: { ...request }, status: response.status, body });
      if (response.status !== 200) throw new Error(`inventory collection failed: ${JSON.stringify(request)} ${response.status} ${body.error}`);
      return body;
    };
    for (const object of ["runtime", "directory"]) {
      const schema = await call({ section: "schema", object });
      for (const [table, info] of Object.entries(schema.tables)) {
        if (!info.present || info.count_only) continue;
        let page = await call({ section: "sql", object, table, page_size: "100", scan: schema.scan });
        while (page.cursor) page = await call({ section: "sql", object, table, page_size: "100", cursor: page.cursor });
      }
      let page = await call({ section: "do_kv", object, page_size: "100", scan: schema.scan });
      while (page.cursor) page = await call({ section: "do_kv", object, page_size: "100", cursor: page.cursor });
      await call({ section: "finalize", object, scan: schema.scan });
    }
    for (let pass = 0; pass < kvPasses; pass++) {
      let page = await call({ section: "kv", page_size: "100" });
      while (page.cursor) page = await call({ section: "kv", page_size: "100", cursor: page.cursor });
    }
    if (collectEnv) await call({ section: "env" });
    return assemble({ format: EXPORT_FORMAT, responses });
  } finally {
    for (const db of opened) db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

// Seed statements for the runtime object's instance state and history.
export const instanceStateRow = (revision, instances) => ["INSERT INTO instance_state (id, revision, payload) VALUES (1, ?, ?)", revision, JSON.stringify(instances)];
export const historyRow = (revision, entry) => ["INSERT INTO instance_history (revision, entry) VALUES (?, ?)", revision, JSON.stringify({ revision, ts: "2026-01-01T00:00:00.000Z", login: "fixture-admin", ...entry })];
