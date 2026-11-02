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

// Named colours and every colour function are colour literals, both outside tokens.css and in theme parity.
for (const value of ["rebeccapurple", "RED", "oklch(60% 0.2 30)", "oklab(0.6 0.1 0.1)", "lab(50% 40 59)", "lch(52% 72 50)",
  "hwb(194 0% 0%)", "color(display-p3 1 0 0)", "hsl(0 0% 100%)"]) {
  assert.deepEqual(rules(`.a { color: ${value}; }`), ["color-literal"], value);
  assert.deepEqual(tokens(`:root { --c: ${value}; }`), ["theme-parity"], value);
}
assert.deepEqual(rules(".a { border: 1px solid white; }"), ["color-literal"]);
assert.deepEqual(rules(".a { box-shadow: 0 0 2px black; }"), ["color-literal"]);
assert.deepEqual(rules(".a { background: color-mix(in srgb, red 20%, var(--surface-1)); }"), ["color-literal"]);
// Keywords, var() names, strings and non-colour identifiers are not colours.
for (const css of [
  ".a { color: transparent; }", ".a { color: currentColor; }", ".a { color: inherit; }",
  ".a { color: var(--red); }", ".a { background: var(--tan, var(--surface-1)); }",
  ".a { background: color-mix(in srgb, var(--accent) 20%, transparent); }",
  ".a { font-family: Tan, sans-serif; }", ".a { animation-name: pink; }", '.a { grid-template-areas: "red blue"; }',
  '.a { content: "white"; }', ".a { background: url(red.png); }",
]) assert.deepEqual(rules(css), [], css);
assert.deepEqual(tokens(':root { --c: oklch(60% 0.2 30); }\n:root[data-theme="dark"] { --c: rebeccapurple; }'), []);

// Line numbers point at the declaration.
assert.equal(checkCss(".a {\n  width: 1px;\n  color: #fff;\n}", "a.css")[0].line, 3);

// The live tree is scanned and the legacy dead file is skipped; warn-only never fails.
const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
const live = await runGuards(root);
assert.ok(!live.some((v) => v.file === "src/styles.css"));
const run = spawnSync(process.execPath, [`${root}scripts/check-style-guards.mjs`], { encoding: "utf8" });
assert.equal(run.status, 0, run.stderr);
assert.match(run.stdout, /warn-only/);
console.log(`console_style_guards_validation ok (${live.length} existing warn-only violations)`);
