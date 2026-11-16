// Read-contract boundary validation (ADR 0002; `.github/engineering.md`,
// "Observation and identity boundaries").
//
// 1. Every public route branch in `worker.js` `fetch` and every internal action
//    dispatched by the RuntimeInstances Durable Object is classified in
//    `web/strategy-switch-console/application/read_contracts.js`, and every
//    registry entry still exists in code. The surface is read from a strict
//    TypeScript AST by `tests/helpers/read_contract_surface.mjs`: a source that
//    does not parse, or that uses a dispatch form the helper does not admit,
//    fails before it is compared with the registry, so a new route or action
//    cannot pass uncounted.
// 2. The finite exception register `tests/fixtures/read-contract-exceptions.json`
//    agrees with the registry, has not expired (deadlines are inclusive UTC
//    dates), points at helpers that still exist, and lists the exact call sites
//    of each excepted helper. A new caller therefore needs a register change in
//    the same review.
// 3. Debt that can be reproduced cheaply (B0, B1, B5) still reproduces under the
//    read-only trap; when it stops, close the register entry. Indirect edges
//    (dependency injection, callbacks) behind B1, B3 and I2 are anchored and
//    must stay attributed.
// 4. The read-only trap adapter catches each write class, and each check above
//    fails on an injected violation. Source probes edit in-memory copies; the
//    executable probes write a scratch sibling module, import it and remove it.
//
// `node tests/read_contract_boundaries_validation.mjs --print-seed` prints the
// operation lists and call-site counts computed from the current code, for use
// when reviewing a register change. The suite needs the console frontend
// dependencies (`npm ci` in `web/strategy-switch-console/frontend`) for the
// pinned TypeScript parser.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifySql, createReadOnlyKv, createReadOnlyStorage, ReadOnlyViolation } from "./helpers/read_only_storage.mjs";
import { astBlock, canonicalExpression, CONSOLE, extractSurface, loadTypeScript, SurfaceError } from "./helpers/read_contract_surface.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REGISTER_PATH = "tests/fixtures/read-contract-exceptions.json";
const ADOPTED_ON = "2026-11-14";
const MAX_WINDOW_DAYS = 60;
const METHODS = new Set(["GET", "HEAD", "POST", "*"]);
const SCOPES = new Set(["static", "session", "command", "undeclared"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".wrangler"]);
// The registry names excepted helpers itself; it is not a call site.
const SKIP_FILES = new Set(["v2_asset_map.js", "read_contracts.js"]);
// Probe-only: a JSON list of { file, from, to } edits applied to the in-memory
// sources before the baseline check, so a child run proves the full-suite exit.
const PROBE_ENV = "READ_CONTRACT_PROBE_EDITS";

const ts = loadTypeScript(ROOT);
const importConsole = path => import(pathToFileURL(join(ROOT, CONSOLE, path)).href);
const registry = await importConsole("application/read_contracts.js");
const register = JSON.parse(readFileSync(join(ROOT, REGISTER_PATH), "utf8"));
const registerText = readFileSync(join(ROOT, REGISTER_PATH), "utf8");

/** Every console module in the source tree; the extraction's module set. */
function loadTree() {
  const tree = new Map();
  const walk = dir => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(ROOT, rel)).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(rel);
      } else if (/\.(?:m?js|tsx?)$/.test(name) && !name.startsWith(".read-contract-probe-")) {
        tree.set(rel, readFileSync(join(ROOT, rel), "utf8"));
      }
    }
  };
  walk(CONSOLE);
  return tree;
}

/** The tree without SKIP_FILES: the files searched for helper call sites. */
const callSiteSources = tree => new Map([...tree].filter(([rel]) => !SKIP_FILES.has(basename(rel))));

const applyEdits = (sources, edits) => new Map([...sources].map(([name, text]) => {
  for (const { file, from, to } of edits) {
    if (name !== `${CONSOLE}/${file}`) continue;
    if (!text.includes(from)) throw new Error(`probe anchor absent from ${file}: ${from}`);
    text = text.replace(from, to);
  }
  return [name, text];
}));

/** Body text of the declaration whose header is `signature` (AST location). */
const blockAfter = (file, source, signature) => astBlock(ts, file, source, signature);

/** Canonical key of a registry `match`, or null when it does not parse. */
const routeKey = match => { try { return canonicalExpression(ts, match); } catch (error) { if (error instanceof SurfaceError) return null; throw error; } };


function definitionPattern(symbol) {
  const name = symbol.replace(/[$]/g, "\\$");
  return new RegExp(`(?:\\bfunction\\*?\\s+${name}\\s*\\(|\\bclass\\s+${name}\\b|\\b(?:const|let)\\s+${name}\\s*=|^\\s+(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{)`, "gm");
}

// Probes that edit sources pass a new Map, so a cached count is never stale.
const siteCounts = new WeakMap();

/** Per-file occurrences of a helper: calls of a symbol, or a literal. */
function countSites(sources, helper) {
  if (!siteCounts.has(sources)) siteCounts.set(sources, new Map());
  const cache = siteCounts.get(sources);
  const key = JSON.stringify([helper.symbol, helper.literal]);
  if (!cache.has(key)) cache.set(key, computeSites(sources, helper));
  return cache.get(key);
}

// Per helper and file text; probes change one file, so the rest are reused.
const fileSiteCounts = new Map();

function computeSites(sources, helper) {
  const counts = {};
  const key = JSON.stringify([helper.symbol, helper.literal]);
  if (!fileSiteCounts.has(key)) fileSiteCounts.set(key, new Map());
  const byText = fileSiteCounts.get(key);
  for (const [file, text] of sources) {
    let count = byText.get(text);
    if (count === undefined) {
      if (helper.symbol) {
        const name = helper.symbol.replace(/[$]/g, "\\$");
        count = (text.match(new RegExp(`(?<![\\w$])${name}\\s*\\(`, "g")) || []).length
          - (text.match(definitionPattern(helper.symbol)) || []).filter(def => def.includes("(")).length;
      } else {
        count = text.split(helper.literal).length - 1;
      }
      byText.set(text, count);
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
    // Registry conditions compare as ASTs: literal values and operators
    // count, trivia and redundant parentheses do not.
    const key = routeKey(route.match);
    if (!key) errors.push(`${where}: registry match does not parse as one expression: ${route.match}`);
    if (seenMatches.has(key)) errors.push(`${where}: duplicate registry match`);
    seenMatches.add(key);
    const branch = surface.routes.get(key);
    if (!branch) errors.push(`${where}: stale entry, no worker.js route branch has condition ${route.match}`);
    else if (!new RegExp(`\\b${route.handler}\\b`).test(branch.text)) errors.push(`${where}: handler ${route.handler} not found in its branch`);
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
  for (const [key, branch] of surface.routes) {
    if (!seenMatches.has(key)) errors.push(`unclassified route branch in worker.js: ${branch.condition}`);
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

const probeEdits = process.env[PROBE_ENV] ? JSON.parse(process.env[PROBE_ENV]) : [];
const tree = applyEdits(loadTree(), probeEdits);
const sources = callSiteSources(tree);
// The module graph is checked against the whole tree; `src` overlays it.
const extracted = src => extractSurface(ts, src, { modules: tree });
const surface = extracted(sources);
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
// Exact sets, not counts: extracted route conditions and internal operations
// equal the registry entries one for one.
assert.deepEqual([...surface.routes.keys()].sort(), registry.PUBLIC_ROUTES.map(route => routeKey(route.match)).sort(), "route branches equal the registry as a set");
assert.equal(surface.routes.size, registry.PUBLIC_ROUTES.length, "one route branch per registry route");
assert.deepEqual([...surface.internal].sort(), Object.keys(registry.INTERNAL_OPERATIONS).sort(), "internal operations equal the registry as a set");

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

// 3b. Indirect edges behind registered exceptions. Dependency injection and
// callbacks hide these from name matching, so each one is pinned here: the
// anchors must still be in the code, and the register must still attribute
// the exception to the operation. When an anchor disappears because the edge
// is gone, narrow the exception in the same change instead of editing the
// anchor.
const RS = `${CONSOLE}/application/worker/runtime_support.js`;
const DO = `${CONSOLE}/application/runtime_instances/durable_object.js`;
const CONSOLE_GROUP = "console api group";
const INDIRECT_EDGES = [
  { exception: "B1", operations: ["route:console api group#GET"], description: "Console group injects accountSettingsResponse (diff) and consoleRunControls (run-controls), both requesting account_settings_read", anchors: [
    { route: CONSOLE_GROUP, text: "settings: accountSettingsResponse" },
    { route: CONSOLE_GROUP, text: "runControls: consoleRunControls" },
    { file: RS, block: "export async function accountSettingsResponse(request, env) {", text: "accountSettingsResponseImpl(" },
    { file: `${CONSOLE}/application/account_settings/http.js`, block: "export async function accountSettingsResponse(request, env, deps) {", text: 'action: "account_settings_read"' },
    { file: RS, block: "export async function consoleRunControls(_request, env, account, session) {", text: 'action: "account_settings_read"' },
  ] },
  { exception: "B1", operations: ["route:/api/admin/config#GET"], description: "adminConfigResponse -> buildAdminState -> loadRiskProfileBindings -> risk_profile_read", anchors: [
    { file: RS, block: "export async function adminConfigResponse(request, env) {", text: "buildAdminState(session, env)" },
    { file: RS, block: "export async function buildAdminState(session, env) {", text: "loadRiskProfileBindings(env)" },
    { file: RS, block: "export async function loadRiskProfileBindings(env) {", text: 'action: "risk_profile_read"' },
  ] },
  { exception: "B1", operations: ["route:/api/desk/readbacks#GET", "action:desk_readback_fresh"], description: "Desk target readback requests desk_readback_fresh; the store's read callback calls readAccountSettings", anchors: [
    { file: `${CONSOLE}/application/desk/readback.js`, block: "export async function deskReadbackResponse(request, env, deps) {", text: 'command({ action: "desk_readback_fresh"' },
    { file: `${CONSOLE}/application/desk/readback.js`, block: "export class DeskReadbackStore {", text: "this.read(command.id, command.actor)" },
    { file: DO, block: "constructor(ctx, env) {", text: "this.deskReadbacks = new DeskReadbackStore(ctx.storage, async (id, actor) => {" },
    { file: DO, block: "constructor(ctx, env) {", text: "this.readAccountSettings({ platform: target.platform, key: target.key" },
  ] },
  { exception: "B1", operations: ["action:account_settings_read", "action:risk_profile_read"], description: "readAccountSettings -> readRiskProfileAuthority -> ensureRiskProfileAuthority", anchors: [
    { file: DO, block: "readAccountSettings(command) {", text: "this.readRiskProfileAuthority(command.legacy)" },
    { file: DO, block: "readRiskProfileAuthority(legacy) {", text: "this.ensureRiskProfileAuthority(legacy)" },
  ] },
  { exception: "B3", operations: ["route:console api group#GET"], description: "run-controls -> consoleRunControls -> platformControl -> readPlatformRuntimeControl", anchors: [
    { route: CONSOLE_GROUP, text: "runControls: consoleRunControls" },
    { file: RS, block: "export async function consoleRunControls(_request, env, account, session) {", text: "platformControl: [\"ibkr\", \"schwab\"].includes(account.platform)\n      ? () => readPlatformRuntimeControl(env, account.platform, account.target_name)" },
    { file: `${CONSOLE}/application/console_api/run_controls.js`, block: "export async function runControls(account, session, deps) {", text: "await deps.platformControl()" },
  ] },
  { exception: "I2", operations: ["route:console api group#GET"], description: "Console group injects runtime-daily bindings and reader", anchors: [
    { route: CONSOLE_GROUP, text: "runtimeDailyPublicBindings(e," },
    { route: CONSOLE_GROUP, text: "daily: (req, e) => runtimeDailyResponse(" },
  ] },
  { exception: "I2", operations: ["route:/api/config#*"], description: "configPayload -> runtimeDailyPublicBindings -> runtimeDailyRegisteredBindings", anchors: [
    { file: RS, block: "export async function configPayload(request, env, ctx) {", text: "runtimeDailyPublicBindings(env, accountConfig.options)" },
    { file: RS, text: "export async function runtimeDailyPublicBindings(env, accountOptions, readRegistered = () => runtimeDailyRegisteredBindings(env, accountOptions)) {" },
  ] },
  { exception: "I2", operations: ["route:/api/runtime-daily#GET"], description: "selected-account runtime-daily read resolves registered bindings", anchors: [
    { file: RS, block: "export async function runtimeDailyResponse(request, env, url, context = null) {", text: "runtimeDailyRegisteredBindings(env, config.options)" },
  ] },
  { exception: "I2", operations: ["route:/api/runtime-daily/sync#POST"], description: "runtime-daily sync (a command) resolves registered bindings", anchors: [
    { file: RS, block: "export async function syncRuntimeDailyResponse(request, env) {", text: "runtimeDailyRegisteredBindings(env, options)" },
  ] },
  { exception: "I2", operations: ["route:/api/desk/ribbon#GET", "route:/api/desk/overview#GET"], description: "Desk N1 runtimeDay -> todaySummary with runtimeDailyPublicBindings", anchors: [
    { file: `${CONSOLE}/worker.js`, block: "function deskN1Deps() {", text: "runtimeDailyPublicBindings(e, (await loadAccountOptionsConfig(e)).options)" },
    { file: `${CONSOLE}/worker.js`, block: "function deskN1Deps() {", text: "todaySummary(req, e, dailyDeps," },
    { file: `${CONSOLE}/application/desk/ribbon.js`, text: "deps.runtimeDay(request, env, accounts, businessDate" },
    { file: `${CONSOLE}/application/desk/overview.js`, text: "deps.runtimeDay(request, env, configuredAccounts(config.value), businessDate)" },
  ] },
];

function checkIndirectEdges({ edges = INDIRECT_EDGES, sources: src, surface: surf, register: reg, operations, routes = registry.PUBLIC_ROUTES }) {
  const errors = [];
  for (const edge of edges) {
    const entry = (reg.exceptions || []).find(item => item.id === edge.exception);
    for (const op of edge.operations) {
      const registered = entry?.kind === "effect" ? operations.get(op)?.effects.includes(edge.exception) : entry?.reachable_operations?.includes(op);
      if (!registered) errors.push(`edge ${edge.exception} ${op}: the code reaches the exception (${edge.description}) but the registry/register no longer attributes it`);
    }
    for (const anchor of edge.anchors) {
      let text;
      try {
        if (anchor.route) text = surf.routes.get(routeKey(routes.find(route => route.id === anchor.route)?.match ?? ""))?.text;
        else text = anchor.block ? blockAfter(anchor.file, src.get(anchor.file) || "", anchor.block)?.text : src.get(anchor.file);
      } catch (error) { text = null; errors.push(`edge ${edge.exception}: ${error.message}`); }
      if (!text?.includes(anchor.text)) errors.push(`edge ${edge.exception} ${edge.operations.join(",")}: anchor gone from ${anchor.route ? `route ${anchor.route}` : `${anchor.file}${anchor.block ? ` (${anchor.block})` : ""}`}: ${anchor.text.replace(/\s+/g, " ")}; if the edge is gone, narrow the exception`);
    }
  }
  return errors;
}

assert.deepEqual(checkIndirectEdges({ sources, surface, register, operations: result.operations }), [], "indirect exception edges");

// The injected edges behave as anchored: exercised through the real modules
// with stub dependencies; the last probe runs under the read-only trap.
{
  const { consoleApiResponse } = await importConsole("application/console_api/routes.js");
  const calls = [];
  const deps = {
    json: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    readSession: async () => ({ allowed: true, admin: true, login: "synthetic" }),
    command: async () => { throw new Error("unexpected command"); },
    accountOptions: async () => ({ options: { ibkr: [{ key: "synthetic-account", target_name: "synthetic-target" }] } }),
    settings: async request => { calls.push(["settings", new URL(request.url).pathname]); return new Response("{}", { status: 503 }); },
    runControls: async (_request, _env, account) => { calls.push(["runControls", account.key]); return {}; },
  };
  const query = "?platform=ibkr&account=synthetic-account";
  await consoleApiResponse(new Request(`https://console.invalid/api/account-settings/diff${query}`), {}, deps);
  await consoleApiResponse(new Request(`https://console.invalid/api/accounts/run-controls${query}`), {}, deps);
  assert.deepEqual(calls, [["settings", "/api/account-settings"], ["runControls", "synthetic-account"]], "B1/B3: Console group GET reaches the injected settings and runControls dependencies");

  const { runControls } = await importConsole("application/console_api/run_controls.js");
  let platformControlCalls = 0;
  await runControls({ key: "synthetic-account", platform: "ibkr", target_name: "synthetic-target" }, { admin: true, login: "synthetic" }, {
    dispatchAvailable: true,
    platformControl: async () => { platformControlCalls += 1; return { phase: "idle" }; },
    stopReady: async () => false, resumeTarget: async () => null, profileState: async () => ({ reason: "synthetic" }),
  });
  assert.equal(platformControlCalls, 1, "B3: run-controls invokes the platform-control read for an administrator with dispatch");

  const { RuntimeInstances } = await importConsole("application/runtime_instances/durable_object.js");
  const risk = createReadOnlyStorage();
  const self = Object.create(RuntimeInstances.prototype);
  self.sql = risk.storage.sql;
  self.existingAccountInstance = () => ({ state: {}, item: { platform: "ibkr" }, identity: { target_name: "synthetic-target" } });
  assert.throws(() => self.readAccountSettings({ platform: "ibkr", key: "synthetic-account", legacy: { state: "valid", bindings: [] } }), ReadOnlyViolation);
  assert.match(risk.violations[0]?.detail || "", /^INSERT INTO risk_profile_authority/, "B1: readAccountSettings, used by the Desk readback callback, still imports the absent authority");
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

  // Comment markers and semicolons inside strings or quoted identifiers are
  // literal text; they cannot hide a later statement (review F1). Each script
  // below deletes a row in a real SQLite database.
  const reads = [
    "SELECT \"--\" FROM t", "SELECT [/*], `*/` FROM t", "SELECT \"a;b\", 'c;d' FROM t", "SELECT 'it''s -- fine' FROM t",
    "SELECT a FROM t WHERE b = 'DELETE FROM t'", "SELECT 1; -- trailing comment", "SELECT 1 /* ; */;", "SELECT replace(a, 'x', 'y') FROM t",
    "PRAGMA table_info('instance_state')",
  ];
  for (const statement of reads) assert.equal(classifySql(statement), null, statement);
  const scripts = {
    "SELECT '--'; DELETE FROM t;": "sql_multiple_statements",
    "SELECT '/*'; DELETE FROM t; SELECT '*/';": "sql_multiple_statements",
    "SELECT \"--\"; DELETE FROM t": "sql_multiple_statements",
    "SELECT [/*]; DELETE FROM t; SELECT [*/]": "sql_multiple_statements",
    "SELECT `--`; DELETE FROM t": "sql_multiple_statements",
    "SELECT 1 -- note\n; DELETE FROM t": "sql_multiple_statements",
    "SELECT 1 /* ; */ ; DELETE FROM t": "sql_multiple_statements",
    "SELECT 'a'';--'; DELETE FROM t": "sql_multiple_statements",
    "DELETE FROM t; SELECT 1": "sql_multiple_statements",
    "SELECT 1; SELECT 2": "sql_multiple_statements",
    "SELECT * FROM t WHERE a IN (SELECT 1); UPDATE t SET a = 2": "sql_multiple_statements",
    "SELECT 'unterminated": "sql_unsupported_syntax",
    "SELECT \"unterminated FROM t": "sql_unsupported_syntax",
    "SELECT [unterminated FROM t": "sql_unsupported_syntax",
    "SELECT 1 /* unterminated": "sql_unsupported_syntax",
    "WITH x AS (SELECT '--') DELETE FROM t": "sql_dml",
    "PRAGMA table_info(t) = 1": "sql_pragma_write",
    "PRAGMA \"user_version\" = 2": "sql_pragma_write",
  };
  const mixed = createReadOnlyStorage({ sqlRows: () => { throw new Error("a rejected script reached the fixture"); } });
  for (const [script, kind] of Object.entries(scripts)) {
    assert.equal(classifySql(script), kind, script);
    // Swallowed by the code under test: still recorded, never executed.
    try { mixed.storage.sql.exec(script); } catch (error) { assert.ok(error instanceof ReadOnlyViolation, script); }
  }
  assert.deepEqual(mixed.violations.map(v => v.kind), Object.values(scripts), "every rejected script is recorded");
  assert.equal(mixed.violations[0].detail, "SELECT ''; DELETE FROM t", "violation detail is comment-free and string-redacted");
}

// 4b. Each baseline check fails on an injected violation.
{
  const run = overrides => validate({ ...baseline, ...overrides }).errors;
  const clone = value => structuredClone(value);
  const expectError = (errors, pattern, label) => assert.ok(errors.some(error => pattern.test(error)), `${label}: expected ${pattern}, got ${JSON.stringify(errors)}`);

  // (a) A new route branch or internal action without a classification.
  const routesPlus = new Map(surface.routes);
  const probeCondition = 'url.pathname === "/api/probe-unclassified" && request.method === "GET"';
  routesPlus.set(routeKey(probeCondition), { condition: probeCondition, text: "probe" });
  expectError(run({ surface: { ...surface, routes: routesPlus } }), /^unclassified route branch/, "probe (a) route");
  expectError(run({ surface: { ...surface, internal: new Set([...surface.internal, "action:probe_read"]) } }), /^unclassified internal operation action:probe_read/, "probe (a) action");
  const extraFamily = extracted(applyEdits(sources, [{ file: "application/runtime_instances/durable_object.js", from: "if (HK_STOP_DO_ACTIONS.has(command?.action)) {", to: "if (PROBE_DO_ACTIONS.has(command?.action)) {}\n      if (HK_STOP_DO_ACTIONS.has(command?.action)) {" }]));
  expectError(extraFamily.errors, /family_unknown: unknown action family PROBE_DO_ACTIONS/, "probe (a) family");

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

  // (e) Extraction is a strict AST admission check (review F2; matrix of the
  // F2 design). Each probe edits an in-memory copy of the real source with the
  // registry and register unchanged. "Discover": extraction admits the source,
  // finds the added operation and validation fails for its missing
  // classification. "Reject": extraction fails with the specific unsupported
  // form. In both cases validation, which decides this suite's exit, is not
  // clean. "Pass": identical sets and clean validation.
  const DO_FILE = "application/runtime_instances/durable_object.js";
  const HK_BRANCH = "if (HK_STOP_DO_ACTIONS.has(command?.action)) {";
  const HK_BODY = "return json(this.storage.transactionSync(() => this.hkStopCommand(command)));";
  const GET_BRANCH = 'if (request.method === "GET") return json(this.response(this.read()));';
  const ROOT_BRANCH = '      if (url.pathname === "/") {';
  const PROBE_ROUTE = 'if (url.pathname === "/api/probe-unclassified" && request.method === "GET") return new Response("probe");';
  const edit = (file, from, to) => applyEdits(sources, [{ file, from, to }]);
  const beforeHk = text => edit(DO_FILE, HK_BRANCH, `${text}\n      ${HK_BRANCH}`);
  const inHk = text => edit(DO_FILE, HK_BODY, `${text}\n        ${HK_BODY}`);
  const beforeGet = text => edit(DO_FILE, GET_BRANCH, `${text}\n      ${GET_BRANCH}`);
  const beforeRoot = text => edit("worker.js", ROOT_BRANCH, `      ${text}\n${ROOT_BRANCH}`);
  const outcomes = [];
  const validated = probedSources => {
    const probed = extracted(probedSources);
    return { probed, errors: run({ surface: probed, sources: probedSources }) };
  };
  const discover = (label, probedSources, pattern) => {
    const { probed, errors } = validated(probedSources);
    assert.deepEqual(probed.errors, [], `discover ${label}: admitted without an extraction error`);
    expectError(errors, pattern, `discover ${label}`);
    outcomes.push(["discover", label, errors.find(error => pattern.test(error))]);
  };
  const reject = (label, probedSources, pattern) => {
    const { probed, errors } = validated(probedSources);
    expectError(probed.errors, pattern, `reject ${label}`);
    assert.notDeepEqual(errors, [], `reject ${label}: validation fails`);
    outcomes.push(["reject", label, probed.errors.find(error => pattern.test(error))]);
  };
  // Either outcome is acceptable; a silent pass is not.
  const discoverOrReject = (label, probedSources, discoverPattern, rejectPattern) => {
    const { probed, errors } = validated(probedSources);
    const found = probed.errors.find(error => rejectPattern.test(error)) || errors.find(error => discoverPattern.test(error));
    assert.ok(found, `${label}: expected ${discoverPattern} or ${rejectPattern}, got ${JSON.stringify(errors)}`);
    outcomes.push([probed.errors.length ? "reject" : "discover", label, found]);
  };
  const pass = (label, probedSources) => {
    const { probed, errors } = validated(probedSources);
    assert.deepEqual(probed.errors, [], `pass ${label}: no extraction error`);
    assert.deepEqual([...probed.routes.keys()], [...surface.routes.keys()], `pass ${label}: identical route branches`);
    assert.deepEqual([...probed.internal].sort(), [...surface.internal].sort(), `pass ${label}: identical internal operations`);
    assert.deepEqual(errors, [], `pass ${label}: validation passes`);
    outcomes.push(["pass", label, ""]);
  };
  const UNCLASSIFIED_ROUTE = /^unclassified route branch in worker\.js: url\.pathname === "\/api\/probe-unclassified"/;
  const UNCLASSIFIED_READ = /^unclassified internal operation action:instance_state:probe_read$/;
  const COMPUTED = /computed_access: computed access on receiver/;

  // New Worker route: any indentation, tabs, the same line.
  for (const indent of ["", " ", "    ", "      ", "          ", "\t", "\t\t"]) {
    discover(`Worker route indented ${JSON.stringify(indent)}`, edit("worker.js", ROOT_BRANCH, `${indent}${PROBE_ROUTE}\n${ROOT_BRANCH}`), UNCLASSIFIED_ROUTE);
  }
  discover("Worker route on the same line as another", edit("worker.js", ROOT_BRANCH, `      ${PROBE_ROUTE} ${ROOT_BRANCH.trim()}`), UNCLASSIFIED_ROUTE);
  discover("Worker route with brackets in strings, regex and templates", beforeRoot('if (url.pathname === "/api/probe-braces") { const s = "}{"; const r = /[}{]/; return new Response(`${s}}`); }'), /^unclassified route branch.*probe-braces/);

  // Spelling of an action comparison (FIX2 probes 1, 4-7).
  discover("comment inside the action member", beforeHk('if (command./* dispatch */action === "probe_read") return json({ probe: true });'), UNCLASSIFIED_READ);
  discover("parenthesized action member", beforeHk('if ((command.action) === "probe_read") return json({ probe: true });'), UNCLASSIFIED_READ);
  discover("repeated parentheses around the receiver", beforeHk('if (((command)).action === "probe_read") return json({ probe: true });'), UNCLASSIFIED_READ);
  discover("single-quoted action value", beforeHk("if (command.action === 'probe_read') return json({ probe: true });"), UNCLASSIFIED_READ);
  discover("plain-template action value", beforeHk("if (command.action === `probe_read`) return json({ probe: true });"), UNCLASSIFIED_READ);
  discover("reversed comparison", beforeHk('if ("probe_read" === command?.action) return json({ probe: true });'), UNCLASSIFIED_READ);
  discoverOrReject("comparison inside a template interpolation", beforeHk('if (`${command.action === "probe_read"}` === "true") return json({ probe: true });'),
    UNCLASSIFIED_READ, /statement: dispatch-level statement not admitted/);
  discover("comparison inside a template interpolation in a gated body", inHk('if (`${command.action === "probe_read"}` === "true") return json({ probe: true });'), UNCLASSIFIED_READ);

  // Computed access on a receiver, whatever its key (FIX2 probes 2, 10, 11).
  reject("request[\"method\"]", beforeGet('if (request["method"] === "PUT") return json({ probe: true });'), COMPUTED);
  reject("request[probeKey]", beforeGet('if (request[probeKey] === "PUT") return json({ probe: true });'), COMPUTED);
  reject("(command)[\"act\" + \"ion\"]", beforeHk('if ((command)["act" + "ion"] === "probe_read") return json({ probe: true });'), COMPUTED);
  reject("(request)[\"me\" + \"thod\"]", beforeGet('if ((request)["me" + "thod"] === "PUT") return json({ probe: true });'), COMPUTED);
  for (const access of ['((command))["action"]', 'command?.["action"]', 'command["\\u0061ction"]', "command[`action`]", 'command[`act${"ion"}`]', 'command["action"]']) {
    reject(`computed command access ${access}`, beforeHk(`if (${access} === "probe_read") return json({ probe: true });`), COMPUTED);
  }
  for (const access of ['request?.["method"]', "(request)[`method`]", "((request))['met' + 'hod']"]) {
    reject(`computed request access ${access}`, beforeGet(`if (${access} === "PUT") return json({ probe: true });`), COMPUTED);
  }
  reject("computed command access in a gated body", inHk('if (command["action"] === "probe_read") return json({ probe: true });'), COMPUTED);
  reject("computed url access in a Worker route", beforeRoot('if (url["pathname"] === "/api/probe") return new Response("probe");'), COMPUTED);
  reject("optional computed url access in a route body", edit("worker.js", 'if (url.pathname === "/api/session") return', 'if (url.pathname === "/api/session") if (url?.["pathname"]) return'), COMPUTED);
  reject("computed request access in a Worker route", beforeRoot('if (url.pathname === "/api/probe" && (request)["method"] === "GET") return new Response("probe");'), COMPUTED);
  reject("computed access in rotationCommand", edit("secretRotation.js", "  if (c.action === 'rotation_denied')", "  if (c['action'] === 'rotation_probe') return { probe: true };\n  if (c.action === 'rotation_denied')"), COMPUTED);
  reject("computed access in KvDirectory.run", edit("kv_directory.js", '    if (command.action === "cache") {', '    if (command[`action`] === "probe") return { probe: true };\n    if (command.action === "cache") {'), COMPUTED);

  // Aliases, destructuring, reflection, forwarding.
  reject("alias of command", beforeHk('const probeCommand = command;'), /alias: receiver command bound to another name/);
  reject("alias of command in a gated body", inHk('const probeAlias = command; if (probeAlias.action === "probe_read") return json({});'), /alias: receiver command bound to another name/);
  reject("destructured action", beforeHk('const { action } = command;\n      if (action === "probe_read") return json({});'), /destructuring: receiver command bound to another name/);
  reject("destructuring assignment", inHk('let probeAction; ({ action: probeAction } = command);'), /destructuring: receiver command assigned elsewhere/);
  reject("Reflect.get on command", beforeHk('if (Reflect.get(command, "action") === "probe_read") return json({});'), /reflection: receiver command passed to Reflect/);
  reject("Object.entries on request", inHk('if (Object.entries(request).length) return json({});'), /reflection: receiver request passed to Object/);
  reject("helper forwarding outside a gate", beforeHk('if (probeDispatch(command)) return json({});'), /forwarding: receiver command forwarded outside a gated branch/);
  reject("IIFE forwarding", inHk('if (((c) => c.action === "probe_read")(command)) return json({});'), /forwarding: receiver command passed to an immediately invoked function/);
  reject("spread copy of command", beforeHk('if (probeDispatch({ ...command })) return json({});'), /alias: receiver command spread/);
  reject("shorthand property forwarding", beforeHk('if (probeDispatch({ command })) return json({});'), /alias: shorthand property passes receiver command/);
  reject("reassignment of command", beforeHk('command = { action: "probe_read" };'), /reassignment: receiver command is reassigned/);
  reject("write to command.action", inHk('command.action = "probe_read";'), /mutation: write to command\.action/);
  reject("shadowed receiver", inHk("for (const request of []) json(request);"), /shadowing: declaration shadows receiver request/);
  reject("dynamic evaluation", inHk('if (eval("command.action") === "probe_read") return json({});'), /dynamic_evaluation: eval reference/);
  reject("Worker path alias", beforeRoot("const path = url.pathname;"), /statement: route dispatch must be a top-level if-branch; not admitted: const path/);
  reject("Worker destructured pathname", edit("worker.js", "    const url = new URL(request.url);\n    try {", "    const url = new URL(request.url);\n    try {\n      const { pathname } = url;"), /destructuring: receiver url bound to another name/);
  reject("Worker request alias in a route body", edit("worker.js", 'if (url.pathname === "/api/session") return', 'if (url.pathname === "/api/session") { const probeRequest = request; }\n      if (url.pathname === "/api/session") return'), /alias: receiver request bound to another name/);
  reject("rotationCommand destructured action", edit("secretRotation.js", "  if (c.action === 'rotation_denied')", "  const { action: probeAction } = c;\n  if (c.action === 'rotation_denied')"), /destructuring: receiver c bound to another name/);
  reject("KvDirectory.run helper forwarding", edit("kv_directory.js", '    if (command.action === "cache") {', '    if (probeDispatch(command)) return { probe: true };\n    if (command.action === "cache") {'), /forwarding: receiver command forwarded outside a gated branch/);

  // Fourth-round counterexamples (review F2.1): a gated branch is not
  // authorization to forward a receiver, call a method on it or evaluate code.
  const PERF_BRANCH = 'if (url.pathname.startsWith("/api/performance/")) {';
  const inPerf = text => edit("worker.js", PERF_BRANCH, `${PERF_BRANCH}\n        ${text}`);
  const PROBE_FORWARD = 'function probeForward(r) {\n          return r.url.endsWith("/api/performance/probe-unclassified");\n        }';
  reject("helper forwarding with a renamed parameter", inPerf(`${PROBE_FORWARD}\n        if (probeForward(request)) return new Response("probe-forward");`),
    /forwarding: receiver request forwarded to an unreviewed call probeForward\(request\)/);
  reject("helper forwarding inside a template interpolation", inPerf(`${PROBE_FORWARD}\n        if (\`\${probeForward(request)}\` === "true") return new Response("probe-forward");`),
    /forwarding: receiver request forwarded to an unreviewed call probeForward\(request\)/);
  reject("arrow helper forwarding", inPerf('const probeArrow = (x) => x.url.includes("probe");\n        if (probeArrow(request)) return new Response("probe");'),
    /forwarding: receiver request forwarded to an unreviewed call probeArrow\(request\)/);
  reject("receiver-producing call valueOf", inPerf('const r = request.valueOf();\n        if (new URL(r.url)["path" + "name"] === "/api/performance/probe-unclassified") return new Response("probe-valueof");'),
    /receiver_call: method call request\.valueOf\(\) on a receiver is admitted only in a reviewed template/);
  reject("computed globalThis evaluation", inPerf('if (globalThis["ev" + "al"]("true")) return new Response("probe-eval");'),
    /dynamic_evaluation: global globalThis is not admitted in the dispatch set/);

  // Entry replacement (review F2.2): any reference to an entry class or the
  // Worker default export outside its admitted use, whatever the spelling.
  const DO_END = '      throw new HttpError("unsupported_ux1_action", 400);\n    });\n  }\n}\n';
  const afterDo = text => edit(DO_FILE, DO_END, `${DO_END}${text}\n`);
  const PROBE_WRAPPER = 'async function(r) {\n  if (r.method === "PUT" && new URL(r.url).pathname === "/probe-unclassified") return new Response("probe-replacement");\n  return originalProbeFetch.call(this, r);\n}';
  reject("computed prototype replacement of RuntimeInstances.fetch", afterDo(`const originalProbeFetch = RuntimeInstances.prototype.fetch;\nRuntimeInstances.prototype["fe" + "tch"] = ${PROBE_WRAPPER};`),
    /module graph: entry_replaced: RuntimeInstances is referenced in .*RuntimeInstances\.prototype\["fe" \+ "tch"\]/);
  reject("defineProperty replacement of RuntimeInstances.fetch", afterDo(`const originalProbeFetch = RuntimeInstances.prototype.fetch;\nObject.defineProperty(RuntimeInstances.prototype, "fetch", { value: ${PROBE_WRAPPER} });`),
    /module graph: entry_replaced: RuntimeInstances is referenced in .*Object\.defineProperty\(RuntimeInstances\.prototype/);
  reject("computed replacement of KvDirectory.run", edit("kv_directory.js", "export const DIRECTORY_PATH", 'KvDirectory.prototype["r" + "un"] = async () => ({ probe: true });\nexport const DIRECTORY_PATH'),
    /module graph: entry_replaced: KvDirectory used other than as new KvDirectory/);
  const defaultProbe = new Map(edit("worker.js", "export default {", 'import "./application/probe_default.js";\nexport default {'));
  defaultProbe.set(`${CONSOLE}/application/probe_default.js`, 'import worker from "../worker.js";\nworker["fe" + "tch"] = async () => new Response("probe");\n');
  reject("computed replacement of the Worker fetch from another module", defaultProbe, /module graph: entry_replaced: the Worker default export is referenced in .*probe_default\.js/);

  // Family mutation by import identity (review F2.3): namespace members and
  // escaped identifiers resolve to the family binding.
  const HK_MARKED = `${HK_BRANCH}\n        if (command.probe_marker) return json({ probe: true });`;
  reject("family mutation through a namespace import", applyEdits(sources, [
    { file: DO_FILE, from: DO_END, to: `${DO_END}import * as probeConstants from "../hk_stop/constants.js";\nprobeConstants.HK_STOP_DO_ACTIONS.add("probe_namespace");\n` },
    { file: DO_FILE, from: HK_BRANCH, to: HK_MARKED }]), /module graph: family_mutation: HK_STOP_DO_ACTIONS used other than \.has\(\) in .*probeConstants\.HK_STOP_DO_ACTIONS\.add/);
  const escapedProbe = applyEdits(sources, [
    { file: DO_FILE, from: DO_END, to: `${DO_END}import "../hk_stop/probe_mutation.js";\n` },
    { file: DO_FILE, from: HK_BRANCH, to: HK_MARKED }]);
  escapedProbe.set(`${CONSOLE}/application/hk_stop/probe_mutation.js`, 'import { HK\\u005fSTOP_DO_ACTIONS } from "./constants.js";\nHK\\u005fSTOP_DO_ACTIONS.add("probe_escape");\n');
  reject("family mutation through an escaped identifier", escapedProbe, /module graph: family_mutation: HK_STOP_DO_ACTIONS used other than \.has\(\) in .*probe_mutation\.js/);
  const namespaceReexport = new Map(edit(DO_FILE, DO_END, `${DO_END}import { probeNs } from "../hk_stop/probe_ns.js";\nprobeNs.HK_STOP_DO_ACTIONS.add("probe_ns");\n`));
  namespaceReexport.set(`${CONSOLE}/application/hk_stop/probe_ns.js`, 'export * as probeNs from "./constants.js";\n');
  reject("family mutation through a namespace re-export", namespaceReexport, /module graph: entry_replaced: export \* as probeNs re-exports dispatch bindings/);

  // Fifth-round counterexamples (review FIX4B): a dynamic import, an exported
  // namespace import and a same-named forward target keep the spelling but
  // lose the reviewed binding.
  const familyProbe = (text, files = {}) => {
    const probed = applyEdits(sources, [{ file: DO_FILE, from: DO_END, to: `${DO_END}${text}\n` }, { file: DO_FILE, from: HK_BRANCH, to: HK_MARKED }]);
    for (const [name, body] of Object.entries(files)) probed.set(`${CONSOLE}/application/hk_stop/${name}`, body);
    return probed;
  };
  const DYNAMIC = /module graph: family_mutation: dynamic import of .*hk_stop\/constants\.js, which exports HK_STOP_DO_ACTIONS, is not admitted/;
  reject("family mutation through a dynamic import namespace", familyProbe('const probeConstants = await import("../hk_stop/constants.js"); probeConstants.HK_STOP_DO_ACTIONS.add("probe_dynamic");'), DYNAMIC);
  reject("family mutation through a destructured dynamic import", familyProbe('const { HK_STOP_DO_ACTIONS: probeFamily } = await import("../hk_stop/constants.js"); probeFamily.add("probe_dynamic");'), DYNAMIC);
  reject("family mutation through an exported namespace import", familyProbe('import { probeNs } from "../hk_stop/probe_barrel.js"; probeNs.HK_STOP_DO_ACTIONS.add("probe_dynamic");',
    { "probe_barrel.js": 'import * as probeNs from "./constants.js"; export { probeNs };' }),
  /module graph: family_mutation: namespace probeNs of .*hk_stop\/constants\.js, which exports HK_STOP_DO_ACTIONS, is re-exported as probeNs in .*probe_barrel\.js/);
  reject("family mutation through an exported namespace import of a chained barrel", familyProbe('import { probeNs } from "../hk_stop/probe_outer.js"; probeNs.HK_STOP_DO_ACTIONS.add("probe_chain");', {
    "probe_star.js": 'export * from "./constants.js";\n',
    "probe_inner.js": 'import * as probeNs from "./probe_star.js";\nexport { probeNs as probeNs };\n',
    "probe_outer.js": 'export { probeNs } from "./probe_inner.js";\n',
  }), /module graph: family_mutation: namespace probeNs of .*hk_stop\/probe_star\.js, which exports HK_STOP_DO_ACTIONS, is re-exported as probeNs in .*probe_inner\.js/);
  reject("family mutation through export * as of a chained barrel", familyProbe('import { probeNs } from "../hk_stop/probe_outer.js"; probeNs.HK_STOP_DO_ACTIONS.add("probe_chain");', {
    "probe_star.js": 'export * from "./constants.js";\n',
    "probe_outer.js": 'export * as probeNs from "./probe_star.js";\n',
  }), /module graph: entry_replaced: export \* as probeNs re-exports dispatch bindings of .*hk_stop\/probe_star\.js/);
  const PERF_IMPORT = 'import { performanceResponse } from "./application/console_api/performance_routes.js";';
  reject("forward target replaced by a same-named local wrapper", edit("worker.js", PERF_IMPORT, 'import { performanceResponse as originalPerformanceResponse } from "./application/console_api/performance_routes.js";\nfunction performanceResponse(r,e,d) { if (r.url.endsWith("/api/performance/probe-unclassified")) return new Response("probe-target"); return originalPerformanceResponse(r,e,d); }'),
    /worker\.js fetch: forward_target: performanceResponse in a reviewed forward resolves to local, reviewed import:\.\/application\/console_api\/performance_routes\.js/);
  const otherTarget = new Map(edit("worker.js", PERF_IMPORT, 'import { performanceResponse } from "./application/console_api/probe_performance.js";'));
  otherTarget.set(`${CONSOLE}/application/console_api/probe_performance.js`, 'export function performanceResponse() { return new Response("probe-target"); }\n');
  reject("forward target imported from another module", otherTarget,
    /worker\.js fetch: forward_target: performanceResponse in a reviewed forward resolves to import:\.\/application\/console_api\/probe_performance\.js, reviewed import:\.\/application\/console_api\/performance_routes\.js/);
  reject("forward dependency replaced by a same-named local wrapper", applyEdits(sources, [
    { file: "worker.js", from: "\n  readBoundAccountExecutions,\n", to: "\n" },
    { file: "worker.js", from: "export default {", to: 'const readBoundAccountExecutions = async () => new Response("probe-target");\nexport default {' }]),
  /worker\.js fetch: forward_target: readBoundAccountExecutions in a reviewed forward resolves to local, reviewed namespace:/);
  reject("forward dependency redeclared at module level", edit("worker.js", "export default {", 'const readBoundAccountExecutions = async () => new Response("probe-target");\nexport default {'),
    /worker\.js fetch: forward_target: readBoundAccountExecutions in a reviewed forward resolves to an unadmitted binding, reviewed namespace:/);

  // Catch bodies (review F2.4): the whole clause is the reviewed template.
  reject("error-derived dispatch in the DO catch", edit(DO_FILE, "    } catch (error) {\n      return json({ ok: false, error: error instanceof HttpError", '    } catch (error) {\n      if (error.message === "method_not_allowed") return new Response("probe-catch");\n      return json({ ok: false, error: error instanceof HttpError'),
    /RuntimeInstances\.fetch: statement: catch clause is not the reviewed error response: catch \(error\) \{ if \(error\.message/);
  reject("error-derived dispatch in the Worker catch", edit("worker.js", "    } catch (error) {\n      const directoryError", '    } catch (error) {\n      if (error.message === "method_not_allowed") return new Response("probe-catch");\n      const directoryError'),
    /worker\.js fetch: statement: catch clause is not the reviewed error response: catch \(error\) \{ if \(error\.message/);

  // Nested, switch and conditional dispatch; preamble, catch and fallthrough
  // injection (the round-one committed probes are replayed here).
  reject("Worker nested route inside a branch", edit("worker.js", 'if (url.pathname.startsWith("/api/performance/")) {', 'if (url.pathname.startsWith("/api/performance/")) {\n        if (url.pathname === "/api/performance/probe") return new Response("probe");'), /nested_pathname: unreviewed url\.pathname use/);
  reject("Worker else-branch dispatch", beforeRoot('if (url.pathname === "/api/probe-a") return new Response("a");\n      else if (url.pathname === "/api/probe-b") return new Response("b");'), /else_dispatch: else-branch dispatch is not admitted/);
  reject("Worker switch dispatch", beforeRoot('switch (url.pathname) { case "/api/probe": return new Response("probe"); }'), /statement: route dispatch must be a top-level if-branch; not admitted: switch/);
  reject("Worker logical dispatch", beforeRoot('if (request.method === "GET") return probeAll(url.pathname);'), /route_condition: top-level branch does not test url\.pathname/);
  reject("Worker unadmitted condition form", beforeRoot('if (url.pathname.endsWith("/probe")) return new Response("probe");'), /route_condition: condition form not admitted/);
  reject("Worker expression statement", beforeRoot('url.pathname === "/api/probe" && probe();'), /statement: route dispatch must be a top-level if-branch; not admitted: url\.pathname/);
  reject("Worker nested if consequent", beforeRoot('if (url.pathname.startsWith("/api/probe")) if (request.method === "GET") return new Response("probe");'), /statement: nested dispatch statement in branch/);
  reject("Worker dispatch before try", edit("worker.js", "    const url = new URL(request.url);\n    try {", '    const url = new URL(request.url);\n    if (url.pathname === "/api/probe") return new Response("probe");\n    try {'), /statement: fetch must be/);
  reject("Worker statement after fallthrough", edit("worker.js", '      return json({ ok: false, error: "not_found" }, 404);\n    } catch', '      return json({ ok: false, error: "not_found" }, 404);\n      if (url.pathname === "/api/probe") return new Response("probe");\n    } catch'), /statement: statement after the final fallthrough/);
  reject("Worker catch injection", edit("worker.js", "    } catch (error) {\n      const directoryError", '    } catch (error) {\n      if (url.pathname === "/api/probe") return new Response("probe");\n      const directoryError'), /statement: catch clause is not the reviewed error response: catch \(error\) \{ if \(url\.pathname/);
  reject("DO switch on action", beforeHk('switch (command.action) { case "probe_read": return json({}); }'), /dispatch_form: command\.action read outside a recognised dispatch form/);
  discover("DO conditional dispatch in a gated body", inHk('if (command.kind) return command.action === "probe_read" ? json({ probe: true }) : json({});'), UNCLASSIFIED_READ);
  discover("DO else-if added to the transaction chain", edit(DO_FILE, '          } else if (command.action === "sync_defaults") {', '          } else if (command.action === "probe_write") {\n            changed = false;\n          } else if (command.action === "sync_defaults") {'), /^unclassified internal operation action:instance_state:probe_write$/);
  reject("DO nested family dispatch", inHk('if (HK_STOP_DO_ACTIONS.has(command.action)) return json({});'), /dispatch_form: nested family dispatch is not admitted/);
  reject("DO preamble injection", edit(DO_FILE, "      if (new URL(request.url).pathname === DIRECTORY_PATH) {", '      if (request.headers.get("x-probe")) return json({ probe: true });\n      if (new URL(request.url).pathname === DIRECTORY_PATH) {'), /statement: dispatch-level statement not admitted: if \(request\.headers/);
  reject("DO other receiver field", beforeHk('if (request.body?.action === "probe_read") return json({});'), /statement: dispatch-level statement not admitted: if \(request\.body\?\.action/);
  reject("DO payload-field dispatch at the transaction level", edit(DO_FILE, "        const ts = new Date().toISOString();", '        if (command.mode === "probe") return this.response(state);\n        const ts = new Date().toISOString();'), /RuntimeInstances transaction: statement: dispatch-level statement not admitted/);
  reject("DO catch injection", edit(DO_FILE, "    } catch (error) {\n      return json({ ok: false, error: error instanceof HttpError", '    } catch (error) {\n      if (request.method === "PUT") return json({ probe: true });\n      return json({ ok: false, error: error instanceof HttpError'), /statement: catch clause is not the reviewed error response: catch \(error\) \{ if \(request\.method/);
  reject("DO statement after the fallthrough", edit(DO_FILE, "        return this.response(state);\n      }));\n", '        return this.response(state);\n      }));\n      if (command.action === "probe_read") return json({});\n'), /statement: statement after the final fallthrough/);
  reject("DO new path form", beforeGet('if (new URL(request.url).pathname === "/probe") return json({});'), /statement: dispatch-level statement not admitted/);
  reject("ux1 switch on action", edit(DO_FILE, '      const login = String(command?.login || "");', '      switch (command.action) { case "ux1_probe": return { probe: true }; }\n      const login = String(command?.login || "");'), /^ux1ResearchCommand: dispatch_form/);
  discover("ux1 new action", edit(DO_FILE, '      if (command.action === "ux1_read") return found;', '      if (command.action === "ux1_probe") return found;\n      if (command.action === "ux1_read") return found;'), /^unclassified internal operation action:ux1_probe$/);
  reject("ux1 action outside its prefix", edit(DO_FILE, '      if (command.action === "ux1_read") return found;', '      if (command.action === "probe_read") return found;\n      if (command.action === "ux1_read") return found;'), /prefix_mismatch: prefix family ux1_ dispatches probe_read/);
  reject("rotation alternate form", edit("secretRotation.js", "  if (c.action === 'rotation_denied')", "  if (['rotation_probe'].includes(c.action)) return { probe: true };\n  if (c.action === 'rotation_denied')"), /^rotationCommand: dispatch_form: list dispatch is not admitted/);
  discover("rotation new action", edit("secretRotation.js", "  if (c.action === 'rotation_denied')", "  if (c.action === 'rotation_probe') return { probe: true };\n  if (c.action === 'rotation_denied')"), /^unclassified internal operation action:rotation_probe$/);
  reject("rotation delegate statement", edit("secretRotation.js", "  let factors = [];", "  let factors = [];\n  if (command.mode) return { probe: true };"), /^durableRotationCommand: statement: dispatch-level statement not admitted/);
  reject("directory alternate form", edit("kv_directory.js", '    if (command.action === "cache") {', '    if (["probe"].includes(command.action)) return { probe: true };\n    if (command.action === "cache") {'), /^KvDirectory\.run: dispatch_form: list dispatch is not admitted/);
  discover("directory new action", edit("kv_directory.js", '    if (command.action === "cache") {', '    if (command.action === "probe") return { probe: true };\n    if (command.action === "cache") {'), /^unclassified internal operation action:directory:probe$/);
  reject("directory preamble statement", edit("kv_directory.js", '    if (command.action === "cache") {', '    await this.storage.get("probe");\n    if (command.action === "cache") {'), /^KvDirectory\.run: statement: dispatch-level statement not admitted/);

  // Families, prefixes and entries.
  const HK_FAMILY = 'export const HK_STOP_DO_ACTIONS = new Set(["hk_stop_claim", "hk_stop_record", "hk_stop_read", "hk_stop_accept_result"]);';
  discover("family addition", edit("application/hk_stop/constants.js", HK_FAMILY, HK_FAMILY.replace('"hk_stop_accept_result"', '"hk_stop_accept_result", "hk_stop_probe"')), /^unclassified internal operation action:hk_stop_probe$/);
  discover("family deletion", edit("application/hk_stop/constants.js", HK_FAMILY, HK_FAMILY.replace('"hk_stop_read", ', "")), /^stale internal operation action:hk_stop_read/);
  reject("dynamic family membership", edit("application/hk_stop/constants.js", HK_FAMILY, HK_FAMILY.replace("new Set([", "new Set([...PROBE_ACTIONS, ")), /family_dynamic: HK_STOP_DO_ACTIONS/);
  reject("non-literal family", edit("application/hk_stop/constants.js", HK_FAMILY, "export const HK_STOP_DO_ACTIONS = probeFamily();"), /family_dynamic: HK_STOP_DO_ACTIONS/);
  reject("family mutation", edit("application/hk_stop/constants.js", HK_FAMILY, `${HK_FAMILY}\nHK_STOP_DO_ACTIONS.add("hk_stop_probe");`), /family_mutation: HK_STOP_DO_ACTIONS used other than \.has\(\)/);
  reject("family mutation in another module", edit("application/worker/runtime_support.js", "export const ACCOUNT_FACTS_DO_ACTIONS = new Set([", 'export const PROBE_MUTATION = () => HK_STOP_DO_ACTIONS.delete("hk_stop_read");\nexport const ACCOUNT_FACTS_DO_ACTIONS = new Set(['), /family_mutation: HK_STOP_DO_ACTIONS used other than \.has\(\)/);
  reject("unknown family", beforeHk("if (PROBE_DO_ACTIONS.has(command?.action)) {}"), /family_unknown: unknown action family PROBE_DO_ACTIONS/);
  reject("unknown prefix", beforeHk('if (typeof command?.action === "string" && command.action.startsWith("probe_")) return json({});'), /prefix_unknown: unknown action prefix probe_/);
  reject("unknown path delegate", beforeGet("if (new URL(request.url).pathname === PROBE_PATH) return json({});"), /prefix_unknown: unknown path delegate PROBE_PATH/);
  reject("altered prefix delegate", edit(DO_FILE, "return json(this.ux1ResearchCommand(command));", "return json(this.probeCommand(command));"), /delegate: ux1_ branch is not the reviewed delegate/);
  discover("new DO method", beforeGet('if (request.method === "PUT") return json({ probe: true });'), /^unclassified internal operation action:instance_state:PUT$/);
  discover("new Worker entry", edit("worker.js", "export default {", "export default {\n  async queue(batch, env) {},"), /^unclassified internal operation worker:queue$/);
  reject("new Durable Object entry", edit(DO_FILE, "  async alarm() { await this.deskReadbacks.alarm(); }", "  async alarm() { await this.deskReadbacks.alarm(); }\n  async webSocketMessage(socket, message) {}"), /entry_unsupported: RuntimeInstances\.webSocketMessage/);

  // Malformed source, duplicate or replaced entries.
  reject("unbalanced Worker source", beforeRoot('if (url.pathname === "/api/probe") { return new Response("probe");'), /parse_error/);
  reject("unbalanced Durable Object source", beforeHk('if (command.action === "probe_read") {'), /parse_error/);
  reject("TypeScript-only syntax", beforeHk('const probe: string = "x";'), /parse_error/);
  reject("duplicate Worker entry", edit("worker.js", "export default {", 'export default {\n  async fetch(request, env, ctx) { return new Response("probe"); },'), /entry_duplicate: fetch/);
  reject("non-method Worker export member", edit("worker.js", "export default {", "export default {\n  ...probeHandlers,"), /export_form: member form not admitted: \.\.\.probeHandlers/);
  reject("duplicate Durable Object entry", edit(DO_FILE, "  async alarm() { await this.deskReadbacks.alarm(); }", "  async alarm() { await this.deskReadbacks.alarm(); }\n  async alarm() {}"), /entry_duplicate: RuntimeInstances\.alarm/);
  reject("replaced Durable Object entry", edit(DO_FILE, "  async alarm() { await this.deskReadbacks.alarm(); }", '  async alarm() { await this.deskReadbacks.alarm(); }\n  static { RuntimeInstances.prototype.fetch = async () => new Response("probe"); }'), /entry_replaced: static member of RuntimeInstances is not admitted/);
  reject("duplicate route condition", beforeRoot('if (url.pathname === "/") return new Response("probe");'), /entry_duplicate: duplicate route condition/);
  reject("reassigned rotation dispatcher", edit("secretRotation.js", "export async function durableRotationCommand(", "rotationCommand = () => ({ probe: true });\nexport async function durableRotationCommand("), /entry_replaced: rotationCommand is reassigned/);

  // Inert text and formatting (FIX2 probes 3, 8, 9): identical sets.
  pass("comment-only action", beforeHk('// if (command.action === "probe_comment_only") return json({});'));
  pass("action text in a string", beforeHk('const probeNote = "if (command.action === \\"probe_string_only\\") request[\\"method\\"]";'));
  pass("action text in a plain template", beforeHk('const probeTemplate = `if (command.action === "probe_template") request["method"]`;'));
  pass("action text in a regex", beforeHk('const probeRegex = /command\\.action === "probe_regex"|request\\[method\\]/;'));
  pass("action text in a gated body", inHk('const probeNote = "command.action === \'probe_gated\'"; const probeRegex = /url\\.pathname/;'));
  pass("route text in a Worker comment", edit("worker.js", 'if (url.pathname === "/api/session") return', '// if (url.pathname === "/api/probe-comment") return probe();\n      if (url.pathname === "/api/session") return'));
  pass("comments and parentheses around a family gate", edit(DO_FILE, HK_BRANCH, "if ((/* family */ HK_STOP_DO_ACTIONS.has( (command?.action) /* gate */ ))) {"));
  pass("reformatted route condition", edit("worker.js", 'if (url.pathname === "/api/session") return', "if ((url.pathname\n        === '/api/session')) return"));
  pass("quote style in rotationCommand", edit("secretRotation.js", "  if (c.action === 'rotation_denied')", '  if (c.action === "rotation_denied")'));
  pass("doubled indentation", new Map([...sources].map(([name, text]) => [name, /(?:worker|durable_object|kv_directory|secretRotation)\.js$/.test(name) ? text.replace(/^( +)/gm, "$1$1") : text])));
  expectError(run({ routes: [...registry.PUBLIC_ROUTES, { ...registry.PUBLIC_ROUTES[0], id: "/probe-duplicate", match: "(url.pathname === '/')" }] }), /route \/probe-duplicate: duplicate registry match/, "probe (e) duplicate registry entry");
  outcomes.push(["reject", "duplicate registry entry", "duplicate registry match"]);
  expectError(run({ routes: [...registry.PUBLIC_ROUTES, { id: "/probe-unparsed", match: "url.pathname ===", handler: "probe", effects: { GET: "observation" }, scope: "static" }] }), /registry match does not parse/, "probe (e) unparsable registry match");

  // The executable injections are live: each runs through the real handler,
  // loaded from a scratch sibling module that is removed afterwards.
  let scratchCount = 0;
  const scratch = async (file, probedSources, use) => {
    const original = join(ROOT, CONSOLE, file);
    const path = join(dirname(original), `.read-contract-probe-${process.pid}-${scratchCount += 1}-${basename(file)}`);
    writeFileSync(path, probedSources.get(`${CONSOLE}/${file}`));
    try { return await use(await import(pathToFileURL(path).href)); } finally { rmSync(path, { force: true }); }
  };
  const fakeSql = { exec: () => ({ toArray: () => [], one: () => null }) };
  const doResponse = (probedSources, request) => scratch(DO_FILE, probedSources, async ({ RuntimeInstances }) => {
    const response = await Object.create(RuntimeInstances.prototype).fetch(request);
    return [response.status, await response.json()];
  });
  const post = body => new Request("https://runtime-instances.invalid/", { method: "POST", body: JSON.stringify(body) });
  const put = () => new Request("https://runtime-instances.invalid/", { method: "PUT" });
  const probe = [200, { probe: true }];
  const worker = await scratch("worker.js", edit("worker.js", ROOT_BRANCH, `    ${PROBE_ROUTE}\n${ROOT_BRANCH}`),
    async module => (await module.default.fetch(new Request("https://console.invalid/api/probe-unclassified"), {}, {})).text());
  assert.equal(worker, "probe", "executable: new Worker route");
  for (const [label, text] of [
    ["comment inside the action member", 'if (command./* dispatch */action === "probe_read") return json({ probe: true });'],
    ["parenthesized action member", 'if ((command.action) === "probe_read") return json({ probe: true });'],
    ["single-quoted action value", "if (command.action === 'probe_read') return json({ probe: true });"],
    ["plain-template action value", "if (command.action === `probe_read`) return json({ probe: true });"],
    ["comparison inside a template interpolation", 'if (`${command.action === "probe_read"}` === "true") return json({ probe: true });'],
    ["(command)[\"act\" + \"ion\"]", 'if ((command)["act" + "ion"] === "probe_read") return json({ probe: true });'],
  ]) assert.deepEqual(await doResponse(beforeHk(text), post({ action: "probe_read" })), probe, `executable: ${label}`);
  for (const [label, text] of [
    ["request[\"method\"]", 'if (request["method"] === "PUT") return json({ probe: true });'],
    ["(request)[\"me\" + \"thod\"]", 'if ((request)["me" + "thod"] === "PUT") return json({ probe: true });'],
    ["new DO method", 'if (request.method === "PUT") return json({ probe: true });'],
  ]) assert.deepEqual(await doResponse(beforeGet(text), put()), probe, `executable: ${label} (PUT before the GET and non-POST checks)`);
  assert.deepEqual(await scratch("secretRotation.js", edit("secretRotation.js", "  if (c.action === 'rotation_denied')", "  if (['rotation_probe'].includes(c.action)) return { probe: true };\n  if (c.action === 'rotation_denied')"),
    module => module.rotationCommand(fakeSql, { action: "rotation_probe" })), { probe: true }, "executable: rotation alternate form");
  assert.deepEqual(await scratch("kv_directory.js", edit("kv_directory.js", '    if (command.action === "cache") {', '    if (["probe"].includes(command.action)) return { probe: true };\n    if (command.action === "cache") {'),
    module => new module.KvDirectory({}, {}).run({ action: "probe" })), { probe: true }, "executable: directory alternate form");
  assert.deepEqual(await scratch(DO_FILE, edit(DO_FILE, '      const login = String(command?.login || "");', '      switch (command.action) { case "ux1_probe": return { probe: true }; }\n      const login = String(command?.login || "");'),
    ({ RuntimeInstances }) => Object.assign(Object.create(RuntimeInstances.prototype), { storage: { transactionSync: fn => fn() }, sql: fakeSql }).ux1ResearchCommand({ action: "ux1_probe" })), { probe: true }, "executable: ux1 switch");

  // The suite's own exit: a child run over in-memory edits exits nonzero for a
  // discovered and a rejected injection, and zero for an inert control.
  if (!process.env[PROBE_ENV]) {
    for (const [label, edits, status] of [
      ["discover", [{ file: DO_FILE, from: HK_BRANCH, to: `if (command./* dispatch */action === "probe_read") return json({ probe: true });\n      ${HK_BRANCH}` }], 1],
      ["reject", [{ file: DO_FILE, from: GET_BRANCH, to: `if ((request)["me" + "thod"] === "PUT") return json({ probe: true });\n      ${GET_BRANCH}` }], 1],
      ["pass", [{ file: DO_FILE, from: HK_BRANCH, to: `// if (command.action === "probe_comment_only") return json({});\n      ${HK_BRANCH}` }], 0],
    ]) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, [PROBE_ENV]: JSON.stringify(edits) }, encoding: "utf8" });
      assert.equal(child.status === 0 ? 0 : 1, status, `full-suite exit for the ${label} child: ${child.status}\n${child.stderr.slice(0, 2000)}`);
      outcomes.push([`suite exit ${child.status}`, `child run (${label})`, ""]);
    }
  }
  if (process.argv.includes("--print-probes")) for (const [outcome, label, detail] of outcomes) console.log(`${outcome}\t${label}\t${detail}`);
  console.log(`read contract probe matrix: ${outcomes.filter(([o]) => o === "discover").length} discover, ${outcomes.filter(([o]) => o === "reject").length} reject, ${outcomes.filter(([o]) => o === "pass").length} pass`);

  // (f) Indirect exception edges stay attributed and anchored (review F3).
  const edges = overrides => checkIndirectEdges({ sources, surface, register, operations: result.operations, ...overrides });
  const withoutB1 = clone(register);
  withoutB1.exceptions.find(entry => entry.id === "B1").reachable_operations = withoutB1.exceptions.find(entry => entry.id === "B1").reachable_operations.filter(op => op !== "route:/api/admin/config#GET");
  const routesWithoutB1 = registry.PUBLIC_ROUTES.map(route => route.handler === "adminConfigResponse" ? { ...route, effects: { GET: "B0" } } : route);
  const consistentRemoval = validate({ ...baseline, routes: routesWithoutB1, register: withoutB1 });
  assert.deepEqual(consistentRemoval.errors.filter(error => /exception B1/.test(error)), [], "a consistent registry+register removal passes the two-way check alone");
  expectError(edges({ register: withoutB1, operations: consistentRemoval.operations }), /^edge B1 route:\/api\/admin\/config#GET: the code reaches the exception/, "probe (f) consistent B1 removal");
  for (const [id, op] of [["B3", "route:console api group#GET"], ["B1", "action:desk_readback_fresh"]]) {
    const ops = new Map(result.operations);
    ops.set(op, { ...ops.get(op), effects: ops.get(op).effects.filter(effect => effect !== id) });
    expectError(edges({ operations: ops }), new RegExp(`^edge ${id} .*${op.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`), `probe (f) ${id} ${op}`);
  }
  const withoutSync = clone(register);
  const i2 = withoutSync.exceptions.find(entry => entry.id === "I2");
  i2.reachable_operations = i2.reachable_operations.filter(op => op !== "route:/api/runtime-daily/sync#POST");
  expectError(edges({ register: withoutSync }), /^edge I2 route:\/api\/runtime-daily\/sync#POST/, "probe (f) I2 sync");
  for (const [file, from, pattern] of [
    ["application/runtime_instances/durable_object.js", "this.readAccountSettings({ platform: target.platform, key: target.key", /^edge B1 .*anchor gone/],
    ["application/worker/runtime_support.js", "loadRiskProfileBindings(env);\n  const runtimeInstances", /^edge B1 route:\/api\/admin\/config#GET: anchor gone/],
    ["worker.js", "runControls: consoleRunControls", /^edge B[13] route:console api group#GET: anchor gone/],
    ["application/worker/runtime_support.js", "? () => readPlatformRuntimeControl(env, account.platform, account.target_name)", /^edge B3 .*anchor gone/],
    ["application/desk/overview.js", "deps.runtimeDay(request, env, configuredAccounts(config.value), businessDate)", /^edge I2 .*overview.*anchor gone/],
  ]) {
    const probedSources = edit(file, from, `probeRemoved${from.length}`);
    const probedSurface = file === "worker.js" ? extracted(probedSources) : surface;
    expectError(edges({ sources: probedSources, surface: probedSurface }), pattern, `probe (f) anchor ${file}`);
  }
}

console.log(`read contract boundaries: ${surface.routes.size} route branches, ${surface.internal.size} internal operations, ${register.exceptions.length} exceptions; ok`);
