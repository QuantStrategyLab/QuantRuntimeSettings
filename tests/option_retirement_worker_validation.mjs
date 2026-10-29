import assert from "node:assert/strict";
import { __test } from "../web/strategy-switch-console/worker.js";

const input = { platform: "ibkr", target_name: "preview", strategy_profile: "tqqq_growth_income" };
assert.equal(__test.normalizeSwitchInputs(input).option_overlay_mode, "current");
assert.equal(__test.normalizeSwitchInputs({ ...input, option_overlay_mode: "current" }).option_overlay_mode, "current");
assert.equal(__test.normalizeSwitchInputs({ ...input, option_overlay_mode: "disabled" }).option_overlay_mode, "disabled");
assert.throws(() => __test.normalizeSwitchInputs({ ...input, option_overlay_mode: "enabled" }), /option overlay is retired/);
console.log("Worker option retirement: current preserved, explicit enabled rejected, disabled remains explicit.");
