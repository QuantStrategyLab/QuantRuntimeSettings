import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { consoleBuildChanged } from "../web/strategy-switch-console/frontend/src/app/consoleBuild.ts";

const require = createRequire(new URL("../web/strategy-switch-console/frontend/package.json", import.meta.url));
const ts = require("typescript");
const current = "a".repeat(64), latest = "b".repeat(64);
let requests = 0;
const fetcher = (version, status = 200) => async (url, options) => {
  requests++;
  assert.equal(url, "/");
  assert.deepEqual(options, { method: "HEAD", cache: "no-store", credentials: "omit" });
  return new Response(null, { status, headers: { "X-Console-Build": version } });
};
assert.equal(await consoleBuildChanged(current, fetcher(current)), false);
assert.equal(await consoleBuildChanged(current, fetcher(latest)), true);
assert.equal(await consoleBuildChanged(current, fetcher(latest, 503)), false);
assert.equal(await consoleBuildChanged(current, fetcher("invalid")), false);
assert.equal(await consoleBuildChanged("", fetcher(latest)), false);
assert.equal(requests, 4, "unmarked development pages do not make update requests");

const source = readFileSync(new URL("../web/strategy-switch-console/frontend/src/app/UpdateNotice.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const events = new Map();
let effect, cleanup, visible = false, checks = 0, reloads = 0, guardAllows = false, clock = 100_000;
const document = {
  visibilityState: "visible",
  querySelector: () => ({ content: current }),
  addEventListener: (name, fn) => events.set(name, fn),
  removeEventListener: name => events.delete(name),
};
const window = {
  addEventListener: (name, fn) => events.set(name, fn),
  removeEventListener: name => events.delete(name),
  location: { reload: () => reloads++ },
};
const exports = {};
const jsx = (type, props) => ({ type, props });
runInNewContext(code, { exports, document, window, Date: { now: () => clock }, require: name => {
  if (name === "react") return { useState: () => [visible, next => { visible = next; }], useEffect: fn => { effect = fn; } };
  if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
  if (name === "../i18n") return { useT: () => key => key };
  if (name === "./consoleBuild") return { consoleBuildChanged: async () => { checks++; return true; } };
  if (name === "./router") return { getNavigationGuard: () => async () => guardAllows };
  throw Error(name);
} });
assert.equal(exports.UpdateNotice(), null);
cleanup = effect();
await new Promise(setImmediate);
assert.equal(checks, 0, "a fresh shell does not request its own version during boot");
assert.equal(visible, false);
await events.get("focus")();
assert.equal(visible, true);
assert.equal(reloads, 0, "new deployments never force a reload");
await events.get("focus")();
assert.equal(checks, 1, "focus and visibility checks are deduplicated");
clock += 60_001;
document.visibilityState = "hidden";
await events.get("visibilitychange")();
assert.equal(checks, 1, "hidden tabs do no background work");
document.visibilityState = "visible";
await events.get("visibilitychange")();
assert.equal(checks, 2);
const notice = exports.UpdateNotice();
notice.props.children[1].props.onClick();
await new Promise(setImmediate);
assert.equal(reloads, 0, "cancelling the existing unsaved-edit guard preserves the page");
guardAllows = true;
notice.props.children[1].props.onClick();
await new Promise(setImmediate);
assert.equal(reloads, 1);
cleanup();
assert.equal(events.size, 0);

const deny = /审计|核对|证据|门禁|\baudit\b|\bevidence\b/i;
for (const file of ["locales.ts", "i18n/zh-CN.ts", "i18n/en.ts", ...["accounts", "decisions", "health", "overview", "performance", "strategies"].map(page => `i18n/pages/${page}.ts`)]) {
  const path = new URL(`../web/strategy-switch-console/frontend/src/${file}`, import.meta.url);
  const tree = ts.createSourceFile(file, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const visit = node => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.initializer)) {
      assert.doesNotMatch(node.initializer.text, deny, `${file}: product copy must not contain internal audit terminology`);
      if (file === "locales.ts" && ts.isStringLiteral(node.name)) assert.doesNotMatch(node.name.text, deny);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
}
console.log("console_update_notice_validation: PASS");
