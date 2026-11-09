// Desk (Meridian) overview: signed currency text, headline counts, risk meters and the
// plotting geometry. Pure modules only; every unknown stays unknown instead of becoming 0.
import assert from "node:assert/strict";
import {
  curveGeometry, formatMoney, formatMultiple, formatSignedMoney, formatSignedPercent, headlineCounts, meter, sparkPaths,
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
assert.deepEqual(okCounts, { running: 5, steady: 5, drifting: 0, configUnknown: 0, total: 6 });
// A running book whose config could not be read is not evidence that the saved plan matches:
// it is counted as unknown, never as steady.
const unreadableConfig = headlineCounts([{
  ...overviewOk.book[0], runtime: { status: "known", value: "running", observed_at: "2026-11-02T14:31:48Z" },
  config: { state: "unknown", drift_count: 0, checked_at: null },
}]);
assert.deepEqual(unreadableConfig, { running: 1, steady: 0, drifting: 0, configUnknown: 1, total: 1 });
// A book whose runtime is unknown is not counted as running.
const degradedCounts = headlineCounts(overviewDegraded.book);
assert.equal(degradedCounts.total, 6);
assert.equal(degradedCounts.drifting, 0);
assert.equal(degradedCounts.steady + degradedCounts.configUnknown, degradedCounts.running);
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
assert.deepEqual(sparkPaths([], [], null, null, 120, 32), [], "no points, no path");
assert.deepEqual(sparkPaths(["100"], [], "2026-10-10", "2026-10-10", 120, 32), [], "one point is not a trend");

const solid = sparkPaths(["100", "101", "102"], [], "2026-10-10", "2026-10-12", 120, 32);
assert.equal(solid.length, 1);
assert.match(solid[0], /^M\d/);

// A gap splits the line, and both runs keep their place on one shared timeline and scale:
// 10 → x 1, 11 → x 30.5, (12 missing), 13 → x 89.5, 14 → x 119, with 100 at the bottom and
// 104 at the top. Stretching each run to the full width would put both starts near x 1.
const gapped = sparkPaths(["100", "101", "103", "104"], ["2026-10-12"], "2026-10-10", "2026-10-14", 120, 32);
assert.deepEqual(gapped, ["M1.00 31.00 L30.50 23.50", "M89.50 8.50 L119.00 1.00"]);

// When every observed run holds a single point there is nothing to draw; the page says the
// history is too short instead of joining the two points across the missing day.
assert.deepEqual(sparkPaths(["100", "104"], ["2026-10-11"], "2026-10-10", "2026-10-12", 120, 32), []);
assert.deepEqual(sparkPaths(["100", "104"], [], "2026-10-10", "2026-10-12", 120, 32).length, 1, "no gap, one run");

// A series that does not cover the window's observed days cannot be placed by date; it is drawn
// as one run by index rather than split at a guessed date.
const misaligned = sparkPaths(["100", "101", "102"], ["2026-10-11"], "2026-10-10", "2026-10-14", 120, 32);
assert.equal(misaligned.length, 1);

console.log("console_desk_overview_validation: PASS");
