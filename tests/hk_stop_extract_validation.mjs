import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  HK_STOP_DO_ACTIONS,
  HK_STOP_REQUEST_ID,
  HK_STOP_TARGET_ID,
} from "../web/strategy-switch-console/application/hk_stop/constants.js";
import {
  hkStopDigestOrEmpty,
  hkStopExactObject,
  hkStopIdentityComplete,
  hkStopObservation,
  hkStopSourceIdentity,
  normalizeHkStopResult,
  presentHkStop,
} from "../web/strategy-switch-console/application/hk_stop/helpers.js";
import {
  acceptHkStopResult,
  loadHkStopAccount,
} from "../web/strategy-switch-console/application/hk_stop/http.js";
import { loadWorkerSurface, stripComments, surfaceImportsModule } from "./helpers/worker_surface.mjs";

const surface = await loadWorkerSurface();
const { supportSource, wiredSource } = surface;
const helpersSource = await readFile(
  new URL("../web/strategy-switch-console/application/hk_stop/helpers.js", import.meta.url),
  "utf8",
);
const httpSource = await readFile(
  new URL("../web/strategy-switch-console/application/hk_stop/http.js", import.meta.url),
  "utf8",
);

assert.equal(
  surfaceImportsModule(surface, "hk_stop/constants.js"),
  true,
  "Worker stack imports hk_stop constants",
);
assert.equal(
  surfaceImportsModule(surface, "hk_stop/helpers.js"),
  true,
  "Worker stack imports hk_stop helpers",
);
assert.equal(
  surfaceImportsModule(surface, "hk_stop/http.js"),
  true,
  "Worker stack imports hk_stop http",
);

assert.match(supportSource, /async function acceptHkStopResult/);
assert.match(supportSource, /async function loadHkStopAccount/);
assert.match(supportSource, /acceptHkStopResultImpl/);
assert.match(supportSource, /loadHkStopAccountImpl/);
assert.match(wiredSource, /HK_STOP_DO_ACTIONS/);

assert.equal(HK_STOP_TARGET_ID, "longbridge/hk");
assert.equal(HK_STOP_DO_ACTIONS.has("hk_stop_claim"), true);
assert.equal(HK_STOP_REQUEST_ID.test("00000000-0000-4000-8000-000000000000"), true);
assert.equal(typeof hkStopSourceIdentity, "function");
assert.equal(typeof hkStopDigestOrEmpty, "function");
assert.equal(typeof hkStopExactObject, "function");
assert.equal(typeof normalizeHkStopResult, "function");
assert.equal(typeof hkStopIdentityComplete, "function");
assert.equal(typeof presentHkStop, "function");
assert.equal(typeof hkStopObservation, "function");
assert.equal(typeof acceptHkStopResult, "function");
assert.equal(typeof loadHkStopAccount, "function");

const helpersNoComments = stripComments(helpersSource);
assert.equal(
  /from\s+["'][^"']*runtime_support\.js["']/.test(helpersNoComments),
  false,
  "hk_stop helpers must not import runtime_support",
);
assert.equal(
  /from\s+["'][^"']*runtime_support\.js["']/.test(stripComments(httpSource)),
  false,
  "hk_stop http must not import runtime_support",
);
assert.equal(
  httpSource.includes('from "./worker.js"')
    || httpSource.includes("from '../worker.js'")
    || httpSource.includes('from "../../worker.js"'),
  false,
  "hk_stop http must not import worker.js",
);

const identity = hkStopSourceIdentity({
  key: "hk",
  target_name: "hk",
  deployment_selector: "hk-prod",
  account_selector: ["acc"],
  account_scope: "HK",
  service_name: "longbridge-quant-hk-service",
  variable_scope: "environment",
  github_environment: "longbridge-hk",
});
assert.equal(hkStopIdentityComplete(identity), true);
assert.equal(hkStopDigestOrEmpty("not-a-digest"), "");
assert.equal(hkStopDigestOrEmpty("a".repeat(64)), "a".repeat(64));
assert.deepEqual(await hkStopObservation(), { status: "unknown", request_succeeded: false });
