// Unit checks for the warn-only CSS style guards. Synthetic CSS only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { checkCss, runGuards } from "../web/strategy-switch-console/frontend/scripts/check-style-guards.mjs";

const rules = (css, file = "a.css") => checkCss(css, file).map((v) => v.rule);

assert.deepEqual(rules(".a { color: #fff; }"), ["color-literal"]);
assert.deepEqual(rules(".a { color: rgba(0,0,0,.5); }"), ["color-literal"]);
assert.deepEqual(rules(".a { color: #fff; }", "src/app/tokens.css"), []);
assert.deepEqual(rules("/* #fff box-shadow: 0 0 1px red */ .a { color: var(--text-primary); }"), []);
// Visual-design properties are free: only hardcoded colours are checked.
for (const css of [
  ".a { box-shadow: 0 1px 2px var(--shadow-sm); }",
  ".a { background: linear-gradient(var(--c1), var(--c2)); }",
  ".a { border: 1px solid var(--border); border-radius: var(--radius-md); }",
  ".a { border: 0.5px solid var(--border); }",
  ".a { grid-template-columns: repeat(6, 1fr); }",
]) assert.deepEqual(rules(css), [], css);
assert.deepEqual(rules(".a { box-shadow: 0 1px 2px rgba(0,0,0,.2); }"), ["color-literal"]);
assert.deepEqual(rules(".a { background: linear-gradient(#fff, #000); }"), ["color-literal"]);
// Other hardcoded values (font size, legacy aliases) are not checked.
for (const css of [".a { font-size: 13px; }", ".a { color: var(--ink); }", ":root { --shadow: none; }"]) assert.deepEqual(rules(css), [], css);

// Tokens need both a light and a dark value.
const tokens = (css) => rules(css, "src/app/tokens.css");
assert.deepEqual(tokens(':root { --c: #fff; }\n:root[data-theme="dark"] { --c: #000; }'), []);
assert.deepEqual(tokens(':root { --c: #fff; }\n:root[data-theme="dark"] { --d: #000; }'), ["theme-parity", "theme-parity"]);

// Line numbers point at the declaration.
assert.equal(checkCss(".a {\n  color: red;\n  color: #fff;\n}", "a.css")[0].line, 3);

// The live tree is scanned and the legacy dead file is skipped; warn-only never fails.
const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const live = await runGuards(root);
assert.ok(!live.some((v) => v.file === "src/styles.css"));
const run = spawnSync(process.execPath, [`${root}scripts/check-style-guards.mjs`], { encoding: "utf8" });
assert.equal(run.status, 0, run.stderr);
assert.match(run.stdout, /warn-only/);
console.log(`console_style_guards_validation ok (${live.length} existing warn-only violations)`);
