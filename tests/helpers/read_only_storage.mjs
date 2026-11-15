// Read-only storage traps for no-write suites (ADR 0002, rule R1).
//
// The adapters stand in for Durable Object `ctx.storage` (SQL, KV, alarms) and
// a Workers KV namespace. Reads are served from fixture data. Every write
// attempt, including SQL DDL/DML and writable PRAGMA, DO/KV put/delete/
// deleteAll, and alarm changes, is recorded and then thrown. The record
// survives code that catches the error (the RuntimeInstances constructor wraps
// some ALTERs in try/catch), so a suite asserts `trap.violations` is empty
// rather than relying on the throw alone.
//
// Install the trap before constructing the object under test: construction is
// part of the request lifecycle.

export class ReadOnlyViolation extends Error {
  constructor(kind, detail) {
    super(`read_only_violation:${kind}`);
    this.name = "ReadOnlyViolation";
    this.kind = kind;
    this.detail = detail;
  }
}

// Read-only PRAGMA forms. A PRAGMA with `=` or a call argument other than a
// table name for these introspection functions is treated as a write.
const READ_PRAGMAS = new Set(["table_info", "table_xinfo", "table_list", "index_list", "index_info", "index_xinfo", "foreign_key_list"]);

function stripSql(query) {
  return String(query)
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .trim();
}

/**
 * Classify one SQL statement. Returns null for an allowed read, otherwise the
 * violation kind. A leading SELECT is not enough on its own: multiple
 * statements and write keywords after a CTE are rejected too.
 */
export function classifySql(query) {
  const sql = stripSql(query);
  const body = sql.replace(/;\s*$/, "");
  if (body.includes(";")) return "sql_multiple_statements";
  const head = body.match(/^\s*([A-Za-z]+)/)?.[1]?.toUpperCase();
  if (head === "SELECT") return null;
  if (head === "WITH") {
    return /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(body) ? "sql_dml" : null;
  }
  if (head === "PRAGMA") {
    const pragma = body.match(/^\s*PRAGMA\s+(?:[A-Za-z_]+\.)?([A-Za-z_]+)\s*(=|\()?/i);
    if (pragma && READ_PRAGMAS.has(pragma[1].toLowerCase()) && pragma[2] !== "=") return null;
    if (pragma && !pragma[2]) return "sql_pragma_unreviewed";
    return "sql_pragma_write";
  }
  if (["CREATE", "ALTER", "DROP", "REINDEX", "VACUUM", "ANALYZE", "ATTACH", "DETACH"].includes(head)) return "sql_ddl";
  if (["INSERT", "UPDATE", "DELETE", "REPLACE", "UPSERT"].includes(head)) return "sql_dml";
  return "sql_unclassified";
}

function cursor(rows) {
  const list = rows.map(row => ({ ...row }));
  return {
    toArray: () => list.map(row => ({ ...row })),
    one: () => {
      if (list.length !== 1) throw new Error("read_only_storage_one_expected");
      return { ...list[0] };
    },
    raw: () => list.map(row => Object.values(row))[Symbol.iterator](),
    columnNames: list.length ? Object.keys(list[0]) : [],
    rowsRead: list.length,
    rowsWritten: 0,
    [Symbol.iterator]: () => list.map(row => ({ ...row }))[Symbol.iterator](),
  };
}

/**
 * A trapped Durable Object `ctx.storage`.
 *
 * @param {{
 *   sqlRows?: (query: string, bindings: unknown[]) => object[],
 *   kv?: Record<string, unknown>,
 *   alarm?: number | null,
 * }} [fixtures]
 */
export function createReadOnlyStorage({ sqlRows = () => [], kv = {}, alarm = null } = {}) {
  const violations = [];
  const values = new Map(Object.entries(kv).map(([key, value]) => [key, structuredClone(value)]));
  const statements = [];
  const trap = (kind, detail) => {
    violations.push({ kind, detail });
    throw new ReadOnlyViolation(kind, detail);
  };
  const sql = {
    exec(query, ...bindings) {
      statements.push(String(query));
      const kind = classifySql(query);
      if (kind) trap(kind, stripSql(query).slice(0, 120));
      return cursor(sqlRows(String(query), bindings));
    },
    get databaseSize() { return 0; },
  };
  const get = async keys => {
    if (Array.isArray(keys)) return new Map(keys.filter(key => values.has(key)).map(key => [key, structuredClone(values.get(key))]));
    return values.has(keys) ? structuredClone(values.get(keys)) : undefined;
  };
  const list = async ({ prefix = "", limit = Infinity } = {}) => new Map([...values.entries()]
    .filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)
    .map(([key, value]) => [key, structuredClone(value)]));
  const writers = {
    put: async key => trap("do_kv_put", String(typeof key === "object" ? Object.keys(key).join(",") : key)),
    delete: async key => trap("do_kv_delete", String(key)),
    deleteAll: async () => trap("do_kv_delete_all", "*"),
    setAlarm: async when => trap("alarm_set", String(when)),
    deleteAlarm: async () => trap("alarm_delete", "*"),
  };
  const txn = { get, list, getAlarm: async () => alarm, ...writers, rollback() {} };
  const storage = {
    sql,
    ...txn,
    transactionSync: fn => fn(),
    transaction: async fn => fn(txn),
    sync: async () => {},
  };
  return {
    storage,
    violations,
    statements,
    snapshot: () => ({ kv: structuredClone(Object.fromEntries(values)), alarm }),
  };
}

/** A trapped Workers KV namespace with fixture entries. */
export function createReadOnlyKv(entries = {}) {
  const violations = [];
  const values = new Map(Object.entries(entries));
  const trap = (kind, detail) => {
    violations.push({ kind, detail });
    throw new ReadOnlyViolation(kind, detail);
  };
  const decode = (value, type) => {
    if (value === undefined || value === null) return null;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return type === "json" ? JSON.parse(text) : text;
  };
  return {
    violations,
    namespace: {
      async get(key, options) { return decode(values.get(key), typeof options === "string" ? options : options?.type); },
      async getWithMetadata(key, options) { return { value: await this.get(key, options), metadata: null }; },
      async list({ prefix = "", limit = 1000 } = {}) {
        const keys = [...values.keys()].filter(key => key.startsWith(prefix)).sort().slice(0, limit).map(name => ({ name }));
        return { keys, list_complete: true, cursor: "" };
      },
      put: async key => trap("kv_put", String(key)),
      delete: async key => trap("kv_delete", String(key)),
    },
  };
}
