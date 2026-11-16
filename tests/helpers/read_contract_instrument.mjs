// Writer-entry instrumentation and the temporary module graph G for the
// bounded executable read contract (ADR 0002; see the acceptance statement in
// `tests/read_contract_boundaries_validation.mjs`).
//
// W is the finite list of registered callables in
// `tests/fixtures/read-contract-runtime-manifest.json`. Each entry is located
// by its declaration in the original file from the exception register, and
// the source text is transformed before any module is evaluated:
//
// - a function or method with simple parameters gets `__rcEnter(id)` as the
//   first statement of its body;
// - a function or method whose trailing parameters have defaults, patterns or
//   a rest element keeps its leading simple parameters (so `length` is
//   unchanged), collects the rest with `...__rcRest`, and destructures them
//   after the entry call, so no parameter expression runs before the entry;
// - a base-class constructor gets a first private field initializer
//   `#__rcEntry = __rcEnter(id)`, which runs before every other field
//   initializer, parameter expression and the constructor body.
//
// Every other callable kind (generators, accessors, arrows, derived-class
// constructors) and every parameter list whose rewrite could change scoping
// fails coverage instead of being instrumented approximately. A missing or
// ambiguous declaration fails as well, so W never shrinks silently.
//
// A copied body is a new callable. A declaration elsewhere in the graph whose
// body text equals a W entry's original body is a fixture clone: it is
// instrumented with the same identity and its clone provenance, and each case
// declares how many clones it carries; a different count fails the case.
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const MARK = "__rcEnter";
export const REST = "__rcRest";
export const FIELD = "#__rcEntry";
export const KINDS = new Set(["function", "method", "constructor"]);

export class CoverageError extends Error {}

export const sha256 = text => createHash("sha256").update(text).digest("hex");

function parse(ts, file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (sf.parseDiagnostics?.length) throw new CoverageError(`${file}: does not parse: ${ts.flattenDiagnosticMessageText(sf.parseDiagnostics[0].messageText, " ")}`);
  return sf;
}

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

/** The declaration of one W entry in its file; exactly one, of a supported kind. */
export function locateEntry(ts, sf, entry) {
  const where = `${entry.id} (${entry.file})`;
  if (!KINDS.has(entry.kind)) throw new CoverageError(`${where}: unsupported entry kind ${entry.kind}`);
  if (entry.kind === "function") {
    const found = sf.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === entry.symbol);
    if (found.length !== 1) throw new CoverageError(`${where}: ${found.length ? "ambiguous" : "missing"} top-level function ${entry.symbol}`);
    const [node] = found;
    if (node.asteriskToken) throw new CoverageError(`${where}: generator functions are not instrumented; entry would be deferred to the first next()`);
    if (!node.body) throw new CoverageError(`${where}: declaration without a body`);
    return { node, body: node.body };
  }
  const classes = sf.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === entry.class);
  if (classes.length !== 1) throw new CoverageError(`${where}: ${classes.length ? "ambiguous" : "missing"} top-level class ${entry.class}`);
  const [klass] = classes;
  if (entry.kind === "constructor") {
    if (klass.heritageClauses?.length) throw new CoverageError(`${where}: derived-class constructors are not instrumented; fields would run after super()`);
    if (klass.members.filter(ts.isConstructorDeclaration).length > 1) throw new CoverageError(`${where}: ambiguous constructor`);
    return { node: klass, klass, body: klass.members.find(ts.isConstructorDeclaration)?.body ?? null };
  }
  const members = klass.members.filter(member => member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) && member.name.text === entry.name);
  if (members.length !== 1) throw new CoverageError(`${where}: ${members.length ? "ambiguous" : "missing"} member ${entry.class}.${entry.name}`);
  const [node] = members;
  if (!ts.isMethodDeclaration(node)) throw new CoverageError(`${where}: ${entry.class}.${entry.name} is not a method; accessors and fields are not instrumented`);
  if (node.asteriskToken) throw new CoverageError(`${where}: generator methods are not instrumented`);
  if (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Static) throw new CoverageError(`${where}: static methods are not W entries`);
  if (!node.body) throw new CoverageError(`${where}: method without a body`);
  return { node, body: node.body };
}

/** Names declared in a function body's own scope (var anywhere, top-level lexical and function declarations). */
function bodyNames(ts, body) {
  const names = new Set();
  const bind = name => {
    if (ts.isIdentifier(name)) names.add(name.text);
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bind(element.name);
  };
  const visit = (node, top) => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) {
      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && top) names.add(node.name.text);
      return;
    }
    if (ts.isVariableDeclarationList(node)) {
      const lexical = node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const);
      if (!lexical || top) for (const declaration of node.declarations) bind(declaration.name);
    }
    ts.forEachChild(node, child => visit(child, top && (ts.isVariableStatement(node) || ts.isVariableDeclarationList(node))));
  };
  for (const statement of body.statements) visit(statement, true);
  return names;
}

/** Text edits that put the entry call before every parameter expression and the body. */
function entryEdits(ts, sf, fn, body, call, where) {
  const params = [...fn.parameters];
  const simple = param => ts.isIdentifier(param.name) && !param.initializer && !param.dotDotDotToken;
  const first = params.findIndex(param => !simple(param));
  const open = body.getStart(sf) + 1;
  if (first < 0) return [{ pos: open, end: open, text: ` ${call};` }];
  const rest = params.slice(first);
  const names = [];
  const bind = name => {
    if (ts.isIdentifier(name)) names.push(name.text);
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bind(element.name);
  };
  for (const param of params) bind(param.name);
  const declared = bodyNames(ts, body);
  for (const name of names) if (declared.has(name)) throw new CoverageError(`${where}: parameter ${name} is redeclared in the body; the parameter rewrite would merge scopes`);
  // An initializer may not read a binding declared at or after its own
  // position (TDZ in the original), nor a name the body declares.
  const seen = new Set(params.slice(0, first).flatMap(param => [param.name.text]));
  for (const param of rest) {
    const own = [];
    const bindOwn = name => { if (ts.isIdentifier(name)) own.push(name.text); else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindOwn(element.name); };
    bindOwn(param.name);
    const later = new Set(names.filter(name => !seen.has(name)));
    const check = node => {
      if (ts.isIdentifier(node) && (later.has(node.text) || declared.has(node.text)) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
        && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node) && !(ts.isBindingElement(node.parent) && node.parent.propertyName === node)
        && !(ts.isBindingElement(node.parent) && node.parent.name === node)) {
        throw new CoverageError(`${where}: parameter expression reads ${node.text}, which the rewrite would resolve differently`);
      }
      ts.forEachChild(node, check);
    };
    check(param);
    for (const name of own) seen.add(name);
  }
  const start = rest[0].getStart(sf);
  const end = rest.at(-1).end;
  return [
    { pos: start, end, text: `...${REST}` },
    { pos: open, end: open, text: ` ${call}; var [${sf.text.slice(start, end)}] = ${REST};` },
  ];
}

const callText = (id, site) => (site === "original" ? `${MARK}(${JSON.stringify(id)})` : `${MARK}(${JSON.stringify(id)}, ${JSON.stringify(site)})`);

/** Every function-like with a block body, for clone detection. */
function functionsWithBodies(ts, sf) {
  const out = [];
  const visit = node => {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
      || ts.isArrowFunction(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.body && ts.isBlock(node.body)) out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * Locate every W entry in the original sources and record the body text that
 * identifies its clones. Throws CoverageError when any entry is missing,
 * ambiguous or of an unsupported kind.
 */
export function anchorEntries(ts, sources, entries) {
  const anchors = new Map();
  for (const entry of entries) {
    const text = sources.get(entry.file);
    if (text === undefined) throw new CoverageError(`${entry.id}: file ${entry.file} is not in the source graph`);
    const sf = parse(ts, entry.file, text);
    const { node, body } = locateEntry(ts, sf, entry);
    anchors.set(entry.id, { entry, line: lineOf(sf, node), body: body ? body.getText(sf) : null });
  }
  return anchors;
}

/**
 * Instrument one file: W declarations it holds and every clone of a W body.
 * Returns the new text and the markers inserted, or the original text when
 * the file holds neither.
 */
export function instrumentFile(ts, file, text, entries, anchors, monitorUrl) {
  const own = entries.filter(entry => entry.file === file);
  const bodies = [...anchors.values()].filter(anchor => anchor.body && anchor.entry.kind !== "constructor");
  if (!own.length && !bodies.some(anchor => text.includes(anchor.body))) return { text, markers: [] };
  for (const reserved of [MARK, REST, FIELD.slice(1)]) if (text.includes(reserved)) throw new CoverageError(`${file}: reserved instrumentation name ${reserved} already appears`);
  if (text.startsWith("#!")) throw new CoverageError(`${file}: hashbang modules are not instrumented`);
  const sf = parse(ts, file, text);
  const edits = [];
  const markers = [];
  const anchored = new Set();
  for (const entry of own) {
    const where = `${entry.id} (${file})`;
    const { node, klass } = locateEntry(ts, sf, entry);
    anchored.add(node);
    const call = callText(entry.id, "original");
    if (entry.kind === "constructor") {
      const open = text.indexOf("{", klass.name.end);
      edits.push({ pos: open + 1, end: open + 1, text: ` ${FIELD} = ${call};` });
      anchored.add(klass.members.find(ts.isConstructorDeclaration));
    } else {
      edits.push(...entryEdits(ts, sf, node, node.body, call, where));
    }
    markers.push({ id: entry.id, site: "original", line: lineOf(sf, node) });
  }
  for (const fn of functionsWithBodies(ts, sf)) {
    if (anchored.has(fn)) continue;
    const bodyText = fn.body.getText(sf);
    const anchor = bodies.find(candidate => candidate.body === bodyText);
    if (!anchor) continue;
    // Provenance is the file, not the line, so an unrelated edit does not
    // change the expected identity.
    const site = `clone:${file.split("/").pop()}`;
    if (fn.asteriskToken || ts.isGetAccessorDeclaration(fn) || ts.isSetAccessorDeclaration(fn)) throw new CoverageError(`${anchor.entry.id}: clone at ${site} is a callable kind the transformer does not instrument`);
    edits.push(...entryEdits(ts, sf, fn, fn.body, callText(anchor.entry.id, site), `${anchor.entry.id} clone ${site}`));
    markers.push({ id: anchor.entry.id, site, line: lineOf(sf, fn) });
  }
  if (!markers.length) return { text, markers };
  let out = text;
  for (const { pos, end, text: insert } of edits.sort((a, b) => b.pos - a.pos)) out = out.slice(0, pos) + insert + out.slice(end);
  out = `import { enter as ${MARK} } from ${JSON.stringify(monitorUrl)}; ${out}`;
  const check = parse(ts, file, out);
  let count = 0;
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === MARK) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(check);
  if (count !== markers.length) throw new CoverageError(`${file}: ${markers.length} markers planned, ${count} present after instrumentation`);
  return { text: out, markers };
}

/**
 * One coherent temporary source graph, reused sequentially: the console
 * modules (instrumented), the package marker that makes them ES modules,
 * and per case its edited files and pinned synthetic packages.
 */
export class GraphWorkspace {
  constructor(root, baseFiles) {
    this.root = root;
    this.base = new Map(baseFiles);
    this.written = new Map();
    rmSync(root, { recursive: true, force: true });
    for (const [rel, text] of this.base) this.write(rel, text);
  }

  write(rel, text) {
    const path = join(this.root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    this.written.set(rel, sha256(text));
  }

  /** Bring the tree to exactly `files` (relative path to text) and return the graph digest map. */
  prepare(files) {
    for (const rel of [...this.written.keys()]) {
      if (!files.has(rel)) { rmSync(join(this.root, rel), { force: true }); this.written.delete(rel); }
    }
    for (const [rel, text] of files) if (this.written.get(rel) !== sha256(text)) this.write(rel, text);
    return Object.fromEntries([...files].filter(([rel]) => /\.m?js$/.test(rel)).map(([rel, text]) => [join(this.root, rel), sha256(text)]));
  }

  dispose() { rmSync(this.root, { recursive: true, force: true }); }
}
