// Runner for the bounded executable read contract: W (registered writer
// callables), G (the verified instrumented module graph), T (the finite case
// corpus) and B (the frozen completion bounds), all declared in
// `tests/fixtures/read-contract-runtime-manifest.json`. The acceptance
// statement and its accepted limits are in the header of
// `tests/read_contract_boundaries_validation.mjs`.
//
// The parent builds one temporary graph, reused sequentially: every console
// module, instrumented once, plus each case's edited files and pinned
// synthetic packages. Each case runs in a fresh child process
// (`read_contract_child.mjs`) under the case budget; the parent judges it
// from the child's result file only. Static admission (S) is evaluated and
// recorded for every case but never gates its execution, so an adversarial
// case proves the writer-entry latch even where S admits it.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { anchorEntries, CoverageError, GraphWorkspace, instrumentFile } from "./read_contract_instrument.mjs";

const MONITOR = fileURLToPath(new URL("./read_contract_monitor.mjs", import.meta.url));
const CHILD = fileURLToPath(new URL("./read_contract_child.mjs", import.meta.url));
const BOUND_KEYS = ["case_ms", "suite_ms", "max_scheduled_tasks", "max_drain_turns", "max_timer_delay_ms"];
const DETECTIONS = new Set(["none", "writer_latch", "operation_mismatch", "graph_unresolved", "bound_exceeded", "incomplete"]);

/** Apply fixture edits ({ file, from, to } or { file, prepend } / { file, append }) to console-relative files. */
export function applyFixture(tree, consoleDir, fixture) {
  const out = new Map(tree);
  for (const edit of fixture.edits || []) {
    const rel = `${consoleDir}/${edit.file}`;
    let text = out.get(rel);
    if (text === undefined) throw new Error(`fixture edit on a missing file ${edit.file}`);
    if (edit.prepend !== undefined) text = edit.prepend + text;
    else if (edit.append !== undefined) text += edit.append;
    else {
      if (!text.includes(edit.from)) throw new Error(`fixture anchor absent from ${edit.file}: ${edit.from.slice(0, 80)}`);
      text = text.replace(edit.from, edit.to);
    }
    out.set(rel, text);
  }
  for (const [file, text] of Object.entries(fixture.files || {})) out.set(`${consoleDir}/${file}`, text);
  return out;
}

/** Check the manifest's shape and reconcile W with the exception register. */
export function manifestErrors(manifest, register, today) {
  const errors = [];
  if (!Number.isInteger(manifest.version)) errors.push("manifest: version must be an integer");
  for (const key of BOUND_KEYS) if (!Number.isInteger(manifest.bounds?.[key]) || manifest.bounds[key] < 0) errors.push(`manifest: bound ${key} must be a non-negative integer`);
  const symbols = new Map();
  for (const entry of register.exceptions || []) {
    for (const helper of entry.helpers || []) if (helper.symbol) symbols.set(`${helper.file}#${helper.symbol}`, entry.id);
  }
  const ids = new Set();
  const declared = new Set();
  for (const entry of manifest.entries || []) {
    if (ids.has(entry.id)) errors.push(`W: duplicate entry id ${entry.id}`);
    ids.add(entry.id);
    const key = `${entry.file}#${entry.symbol}`;
    declared.add(key);
    if (!symbols.has(key)) errors.push(`W: ${entry.id} names ${key}, which is not a registered symbol helper`);
    else if (symbols.get(key) !== entry.effect) errors.push(`W: ${entry.id} declares effect ${entry.effect}, the register files it under ${symbols.get(key)}`);
    if (!entry.id.startsWith(`${entry.effect}.`)) errors.push(`W: ${entry.id} does not carry its effect prefix`);
  }
  for (const key of symbols.keys()) if (!declared.has(key)) errors.push(`W: registered symbol helper ${key} has no W entry; reconcile the manifest with the register`);
  const caseIds = new Set();
  for (const item of manifest.cases || []) {
    if (caseIds.has(item.id)) errors.push(`T: duplicate case id ${item.id}`);
    caseIds.add(item.id);
    if (!DETECTIONS.has(item.expected?.detection)) errors.push(`T: ${item.id} has no valid expected detection`);
    for (const phase of item.phases || []) {
      if (!["debt", "zero-writer"].includes(phase.mode)) errors.push(`T: ${item.id} phase ${phase.name} has mode ${phase.mode}`);
      if (phase.mode !== "debt") { if (phase.allow?.length || phase.debt?.length) errors.push(`T: ${item.id} zero-writer phase ${phase.name} allows writers`); continue; }
      const effects = new Map((manifest.entries || []).map(entry => [entry.id, entry.effect]));
      for (const id of phase.allow || []) if (!(phase.debt || []).some(debt => debt.exception === effects.get(id))) errors.push(`T: ${item.id} debt phase ${phase.name} allows ${id} without declaring its exception`);
      for (const { exception, operation } of phase.debt || []) {
        const entry = (register.exceptions || []).find(candidate => candidate.id === exception);
        if (!entry) { errors.push(`T: ${item.id} debt ${exception} is not a registered exception`); continue; }
        if (entry.expires_on < today) errors.push(`T: ${item.id} debt ${exception} expired on ${entry.expires_on}`);
        if (operation === "construction") {
          // Cold construction precedes every Durable Object operation; the
          // register attributes it through the helper's call sites in the
          // constructed class's file, or the class itself.
          const { file, class: klass } = manifest.construction;
          for (const id of (phase.allow || []).filter(id => effects.get(id) === exception)) {
            const w = manifest.entries.find(candidate => candidate.id === id);
            const helper = (entry.helpers || []).find(candidate => candidate.symbol === w.symbol && candidate.file === w.file);
            if (!helper || !(w.symbol === klass && w.file === file || Object.hasOwn(helper.sites || {}, file))) errors.push(`T: ${item.id} debt ${id} is not registered as reached from the ${klass} constructor`);
          }
        } else if (!(entry.reachable_operations || []).includes(operation)) errors.push(`T: ${item.id} debt ${exception} does not list operation ${operation}`);
      }
    }
  }
  return errors;
}

const records = path => readFileSync(path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));

/** The observed outcome of one child run, in the manifest's expected shape. */
function observe(lines, item, coverage, staticOutcome, child) {
  const result = lines.find(line => line.t === "result");
  const graph = lines.filter(line => line.t === "graph").map(line => line.kind);
  const violations = lines.filter(line => line.t === "violation");
  const steps = (result?.steps || []).map(({ phase, ...rest }) => rest);
  const complete = lines.some(line => line.t === "complete") && child.status === 0;
  // Bound and harness failures: budget overrun, unsupported facility, residual
  // tracked work, an uncaught error, a driver crash outside a graph failure.
  const failures = [...new Set([
    ...lines.filter(line => ["budget", "unsupported", "residual", "uncaught"].includes(line.t)).map(line => `${line.t}:${line.kind || line.facility || line.name}`),
    ...(graph.length ? [] : lines.filter(line => line.t === "driver_error").map(line => `driver_error:${line.name}`)),
    ...(complete ? [] : [`incomplete:${child.error?.code === "ETIMEDOUT" || child.signal ? "timeout" : `exit ${child.status}`}`]),
  ])];
  const contract = item.operation_contract;
  const mismatch = contract && contract.some(({ step, ...want }) => JSON.stringify(steps[step]) !== JSON.stringify(want));
  return {
    static: staticOutcome.outcome,
    clones: coverage.clones,
    steps,
    writers: lines.filter(line => line.t === "enter").map(({ id, site, phase }) => (site === "original" ? { id, phase } : { id, site, phase })),
    storage: (result?.storage || []).map(({ phase, kind, detail }) => `${phase}:${kind}${detail ? ` ${detail}` : ""}`),
    kv: result?.kv || [],
    unhandled: result?.unhandled || [],
    graph,
    failures,
    detection: !complete ? "incomplete" : graph.length ? "graph_unresolved" : failures.length ? "bound_exceeded" : violations.length ? "writer_latch" : mismatch ? "operation_mismatch" : "none",
    _drained: (result?.phases || []).map(phase => phase.drained),
    _debt_not_entered: (result?.phases || []).flatMap(phase => phase.debt_not_entered),
    _loaded: lines.filter(line => line.t === "load" && line.file).map(line => line.file),
    _builtins: lines.filter(line => line.t === "load" && line.builtin).map(line => line.builtin),
    _elapsed: result?.elapsed_ms ?? null,
  };
}

const COMPARED = ["static", "clones", "steps", "writers", "storage", "kv", "unhandled", "graph", "failures", "detection"];

/**
 * Run every manifest case. `fixtures` maps fixture names to { edits, files,
 * pins }; `staticOutcome(tree)` returns { outcome: "admit" | "reject" }.
 * Returns { errors, rows, totals }; `record` returns observations instead of
 * comparing them (for reviewing a manifest change, never for acceptance).
 */
export function runRuntimeContract({ ts, root, consoleDir, tree, register, manifest, fixtures, staticOutcome, scratch, today, record = false }) {
  const suiteStart = Date.now();
  const errors = manifestErrors(manifest, register, today);
  const { bounds } = manifest;
  const used = new Set(manifest.cases.map(item => item.fixture));
  for (const name of Object.keys(fixtures)) if (!used.has(name)) errors.push(`T: fixture ${name} is defined but no manifest case runs it`);
  for (const name of used) if (!Object.hasOwn(fixtures, name)) errors.push(`T: manifest fixture ${name} is not defined`);
  if (errors.length) return { errors, rows: [] };

  // W anchored in the unmodified snapshot, G's base instrumented once.
  let anchors;
  const base = new Map();
  const baseMarkers = new Map();
  try {
    anchors = anchorEntries(ts, tree, manifest.entries);
    for (const [rel, text] of tree) {
      if (!/\.m?js$/.test(rel)) continue;
      const { text: out, markers } = instrumentFile(ts, rel, text, manifest.entries, anchors, MONITOR);
      base.set(rel, out);
      if (markers.length) baseMarkers.set(rel, markers);
    }
  } catch (error) {
    if (error instanceof CoverageError) return { errors: [`W coverage: ${error.message}`], rows: [] };
    throw error;
  }
  const originals = [...baseMarkers.values()].flat().filter(marker => marker.site === "original");
  if (originals.length !== manifest.entries.length || [...baseMarkers.values()].flat().length !== originals.length) {
    return { errors: [`W coverage: ${originals.length} of ${manifest.entries.length} entries instrumented in the snapshot, ${[...baseMarkers.values()].flat().length - originals.length} unexpected clones`], rows: [] };
  }
  const entryFiles = new Map(manifest.entries.map(entry => [entry.id, entry.file]));
  const packageJson = `${consoleDir}/package.json`;
  base.set(packageJson, readFileSync(join(root, packageJson), "utf8"));
  const workspace = new GraphWorkspace(scratch, base);
  const rows = [];
  const observed = {};
  try {
    for (const item of manifest.cases) {
      const fixture = fixtures[item.fixture];
      const where = `T ${item.id}`;
      const probed = applyFixture(tree, consoleDir, fixture);
      const staticResult = staticOutcome(probed);
      // G for this case: the base with every changed file re-instrumented,
      // and the pinned synthetic packages instrumented like console modules.
      const files = new Map(base);
      const markers = new Map(baseMarkers);
      const pins = {};
      let coverageError = null;
      try {
        const changed = [...probed].filter(([rel, text]) => tree.get(rel) !== text && /\.m?js$/.test(rel));
        for (const [name, pkg] of Object.entries(fixture.pins || {})) {
          for (const [file, text] of Object.entries(pkg.files)) changed.push([`node_modules/${name}/${file}`, text]);
          pins[name] = join(scratch, `node_modules/${name}/${pkg.main}`);
        }
        for (const [rel, text] of changed) {
          if (!/\.m?js$/.test(rel)) { files.set(rel, text); continue; }
          const { text: out, markers: found } = instrumentFile(ts, rel, text, manifest.entries, anchors, MONITOR);
          files.set(rel, out);
          if (found.length) markers.set(rel, found); else markers.delete(rel);
        }
      } catch (error) {
        if (!(error instanceof CoverageError)) throw error;
        coverageError = error.message;
      }
      const all = [...markers.values()].flat();
      const coverage = { originals: all.filter(marker => marker.site === "original").length, clones: all.filter(marker => marker.site !== "original").length };
      if (coverageError || coverage.originals !== manifest.entries.length) {
        errors.push(`${where}: coverage: ${coverageError || `${coverage.originals} of ${manifest.entries.length} W entries instrumented`}`);
        continue;
      }
      const digests = workspace.prepare(files);
      const result = join(scratch, "result.jsonl");
      const specPath = join(scratch, "case.json");
      rmSync(result, { force: true });
      writeFileSync(specPath, JSON.stringify({
        result, bounds, entries: manifest.entries, phases: item.phases, initial_state: item.initial_state || {},
        graph: { root: scratch, console: consoleDir, files: digests, trusted: [MONITOR], pins, builtins: manifest.builtins },
      }));
      const child = spawnSync(process.execPath, [CHILD, specPath], { encoding: "utf8", timeout: bounds.case_ms, killSignal: "SIGKILL" });
      let lines = [];
      try { lines = records(result); } catch { /* no result file: incomplete */ }
      const seen = observe(lines, item, coverage, staticResult, child);
      const loadedW = manifest.entries.filter(entry => seen._loaded.includes(entry.file)).map(entry => entry.id);
      observed[item.id] = Object.fromEntries(COMPARED.map(key => [key, seen[key]]));
      const row = {
        id: item.id, static: seen.static, coverage: `${seen._loaded.length} modules, ${loadedW.length}/${manifest.entries.length} W loaded, ${seen.clones} clones`,
        expected_writers: (item.expected.writers || []).map(writer => writer.id).join(",") || "-", actual_writers: seen.writers.map(writer => writer.id).join(",") || "-",
        detection: seen.detection, storage: seen.storage.length ? seen.storage.join("; ") : "-", deferred: seen._drained.every(Boolean) && seen._drained.length === item.phases.length ? "drained" : `incomplete ${JSON.stringify(seen._drained)}`,
        exit: child.error?.code === "ETIMEDOUT" || child.signal ? `timeout/${child.signal}` : child.status, ms: seen._elapsed,
      };
      rows.push(row);
      if (record) continue;
      // A failure, residual work, a timeout or an incomplete result passes
      // only as the exact declared outcome of a bounds or graph control; a
      // writer, debt or observation case must also drain every phase.
      if (seen._debt_not_entered.length) errors.push(`${where}: declared debt not reproduced: ${seen._debt_not_entered.join(", ")}`);
      if (["none", "writer_latch", "operation_mismatch"].includes(item.expected.detection) && (seen._drained.length !== item.phases.length || !seen._drained.every(Boolean))) errors.push(`${where}: a phase did not drain within its bounds`);
      if (seen.failures.length && JSON.stringify(seen.failures) !== JSON.stringify(item.expected.failures || [])) errors.push(`${where}: harness failure: ${seen.failures.join(", ")}${child.stderr ? `: ${child.stderr.slice(0, 300)}` : ""}`);
      for (const builtin of seen._builtins) if (!manifest.builtins.includes(builtin)) errors.push(`${where}: builtin ${builtin} loaded outside the declared set`);
      for (const writer of item.expected.writers || []) {
        if (!seen._loaded.includes(entryFiles.get(writer.id)) && !writer.site) errors.push(`${where}: expected writer ${writer.id} but its instrumented module was not loaded`);
      }
      for (const key of COMPARED) {
        const want = item.expected[key] ?? (["kv", "unhandled", "graph", "failures", "storage", "writers"].includes(key) ? [] : key === "clones" ? 0 : undefined);
        if (JSON.stringify(seen[key]) !== JSON.stringify(want)) errors.push(`${where}: ${key}: expected ${JSON.stringify(want)}, observed ${JSON.stringify(seen[key])}`);
      }
      if (Date.now() - suiteStart > bounds.suite_ms) { errors.push(`T: whole-suite budget of ${bounds.suite_ms} ms exceeded after ${item.id}`); break; }
    }
  } finally {
    workspace.dispose();
  }
  const ran = new Set(rows.map(row => row.id));
  for (const item of manifest.cases) if (!ran.has(item.id) && !errors.some(error => error.startsWith(`T ${item.id}:`))) errors.push(`T ${item.id}: omitted`);
  return { errors, rows, observed, elapsed_ms: Date.now() - suiteStart };
}

/** Writer copies and other fixture edits for the fix-11 and fix-13 witnesses, as the reviews defined them. */
export function witnessFixtures(sources, consoleDir) {
  const DO = "application/runtime_instances/durable_object.js";
  const text = sources.get(`${consoleDir}/${DO}`);
  const anchor = '    const row = this.sql.exec("SELECT revision, payload FROM instance_state WHERE id = 1").toArray()[0];';
  const start = text.indexOf("  ensureRiskProfileAuthority(legacy) {");
  const method = text.slice(start, text.indexOf("\n  storedRiskBindings", start)).trimEnd();
  const body = method.slice(method.indexOf("{"));
  const key = '["ensureRisk", "ProfileAuthority"].join("")';
  const legacy = '{ state: "valid", bindings: [] }';
  const klass = `\nclass ReviewHost {\n  constructor(sql) { this.sql = sql; this.reveal = {}.valueOf; }\n${method}\n  invoke() { return this.reveal()[${key}](${legacy}); }\n}\n`;
  const proto = "\nclass ReviewHost { constructor(sql) { this.sql = sql; } }\n";
  const readInject = (line, prepend = "") => [...(prepend ? [{ file: DO, prepend }] : []), { file: DO, from: anchor, to: `${anchor}\n${line}` }];
  const protoCall = `    new ReviewHost(this.sql)[${key}](${legacy});`;
  const hookCall = carrier => `    this.pending = ${carrier}[["writeCurrent", "StrategiesCache"].join("")](this.reviewEnv, { synthetic: true }, 1);`;
  const READ_START = "  read() {\n";
  const readEdit = line => ({ file: DO, from: READ_START, to: `${READ_START}    ${line}\n` });
  const disclosed = `this.reviewSelf = function () { return this; };\nthis.reviewSelf()[["ensure", "RiskProfile", "Authority"].join("")](${legacy});`;
  const replacement = 'this.reviewSelf = function () { return this; };\nthis.reviewSelf()[["fet", "ch"].join("")] = async function (reviewRequest) { if (reviewRequest.method === "PATCH") return new Response("synthetic-unregistered-operation"); return new Response("synthetic-fallback"); };';
  const fixtures = {
    "computed-runtime-key": { edits: readInject("    new ReviewHost(this.sql).invoke();", klass.replace("ensureRiskProfileAuthority(legacy)", `[${key}](legacy)`)) },
    "computed-concatenation": { edits: readInject("    new ReviewHost(this.sql).invoke();", klass.replace("ensureRiskProfileAuthority(legacy)", '["ensureRisk" + "ProfileAuthority"](legacy)')) },
    "prototype-aliased-assignment": { edits: readInject(protoCall, `${proto}const reviewPrototype = ReviewHost.prototype;\nreviewPrototype[${key}] = function(legacy) ${body};\n`) },
    "prototype-direct-assignment": { edits: readInject(protoCall, `${proto}ReviewHost.prototype.ensureRiskProfileAuthority = function(legacy) ${body};\n`) },
    "define-property-aliased-runtime": { edits: readInject(protoCall, `${proto}const reviewPrototype = ReviewHost.prototype;\nObject.defineProperty(reviewPrototype, ${key}, { value: function(legacy) ${body} });\n`) },
    "define-property-literal": { edits: readInject(protoCall, `${proto}Object.defineProperty(ReviewHost.prototype, "ensureRiskProfileAuthority", { value: function(legacy) ${body} });\n`) },
    "test-hook-existing-valueof": { edits: readInject(hookCall("__test.valueOf()"), 'import { __test } from "../../worker.js";\n') },
    "non-test-shorthand": { edits: [...readInject(hookCall("reviewCarrier"), 'import { reviewCarrier } from "../worker/runtime_support.js";\n'),
      { file: "application/worker/runtime_support.js", append: "\nexport const reviewCarrier = { writeCurrentStrategiesCache };\n" }] },
    "missing-relative-base": { edits: readInject("    new ReviewChild().invoke(this.sql);", 'import { ReviewBase } from "./review-missing.js";\nclass ReviewChild extends ReviewBase {}\n') },
    "bare-package-base-existing-writer": {
      edits: readInject("    new ReviewChild().invoke(this.sql);", 'import { ReviewBase } from "synthetic-review-base";\nclass ReviewChild extends ReviewBase {}\n'),
      pins: { "synthetic-review-base": { main: "index.js", files: {
        "package.json": `${JSON.stringify({ name: "synthetic-review-base", type: "module", exports: "./index.js" })}\n`,
        "index.js": `import { RuntimeInstances } from "../../${consoleDir}/${DO}";\nexport class ReviewBase { invoke(sql) { return RuntimeInstances.prototype.ensureRiskProfileAuthority.call({sql}, ${legacy}); } }\n`,
      } } },
    },
    "pinned-package-unused": {
      pins: { "synthetic-review-base": { main: "index.js", files: {
        "package.json": `${JSON.stringify({ name: "synthetic-review-base", type: "module", exports: "./index.js" })}\n`,
        "index.js": "export class ReviewBase { invoke() { return null; } }\n",
      } } },
    },
    "graph-unpinned-package": { edits: readInject("    new ReviewChild().invoke(this.sql);", 'import { ReviewBase } from "synthetic-unpinned-base";\nclass ReviewChild extends ReviewBase {}\n') },
    "graph-builtin-rejected": { edits: [{ file: DO, prepend: 'import { readFileSync as reviewRead } from "node:fs";\n' }] },
    "graph-alternate-url": { edits: [{ file: DO, prepend: 'import { binanceDetailCommand as reviewCopy } from "../../binance_detail_archive.js?copy";\n' }] },
    "bounds-task-budget": { edits: [readEdit("const reviewLoop = () => { setTimeout(reviewLoop, 0); setTimeout(reviewLoop, 0); }; reviewLoop();")] },
    "bounds-interval": { edits: [readEdit("setInterval(() => {}, 0);")] },
    "bounds-delayed-timer": { edits: [readEdit("setTimeout(() => {}, 1000);")] },
    "bounds-unsettled-promise": { edits: [readEdit("this.pending = new Promise(() => {});")] },
    "bounds-hang": { edits: [readEdit("for (;;) {}")] },
    "review-nested-instance-return": { edits: [readEdit(disclosed)] },
    "review-nested-instance-return-anchor-preserved": { edits: [{ file: DO, from: `${anchor}\n`, to: `${anchor}\n    ${disclosed}\n` }] },
    "review-nested-instance-entry-replacement": { edits: [readEdit(replacement)] },
  };
  for (const file of ["v2_asset_map.js", "application/read_contracts.js"]) {
    const prefix = file === "v2_asset_map.js" ? "./" : "../";
    fixtures[`skipped-shorthand-${file.replace("/", "-")}`] = { edits: [
      ...readInject(hookCall("reviewCarrier"), `import { reviewCarrier } from "../../${file}";\n`),
      { file, append: `\nimport { writeCurrentStrategiesCache } from "${prefix}application/worker/runtime_support.js";\nexport const reviewCarrier = { writeCurrentStrategiesCache };\n` },
    ] };
  }
  return fixtures;
}

/**
 * Negative controls of W coverage itself: each synthetic declaration or
 * manifest change must fail coverage or reconciliation rather than be
 * instrumented approximately or shrink W. Returns [label, error] pairs whose
 * error is null when the control behaved as required.
 */
export function coverageControls(ts, manifest, register, today) {
  const file = "synthetic/coverage.js";
  const fn = { id: "B9.probe", effect: "B9", symbol: "probe", file, kind: "function" };
  const method = { id: "B9.Probe.probe", effect: "B9", symbol: "probe", file, kind: "method", class: "Probe", name: "probe" };
  const ctor = { id: "B9.Probe.constructor", effect: "B9", symbol: "Probe", file, kind: "constructor", class: "Probe" };
  const rejects = {
    "missing declaration": [fn, "export function other() {}\n"],
    "ambiguous declaration": [fn, "export function probe() {}\nfunction probe() {}\n"],
    "generator function": [fn, "export function* probe() { yield 1; }\n"],
    "accessor member": [method, "export class Probe { get probe() { return 1; } }\n"],
    "generator method": [method, "export class Probe { *probe() { yield 1; } }\n"],
    "static method": [method, "export class Probe { static probe() {} }\n"],
    "derived-class constructor": [ctor, "class Base {}\nexport class Probe extends Base { constructor() { super(); } }\n"],
    "parameter redeclared in the body": [fn, "export function probe(a, b = 1) { var b; return b; }\n"],
    "parameter expression reads a later parameter": [fn, "export function probe(a = b, b = 1) { return a; }\n"],
    "parameter expression reads a body name": [fn, "export function probe(a, b = () => c) { const c = 1; return b; }\n"],
    "reserved instrumentation name": [fn, "export function probe() { return typeof __rcEnter; }\n"],
    "unsupported kind": [{ ...fn, kind: "arrow" }, "export const probe = () => 1;\n"],
  };
  const out = [];
  for (const [label, [entry, text]] of Object.entries(rejects)) {
    let error = `${label}: instrumented instead of failing coverage`;
    try {
      const sources = new Map([[file, text]]);
      const anchors = anchorEntries(ts, sources, [entry]);
      instrumentFile(ts, file, text, [entry], anchors, MONITOR);
    } catch (caught) { if (caught instanceof CoverageError) error = null; else error = `${label}: ${caught.message}`; }
    out.push([`coverage rejects: ${label}`, error]);
  }
  // Supported forms keep the entry first: the rewritten parameter list keeps
  // the leading simple parameters, and the constructor marker is a field.
  const accepted = {
    "function with destructured defaults": [fn, "export async function probe(a, b, { c, d = Date.now } = {}) { return [a, b, c, d]; }\n", /function probe\(a, b, \.\.\.__rcRest\) \{ __rcEnter\("B9\.probe"\); var \[\{ c, d = Date\.now \} = \{\}\] = __rcRest;/],
    "method with simple parameters": [method, "export class Probe { probe(a) { return a; } }\n", /probe\(a\) \{ __rcEnter\("B9\.Probe\.probe"\); return a;/],
    "base-class constructor": [ctor, "export class Probe { x = 1; constructor(a, b = 2) { this.a = a; } }\n", /class Probe \{ #__rcEntry = __rcEnter\("B9\.Probe\.constructor"\); x = 1;/],
  };
  for (const [label, [entry, text, pattern]] of Object.entries(accepted)) {
    let error = null;
    try {
      const anchors = anchorEntries(ts, new Map([[file, text]]), [entry]);
      const { text: instrumented, markers } = instrumentFile(ts, file, text, [entry], anchors, MONITOR);
      if (markers.length !== 1 || !pattern.test(instrumented)) error = `${label}: unexpected instrumentation ${instrumented.slice(0, 200)}`;
    } catch (caught) { error = `${label}: ${caught.message}`; }
    out.push([`coverage instruments: ${label}`, error]);
  }
  // W reconciles with the register in both directions.
  const dropped = { ...manifest, entries: manifest.entries.slice(1) };
  const extra = { ...manifest, entries: [...manifest.entries, { ...manifest.entries[0], id: "B0.probeExtra", symbol: "probeExtra" }] };
  const moved = { ...manifest, entries: manifest.entries.map((entry, index) => (index ? entry : { ...entry, effect: "B1", id: entry.id.replace(/^B0/, "B1") })) };
  for (const [label, changed, pattern] of [["W entry removed", dropped, /has no W entry/], ["unregistered W entry", extra, /not a registered symbol helper/], ["W entry under another effect", moved, /the register files it under B0/]]) {
    const errors = manifestErrors(changed, register, today);
    out.push([`reconciliation: ${label}`, errors.some(error => pattern.test(error)) ? null : `${label}: expected ${pattern}, got ${JSON.stringify(errors)}`]);
  }
  const expired = structuredClone(register);
  for (const entry of expired.exceptions) entry.expires_on = "2000-01-01";
  out.push(["reconciliation: debt case under an expired exception", manifestErrors(manifest, expired, today).some(error => /debt B1 expired/.test(error)) ? null : "expired debt accepted"]);
  return out;
}
