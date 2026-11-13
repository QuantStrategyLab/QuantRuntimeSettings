import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const diagnosisTargetsSource = [
  readFileSync(new URL("../web/strategy-switch-console/worker.js", import.meta.url), "utf8"),
  readFileSync(new URL("../web/strategy-switch-console/application/account_diagnosis/constants.js", import.meta.url), "utf8"),
].join("\n");
assert.match(diagnosisTargetsSource, /"schwab\.primary": Object\.freeze\(/);
assert.match(diagnosisTargetsSource, /"firstrade\.primary": Object\.freeze\(/);
assert.match(diagnosisTargetsSource, /recheckRepository: "QuantStrategyLab\/CharlesSchwabPlatform"/);
assert.match(diagnosisTargetsSource, /recheckRepository: "QuantStrategyLab\/FirstradePlatform"/);
assert.match(diagnosisTargetsSource, /recheckWorkflow: "runtime-target-lifecycle\.yml"/);
console.log("account_diagnosis_targets_validation: PASS (schwab.primary + firstrade.primary admitted)");
