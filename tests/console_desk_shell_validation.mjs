// Desk (Meridian) shell: hash routes, hotkeys, review overrides, the fail-closed access gate,
// zh-CN/en copy parity and token-only styling. Synthetic inputs only.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
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
assert.match(app, /access === "open" \? \(page === "performance" \? <PerformancePage[^]*?: <PageStub/, "page content renders only when the gate is open");
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


// Render the actual status element: stale health must be distinguishable without colour.
const directory = await mkdtemp(join(tmpdir(), "desk-gateway-ui-"));
try {
  const outfile = join(directory, "render.cjs");
  const root = new URL("../web/strategy-switch-console/frontend/", import.meta.url).pathname;
  await build({ stdin: { resolveDir: root, contents: `
    import { createElement as h } from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { TopBar } from './src/desk/shell/TopBar';
    import { deskTranslate } from './src/desk/i18n';
    export const render = (language, gateway) => renderToStaticMarkup(h(TopBar, {
      page: 'overview', language, gateway, t: (key, params) => deskTranslate(language, key, params),
      theme: 'light', nowIso: '2026-11-03T00:00:00Z', serverClock: true, mock: null,
      onLanguage() {}, onTheme() {},
    }));
  ` }, bundle: true, platform: "node", format: "cjs", outfile, jsx: "automatic", logLevel: "silent" });
  const { render } = createRequire(import.meta.url)(outfile);
  const statusText = html => html.match(/role="status">([\s\S]*?)<\/span>/)[1].replace(/<[^>]*>/g, "");
  for (const language of ["zh", "en"]) {
    for (const value of ["all_reachable", "degraded", "down"]) {
      const read = { status: "stale", value, observed_at: "2026-11-02T00:00:00Z", age_seconds: 86400 };
      const text = statusText(render(language, { kind: "read", read }));
      assert.match(text, language === "zh" ? /已过期/ : /stale/i, "status must name stale evidence");
      assert.match(text, /1/, "status includes observation age");
      assert.ok(!text.includes(deskTranslate(language, `gateway.${value}`)), "old values never assert current health");
    }
    const current = statusText(render(language, { kind: "read", read: { status: "known", value: "all_reachable", observed_at: "2026-11-03T00:00:00Z" } }));
    assert.equal(current, deskTranslate(language, "gateway.all_reachable"));
    for (const gateway of [{ kind: "failed" }, { kind: "loading" }, { kind: "read", read: { status: "unknown", reason: "read_failed", observed_at: null } }]) {
      const text = statusText(render(language, gateway));
      assert.ok(!text.includes(deskTranslate(language, "gateway.all_reachable")));
    }
  }
} finally { await rm(directory, { recursive: true, force: true }); }

console.log("console desk shell validation passed (including rendered stale gateway status)");

{
// 7. Render the actual status chip: stale reachability cannot sound current.
const { createRequire } = await import("node:module");
const { fileURLToPath } = await import("node:url");
const { join } = await import("node:path");
const frontend = fileURLToPath(new URL("../web/strategy-switch-console/frontend/", import.meta.url));
const require = createRequire(join(frontend, "package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { buildSync } = require("esbuild");
const compiled = buildSync({
  stdin: { contents: 'export { TopBar } from "./desk/shell/TopBar";', resolveDir: join(frontend, "src"), loader: "tsx" },
  bundle: true, platform: "node", format: "cjs", jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"], write: false, logLevel: "silent",
}).outputFiles[0].text;
const component = { exports: {} };
new Function("require", "module", "exports", compiled)(require, component, component.exports);
const gatewayStatus = (gateway, language) => {
  const html = renderToStaticMarkup(React.createElement(component.exports.TopBar, {
    page: "overview", t: (key, values) => deskTranslate(language, key, values), language,
    theme: "light", gateway, nowIso: "2026-11-02T14:00:00Z", serverClock: true,
    mock: null, onLanguage() {}, onTheme() {},
  }));
  return html.match(/role="status"[^>]*>([\s\S]*?)<\/span>/)?.[1].replace(/<[^>]*>/g, "");
};
for (const language of ["en", "zh"]) {
  for (const value of ["all_reachable", "degraded", "down"]) {
    const stale = gatewayStatus({ kind: "read", read: { status: "stale", value,
      observed_at: "2026-11-01T14:00:00Z", age_seconds: 86400 } }, language);
    assert.match(stale, language === "en" ? /stale|unknown/i : /过期|未知/);
    assert.doesNotMatch(stale, /Gateways reachable|网关可达/);
  }
  assert.equal(gatewayStatus({ kind: "read", read: { status: "known", value: "all_reachable",
    observed_at: "2026-11-02T14:00:00Z" } }, language), deskTranslate(language, "gateway.all_reachable"));
  for (const gateway of [{ kind: "failed" }, { kind: "loading" }, { kind: "read", read: { status: "unknown", reason: "read_failed" } }]) {
    assert.doesNotMatch(gatewayStatus(gateway, language), /Gateways reachable|网关可达/);
  }
}
console.log("desk gateway rendering validation passed");

}
