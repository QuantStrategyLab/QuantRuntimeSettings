// Read-contract boundary validation (ADR 0002; `.github/engineering.md`,
// "Observation and identity boundaries").
//
// 1. Every public route branch in `worker.js` `fetch` and every internal action
//    dispatched by the RuntimeInstances Durable Object is classified in
//    `web/strategy-switch-console/application/read_contracts.js`, and every
//    registry entry still exists in code.
// 2. The finite exception register `tests/fixtures/read-contract-exceptions.json`
//    agrees with the registry, has not expired, points at helpers that still
//    exist, and lists the exact call sites of each excepted helper. A new caller
//    therefore needs a register change in the same review.
// 3. Debt that can be reproduced cheaply (B0, B1, B5) still reproduces under the
//    read-only trap; when it stops, close the register entry.
// 4. The read-only trap adapter catches each write class, and each check above
//    fails on an injected violation.
//
// `node tests/read_contract_boundaries_validation.mjs --print-seed` prints the
// operation lists and call-site counts computed from the current code, for use
// when reviewing a register change.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifySql, createReadOnlyKv, createReadOnlyStorage, ReadOnlyViolation } from "./helpers/read_only_storage.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONSOLE = "web/strategy-switch-console";
const REGISTER_PATH = "tests/fixtures/read-contract-exceptions.json";
const ADOPTED_ON = "2026-11-14";
const MAX_WINDOW_DAYS = 60;
const METHODS = new Set(["GET", "HEAD", "POST", "*"]);
const SCOPES = new Set(["static", "session", "command", "undeclared"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".wrangler"]);
// The registry names excepted helpers itself; it is not a call site.
const SKIP_FILES = new Set(["v2_asset_map.js", "read_contracts.js"]);

const importConsole = path => import(pathToFileURL(join(ROOT, CONSOLE, path)).href);
const registry = await importConsole("application/read_contracts.js");
const register = JSON.parse(readFileSync(join(ROOT, REGISTER_PATH), "utf8"));
const registerText = readFileSync(join(ROOT, REGISTER_PATH), "utf8");

function loadSources() {
  const sources = new Map();
  const walk = dir => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(ROOT, rel)).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(rel);
      } else if (/\.(?:m?js|tsx?)$/.test(name) && !SKIP_FILES.has(name)) {
        sources.set(rel, readFileSync(join(ROOT, rel), "utf8"));
      }
    }
  };
  walk(CONSOLE);
  return sources;
}

async function loadActionSets() {
  const modules = [
    await importConsole("application/worker/runtime_support.js"),
    await importConsole("application/account_diagnosis/constants.js"),
  ];
  const sets = {};
  for (const module of modules) {
    for (const [name, value] of Object.entries(module)) if (name.endsWith("_DO_ACTIONS") && value instanceof Set) sets[name] = value;
  }
  return sets;
}

function matchParen(source, open) {
  let depth = 0;
  let quote = null;
  for (let index = open; index < source.length; index += 1) {
    const ch = source[index];
    if (quote) {
      if (ch === "\\") index += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")" && --depth === 0) return index;
  }
  throw new Error("unbalanced_condition");
}

// Class method body: from its signature to the next two-space-indented method.
function methodBody(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0) return null;
  const rest = source.slice(start + signature.length);
  const next = rest.search(/\n {2}(?:async )?[A-Za-z_$][\w$]*\([^)]*\) \{\n/);
  return signature + (next < 0 ? rest : rest.slice(0, next));
}

/** Extract the classified surface from code. */
function extractSurface(sources, actionSets) {
  const errors = [];
  const routes = new Map();
  const internal = new Set();
  const worker = sources.get(`${CONSOLE}/worker.js`);
  const fetchStart = worker.indexOf("async fetch(request, env, ctx) {");
  const defaultStart = worker.indexOf("export default {");
  const fetchEnd = worker.indexOf("\n  async scheduled(", fetchStart);
  if (defaultStart < 0 || fetchStart < 0 || fetchEnd < 0) errors.push("worker_fetch_not_found");
  const fetchBody = worker.slice(fetchStart, fetchEnd);
  const branchStarts = [...fetchBody.matchAll(/^ {6}if \(/gm)].map(match => match.index);
  for (const [position, start] of branchStarts.entries()) {
    const open = start + fetchBody.slice(start).indexOf("(");
    const condition = fetchBody.slice(open + 1, matchParen(fetchBody, open)).replace(/\s+/g, " ").trim();
    if (!condition.includes("url.pathname")) continue;
    if (routes.has(condition)) errors.push(`duplicate route condition in worker.js: ${condition}`);
    routes.set(condition, fetchBody.slice(start, branchStarts[position + 1] ?? fetchBody.length));
  }
  for (const line of fetchBody.split("\n")) {
    if (/^ {6}\S/.test(line) && line.includes("url.pathname") && !/^ {6}if \(/.test(line)) {
      errors.push(`route dispatch outside an if-branch is not extractable: ${line.trim()}`);
    }
  }
  const exportBlock = worker.slice(defaultStart, worker.indexOf("\n};", defaultStart));
  for (const [, name] of exportBlock.matchAll(/^ {2}async (\w+)\(/gm)) if (name !== "fetch") internal.add(`worker:${name}`);

  const durable = sources.get(`${CONSOLE}/application/runtime_instances/durable_object.js`);
  const doFetch = methodBody(durable, "  async fetch(request) {");
  if (!doFetch) errors.push("durable_object_fetch_not_found");
  const literalMembers = new Set();
  for (const [, list] of (doFetch || "").matchAll(/\[((?:\s*"[a-z0-9_]+",?)+)\s*\]\.includes\(command\?\.action\)/g)) {
    for (const [, action] of list.matchAll(/"([a-z0-9_]+)"/g)) literalMembers.add(action);
  }
  const add = (id, family) => {
    if (internal.has(id)) errors.push(`action dispatched by two families: ${id} (${family})`);
    internal.add(id);
  };
  for (const action of literalMembers) add(`action:${action}`, "literal list");
  for (const [, name] of (doFetch || "").matchAll(/\b([A-Z0-9_]+_DO_ACTIONS)\.has\(command\?\.action\)/g)) {
    if (!actionSets[name]) { errors.push(`unknown action family ${name} in RuntimeInstances.fetch`); continue; }
    for (const action of actionSets[name]) add(`action:${action}`, name);
  }
  const prefixFamilies = {
    rotation_: () => [...sources.get(`${CONSOLE}/secretRotation.js`).matchAll(/\b(?:c|command)\.action === '(rotation_[a-z_]+)'/g)].map(m => m[1]),
    ux1_: () => {
      const body = methodBody(durable, "  ux1ResearchCommand(command) {") || "";
      const names = [...body.matchAll(/"(ux1_[a-z_]+)"/g)].map(m => m[1]);
      return names.filter(name => new RegExp(`(?:command\\.action === "${name}"|\\[[^\\]]*"${name}"[^\\]]*\\]\\.includes\\(command\\?\\.action\\))`).test(body));
    },
  };
  for (const [, prefix] of (doFetch || "").matchAll(/command\.action\.startsWith\("([a-z0-9_]+)"\)/g)) {
    if (!prefixFamilies[prefix]) { errors.push(`unknown action prefix ${prefix} in RuntimeInstances.fetch`); continue; }
    for (const action of new Set(prefixFamilies[prefix]())) add(`action:${action}`, prefix);
  }
  for (const [, action] of (doFetch || "").matchAll(/(?<!typeof )command\??\.action (?:===|!==) "([a-z0-9_]+)"/g)) {
    // Comparisons on actions already dispatched by a family (e.g. a status code) are not new actions.
    if (!internal.has(`action:${action}`)) internal.add(`action:instance_state:${action}`);
  }
  if (/request\.method === "GET"\) return json\(this\.response\(this\.read\(\)\)\)/.test(doFetch || "")) internal.add("action:instance_state:GET");
  if (/pathname === DIRECTORY_PATH/.test(doFetch || "")) {
    for (const [, action] of sources.get(`${CONSOLE}/kv_directory.js`).matchAll(/command\.action (?:===|!==) "([a-z_]+)"/g)) internal.add(`action:directory:${action}`);
  }
  if (/\n {2}async alarm\(\)/.test(durable)) internal.add("action:lifecycle:alarm");
  return { routes, internal, errors };
}

function definitionPattern(symbol) {
  const name = symbol.replace(/[$]/g, "\\$");
  return new RegExp(`(?:\\bfunction\\*?\\s+${name}\\s*\\(|\\bclass\\s+${name}\\b|\\b(?:const|let)\\s+${name}\\s*=|^\\s+(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{)`, "gm");
}

/** Per-file occurrences of a helper: calls of a symbol, or a literal. */
function countSites(sources, helper) {
  const counts = {};
  for (const [file, text] of sources) {
    let count;
    if (helper.symbol) {
      const name = helper.symbol.replace(/[$]/g, "\\$");
      count = (text.match(new RegExp(`(?<![\\w$])${name}\\s*\\(`, "g")) || []).length
        - (text.match(definitionPattern(helper.symbol)) || []).filter(def => def.includes("(")).length;
    } else {
      count = text.split(helper.literal).length - 1;
    }
    if (count > 0) counts[file] = count;
  }
  return counts;
}

const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const isoDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const sameMap = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/** Validate registry and register against the extracted surface. */
function validate({ routes: registryRoutes, internal: registryInternal, register: reg, surface, sources, today, root = ROOT }) {
  const errors = [...surface.errors];
  const exceptionIds = new Set((reg.exceptions || []).map(entry => entry.id));
  const operations = new Map();
  const checkEffect = (where, effect) => {
    const list = [effect].flat();
    if (!list.length) errors.push(`${where}: empty effect`);
    for (const value of list) {
      if (value === "observation" || value === "command") {
        if (list.length > 1) errors.push(`${where}: "${value}" cannot be combined with exception ids`);
      } else if (!exceptionIds.has(value)) {
        errors.push(`${where}: effect ${value} is not a registered exception id`);
      }
    }
  };
  const checkScope = (where, scope) => {
    if (SCOPES.has(scope)) return;
    const doc = /^contract:(docs\/[a-z0-9.-]+\.md)$/.exec(scope || "");
    if (!doc) errors.push(`${where}: invalid scope ${scope}`);
    else if (!existsSync(join(root, doc[1]))) errors.push(`${where}: dangling scope contract ${doc[1]}`);
  };
  const seenMatches = new Set();
  for (const route of registryRoutes) {
    const where = `route ${route.id}`;
    if (seenMatches.has(route.match)) errors.push(`${where}: duplicate registry match`);
    seenMatches.add(route.match);
    const branch = surface.routes.get(route.match);
    if (!branch) errors.push(`${where}: stale entry, no worker.js route branch has condition ${route.match}`);
    else if (!new RegExp(`\\b${route.handler}\\b`).test(branch)) errors.push(`${where}: handler ${route.handler} not found in its branch`);
    if (!Object.keys(route.effects || {}).length) errors.push(`${where}: no methods classified`);
    for (const [method, effect] of Object.entries(route.effects || {})) {
      if (!METHODS.has(method)) errors.push(`${where}: invalid method ${method}`);
      checkEffect(`${where} ${method}`, effect);
      const id = `route:${route.id}#${method}`;
      if (operations.has(id)) errors.push(`duplicate operation id ${id}`);
      operations.set(id, { effects: [effect].flat(), scope: effect === "command" ? "command" : route.scope });
    }
    checkScope(where, route.scope);
  }
  for (const condition of surface.routes.keys()) {
    if (!seenMatches.has(condition)) errors.push(`unclassified route branch in worker.js: ${condition}`);
  }
  for (const [id, entry] of Object.entries(registryInternal)) {
    if (!surface.internal.has(id)) errors.push(`stale internal operation ${id}: not dispatched by current code`);
    checkEffect(id, entry.effect);
    checkScope(id, entry.scope);
    operations.set(id, { effects: [entry.effect].flat(), scope: entry.scope });
  }
  for (const id of surface.internal) if (!Object.hasOwn(registryInternal, id)) errors.push(`unclassified internal operation ${id}`);

  if (reg.adopted_on !== ADOPTED_ON) errors.push(`register adopted_on must stay ${ADOPTED_ON}`);
  const seenIds = new Set();
  for (const entry of reg.exceptions || []) {
    const where = `exception ${entry.id}`;
    if (seenIds.has(entry.id)) errors.push(`${where}: duplicate id`);
    seenIds.add(entry.id);
    for (const field of ["id", "kind", "title", "effect_type", "work_item", "acceptance_test", "expires_on"]) {
      if (typeof entry[field] !== "string" || !entry[field].trim()) errors.push(`${where}: missing ${field}`);
    }
    if (!["effect", "identity", "projection"].includes(entry.kind)) errors.push(`${where}: invalid kind ${entry.kind}`);
    const deadlines = [{ due_on: entry.expires_on, scope: "entry" }, ...(entry.interim_deadlines || [])];
    for (const deadline of deadlines) {
      if (!isoDate(deadline.due_on)) errors.push(`${where}: deadline ${deadline.due_on} is not an absolute YYYY-MM-DD date`);
      else if (deadline.due_on < today) errors.push(`${where}: expired on ${deadline.due_on} (${deadline.scope}); land the exit evidence or a reviewed bounded replan`);
      else if (!entry.replan && deadline.due_on > addDays(ADOPTED_ON, MAX_WINDOW_DAYS)) errors.push(`${where}: deadline ${deadline.due_on} exceeds the ${MAX_WINDOW_DAYS}-day window without a recorded replan`);
    }
    const reachable = entry.reachable_operations || [];
    if (!reachable.length) errors.push(`${where}: no reachable operations`);
    for (const op of reachable) {
      if (op.startsWith("ui:")) {
        if (!existsSync(join(root, op.slice(3)))) errors.push(`${where}: dangling ui reference ${op}`);
      } else if (!operations.has(op)) errors.push(`${where}: dangling operation ${op}`);
    }
    let expected = null;
    if (entry.kind === "effect") expected = [...operations].filter(([, op]) => op.effects.includes(entry.id)).map(([id]) => id);
    if (entry.kind === "projection") expected = [...operations].filter(([, op]) => op.scope === "undeclared").map(([id]) => id);
    if (expected) {
      const listed = new Set(reachable);
      for (const id of expected) if (!listed.has(id)) errors.push(`${where}: operation ${id} reaches this exception but the register does not list it`);
      for (const id of reachable) if (!expected.includes(id)) errors.push(`${where}: listed operation ${id} no longer reaches this exception`);
    }
    if (!(entry.helpers || []).length) errors.push(`${where}: no helper`);
    for (const helper of entry.helpers || []) {
      const label = `${where} helper ${helper.symbol || helper.literal}`;
      const text = sources.get(helper.file);
      if (!text) { errors.push(`${label}: dangling file ${helper.file}`); continue; }
      if (helper.symbol && !(text.match(definitionPattern(helper.symbol)) || []).length) errors.push(`${label}: dangling, ${helper.symbol} is not defined in ${helper.file}`);
      if (helper.literal && !text.includes(helper.literal)) errors.push(`${label}: dangling, literal not present in ${helper.file}`);
      if (!helper.sites || typeof helper.sites !== "object") { errors.push(`${label}: missing sites`); continue; }
      const actual = countSites(sources, helper);
      if (!sameMap(actual, helper.sites)) errors.push(`${label}: call sites changed; register ${JSON.stringify(helper.sites)}, code ${JSON.stringify(actual)}`);
    }
  }
  for (const [id, op] of operations) {
    for (const effect of op.effects) if (exceptionIds.has(effect) && !seenIds.has(effect)) errors.push(`${id}: unknown exception ${effect}`);
  }
  if (/\bD?U\d{5,}\b|gs:\/\/|@[a-z0-9-]+\.[a-z]{2,}/i.test(JSON.stringify(reg))) errors.push("register contains an identifier-like value; keep it code-only");
  return { errors, operations };
}

const sources = loadSources();
const actionSets = await loadActionSets();
const surface = extractSurface(sources, actionSets);
const today = new Date().toISOString().slice(0, 10);
const baseline = { routes: registry.PUBLIC_ROUTES, internal: registry.INTERNAL_OPERATIONS, register, surface, sources, today };

if (process.argv.includes("--print-seed")) {
  const { operations } = validate(baseline);
  const byException = {};
  for (const [id, op] of operations) {
    for (const effect of op.effects) if (!["observation", "command"].includes(effect)) (byException[effect] ||= []).push(id);
    if (op.scope === "undeclared") (byException.P1 ||= []).push(id);
  }
  const sites = Object.fromEntries((register.exceptions || []).flatMap(entry => (entry.helpers || [])
    .map(helper => [`${entry.id}:${helper.symbol || helper.literal}`, countSites(sources, helper)])));
  console.log(JSON.stringify({ routes: surface.routes.size, internal: surface.internal.size, byException, sites }, null, 2));
  process.exit(0);
}

// 1–2. The committed registry and register agree with the code.
const result = validate(baseline);
assert.deepEqual(result.errors, [], `read-contract baseline:\n${result.errors.join("\n")}`);
assert.equal(registerText.endsWith("\n"), true, "register ends with a newline");
assert.deepEqual(registry.classifiedOperations(), result.operations, "registry helper and suite agree on operation ids");

// 3. Live debt still reproduces under the trap. When an assertion here fails
// because the write is gone, close that exception instead of editing the probe.
{
  const { RuntimeInstances } = await importConsole("application/runtime_instances/durable_object.js");
  const trap = createReadOnlyStorage();
  assert.throws(() => new RuntimeInstances({ storage: trap.storage }, {}), ReadOnlyViolation);
  assert.equal(trap.violations[0]?.kind, "sql_ddl", "B0: construction still initializes schema before any fetch");

  const risk = createReadOnlyStorage();
  assert.throws(() => RuntimeInstances.prototype.ensureRiskProfileAuthority.call({ sql: risk.storage.sql }, { state: "valid", bindings: [] }), ReadOnlyViolation);
  assert.match(risk.violations[0]?.detail || "", /^INSERT INTO risk_profile_authority/, "B1: an absent authority is still imported by the read helper");

  const { binanceDetailCommand } = await importConsole("binance_detail_archive.js");
  const binance = createReadOnlyStorage();
  const binding = {
    platform: "binance", account_key: "synthetic-binance", account_scope: "synthetic-scope", target_name: "synthetic-target",
    service_name: "", deployment_selector: "synthetic-deployment", account_selector: "synthetic-selector", target_id: "synthetic-target",
    account_scope_sha256: "a".repeat(64), reader_revision: "b".repeat(40), approved_application_revision: "c".repeat(40),
    source_binding: { kind: "binance_readonly_scope_revision", id: "d".repeat(64) },
  };
  assert.throws(() => binanceDetailCommand(binance.storage.sql, { action: "binance_detail_read", binding, date: "2030-01-02" }), ReadOnlyViolation);
  assert.equal(binance.violations[0]?.kind, "sql_ddl", "B5: binance_detail_read still creates its table");
}

// 4a. The trap adapter catches each write class and allows reads.
{
  const trap = createReadOnlyStorage({ kv: { present: 1 }, sqlRows: () => [{ n: 1 }] });
  assert.deepEqual(trap.storage.sql.exec("SELECT ? AS n", 1).toArray(), [{ n: 1 }]);
  trap.storage.sql.exec("PRAGMA table_info(instance_state)");
  trap.storage.sql.exec("WITH t AS (SELECT 1) SELECT * FROM t");
  assert.equal(await trap.storage.get("present"), 1);
  assert.equal(await trap.storage.getAlarm(), null);
  assert.deepEqual(trap.violations, [], "reads are not violations");
  const sqlWrites = {
    "INSERT INTO t (a) VALUES (?)": "sql_dml", "UPDATE t SET a = 1": "sql_dml", "DELETE FROM t": "sql_dml",
    "REPLACE INTO t VALUES (1)": "sql_dml", "WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x": "sql_dml",
    "CREATE TABLE IF NOT EXISTS t (a)": "sql_ddl", "ALTER TABLE t ADD COLUMN b": "sql_ddl", "DROP INDEX IF EXISTS i": "sql_ddl",
    "PRAGMA user_version = 2": "sql_pragma_write", "PRAGMA journal_mode": "sql_pragma_unreviewed",
    "SELECT 1; DELETE FROM t": "sql_multiple_statements", "/* SELECT */ INSERT INTO t VALUES (1)": "sql_dml",
  };
  for (const [statement, kind] of Object.entries(sqlWrites)) {
    assert.throws(() => trap.storage.sql.exec(statement), error => error instanceof ReadOnlyViolation && error.kind === kind, statement);
  }
  for (const [operation, kind] of [
    [() => trap.storage.put("k", 1), "do_kv_put"], [() => trap.storage.put({ a: 1 }), "do_kv_put"],
    [() => trap.storage.delete("k"), "do_kv_delete"], [() => trap.storage.deleteAll(), "do_kv_delete_all"],
    [() => trap.storage.setAlarm(Date.now()), "alarm_set"], [() => trap.storage.deleteAlarm(), "alarm_delete"],
    [() => trap.storage.transaction(txn => txn.put("k", 1)), "do_kv_put"], [() => trap.storage.transaction(txn => txn.setAlarm(1)), "alarm_set"],
  ]) {
    await assert.rejects(operation, error => error instanceof ReadOnlyViolation && error.kind === kind, kind);
  }
  // A swallowed violation is still recorded.
  try { trap.storage.sql.exec("ALTER TABLE t ADD COLUMN c"); } catch { /* code under test may catch */ }
  assert.equal(trap.violations.at(-1).kind, "sql_ddl");
  assert.deepEqual(trap.snapshot().kv, { present: 1 }, "no trapped write changed fixture state");

  const kv = createReadOnlyKv({ "config:a": "{\"x\":1}" });
  assert.deepEqual(await kv.namespace.get("config:a", "json"), { x: 1 });
  assert.deepEqual((await kv.namespace.list({ prefix: "config:" })).keys, [{ name: "config:a" }]);
  await assert.rejects(() => kv.namespace.put("config:a", "{}"), error => error.kind === "kv_put");
  await assert.rejects(() => kv.namespace.delete("config:a"), error => error.kind === "kv_delete");
  assert.deepEqual(kv.violations.map(v => v.kind), ["kv_put", "kv_delete"]);
  assert.equal(classifySql("select a from t"), null);
}

// 4b. Each baseline check fails on an injected violation.
{
  const run = overrides => validate({ ...baseline, ...overrides }).errors;
  const clone = value => structuredClone(value);
  const expectError = (errors, pattern, label) => assert.ok(errors.some(error => pattern.test(error)), `${label}: expected ${pattern}, got ${JSON.stringify(errors)}`);

  // (a) A new route branch or internal action without a classification.
  const routesPlus = new Map(surface.routes);
  routesPlus.set('url.pathname === "/api/probe-unclassified" && request.method === "GET"', "probe");
  expectError(run({ surface: { ...surface, routes: routesPlus } }), /^unclassified route branch/, "probe (a) route");
  expectError(run({ surface: { ...surface, internal: new Set([...surface.internal, "action:probe_read"]) } }), /^unclassified internal operation action:probe_read/, "probe (a) action");
  const extraFamily = extractSurface(new Map([...sources].map(([file, text]) => [file, file.endsWith("durable_object.js")
    ? text.replace("if (HK_STOP_DO_ACTIONS.has(command?.action)) {", "if (PROBE_DO_ACTIONS.has(command?.action)) {}\n      if (HK_STOP_DO_ACTIONS.has(command?.action)) {") : text])), actionSets);
  expectError(extraFamily.errors, /^unknown action family PROBE_DO_ACTIONS/, "probe (a) family");

  // (b) A new excepted operation or a new caller without a register change.
  const internalPlus = { ...registry.INTERNAL_OPERATIONS, "action:hk_stop_read": { effect: ["B5", "B0"], scope: "undeclared" } };
  expectError(run({ internal: internalPlus }), /exception B5: operation action:hk_stop_read reaches this exception but the register does not list it/, "probe (b) exception entry");
  expectError(run({ internal: { ...registry.INTERNAL_OPERATIONS, "action:hk_stop_read": { effect: "B9", scope: "undeclared" } } }), /effect B9 is not a registered exception id/, "probe (b) new id");
  const sourcesPlus = new Map(sources);
  sourcesPlus.set(`${CONSOLE}/application/probe_new_caller.js`, "export const probe = env => readCurrentStrategies(null, env, null);\n");
  expectError(run({ sources: sourcesPlus }), /exception B7 helper readCurrentStrategies: call sites changed/, "probe (b) caller");

  // (c) An expired deadline.
  const expired = clone(register);
  expired.exceptions[0].expires_on = addDays(today, -1);
  expectError(run({ register: expired }), /expired on/, "probe (c) expiry");
  expectError(run({ today: addDays(ADOPTED_ON, MAX_WINDOW_DAYS + 1) }), /expired on/, "probe (c) clock");
  const tooLong = clone(register);
  tooLong.exceptions[0].expires_on = addDays(ADOPTED_ON, MAX_WINDOW_DAYS + 1);
  expectError(run({ register: tooLong }), /exceeds the 60-day window/, "probe (c) window");

  // (d) A register or registry entry that no longer corresponds to real code.
  const dangling = clone(register);
  dangling.exceptions.find(entry => entry.id === "B1").helpers[0].symbol = "ensureRiskProfileAuthorityRemoved";
  expectError(run({ register: dangling }), /dangling, ensureRiskProfileAuthorityRemoved is not defined/, "probe (d) helper");
  const danglingOp = clone(register);
  danglingOp.exceptions[0].reachable_operations.push("action:probe_removed");
  expectError(run({ register: danglingOp }), /dangling operation action:probe_removed/, "probe (d) operation");
  const staleRoutes = [...registry.PUBLIC_ROUTES, { id: "/api/probe-removed", match: 'url.pathname === "/api/probe-removed"', handler: "probe", effects: { GET: "observation" }, scope: "static" }];
  expectError(run({ routes: staleRoutes }), /stale entry, no worker.js route branch/, "probe (d) route");
}

console.log(`read contract boundaries: ${surface.routes.size} route branches, ${surface.internal.size} internal operations, ${register.exceptions.length} exceptions; ok`);
