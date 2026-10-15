import assert from "node:assert/strict";
import worker from "../web/strategy-switch-console/worker.js";
import { V2_ASSETS, V2_PAGE_HTML } from "../web/strategy-switch-console/v2_asset_map.js";
import { validateV2Assets } from "../web/strategy-switch-console/frontend/scripts/validate-v2-assets.mjs";

const references = validateV2Assets(V2_PAGE_HTML, V2_ASSETS);
assert.ok(references.length > 2, "validate transitive references as well as the shell");
// Remove every referenced asset in turn. This covers static imports, lazy page
// imports, CSS and Vite's preload dependency array without pinning build hashes.
for (const path of new Set(references.map(reference => reference.path))) {
  const incomplete = { ...V2_ASSETS };
  delete incomplete[path];
  assert.throws(() => validateV2Assets(V2_PAGE_HTML, incomplete), /missing embedded asset/);
}
const fixture = text => ({ base64: Buffer.from(text).toString("base64") });
for (const text of ['import "./missing.js";', 'import("./missing.js?v=1")', 'const preload=["assets/missing.css"]', '@import "./missing.css";', '@import url(./missing.css);']) {
  assert.throws(() => validateV2Assets('', { '/v2/assets/entry.js': fixture(text) }), /missing embedded asset/);
}
for (const [path, asset] of Object.entries(V2_ASSETS)) {
  for (const method of ["GET", "HEAD"]) {
    const response = await worker.fetch(new Request(`https://console.invalid${path}`, { method }), {});
    assert.equal(response.status, 200, `${method} ${path}`);
    assert.equal(response.headers.get("content-type"), asset.contentType, path);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), method === "HEAD" ? Buffer.alloc(0) : Buffer.from(asset.base64, "base64"), path);
  }
}
console.log(`console_v2_assets_validation: PASS (${references.length} references; ${Object.keys(V2_ASSETS).length} assets served)`);
