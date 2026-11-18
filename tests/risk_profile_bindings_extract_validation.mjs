import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as constants from "../web/strategy-switch-console/application/risk_profile_bindings/constants.js";
import * as helpers from "../web/strategy-switch-console/application/risk_profile_bindings/helpers.js";
import * as runtimeSupport from "../web/strategy-switch-console/application/worker/runtime_support.js";
import { loadWorkerSurface, stripComments, surfaceImportsModule } from "./helpers/worker_surface.mjs";

const surface = await loadWorkerSurface();
for (const layer of ["constants.js", "helpers.js"]) {
  assert.equal(
    surfaceImportsModule(surface, `risk_profile_bindings/${layer}`),
    true,
    `Worker stack imports risk_profile_bindings/${layer}`,
  );
  const src = stripComments(
    await readFile(new URL(`../web/strategy-switch-console/application/risk_profile_bindings/${layer}`, import.meta.url), "utf8"),
  );
  assert.doesNotMatch(src, /from\s+["'][^"']*(?:runtime_support|worker|application\/worker\/)[^"']*["']/, `${layer} must not import worker modules`);
}

for (const key of [
  "RISK_PROFILE_BINDINGS_KEY",
  "RISK_PROFILE_BINDING_REGISTRY_SCHEMA_VERSION",
  "RISK_PROFILE_BINDING_SCHEMA_VERSION",
  "RISK_PROFILE_SELECTION_SCHEMA_VERSION",
  "RISK_PROFILE_PREFERENCES",
]) {
  assert.equal(runtimeSupport[key], constants[key], `runtime_support re-exports ${key}`);
}
for (const key of Object.keys(helpers)) {
  assert.equal(runtimeSupport[key], helpers[key], `runtime_support re-exports ${key}`);
}

const built = await helpers.buildRiskProfileBindings(
  { bindings: [{ platform: "ibkr", target_name: "paper", risk_preference: "BALANCED_COMPOUNDING" }] },
  { ibkr: [{ target_name: "paper" }] },
  "octocat",
);
assert.equal(built.length, 1);
assert.equal(built[0].no_order, true);
assert.equal(built[0].execution_authority_granted, false);
const registry = await helpers.normalizeRiskProfileBindingRegistry({
  schema_version: constants.RISK_PROFILE_BINDING_REGISTRY_SCHEMA_VERSION,
  bindings: built,
});
assert.equal(registry[0].scope_id, "ibkr--paper");
await assert.rejects(
  () => helpers.buildRiskProfileBindings(
    { bindings: [{ platform: "ibkr", target_name: "missing", risk_preference: "BALANCED_COMPOUNDING" }] },
    { ibkr: [{ target_name: "paper" }] },
    "octocat",
  ),
  /not configured/,
);
