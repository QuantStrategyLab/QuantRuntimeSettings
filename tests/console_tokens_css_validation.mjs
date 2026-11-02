// tokens.css is the single token file: every light colour has a dark value,
// aliases resolve to declared tokens, and no other live stylesheet declares :root.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../web/strategy-switch-console/frontend/src/", import.meta.url).pathname;
const tokens = await readFile(join(root, "app/tokens.css"), "utf8");
const darkAt = tokens.indexOf(':root[data-theme="dark"]');
const upDownAt = tokens.indexOf("/* Up/down");
assert.ok(darkAt > 0 && upDownAt > darkAt, "tokens.css has light, dark and up/down blocks");
const light = tokens.slice(0, darkAt);
const dark = tokens.slice(darkAt, upDownAt);

const colourDecl = /^\s*(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6,8}|[^;]*\s#[0-9a-fA-F]{6,8}[^;]*);/gm;
const lightColours = [...light.matchAll(colourDecl)].map(m => m[1]);
const darkColours = new Set([...dark.matchAll(colourDecl)].map(m => m[1]));
assert.ok(lightColours.length >= 30, "light block declares the colour tokens");
for (const name of lightColours) assert.ok(darkColours.has(name), `${name} has a dark value`);
for (const name of darkColours) assert.ok(lightColours.includes(name), `${name} has a light value`);

// Every var() reference in tokens.css points at a declared token.
const declared = new Set([...tokens.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map(m => m[1]));
for (const m of tokens.matchAll(/var\((--[a-z0-9-]+)\)/g)) assert.ok(declared.has(m[1]), `${m[1]} is declared`);

// No other live stylesheet declares tokens. Legacy src/styles.css is dead code, removed in P0-2.
const walk = async dir => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(path));
    else if (entry.name.endsWith(".css") && entry.name !== "tokens.css" && entry.name !== "styles.css") out.push(path);
  }
  return out;
};
const css = await walk(root);
assert.ok(css.some(f => f.endsWith("app.css")), "app.css is scanned");
const contains = [];
for (const file of css) if (/:root\s*\{/.test(await readFile(file, "utf8"))) contains.push(file);
assert.deepEqual(contains, [], "no other stylesheet declares :root tokens");
console.log(`console_tokens_css_validation: PASS (${lightColours.length} colour tokens)`);
