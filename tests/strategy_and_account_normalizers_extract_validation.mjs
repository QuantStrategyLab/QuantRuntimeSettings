import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as constants from "../web/strategy-switch-console/application/strategy_and_account_normalizers/constants.js";
import * as helpers from "../web/strategy-switch-console/application/strategy_and_account_normalizers/helpers.js";
import * as runtimeSupport from "../web/strategy-switch-console/application/worker/runtime_support.js";
import { loadWorkerSurface, stripComments, surfaceImportsModule } from "./helpers/worker_surface.mjs";

const surface = await loadWorkerSurface();
for (const layer of ["constants.js", "helpers.js"]) {
  assert.equal(
    surfaceImportsModule(surface, `strategy_and_account_normalizers/${layer}`),
    true,
    `Worker stack imports strategy_and_account_normalizers/${layer}`,
  );
  const src = stripComments(
    await readFile(new URL(`../web/strategy-switch-console/application/strategy_and_account_normalizers/${layer}`, import.meta.url), "utf8"),
  );
  assert.doesNotMatch(src, /from\s+["'][^"']*(?:runtime_support|worker|application\/worker\/)[^"']*["']/, `${layer} must not import worker modules`);
}

for (const key of [
  "SUPPORTED_PLATFORMS",
  "LEGACY_CASH_ONLY_EXECUTION_VARIABLE",
  "CASH_ONLY_EXECUTION_MODES",
  "INCOME_LAYER_ENABLED_VARIABLE",
  "INCOME_LAYER_START_USD_VARIABLE",
  "INCOME_LAYER_MAX_RATIO_VARIABLE",
  "OPTION_OVERLAY_ENABLED_VARIABLE",
  "RUNTIME_TARGET_ENABLED_VARIABLE",
  "DCA_MODE_VARIABLE",
  "DCA_BASE_INVESTMENT_VARIABLE",
  "IBIT_ZSCORE_EXIT_MODE_VARIABLE",
  "IBIT_ZSCORE_EXIT_ENABLED_VARIABLE",
  "IBIT_ZSCORE_EXIT_PARKING_SYMBOL_VARIABLE",
  "OPTION_OVERLAY_VARIABLES",
  "OPTION_OVERLAY_MODES",
]) {
  assert.equal(runtimeSupport[key], constants[key], `runtime_support re-exports ${key}`);
}
for (const key of Object.keys(helpers)) {
  assert.equal(runtimeSupport[key], helpers[key], `runtime_support re-exports ${key}`);
}

assert.equal(helpers.cleanCurrentStrategy("  SPY_MOMENTUM  "), "spy_momentum");
assert.equal(helpers.cleanExecutionMode("paper"), "dry_run");
assert.throws(
  () => helpers.rejectResearchOnlyExtraVariables({ OPTION_OVERLAY_ENABLED: "true" }),
  /research-only/,
);
assert.throws(() => helpers.normalizeBrokerEnvironment("sandbox"), /live or paper/);
