import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker, { __test } from "../web/strategy-switch-console/worker.js";
import { V2_ASSETS, V2_PAGE_HTML } from "../web/strategy-switch-console/v2_asset_map.js";

const request = (path, method = "GET", headers = {}) => new Request(`https://console.example${path}`, { method, headers });
for (const path of ["/"]) {
  const response = await worker.fetch(request(path), {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; connect-src 'self'; script-src 'self'; style-src 'self'");
  assert.equal(await response.text(), V2_PAGE_HTML);
  assert.equal((await worker.fetch(request(path, "HEAD"), {})).headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(await (await worker.fetch(request(path, "HEAD"), {})).text(), "");
  assert.equal((await worker.fetch(request(path, "POST"), {})).status, 405);
}
const adminEnv = { SESSION_SECRET: "synthetic-session-only", STRATEGY_SWITCH_ADMIN_LOGINS: "fixture-admin", ALLOWED_GITHUB_LOGINS: "fixture-user" };
const nonAdminSession = await __test.makeSession("fixture-user", [], adminEnv);
const adminSession = await __test.makeSession("fixture-admin", [], adminEnv);
const missingPage = await (await worker.fetch(request("/missing"), {})).text();
for (const headers of [{}, { Cookie: `qsl_switch_session=${nonAdminSession}` }, { Cookie: `qsl_switch_session=${adminSession}` }]) {
  const adminPage = await worker.fetch(request("/admin", "GET", headers), adminEnv);
  assert.equal(adminPage.status, 404, "/admin is not a page");
  assert.equal(await adminPage.text(), missingPage, "/admin uses the existing unknown-page response");
}
assert.equal((await worker.fetch(request("/admin", "POST", { Cookie: `qsl_switch_session=${adminSession}` }), adminEnv)).status, 404, "/admin POST follows the unknown-route response");
assert.equal((await worker.fetch(request("/missing", "POST"), {})).status, 404);
const anonymousSession = await worker.fetch(request("/api/session"), {}).then(response => response.json());
assert.equal(anonymousSession.allowed, false);
const anonymousConfig = await worker.fetch(request("/api/config"), {}).then(response => response.json());
assert.equal(anonymousConfig.accountOptions, null, "public route exposes no private account routing before session validation");

assert.match(V2_PAGE_HTML, /<div id="root"><\/div>/);
assert.doesNotMatch(V2_PAGE_HTML, /<script[^>]*>[^<]/i);
assert.ok(V2_PAGE_HTML.includes("/v2/assets/index-"), "shell references the versioned bundle");
for (const referenced of V2_PAGE_HTML.matchAll(/(?:src|href)="(\/v2\/assets\/[^\"]+)"/g)) {
  assert.ok(V2_ASSETS[referenced[1]], `every shell reference has a generated asset: ${referenced[1]}`);
}
const privateBundleText = Object.entries(V2_ASSETS)
  .filter(([path]) => path.endsWith(".js"))
  .map(([, asset]) => Buffer.from(asset.base64, "base64").toString("utf8"))
  .join("\n");
assert.doesNotMatch(privateBundleText, /private-account-routing-fixture|qsl_switch_session|SESSION_SECRET/);

const icon = V2_ASSETS["/v2/assets/qsl-brand-icon.png"];
assert.equal(icon.contentType, "image/png");
const iconResponse = await worker.fetch(request("/v2/assets/qsl-brand-icon.png"), {});
assert.equal(iconResponse.status, 200);
assert.equal(iconResponse.headers.get("content-type"), "image/png");
assert.equal(iconResponse.headers.get("cache-control"), "no-cache");
assert.deepEqual(Buffer.from(await iconResponse.arrayBuffer()), await readFile(new URL("../web/strategy-switch-console/frontend/public/qsl-brand-icon.png", import.meta.url)));
const iconHead = await worker.fetch(request("/v2/assets/qsl-brand-icon.png", "HEAD"), {});
assert.equal(iconHead.status, 200);
assert.equal(await iconHead.text(), "");
for (const path of ["/v2", "/v2/unknown", "/v2/assets/not-built.js", "/v2/assets/%2e%2e%2fapi%2fconfig"]) {
  assert.equal((await worker.fetch(request(path), {})).status, 404, `${path} must not fall back to the shell`);
  const head = await worker.fetch(request(path, "HEAD"), {});
  assert.equal(head.status, 404);
  assert.equal(await head.text(), "", "HEAD responses must not include an error body");
}
for (const method of ["POST", "PUT", "DELETE"]) assert.equal((await worker.fetch(request("/v2/assets/qsl-brand-icon.png", method), {})).status, 405);
assert.equal((await worker.fetch(request("/missing"), {})).status, 404);
console.log("console_v2_worker_validation: PASS");
