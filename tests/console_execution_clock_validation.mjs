// US 23/5: an overnight fill's execution time keeps its local date in the trades UI.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { executionClock } from "../web/strategy-switch-console/frontend/src/pages/performance/executionClock.ts";

assert.equal(executionClock("2026-10-23T09:31:00", "2026-10-23"), "09:31:00", "same-day fill shows only the clock");
assert.equal(executionClock("2026-10-22T20:30:00", "2026-10-23"), "2026-10-22 20:30:00", "overnight fill keeps its local date");
assert.equal(executionClock("2026-10-23T09:31:00", null), "09:31:00", "no trade date: clock only");

const tabs = readFileSync(new URL("../web/strategy-switch-console/frontend/src/pages/performance/PerformanceTabs.tsx", import.meta.url), "utf8");
assert.equal((tabs.match(/executionClock\(row\.local_time, row\.trade_date\)/g) || []).length, 2, "table and card both use executionClock");
assert.doesNotMatch(tabs, /row\.local_time\.slice\(11\)/, "no view drops the local date");
console.log("console_execution_clock_validation: PASS (overnight fills keep their local execution date)");
