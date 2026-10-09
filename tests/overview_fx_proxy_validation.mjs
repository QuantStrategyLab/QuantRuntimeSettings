import assert from "node:assert/strict";
import worker, { __test } from "../web/strategy-switch-console/worker.js";
import {
  OVERVIEW_FX_API_URL,
  OVERVIEW_FX_UPSTREAM_URL,
  parseFrankfurterUsdBaseRates,
} from "../web/strategy-switch-console/frontend/src/presentation.ts";

assert.equal(OVERVIEW_FX_API_URL, __test.OVERVIEW_FX_PROXY_PATH);
assert.equal(OVERVIEW_FX_UPSTREAM_URL, __test.OVERVIEW_FX_UPSTREAM_URL);

const fs = await import("node:fs/promises");
const workerSource = await fs.readFile(
  new URL("../web/strategy-switch-console/worker.js", import.meta.url),
  "utf8",
);
const fxSource = await fs.readFile(
  new URL("../web/strategy-switch-console/infrastructure/fx/overview_fx.js", import.meta.url),
  "utf8",
);
assert.match(workerSource, /connect-src 'self'/, "CSP stays same-origin; Frankfurter is not widened into connect-src");
assert.equal(fxSource.includes("api.frankfurter.dev"), true, "FX module retains the fixed Frankfurter upstream");
assert.equal(workerSource.includes("infrastructure/fx/overview_fx.js"), true, "Worker imports the FX module");
assert.equal(/connect-src[^;]*frankfurter/.test(workerSource), false, "browser CSP must not allow frankfurter");

__test.resetOverviewFxCache();
const frankfurterBody = JSON.stringify({
  amount: 1.0,
  base: "USD",
  date: "2026-10-08",
  rates: { CNY: 6.7023, EUR: 0.89397, HKD: 7.8476, SGD: 1.282 },
});
let upstreamCalls = 0;
const fakeFetch = async (resource) => {
  upstreamCalls += 1;
  assert.equal(String(resource), OVERVIEW_FX_UPSTREAM_URL, "proxy fetches only the fixed upstream URL");
  return new Response(frankfurterBody, { status: 200, headers: { "Content-Type": "application/json" } });
};

const ok = await __test.overviewFxResponse(
  new Request("https://console.example/api/overview-fx"),
  fakeFetch,
);
assert.equal(ok.status, 200);
const payload = await ok.json();
assert.equal(payload.base, "USD");
assert.ok(parseFrankfurterUsdBaseRates(payload).SGD);

const cached = await __test.overviewFxResponse(
  new Request("https://console.example/api/overview-fx"),
  fakeFetch,
);
assert.equal(cached.status, 200);
assert.equal(upstreamCalls, 1, "successful FX responses cache briefly in the Worker");

__test.resetOverviewFxCache();
const failed = await __test.overviewFxResponse(
  new Request("https://console.example/api/overview-fx"),
  async () => { throw new Error("network_down"); },
);
assert.equal(failed.status, 502);
assert.equal((await failed.json()).error, "overview_fx_upstream_unavailable");

__test.resetOverviewFxCache();
const badShape = await __test.overviewFxResponse(
  new Request("https://console.example/api/overview-fx"),
  async () => new Response(JSON.stringify({ base: "EUR", rates: { USD: 1 } }), { status: 200 }),
);
assert.equal(badShape.status, 502);
assert.equal((await badShape.json()).error, "overview_fx_upstream_invalid");

const routed = await worker.fetch(new Request("https://console.example/api/overview-fx"), {});
// Without injecting fetch, live upstream may succeed or fail; route must exist (not 404).
assert.notEqual(routed.status, 404);
assert.notEqual(routed.status, 405);
assert.equal(
  (await worker.fetch(new Request("https://console.example/api/overview-fx", { method: "POST" }), {})).status,
  405,
);

console.log("overview_fx_proxy_validation ok");
