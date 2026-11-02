// Desk (Meridian) shell: hash routes, hotkeys, review overrides, the fail-closed access gate,
// zh-CN/en copy parity and token-only styling. Synthetic inputs only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DESK_PAGES, deskHash, hotkeyPage, isDeskHash, parseDeskHash, urlOverrides } from "../web/strategy-switch-console/frontend/src/desk/router.ts";
import { deskAccess } from "../web/strategy-switch-console/frontend/src/desk/shell/access.ts";
import { DESK_MESSAGES, deskTranslate, resolveDeskLanguage } from "../web/strategy-switch-console/frontend/src/desk/i18n/index.ts";

const src = path => readFileSync(new URL(`../web/strategy-switch-console/frontend/src/${path}`, import.meta.url), "utf8");

// 1. Routes: six pages, Accounts and Logs are their own destinations.
assert.deepEqual([...DESK_PAGES], ["overview", "accounts", "switch", "performance", "alerts", "logs"]);
for (const page of DESK_PAGES) {
  assert.equal(parseDeskHash(deskHash(page)).page, page);
  assert.ok(isDeskHash(deskHash(page)));
}
assert.equal(parseDeskHash("#/desk").page, "overview");
assert.equal(parseDeskHash("#/desk/").page, "overview");
assert.equal(parseDeskHash("#/desk/strategy").page, "switch");
assert.equal(parseDeskHash("#/desk/ACCOUNTS").page, "accounts");
assert.equal(parseDeskHash("#/desk/nope").page, "overview");
assert.equal(parseDeskHash("#/desk/accounts?target=fake-broker/demo").params.get("target"), "fake-broker/demo");
for (const hash of ["", "#", "#/desktop", "#/deskx", "#desk", "#/overview"]) assert.equal(isDeskHash(hash), false, hash);
// The boot switch in main.tsx uses the same pattern, so the old console keeps every other URL.
assert.match(src("main.tsx"), /\/\^#\\\/desk\(\?:\[\/\?\]\|\$\)\/\.test\(window\.location\.hash\)/);

// 2. Hotkeys 1-6 follow dock order; ignored with modifiers or while typing.
const key = (k, extra = {}) => ({ key: k, altKey: false, ctrlKey: false, metaKey: false, target: { tagName: "BODY" }, ...extra });
DESK_PAGES.forEach((page, i) => assert.equal(hotkeyPage(key(String(i + 1))), page));
for (const k of ["0", "7", "a", "1.5", " 1", "Enter"]) assert.equal(hotkeyPage(key(k)), null, k);
assert.equal(hotkeyPage(key("2", { ctrlKey: true })), null);
assert.equal(hotkeyPage(key("2", { metaKey: true })), null);
assert.equal(hotkeyPage(key("2", { altKey: true })), null);
for (const tagName of ["INPUT", "textarea", "SELECT"]) assert.equal(hotkeyPage(key("2", { target: { tagName } })), null, tagName);
assert.equal(hotkeyPage(key("2", { target: { tagName: "DIV", isContentEditable: true } })), null);
assert.equal(hotkeyPage(key("2", { target: null })), "accounts");

// 3. Review overrides accept only known values.
assert.deepEqual(urlOverrides("?theme=dark&lang=en"), { theme: "dark", language: "en" });
assert.deepEqual(urlOverrides("?theme=light&lang=zh-CN"), { theme: "light", language: "zh" });
assert.deepEqual(urlOverrides("?theme=sepia&lang=fr"), { theme: null, language: null });

// 4. Access gate fails closed: only a read, authenticated, allowed session opens the desk.
const ready = data => ({ state: "ready", result: { data } });
assert.equal(deskAccess({ state: "loading" }), "loading");
assert.equal(deskAccess({ state: "failed" }), "error");
assert.equal(deskAccess({ state: "weird" }), "error");
assert.equal(deskAccess(ready(null)), "error");
assert.equal(deskAccess(ready({ authenticated: true, allowed: true })), "open");
assert.equal(deskAccess(ready({ authenticated: true, allowed: false })), "denied");
assert.equal(deskAccess(ready({ authenticated: true })), "denied");
assert.equal(deskAccess(ready({ authenticated: true, allowed: "true" })), "denied");
assert.equal(deskAccess(ready({ authenticated: false, allowed: true })), "login");
assert.equal(deskAccess(ready({})), "login");
const app = src("desk/DeskApp.tsx");
assert.match(app, /access === "open" \? <PageStub/, "page content renders only when the gate is open");
// A failed ribbon refresh must not keep an old gateway/alert read on screen.
assert.match(app, /\(\) => alive && setRibbon\(\{ state: "failed" \}\)/, "failed ribbon refresh drops the stale read");
assert.doesNotMatch(app, /previous\.state === "ready" \? previous/, "no keep-last-good fallback for the ribbon");

// 5. Copy: zh-CN primary, en complete, same keys and placeholders, nothing empty.
const zh = DESK_MESSAGES.zh, en = DESK_MESSAGES.en;
assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
const holes = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");
for (const k of Object.keys(zh)) {
  assert.ok(zh[k].trim() && en[k].trim(), `empty copy: ${k}`);
  assert.equal(holes(en[k]), holes(zh[k]), `placeholder mismatch: ${k}`);
}
for (const page of DESK_PAGES) {
  for (const part of ["nav", "page.%.headline", "page.%.body", "page.%.parts"]) {
    const k = part === "nav" ? `nav.${page}` : part.replace("%", page);
    assert.ok(k in zh, `missing ${k}`);
  }
}
assert.match(deskTranslate("zh", "nav.overview"), /[一-鿿]/);
assert.equal(deskTranslate("en", "nav.accounts"), "Accounts");
assert.equal(deskTranslate("en", "stub.eyebrow", {}), en["stub.eyebrow"], "unknown placeholder stays visible");
assert.equal(resolveDeskLanguage(null, ["fr-FR"]), "zh");
assert.equal(resolveDeskLanguage(null, ["en-GB", "zh-CN"]), "en");
assert.equal(resolveDeskLanguage("en", ["zh-CN"]), "en");
assert.equal(resolveDeskLanguage("garbage", []), "zh");

// 6. desk.css uses tokens only, and every --mrd-* it reads is defined for light and dark.
const css = src("desk/styles/desk.css");
assert.equal((css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) || []).length, 0, "raw colours in desk.css");
const tokens = src("app/tokens.css");
const local = new Set([...css.matchAll(/(--mrd-[\w-]+)\s*:/g)].map(m => m[1]));
const used = new Set([...css.matchAll(/var\((--mrd-[\w-]+)/g)].map(m => m[1]).filter(n => !local.has(n)));
const blocks = tokens.split(/\[data-theme=["']?dark["']?\]/);
assert.equal(blocks.length, 2, "tokens.css has one dark block");
const themeIndependent = new Set(["--mrd-font-serif", "--mrd-radius"]);
for (const name of used) {
  assert.ok(blocks[0].includes(`${name}:`), `${name} missing (light)`);
  if (!themeIndependent.has(name)) assert.ok(blocks[1].includes(`${name}:`), `${name} missing (dark)`);
}

console.log("console desk shell validation passed");
