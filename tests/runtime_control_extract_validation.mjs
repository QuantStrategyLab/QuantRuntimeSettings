import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { RUNTIME_CONTROL_DO_ACTIONS } from "../web/strategy-switch-console/application/runtime_control/constants.js";
import {
  presentRuntimeControl,
  runtimeControlIdentityIsComplete,
  runtimeControlStopRequest,
} from "../web/strategy-switch-console/application/runtime_control/helpers.js";
import {
  runtimeControlSource,
  readPlatformRuntimeControl,
  dispatchPlatformRuntimeControl,
} from "../web/strategy-switch-console/application/runtime_control/http.js";
import {
  loadWorkerSurface,
  stripComments,
  surfaceDefinesFunction,
  surfaceImportsModule,
} from "./helpers/worker_surface.mjs";

const runtimeControlModules = [
  "application/runtime_control/constants.js",
  "application/runtime_control/helpers.js",
  "application/runtime_control/http.js",
];

const surface = await loadWorkerSurface({
  includeDurableObject: true,
  applicationModules: runtimeControlModules,
});
const { supportSource, durableSource, wiredSource } = surface;

const helpersSource = await readFile(
  new URL("../web/strategy-switch-console/application/runtime_control/helpers.js", import.meta.url),
  "utf8",
);
const httpSource = await readFile(
  new URL("../web/strategy-switch-console/application/runtime_control/http.js", import.meta.url),
  "utf8",
);

assert.equal(
  surfaceImportsModule(surface, "runtime_control/constants.js"),
  true,
  "Worker stack imports runtime_control constants",
);
assert.equal(
  surfaceImportsModule(surface, "runtime_control/helpers.js"),
  true,
  "Worker stack imports runtime_control helpers",
);
assert.equal(
  surfaceImportsModule(surface, "runtime_control/http.js"),
  true,
  "Worker stack imports runtime_control http",
);

assert.match(supportSource, /async function runtimeControlSource/);
assert.match(supportSource, /async function readPlatformRuntimeControl/);
assert.match(supportSource, /function runtimeControlStopRequest/);
assert.match(supportSource, /async function dispatchPlatformRuntimeControl/);
assert.match(supportSource, /runtimeControlSourceImpl/);
assert.match(supportSource, /readPlatformRuntimeControlImpl/);
assert.match(supportSource, /runtimeControlStopRequestImpl/);
assert.match(supportSource, /dispatchPlatformRuntimeControlImpl/);
assert.match(wiredSource, /RUNTIME_CONTROL_DO_ACTIONS/);
assert.match(durableSource, /RUNTIME_CONTROL_DO_ACTIONS/);
assert.match(durableSource, /runtimeControlIdentityIsComplete/);

for (const name of [
  "presentRuntimeControl",
  "runtimeControlIdentityIsComplete",
  "runtimeControlStopRequest",
  "runtimeControlSource",
  "readPlatformRuntimeControl",
  "dispatchPlatformRuntimeControl",
]) {
  assert.equal(surfaceDefinesFunction(surface, name), true, name);
}

assert.equal(RUNTIME_CONTROL_DO_ACTIONS.has("runtime_control_claim"), true);
assert.equal(RUNTIME_CONTROL_DO_ACTIONS.has("runtime_control_read"), true);
assert.equal(typeof presentRuntimeControl, "function");
assert.equal(typeof runtimeControlIdentityIsComplete, "function");
assert.equal(typeof runtimeControlStopRequest, "function");
assert.equal(typeof runtimeControlSource, "function");
assert.equal(typeof readPlatformRuntimeControl, "function");
assert.equal(typeof dispatchPlatformRuntimeControl, "function");

assert.deepEqual(presentRuntimeControl(null), {
  ok: true,
  request_id: null,
  action: null,
  phase: null,
  updated_at: null,
  unavailable_reason: null,
  platform_applied: false,
});
assert.equal(presentRuntimeControl({ phase: "unknown", request_id: "r1" }).unavailable_reason, "runtime_control_result_unavailable");
assert.equal(runtimeControlIdentityIsComplete({
  platform: "ibkr",
  key: "synthetic",
  target_name: "synthetic",
  broker_environment: null,
  account_selector: "acc",
  deployment_selector: "dep",
  account_scope: "scope",
  service_name: "svc",
}), true);
assert.equal(runtimeControlIdentityIsComplete({
  platform: "ibkr",
  key: "synthetic",
  target_name: "synthetic",
  broker_environment: null,
  account_selector: "acc",
  deployment_selector: "dep",
  account_scope: "scope",
  service_name: "",
}), false);

for (const source of [helpersSource, httpSource]) {
  const noComments = stripComments(source);
  assert.equal(
    /from\s+["'][^"']*runtime_support\.js["']/.test(noComments),
    false,
    "runtime_control modules must not import runtime_support",
  );
  assert.equal(
    source.includes('from "./worker.js"')
      || source.includes("from '../worker.js'")
      || source.includes('from "../../worker.js"'),
    false,
    "runtime_control modules must not import worker.js",
  );
}

console.log("runtime_control_extract_validation: ok");
