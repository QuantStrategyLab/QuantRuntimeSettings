import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workerSource = readFileSync(new URL("../web/strategy-switch-console/worker.js", import.meta.url), "utf8");
assert.match(workerSource, /"schwab\.live": Object\.freeze\(/);
assert.match(workerSource, /"firstrade\.live": Object\.freeze\(/);
assert.match(workerSource, /recheckRepository: "QuantStrategyLab\/CharlesSchwabPlatform"/);
assert.match(workerSource, /recheckRepository: "QuantStrategyLab\/FirstradePlatform"/);
assert.match(workerSource, /recheckWorkflow: "runtime-target-lifecycle\.yml"/);
console.log("account_diagnosis_targets_validation: PASS (schwab.live + firstrade.live admitted)");
