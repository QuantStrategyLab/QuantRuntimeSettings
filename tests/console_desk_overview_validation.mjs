// Desk (Meridian) overview: signed currency text, headline counts, risk meters and the
// plotting geometry. Pure modules only; every unknown stays unknown instead of becoming 0.
import assert from "node:assert/strict";
import {
  curveGeometry, formatMoney, formatMultiple, formatSignedMoney, formatSignedPercent, headlineCounts, meter, sparkPath, sparkSegments,
} from "../web/strategy-switch-console/frontend/src/desk/overview/model.ts";
import { ok as overviewOk, degraded as overviewDegraded } from "../web/strategy-switch-console/frontend/src/desk/api/fixtures/overview.ts";

// ---------------------------------------------------------------- signed figures
assert.equal(formatSignedPercent("0.0059"), "+0.59%");
assert.equal(formatSignedPercent("-0.141"), "−14.10%");
assert.equal(formatSignedPercent("-0.049", 1), "−4.9%");
assert.equal(formatSignedPercent("0"), "0.00%", "zero carries no sign");
assert.equal(formatSignedPercent(null), null, "unknown is not zero");
assert.equal(formatSignedPercent("not-a-number"), null);

assert.equal(formatMultiple("0.964"), "0.96×");
assert.equal(formatMultiple(null), null);

assert.equal(formatMoney("1189800.00", "USD", "en"), "$1,189,800");
assert.equal(formatMoney("1113000.00", "HKD", "en"), "1,113,000 HKD");
assert.equal(formatMoney(null, "USD", "en"), null);
assert.equal(formatSignedMoney("6976.00", "USD", "en"), "+$6,976");
assert.equal(formatSignedMoney("-1256.00", "USD", "zh"), "−$1,256");
assert.equal(formatSignedMoney(null, "USD", "zh"), null);

// ---------------------------------------------------------------- headline counts
// HK reports identity_unverified, so it is not running; its drift stays visible through
// needs_you instead of being folded into the sentence.
const okCounts = headlineCounts(overviewOk.book);
assert.deepEqual(okCounts, { running: 5, steady: 5, drifting: 0, total: 6 });
assert.equal(okCounts.running + okCounts.drifting, okCounts.running, "drift is counted inside running");
// A book whose runtime is unknown is not counted as running, and drift is never invented.
const degradedCounts = headlineCounts(overviewDegraded.book);
assert.equal(degradedCounts.total, 6);
assert.equal(degradedCounts.drifting, 0);
assert.equal(degradedCounts.steady, degradedCounts.running);
assert.ok(degradedCounts.running < 6, "the unreadable book drops out of the running count");

// ---------------------------------------------------------------- risk meters
// 14.1% against a 15% limit is nearly full and reads as a warning, not as safe.
assert.deepEqual(meter("-0.141", "-0.15", 10), { filled: 9, tone: "warn" });
assert.deepEqual(meter("-0.062", "-0.15", 10), { filled: 4, tone: "ok" });
assert.deepEqual(meter("-0.18", "-0.15", 10), { filled: 10, tone: "over" }, "a breach fills the meter");
assert.deepEqual(meter("0", "-0.15", 10), { filled: 0, tone: "ok" });
assert.deepEqual(meter(null, "-0.15", 10), { filled: null, tone: "unknown" }, "no ratio, no fill");
assert.deepEqual(meter("-0.141", null, 10), { filled: null, tone: "unknown" }, "no limit, no fill");
assert.deepEqual(meter("-0.141", "0", 10), { filled: null, tone: "unknown" }, "a zero limit cannot be used");

// ---------------------------------------------------------------- equity curve
const curve = curveGeometry(overviewOk.equity_curve, 720, 220);
assert.ok(curve, "the ready fixture plots");
assert.match(curve.portfolioPath, /^M\d/);
assert.match(curve.benchmarkPath, /^M\d/);
assert.match(curve.areaPath, /Z$/, "the area closes");
assert.match(curve.drawdownPath, /Z$/, "the drawdown band closes");
assert.ok(curve.min < curve.max);
assert.ok(curve.drawdownMin !== null && curve.drawdownMin <= 0, "drawdown is measured from the peak");

// No benchmark in the degraded fixture, so the line is absent rather than flat at 0.
const degradedCurve = curveGeometry(overviewDegraded.equity_curve, 720, 220);
assert.ok(degradedCurve);
assert.equal(degradedCurve.benchmarkPath, null);

// A single point cannot make a line.
const single = { ...overviewOk.equity_curve, portfolio: { dates: ["2026-11-02"], indexed: ["100"] } };
assert.equal(curveGeometry(single, 720, 220), null, "one point is not a curve");
assert.equal(curveGeometry({ ...single, portfolio: { dates: [], indexed: [] } }, 720, 220), null);

// ---------------------------------------------------------------- sparklines
assert.equal(sparkPath([], 120, 32), "");
assert.equal(sparkPath(["100"], 120, 32), "");
assert.match(sparkPath(["100", "101", "102"], 120, 32), /^M\d/);
const flat = sparkPath(["100", "100", "100"], 120, 32);
assert.match(flat, /^M/, "a flat series still draws");

// A gap date breaks the line instead of joining across the unobserved day.
const withGap = sparkSegments(
  ["100", "101", "103", "104"], ["2026-10-12"], "2026-10-10", "2026-10-14",
);
assert.equal(withGap.flat().length, 4, "no point is dropped");
assert.equal(sparkSegments(["100", "101"], [], "2026-10-10", "2026-10-11").length, 1, "no gap, one segment");
assert.deepEqual(sparkSegments([], [], null, null), [[]], "an empty series stays empty");

console.log("console_desk_overview_validation: PASS");
