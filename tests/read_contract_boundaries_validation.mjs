// Read-contract boundary validation (ADR 0002; `.github/engineering.md`,
// "Observation and identity boundaries").
//
// 1. Every public route branch in `worker.js` `fetch` and every internal action
//    dispatched by the RuntimeInstances Durable Object is classified in
//    `web/strategy-switch-console/application/read_contracts.js`, and every
//    registry entry still exists in code. Extraction is token-based and accepts
//    only the reviewed dispatch shapes; any other shape is an error, so a new
//    route or action cannot pass uncounted.
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

// --- Source structure -------------------------------------------------------
//
// Extraction works on tokens, not on indentation or line shape. The tokenizer
// knows strings, template literals, regular expressions and comments, so
// brackets inside them do not count. The dispatch grammar below is closed:
// any form it does not recognise is an extraction error, never a silent skip.

const REGEX_AFTER_WORD = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const PAIRS = { "(": ")", "[": "]", "{": "}" };

/** Tokens with source offsets. Throws on unterminated or unbalanced text. */
function tokenizeJs(source, from = 0, to = source.length) {
  const tokens = [];
  const stack = [];
  let index = from;
  const regexAllowed = () => {
    const last = tokens.at(-1);
    if (!last) return true;
    if (last.type === "word") return REGEX_AFTER_WORD.has(last.value);
    if (last.type !== "punct") return false;
    return ![")", "]", "}"].includes(last.value);
  };
  const skipQuoted = (start, quote) => {
    for (let at = start + 1; at < to; at += 1) {
      if (source[at] === "\\") at += 1;
      else if (source[at] === quote) return at + 1;
      else if (source[at] === "\n") break;
    }
    throw new Error(`unterminated string at offset ${start}`);
  };
  // `subs`, when given, collects [start, end) of each `${ ... }` substitution's code.
  const skipTemplate = (start, subs) => {
    for (let at = start + 1; at < to; at += 1) {
      if (source[at] === "\\") at += 1;
      else if (source[at] === "`") return at + 1;
      else if (source[at] === "$" && source[at + 1] === "{") {
        const end = substitutionEnd(at + 1);
        subs?.push([at + 2, end - 1]);
        at = end - 1;
      }
    }
    throw new Error(`unterminated template at offset ${start}`);
  };
  // End (exclusive) of a `${ ... }` substitution starting at its `{`.
  const substitutionEnd = open => {
    let depth = 0;
    for (let at = open; at < to;) {
      const ch = source[at];
      if (ch === "'" || ch === '"') { at = skipQuoted(at, ch); continue; }
      if (ch === "`") { at = skipTemplate(at); continue; }
      if (ch === "{") depth += 1;
      else if (ch === "}" && --depth === 0) return at + 1;
      at += 1;
    }
    throw new Error(`unterminated substitution at offset ${open}`);
  };
  while (index < to) {
    const ch = source[index];
    if (/\s/.test(ch)) { index += 1; continue; }
    if (ch === "/" && source[index + 1] === "/") { const end = source.indexOf("\n", index); index = end < 0 || end > to ? to : end; continue; }
    if (ch === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end < 0 || end >= to) throw new Error(`unterminated comment at offset ${index}`);
      index = end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = skipQuoted(index, ch);
      tokens.push({ type: "string", value: source.slice(index + 1, end - 1), start: index, end });
      index = end;
      continue;
    }
    if (ch === "`") {
      const subs = [];
      const end = skipTemplate(index, subs);
      tokens.push({ type: "template", value: source.slice(index, end), start: index, end, subs });
      index = end;
      continue;
    }
    if (ch === "/" && regexAllowed()) {
      let at = index + 1;
      let inClass = false;
      for (; at < to; at += 1) {
        if (source[at] === "\\") at += 1;
        else if (source[at] === "[") inClass = true;
        else if (source[at] === "]") inClass = false;
        else if (source[at] === "/" && !inClass) break;
        else if (source[at] === "\n") throw new Error(`unterminated regex at offset ${index}`);
      }
      at += 1;
      while (/[a-z]/.test(source[at] || "")) at += 1;
      tokens.push({ type: "regex", value: source.slice(index, at), start: index, end: at });
      index = at;
      continue;
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(source.slice(index, Math.min(to, index + 200)))?.[0];
    if (word) { tokens.push({ type: "word", value: word, start: index, end: index + word.length }); index += word.length; continue; }
    const number = /^\d[\w.]*/.exec(source.slice(index, Math.min(to, index + 64)))?.[0];
    if (number) { tokens.push({ type: "number", value: number, start: index, end: index + number.length }); index += number.length; continue; }
    if (PAIRS[ch]) stack.push(PAIRS[ch]);
    else if ([")", "]", "}"].includes(ch) && stack.pop() !== ch) throw new Error(`unbalanced ${ch} at offset ${index}`);
    tokens.push({ type: "punct", value: ch, start: index, end: index + 1 });
    index += 1;
  }
  if (stack.length) throw new Error(`unclosed ${stack.at(-1)} before offset ${to}`);
  return tokens;
}

/** Index of the token closing the bracket token at `open`. */
function closeIndex(tokens, open) {
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    if (PAIRS[tokens[index].value] && tokens[index].type === "punct") depth += 1;
    else if (tokens[index].type === "punct" && [")", "]", "}"].includes(tokens[index].value) && --depth === 0) return index;
  }
  throw new Error("unbalanced brackets");
}

// Whole-file tokens, keyed by source text; probes edit copies, so keys differ.
const fileTokens = new Map();

/**
 * Body of the one function, method or object literal whose header is
 * `signature` (ending in `{`). Returns { text, start, end } with offsets into
 * `source`, or null when the signature is absent. A repeated signature is an
 * error: the extractor would not know which one dispatches.
 */
function blockAfter(source, signature) {
  const first = source.indexOf(signature);
  if (first < 0) return null;
  if (source.indexOf(signature, first + 1) >= 0) throw new Error(`signature occurs more than once: ${signature}`);
  const open = first + signature.length - 1;
  if (!fileTokens.has(source)) fileTokens.set(source, tokenizeJs(source));
  const tokens = fileTokens.get(source);
  const at = tokens.findIndex(token => token.start === open);
  if (at < 0 || tokens[at].value !== "{") throw new Error(`signature does not open a block: ${signature}`);
  const close = closeIndex(tokens, at);
  return { text: source.slice(open + 1, tokens[close].start), start: open + 1, end: tokens[close].start };
}

const collapse = text => text.replace(/\s+/g, " ").trim();
const lineAt = (text, offset) => text.slice(text.lastIndexOf("\n", offset - 1) + 1, (text.indexOf("\n", offset) + 1 || text.length + 1) - 1).trim();

// `url.pathname` uses inside a route branch body, other than the condition.
// These are reviewed: they read the path to serve the already-classified
// branch, they do not dispatch a new route. Any other nested use fails, so a
// route hidden inside another branch cannot pass uncounted.
const REVIEWED_NESTED_PATHNAME = new Map([
  ["const asset = V2_ASSETS[url.pathname];", 1],
  ["const hashedBundle = /^\\/v2\\/assets\\/index-[A-Za-z0-9_-]{8,}\\.(?:js|css)$/.test(url.pathname);", 1],
  ['const today = url.pathname === "/api/runtime/today";', 1],
  ['const rest = url.pathname.slice("/api/decisions/".length);', 1],
  ['return await operationResponse(request, env, url.pathname.slice("/api/operations/".length));', 1],
]);

/**
 * Route branches of the Worker `fetch`. The accepted shape is exactly:
 *
 *   async fetch(request, env, ctx) {
 *     const url = new URL(request.url);
 *     try { <if-branch>* return <not found>; } catch (error) { ... }
 *   }
 *
 * where each if-branch is `if (<condition reading url.pathname>) <statement>`
 * with no `else`. Every other statement shape at dispatch level, any
 * `pathname` that is not `url.pathname`, and any unreviewed nested use fails.
 */
function extractRoutes(worker, nestedReviewed = REVIEWED_NESTED_PATHNAME) {
  const errors = [];
  const routes = new Map();
  const fetch = blockAfter(worker, "async fetch(request, env, ctx) {");
  if (!fetch) return { routes, errors: ["worker_fetch_not_found"] };
  const tokens = tokenizeJs(worker, fetch.start, fetch.end);
  const text = index => tokens[index]?.value;
  const expect = (index, values, what) => {
    const got = values.map((_, offset) => text(index + offset));
    if (got.join(" ") !== values.join(" ")) throw new Error(`worker fetch: expected ${what} (${values.join(" ")}), got ${got.join(" ")}`);
    return index + values.length;
  };
  let at = expect(0, ["const", "url", "=", "new", "URL", "(", "request", ".", "url", ")", ";"], "URL construction");
  at = expect(at, ["try", "{"], "try block");
  const tryClose = closeIndex(tokens, at - 1);
  const catchAt = expect(tryClose + 1, ["catch", "(", "error", ")", "{"], "catch block");
  if (closeIndex(tokens, catchAt - 1) !== tokens.length - 1) errors.push("worker fetch: statements after the try/catch are not extractable");
  for (const token of tokens.slice(tryClose)) {
    if (/pathname/.test(token.value)) errors.push("worker fetch: pathname read outside the dispatch try block");
  }

  // `pathname` is only ever read as `url.pathname`.
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== "word" && /pathname/.test(tokens[index].value)) errors.push(`worker fetch: pathname in a ${tokens[index].type} is not extractable: ${lineAt(worker, tokens[index].start)}`);
    if (tokens[index].type === "word" && tokens[index].value === "pathname"
      && !(text(index - 1) === "." && text(index - 2) === "url" && text(index - 3) !== ".")) {
      errors.push(`worker fetch: pathname read other than as url.pathname: ${lineAt(worker, tokens[index].start)}`);
    }
  }

  const nested = new Map();
  let finished = false;
  while (at < tryClose) {
    if (finished) { errors.push(`worker fetch: statement after the final fallthrough: ${lineAt(worker, tokens[at].start)}`); break; }
    if (text(at) === "return") {
      while (at < tryClose && text(at) !== ";") at = PAIRS[text(at)] && tokens[at].type === "punct" ? closeIndex(tokens, at) + 1 : at + 1;
      at += 1;
      finished = true;
      continue;
    }
    if (text(at) !== "if" || text(at + 1) !== "(") {
      errors.push(`worker fetch: route dispatch must be a top-level if-branch; not extractable: ${lineAt(worker, tokens[at].start)}`);
      break;
    }
    const conditionClose = closeIndex(tokens, at + 1);
    const condition = collapse(worker.slice(tokens[at + 1].end, tokens[conditionClose].start));
    let next = conditionClose + 1;
    if (["if", "for", "while", "do", "switch", "try", "with"].includes(text(next))) {
      errors.push(`worker fetch: nested dispatch statement in branch is not extractable: ${condition}`);
    }
    if (text(next) === "{") next = closeIndex(tokens, next) + 1;
    else {
      while (next < tryClose && text(next) !== ";") next = PAIRS[text(next)] && tokens[next].type === "punct" ? closeIndex(tokens, next) + 1 : next + 1;
      next += 1;
    }
    if (text(next) === "else") errors.push(`worker fetch: else-branch dispatch is not extractable: ${condition}`);
    if (!condition.includes("url.pathname")) errors.push(`worker fetch: top-level branch does not test url.pathname: ${condition}`);
    if (routes.has(condition)) errors.push(`duplicate route condition in worker.js: ${condition}`);
    routes.set(condition, worker.slice(tokens[at].start, tokens[next - 1].end));
    for (let index = conditionClose + 1; index < next; index += 1) {
      if (tokens[index].value !== "pathname") continue;
      const line = lineAt(worker, tokens[index].start);
      nested.set(line, (nested.get(line) || 0) + 1);
    }
    at = next;
  }
  if (!finished) errors.push("worker fetch: no final not-found fallthrough");
  for (const [line, count] of nested) {
    if (nestedReviewed.get(line) !== count) errors.push(`worker fetch: unreviewed url.pathname use inside a route branch (${count}x): ${line}`);
  }
  for (const [line, count] of nestedReviewed) {
    if (!nested.has(line)) errors.push(`worker fetch: reviewed nested url.pathname use no longer present (${count}x): ${line}`);
  }
  return { routes, errors };
}

/** Non-fetch entry points of the Worker's default export, read structurally. */
function extractWorkerEntries(worker) {
  const block = blockAfter(worker, "export default {");
  if (!block) return { entries: [], errors: ["worker_default_export_not_found"] };
  const tokens = tokenizeJs(worker, block.start, block.end);
  const entries = [];
  const errors = [];
  let at = 0;
  while (at < tokens.length) {
    if (tokens[at].value === "async") at += 1;
    const name = tokens[at];
    if (name?.type !== "word" || !["(", ":"].includes(tokens[at + 1]?.value)) {
      errors.push(`worker default export: member form not extractable: ${lineAt(worker, (name || tokens.at(-1)).start)}`);
      break;
    }
    entries.push(name.value);
    at += 1;
    // Skip the member's value up to the next top-level comma.
    while (at < tokens.length && tokens[at].value !== ",") at = PAIRS[tokens[at].value] && tokens[at].type === "punct" ? closeIndex(tokens, at) + 1 : at + 1;
    at += 1;
  }
  return { entries, errors };
}

/**
 * Canonical code of a dispatch body, rebuilt from its tokens (review F2).
 * Comments and whitespace disappear, so `command./* x *\/action` reads as
 * `command.action`; tokens are joined without spaces except between two words.
 * Strings and plain templates keep their value only when it is a bare
 * identifier (`"probe_read"`, `"action"`), otherwise they become `"…"`, and
 * regular expressions become `/…/`, so text inside them is never discovered as
 * code. Template substitutions are code and are rendered as such. Dispatch
 * patterns match this text; `line(offset)` gives the source line for errors.
 */
function dispatchCode(source, block) {
  let text = "";
  const offsets = [];
  const append = (piece, sourceOffset) => {
    if (/[\w$]$/.test(text) && /^[\w$]/.test(piece)) text += " ";
    offsets.push([text.length, sourceOffset]);
    text += piece;
  };
  const render = (from, to) => {
    for (const token of tokenizeJs(source, from, to)) {
      if (token.type === "string") append(/^\w+$/.test(token.value) ? `"${token.value}"` : '"…"', token.start);
      else if (token.type === "regex") append("/…/", token.start);
      else if (token.type === "template" && !token.subs.length) append(/^`\w+`$/.test(token.value) ? `"${token.value.slice(1, -1)}"` : '"…"', token.start);
      else if (token.type === "template") {
        append("`…", token.start);
        for (const [subFrom, subTo] of token.subs) { append("${", subFrom - 2); render(subFrom, subTo); append("}…", subTo); }
        append("`", token.end - 1);
      } else append(token.value, token.start);
    }
  };
  render(block.start, block.end);
  const line = offset => {
    let sourceOffset = block.start;
    for (const [at, from] of offsets) { if (at > offset) break; sourceOffset = from; }
    return lineAt(source, sourceOffset);
  };
  return { text, line };
}

/**
 * Every read of an action field in a dispatch body must sit inside a
 * recognised dispatch form or a reviewed non-dispatch snippet. Reads are
 * member access `.action` / `?.action`, any `"action"` key (computed access,
 * `Reflect.get`, destructuring by string), destructuring by name, `switch`,
 * and any computed access on a dispatch receiver (`command[key]`). A new form
 * is therefore an error rather than an uncounted action. `recognised` and
 * `reviewed` are written against the canonical code of `dispatchCode`.
 */
function unrecognisedActionReads(code, label, recognised, reviewed = new Map(), receivers = ["command"]) {
  const errors = [];
  const covered = [];
  const body = code.text;
  for (const pattern of recognised) for (const match of body.matchAll(pattern)) covered.push([match.index, match.index + match[0].length]);
  for (const [snippet, count] of reviewed) {
    let found = 0;
    for (let at = body.indexOf(snippet); at >= 0; at = body.indexOf(snippet, at + 1)) { covered.push([at, at + snippet.length]); found += 1; }
    if (found !== count) errors.push(`reviewed non-dispatch action read occurs ${found}x, reviewed ${count}x: ${snippet}`);
  }
  const reads = [
    ...body.matchAll(/\.action\b/g),
    ...body.matchAll(/"action"/g),
    ...body.matchAll(/\{[^{}]*\baction\b[^{}]*\}=(?![=>])/g),
    ...body.matchAll(/(?<![\w$"])switch\(/g),
  ];
  for (const match of reads) {
    const start = match.index;
    if (!covered.some(([from, to]) => start >= from && start < to)) errors.push(`${label}: action dispatch form not extractable: ${code.line(start)}`);
  }
  const computed = new RegExp(String.raw`(?<![\w$.])(?:${receivers.join("|")})(?:\?\.)?\[`, "g");
  for (const match of body.matchAll(computed)) errors.push(`${label}: computed access on a dispatch receiver is not extractable: ${code.line(match.index)}`);
  return errors;
}

/** Extract the classified surface from code. */
function extractSurface(sources, actionSets, options = {}) {
  const errors = [];
  const internal = new Set();
  const guard = (label, fn, fallback) => {
    try { return fn(); } catch (error) { errors.push(`${label}: ${error.message}`); return fallback; }
  };
  const worker = sources.get(`${CONSOLE}/worker.js`);
  const routeResult = guard("worker.js", () => extractRoutes(worker, options.nestedReviewed), { routes: new Map(), errors: [] });
  errors.push(...routeResult.errors);
  const entryResult = guard("worker.js", () => extractWorkerEntries(worker), { entries: [], errors: [] });
  errors.push(...entryResult.errors);
  if (!entryResult.entries.includes("fetch")) errors.push("worker default export has no fetch entry");
  for (const name of entryResult.entries) if (name !== "fetch") internal.add(`worker:${name}`);

  const durable = sources.get(`${CONSOLE}/application/runtime_instances/durable_object.js`);
  // Dispatch bodies are matched as canonical token code (see dispatchCode).
  const codeOf = (file, source, signature) => guard(file, () => {
    const block = source && blockAfter(source, signature);
    return block ? dispatchCode(source, block) : null;
  }, null);
  const doFetch = codeOf("durable_object.js", durable, "async fetch(request) {");
  if (!doFetch) errors.push("durable_object_fetch_not_found");
  const fetchCode = doFetch || { text: "", line: () => "" };
  const body = fetchCode.text;
  const ACTION = String.raw`command\??\.action`;
  const LITERAL_LIST = new RegExp(String.raw`\[((?:"[a-z0-9_]+",?)+)\]\.includes\(${ACTION}\)`, "g");
  const FAMILY = new RegExp(String.raw`\b([A-Z0-9_]+_DO_ACTIONS)\.has\(${ACTION}\)`, "g");
  const PREFIX = new RegExp(String.raw`typeof ${ACTION}==="string"&&${ACTION}\.startsWith\("([a-z0-9_]+)"\)`, "g");
  const COMPARE = new RegExp(String.raw`(?<!typeof )${ACTION}(?:===|!==)"([a-z0-9_]+)"`, "g");
  errors.push(...unrecognisedActionReads(fetchCode, "RuntimeInstances.fetch", [LITERAL_LIST, FAMILY, PREFIX, COMPARE], new Map([
    // Audit history records the action; it does not dispatch on it.
    ["action:command.action,before,after", 1],
  ]), ["command", "request"]));
  const literalMembers = new Set();
  for (const [, list] of body.matchAll(LITERAL_LIST)) {
    for (const [, action] of list.matchAll(/"([a-z0-9_]+)"/g)) literalMembers.add(action);
  }
  const add = (id, family) => {
    if (internal.has(id)) errors.push(`action dispatched by two families: ${id} (${family})`);
    internal.add(id);
  };
  for (const action of literalMembers) add(`action:${action}`, "literal list");
  for (const [, name] of body.matchAll(FAMILY)) {
    if (!actionSets[name]) { errors.push(`unknown action family ${name} in RuntimeInstances.fetch`); continue; }
    for (const action of actionSets[name]) add(`action:${action}`, name);
  }
  const prefixFamilies = {
    rotation_: () => {
      const code = codeOf("secretRotation.js", sources.get(`${CONSOLE}/secretRotation.js`), "export function rotationCommand(sql, c, factors = []) {");
      if (!code) { errors.push("secretRotation.js: rotationCommand not found"); return []; }
      const rotation = code.text;
      const compare = /(?<![\w$.])c\.action==="(rotation_[a-z_]+)"/g;
      errors.push(...unrecognisedActionReads(code, "rotationCommand", [compare], new Map([
        // The stored request's write action, compared for replay; not dispatch.
        ["prior.action!==c.write_action", 1],
      ]), ["c"]));
      return [...rotation.matchAll(compare)].map(m => m[1]);
    },
    ux1_: () => {
      const code = codeOf("durable_object.js", durable, "ux1ResearchCommand(command) {");
      if (!code) { errors.push("durable_object.js: ux1ResearchCommand not found"); return []; }
      const ux1 = code.text;
      const list = new RegExp(LITERAL_LIST.source, "g");
      const compare = /command\??\.action==="(ux1_[a-z_]+)"/g;
      errors.push(...unrecognisedActionReads(code, "ux1ResearchCommand", [list, compare]));
      return [
        ...[...ux1.matchAll(list)].flatMap(([, members]) => [...members.matchAll(/"([a-z0-9_]+)"/g)].map(m => m[1])),
        ...[...ux1.matchAll(compare)].map(m => m[1]),
      ];
    },
  };
  for (const [, prefix] of body.matchAll(PREFIX)) {
    if (!prefixFamilies[prefix]) { errors.push(`unknown action prefix ${prefix} in RuntimeInstances.fetch`); continue; }
    for (const action of new Set(prefixFamilies[prefix]())) {
      if (!action.startsWith(prefix)) errors.push(`prefix family ${prefix} dispatches ${action}`);
      add(`action:${action}`, prefix);
    }
  }
  for (const [, action] of body.matchAll(COMPARE)) {
    // Comparisons on actions already dispatched by a family (e.g. a status code) are not new actions.
    if (!internal.has(`action:${action}`)) internal.add(`action:instance_state:${action}`);
  }
  // Method and path dispatch of RuntimeInstances.fetch itself: exactly these
  // reviewed forms. Every `method` / `pathname` name counts as a read, whether
  // a member, a string key (`request["method"]`) or a destructured binding;
  // computed access on `request` is rejected above.
  const methodForms = new Map([
    ['request.method==="GET")return json(this.response(this.read()))', 1],
    ['request.method!=="POST"', 2],
  ]);
  const pathForms = new Map([["new URL(request.url).pathname===DIRECTORY_PATH", 1]]);
  for (const [label, pattern, forms] of [["request.method", /\bmethod\b/g, methodForms], ["pathname", /\bpathname\b/g, pathForms]]) {
    const reads = [...body.matchAll(pattern)].length;
    const reviewed = [...forms].reduce((sum, [form, count]) => {
      const found = body.split(form).length - 1;
      if (found !== count) errors.push(`RuntimeInstances.fetch: ${label} form occurs ${found}x, reviewed ${count}x: ${form}`);
      return sum + count;
    }, 0);
    if (reads !== reviewed) errors.push(`RuntimeInstances.fetch: ${reads} ${label} reads, ${reviewed} reviewed; a new dispatch form is not extractable`);
  }
  if (body.includes('request.method==="GET")return json(this.response(this.read()))')) internal.add("action:instance_state:GET");
  if (body.includes("pathname===DIRECTORY_PATH")) {
    const run = codeOf("kv_directory.js", sources.get(`${CONSOLE}/kv_directory.js`), "async run(command) {");
    if (!run) errors.push("kv_directory.js: KvDirectory.run not found");
    const compare = /command\.action(?:===|!==)"([a-z_]+)"/g;
    if (run) errors.push(...unrecognisedActionReads(run, "KvDirectory.run", [compare]));
    for (const [, action] of (run?.text || "").matchAll(compare)) internal.add(`action:directory:${action}`);
  }
  if (guard("durable_object.js", () => blockAfter(durable, "async alarm() {"), null)) internal.add("action:lifecycle:alarm");
  return { routes: routeResult.routes, internal, errors };
}

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

function computeSites(sources, helper) {
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
        if (anchor.route) text = surf.routes.get(routes.find(route => route.id === anchor.route)?.match);
        else text = anchor.block ? blockAfter(src.get(anchor.file) || "", anchor.block)?.text : src.get(anchor.file);
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

  // (e) Extraction is structural and fails closed (review F2). Each probe edits
  // a copy of the real source; none is written to disk.
  const edit = (file, from, to) => {
    const path = `${CONSOLE}/${file}`;
    assert.ok(sources.get(path).includes(from), `probe anchor present in ${file}: ${from}`);
    return new Map([...sources].map(([name, text]) => [name, name === path ? text.replace(from, to) : text]));
  };
  const extracted = src => extractSurface(src, actionSets);
  const ROOT_BRANCH = '      if (url.pathname === "/") {';
  const PROBE_ROUTE = 'if (url.pathname === "/api/probe-unclassified" && request.method === "GET") return new Response("probe");';
  for (const indent of ["", "  ", "    ", "      ", "\t", "        "]) {
    const probed = extracted(edit("worker.js", ROOT_BRANCH, `${indent}${PROBE_ROUTE}\n${ROOT_BRANCH}`));
    assert.equal(probed.routes.size, surface.routes.size + 1, `probe (e) route at indent ${JSON.stringify(indent)} is counted`);
    expectError(run({ surface: probed }), /^unclassified route branch in worker\.js: url\.pathname === "\/api\/probe-unclassified"/, `probe (e) indent ${JSON.stringify(indent)}`);
  }
  const sameLine = extracted(edit("worker.js", ROOT_BRANCH, `      ${PROBE_ROUTE} ${ROOT_BRANCH.trim()}`));
  expectError(run({ surface: sameLine }), /^unclassified route branch.*probe-unclassified/, "probe (e) same line");
  const braces = extracted(edit("worker.js", ROOT_BRANCH, `      if (url.pathname === "/api/probe-braces") { const s = "}{"; const r = /[}{]/; return new Response(\`\${s}}\`); }\n${ROOT_BRANCH}`));
  expectError(run({ surface: braces }), /^unclassified route branch.*probe-braces/, "probe (e) brackets inside strings, regex and templates");
  const failClosed = {
    "nested route inside a branch": [/unreviewed url\.pathname use inside a route branch/, edit("worker.js", 'if (url.pathname.startsWith("/api/performance/")) {', 'if (url.pathname.startsWith("/api/performance/")) {\n        if (url.pathname === "/api/performance/probe") return new Response("probe");')],
    "else-branch dispatch": [/else-branch dispatch is not extractable/, edit("worker.js", ROOT_BRANCH, `      if (url.pathname === "/api/probe-a") return new Response("a");\n      else if (url.pathname === "/api/probe-b") return new Response("b");\n${ROOT_BRANCH}`)],
    "switch dispatch": [/route dispatch must be a top-level if-branch; not extractable: switch/, edit("worker.js", ROOT_BRANCH, `      switch (url.pathname) { case "/api/probe": return new Response("probe"); }\n${ROOT_BRANCH}`)],
    "logical dispatch": [/top-level branch does not test url\.pathname/, edit("worker.js", ROOT_BRANCH, `      if (request.method === "GET") return probeAll(url.pathname);\n${ROOT_BRANCH}`)],
    "expression statement": [/route dispatch must be a top-level if-branch; not extractable: url\.pathname/, edit("worker.js", ROOT_BRANCH, `      url.pathname === "/api/probe" && probe();\n${ROOT_BRANCH}`)],
    "path alias": [/route dispatch must be a top-level if-branch; not extractable: const path/, edit("worker.js", ROOT_BRANCH, `      const path = url.pathname;\n${ROOT_BRANCH}`)],
    "destructured pathname": [/pathname read other than as url\.pathname/, edit("worker.js", "    const url = new URL(request.url);\n    try {", "    const url = new URL(request.url);\n    try {\n      const { pathname } = url;")],
    "dispatch before try": [/expected try block/, edit("worker.js", "    const url = new URL(request.url);\n    try {", '    const url = new URL(request.url);\n    if (url.pathname === "/api/probe") return new Response("probe");\n    try {')],
    "nested if consequent": [/nested dispatch statement in branch/, edit("worker.js", ROOT_BRANCH, `      if (url.pathname.startsWith("/api/probe")) if (request.method === "GET") return new Response("probe");\n${ROOT_BRANCH}`)],
    "statement after fallthrough": [/statement after the final fallthrough/, edit("worker.js", '      return json({ ok: false, error: "not_found" }, 404);\n    } catch', '      return json({ ok: false, error: "not_found" }, 404);\n      if (url.pathname === "/api/probe") return new Response("probe");\n    } catch')],
    "unbalanced source": [/unclosed \}/, edit("worker.js", ROOT_BRANCH, `      if (url.pathname === "/api/probe") { return new Response("probe");\n${ROOT_BRANCH}`)],
    "non-method export member": [/member form not extractable: \.\.\.probeHandlers/, edit("worker.js", "export default {", "export default {\n  ...probeHandlers,")],
    "DO switch on action": [/^RuntimeInstances\.fetch: action dispatch form not extractable: switch/, edit("application/runtime_instances/durable_object.js", "if (HK_STOP_DO_ACTIONS.has(command?.action)) {", 'switch (command.action) { case "probe_read": return json({}); }\n      if (HK_STOP_DO_ACTIONS.has(command?.action)) {')],
    "DO destructured action": [/^RuntimeInstances\.fetch: action dispatch form not extractable: const \{ action \}/, edit("application/runtime_instances/durable_object.js", "if (HK_STOP_DO_ACTIONS.has(command?.action)) {", 'const { action } = command;\n      if (action === "probe_read") return json({});\n      if (HK_STOP_DO_ACTIONS.has(command?.action)) {')],
    "DO computed action": [/^RuntimeInstances\.fetch: action dispatch form not extractable: .*command\[\"action\"\]/, edit("application/runtime_instances/durable_object.js", "if (HK_STOP_DO_ACTIONS.has(command?.action)) {", 'if (command["action"] === "probe_read") return json({});\n      if (HK_STOP_DO_ACTIONS.has(command?.action)) {')],
    "DO other receiver": [/^RuntimeInstances\.fetch: action dispatch form not extractable: .*request\.body\?\.action/, edit("application/runtime_instances/durable_object.js", "if (HK_STOP_DO_ACTIONS.has(command?.action)) {", 'if (request.body?.action === "probe_read") return json({});\n      if (HK_STOP_DO_ACTIONS.has(command?.action)) {')],
    "DO new method form": [/request\.method reads, 3 reviewed/, edit("application/runtime_instances/durable_object.js", 'if (request.method === "GET") return json(this.response(this.read()));', 'if (request.method === "PUT") return json({});\n      if (request.method === "GET") return json(this.response(this.read()));')],
    "DO new path form": [/pathname reads, 1 reviewed/, edit("application/runtime_instances/durable_object.js", 'if (request.method === "GET") return json(this.response(this.read()));', 'if (new URL(request.url).pathname === "/probe") return json({});\n      if (request.method === "GET") return json(this.response(this.read()));')],
    "ux1 switch on action": [/^ux1ResearchCommand: action dispatch form not extractable/, edit("application/runtime_instances/durable_object.js", "      const login = String(command?.login || \"\");", "      switch (command.action) { case \"ux1_probe\": return {}; }\n      const login = String(command?.login || \"\");")],
    "rotation alternate form": [/^rotationCommand: action dispatch form not extractable/, edit("secretRotation.js", "  if (c.action === 'rotation_denied')", "  if (['rotation_probe'].includes(c.action)) return {};\n  if (c.action === 'rotation_denied')")],
    "directory alternate form": [/^KvDirectory\.run: action dispatch form not extractable/, edit("kv_directory.js", '    if (command.action === "cache") {', '    if (["probe"].includes(command.action)) return {};\n    if (command.action === "cache") {')],
  };
  for (const [label, [pattern, probedSources]] of Object.entries(failClosed)) {
    expectError(extracted(probedSources).errors, pattern, `probe (e) ${label}`);
  }
  const reindented = new Map([...sources].map(([name, text]) => [name, /worker\.js$|durable_object\.js$/.test(name) ? text.replace(/^( +)/gm, "$1$1") : text]));
  const reindentedSurface = extracted(reindented);
  assert.deepEqual(reindentedSurface.errors, [], "probe (e) doubled indentation extracts cleanly");
  assert.deepEqual([...reindentedSurface.routes.keys()], [...surface.routes.keys()], "probe (e) indentation does not change the route branches");
  assert.deepEqual([...reindentedSurface.internal].sort(), [...surface.internal].sort(), "probe (e) indentation does not change the internal operations");
  const newAction = extracted(edit("application/runtime_instances/durable_object.js", "if (HK_STOP_DO_ACTIONS.has(command?.action)) {", 'if (command.action === "probe_read") return json({});\n      if (HK_STOP_DO_ACTIONS.has(command?.action)) {'));
  expectError(run({ surface: newAction }), /^unclassified internal operation action:instance_state:probe_read/, "probe (e) DO comparison");

  // Internal dispatch is read from tokens too (review F2, fix round 2): a
  // comment inside a member read keeps its meaning, computed method access is
  // rejected, and comment or string text is not an operation.
  const HK_BRANCH = "if (HK_STOP_DO_ACTIONS.has(command?.action)) {";
  const GET_BRANCH = 'if (request.method === "GET") return json(this.response(this.read()));';
  const DO_FILE = "application/runtime_instances/durable_object.js";
  const commented = extracted(edit(DO_FILE, HK_BRANCH, `if (command./* dispatch */action === "probe_read") return json({ probe: true });\n      ${HK_BRANCH}`));
  assert.deepEqual(commented.errors, [], "probe (e) comment-separated DO action extracts");
  assert.equal(commented.internal.size, surface.internal.size + 1, "probe (e) comment-separated DO action is counted");
  expectError(run({ surface: commented }), /^unclassified internal operation action:instance_state:probe_read$/, "probe (e) comment-separated DO action");
  const computedMethod = extracted(edit(DO_FILE, GET_BRANCH, `if (request["method"] === "PUT") return json({ probe: true });\n      ${GET_BRANCH}`));
  expectError(computedMethod.errors, /^RuntimeInstances\.fetch: computed access on a dispatch receiver is not extractable: if \(request\["method"\]/, "probe (e) computed DO method receiver");
  expectError(computedMethod.errors, /^RuntimeInstances\.fetch: 4 request\.method reads, 3 reviewed/, "probe (e) computed DO method count");
  const computedKey = extracted(edit(DO_FILE, GET_BRANCH, `if (request[probeKey] === "PUT") return json({ probe: true });\n      ${GET_BRANCH}`));
  expectError(computedKey.errors, /^RuntimeInstances\.fetch: computed access on a dispatch receiver is not extractable: if \(request\[probeKey\]/, "probe (e) computed DO key");
  for (const [label, text] of [
    ["comment-only DO action", '// if (command.action === "probe_comment_only") return json({});'],
    ["DO action inside a string", 'const probeNote = "if (command.action === \\"probe_string_only\\") request[\\"method\\"]";'],
  ]) {
    const inert = extracted(edit(DO_FILE, HK_BRANCH, `${text}\n      ${HK_BRANCH}`));
    assert.deepEqual(inert.errors, [], `probe (e) ${label} is not an extraction error`);
    assert.deepEqual([...inert.internal].sort(), [...surface.internal].sort(), `probe (e) ${label} adds no operation`);
    assert.deepEqual(run({ surface: inert }), [], `probe (e) ${label} passes validation`);
  }
  const newEntry = extracted(edit("worker.js", "export default {", "export default {\n  async queue(batch, env) {},"));
  expectError(run({ surface: newEntry }), /^unclassified internal operation worker:queue/, "probe (e) worker entry");

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
