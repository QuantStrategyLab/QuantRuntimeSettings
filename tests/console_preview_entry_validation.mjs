import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import worker from "../web/strategy-switch-console/worker.js";
import { V2_PAGE_HTML, V2_ASSETS } from "../web/strategy-switch-console/v2_asset_map.js";
import { previewResponse } from "../web/strategy-switch-console/preview_entry.js";
const origin = "https://console.example";
const page = { html: '<html><script src="/preview/assets/index-abcdefgh.js"></script></html>', assets: {
  "/preview/assets/index-abcdefgh.js": { contentType: "text/javascript", base64: btoa("synthetic-preview") },
} };
for (const method of ["GET", "HEAD"]) {
  const shell = previewResponse(new Request(origin + "/preview/", { method }), page, h => new Headers(h));
  assert.equal(shell.status, 200);
  assert.equal(shell.headers.get("Cache-Control"), "no-store");
  assert.equal(await shell.text(), method === "HEAD" ? "" : page.html);
  const asset = previewResponse(new Request(origin + "/preview/assets/index-abcdefgh.js", { method }), page, h => new Headers(h));
  assert.match(asset.headers.get("Cache-Control"), /immutable/);
  assert.equal(await asset.text(), method === "HEAD" ? "" : "synthetic-preview");
}
const redirect = previewResponse(new Request(origin + "/preview?qa=synthetic"), page, h => new Headers(h));
assert.equal(redirect.status, 308);
assert.equal(redirect.headers.get("Location"), "/preview/?qa=synthetic");
for (const path of ["/preview/v2/assets/missing.js", "/preview/assets/missing.js", "/preview/api/session", "/preview/unknown"])
  assert.equal(previewResponse(new Request(origin + path), page, h => new Headers(h)).status, 404);
assert.equal(previewResponse(new Request(origin + "/preview/", { method: "POST" }), page, h => new Headers(h)).status, 405);
const production = await worker.fetch(new Request(origin + "/"), {});
assert.equal(await production.text(), V2_PAGE_HTML);
assert.ok(production.headers.get("Content-Security-Policy"));
const assetPath = Object.keys(V2_ASSETS)[0];
assert.equal((await worker.fetch(new Request(origin + assetPath), {})).status, 200);
const disabled = await worker.fetch(new Request(origin + "/preview/"), {});
assert.equal(disabled.status, 404, "unapproved preview bundle remains unavailable");
assert.ok(disabled.headers.get("Content-Security-Policy"));
assert.equal((await worker.fetch(new Request(origin + "/api/decisions-inbox"), {})).status, 401);

// Generate a completely fictional preview bundle in a temporary tree.
const temp = await mkdtemp(join(tmpdir(), "console-preview-"));
const frontend = join(temp, "frontend");
await mkdir(join(frontend, "scripts"), { recursive: true });
await mkdir(join(frontend, "dist-preview", "assets"), { recursive: true });
const script = join(frontend, "scripts", "sync-v2-asset-map.mjs");
await copyFile(new URL("../web/strategy-switch-console/frontend/scripts/sync-v2-asset-map.mjs", import.meta.url), script);
await writeFile(join(frontend, "dist-preview", "index.html"), page.html);
await writeFile(join(frontend, "dist-preview", "assets", "index-abcdefgh.js"), "synthetic-preview");
await writeFile(join(frontend, "dist-preview", "qsl-brand-icon.png"), new Uint8Array([1, 2, 3]));
await writeFile(join(temp, "v2_asset_map.js"), "production-sentinel");
const generated = spawnSync(process.execPath, [script, "--preview"], { encoding: "utf8" });
assert.equal(generated.status, 0, generated.stderr);
assert.equal(await readFile(join(temp, "v2_asset_map.js"), "utf8"), "production-sentinel");
const bundle = await import(pathToFileURL(join(temp, "preview_asset_map.js")));
assert.equal(bundle.PREVIEW_PAGE_HTML, page.html);
assert.deepEqual(Object.keys(bundle.PREVIEW_ASSETS).sort(), ["/preview/assets/index-abcdefgh.js", "/preview/assets/qsl-brand-icon.png"]);
await writeFile(join(frontend, "dist-preview", "index.html"), '<script src="/v2/assets/index-abcdefgh.js"></script>');
assert.notEqual(spawnSync(process.execPath, [script, "--preview"]).status, 0, "reject production asset references in preview HTML");
console.log("console_preview_entry_validation: PASS");
