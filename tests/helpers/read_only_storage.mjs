// Read-only storage traps for no-write suites (ADR 0002, rule R1).
//
// The adapters stand in for Durable Object `ctx.storage` (SQL, KV, alarms) and
// a Workers KV namespace. Reads are served from fixture data. Every write
// attempt, including SQL DDL/DML and writable PRAGMA, DO/KV put/delete/
// deleteAll, and alarm changes, is recorded and then thrown. The record
// survives code that catches the error (the RuntimeInstances constructor wraps
// some ALTERs in try/catch), so a suite asserts `trap.violations` is empty
// rather than relying on the throw alone. SQL that is not one reviewed read
// statement (several statements, or text that does not tokenize) is a
// violation as well, and is never handed to the fixture.
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

// Read-only PRAGMA forms. A PRAGMA with `=`, or with a call argument that is
// not a single name, is treated as a write.
const READ_PRAGMAS = new Set(["table_info", "table_xinfo", "table_list", "index_list", "index_info", "index_xinfo", "foreign_key_list"]);
const DDL = new Set(["CREATE", "ALTER", "DROP", "REINDEX", "VACUUM", "ANALYZE", "ATTACH", "DETACH"]);
const DML = new Set(["INSERT", "UPDATE", "DELETE", "REPLACE", "UPSERT"]);
const CLOSERS = { "'": "'", '"': '"', "`": "`", "[": "]" };

/**
 * Tokenize SQLite text the way SQLite does: quotes and quoted identifiers
 * first, so comment markers and semicolons inside them are literal text.
 * Returns null on an unterminated string, identifier or block comment; the
 * classifier fails closed on that.
 */
function tokenizeSql(query) {
  const text = String(query);
  const statements = [[]];
  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    if (/\s/.test(ch)) { index += 1; continue; }
    if (ch === "-" && text[index + 1] === "-") {
      const end = text.indexOf("\n", index);
      index = end < 0 ? text.length : end + 1;
      continue;
    }
    if (ch === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      if (end < 0) return null;
      index = end + 2;
      continue;
    }
    if (CLOSERS[ch]) {
      const close = CLOSERS[ch];
      let end = index + 1;
      for (;;) {
        end = text.indexOf(close, end);
        if (end < 0) return null;
        // A doubled quote is an escaped quote; brackets have no escape.
        if (close !== "]" && text[end + 1] === close) { end += 2; continue; }
        break;
      }
      statements.at(-1).push({ type: ch === "'" ? "string" : "name", text: ch === "'" ? "''" : text.slice(index, end + 1) });
      index = end + 1;
      continue;
    }
    if (ch === ";") { statements.push([]); index += 1; continue; }
    const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(text.slice(index))?.[0];
    if (word) {
      statements.at(-1).push({ type: "word", text: word, upper: word.toUpperCase() });
      index += word.length;
      continue;
    }
    const number = /^\d[\w.]*/.exec(text.slice(index))?.[0];
    if (number) {
      statements.at(-1).push({ type: "number", text: number });
      index += number.length;
      continue;
    }
    statements.at(-1).push({ type: "punct", text: ch });
    index += 1;
  }
  return statements.filter(tokens => tokens.length);
}

/** Comment-free, string-redacted text of a query, for violation details. */
export function normalizeSql(query) {
  const statements = tokenizeSql(query);
  if (!statements) return String(query).replace(/\s+/g, " ").trim();
  return statements.map(tokens => tokens.map(token => token.text).join(" ")).join("; ");
}

// `replace(...)` is the string function, not REPLACE INTO.
const writeWord = (tokens, set) => tokens.some((token, index) => token.type === "word" && set.has(token.upper)
  && !(token.upper === "REPLACE" && tokens[index + 1]?.text === "("));

/**
 * Classify one SQL statement. Returns null for an allowed read, otherwise the
 * violation kind. The text is tokenized first, so a comment marker or a
 * semicolon inside a string or quoted identifier cannot hide a later
 * statement. Only a single SELECT, a WITH ... SELECT, or a reviewed
 * introspection PRAGMA is a read; anything else, including more than one
 * statement or text that does not tokenize, is a violation.
 */
export function classifySql(query) {
  const statements = tokenizeSql(query);
  if (!statements) return "sql_unsupported_syntax";
  if (statements.length > 1) return "sql_multiple_statements";
  const tokens = statements[0] || [];
  const head = tokens[0]?.type === "word" ? tokens[0].upper : undefined;
  if (head === "SELECT" || head === "WITH") {
    if (writeWord(tokens, DML)) return "sql_dml";
    if (writeWord(tokens, DDL) || writeWord(tokens, new Set(["PRAGMA"]))) return "sql_ddl";
    return null;
  }
  if (head === "PRAGMA") {
    let rest = tokens.slice(1);
    if (rest[0]?.type !== "word" && rest[0]?.type !== "name") return "sql_pragma_write";
    if (rest[1]?.text === ".") rest = rest.slice(2);
    const name = rest[0]?.type === "word" ? rest[0].upper.toLowerCase() : null;
    const args = rest.slice(1);
    if (!name) return "sql_pragma_write";
    if (!args.length) return READ_PRAGMAS.has(name) ? null : "sql_pragma_unreviewed";
    const singleNameCall = args.length === 3 && args[0].text === "(" && args[2].text === ")" && ["word", "name", "string"].includes(args[1].type);
    return READ_PRAGMAS.has(name) && singleNameCall ? null : "sql_pragma_write";
  }
  if (DDL.has(head)) return "sql_ddl";
  if (DML.has(head)) return "sql_dml";
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
      if (kind) trap(kind, normalizeSql(query).slice(0, 120));
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
