import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "../web/strategy-switch-console/frontend/node_modules/esbuild/lib/main.js";
const directory = await mkdtemp(join(tmpdir(), "console-inbox-requests-"));
const original = globalThis.fetch;
try {
  const outfile = join(directory, "endpoints.mjs");
  await build({ entryPoints: [new URL("../web/strategy-switch-console/frontend/src/api/endpoints.ts", import.meta.url).pathname],
    bundle: true, platform: "node", format: "esm", outfile });
  const { loadInbox, loadRuntimeDaily } = await import(pathToFileURL(outfile));
  const requests = [];
  let settle;
  globalThis.fetch = (path, init) => {
    requests.push({ path, init });
    return new Promise(resolve => { settle = body => resolve(Response.json(body)); });
  };
  const badge = loadInbox(), page = loadInbox();
  assert.equal(badge, page);
  assert.equal(requests.length, 1);
  settle({ status: "read_failed", sources: [] });
  assert.equal((await badge).status, "read_failed", "business errors stay visible");
  const fresh = loadInbox();
  assert.equal(requests.length, 2, "settled data is not cached");
  settle({ status: "ok", sources: [] });
  assert.equal((await fresh).status, "ok");
  const daily = loadRuntimeDaily("2026-10-14", "synthetic", "fixture", false);
  assert.equal(new URL(requests.at(-1).path, "https://synthetic.invalid").searchParams.get("include_history"), "false");
  settle({ ok: true }); await daily;
} finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); }
console.log("console_inbox_requests_validation: PASS");
