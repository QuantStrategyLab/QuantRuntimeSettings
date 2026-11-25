import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  CalendarDigestError,
  classifyUsEquitySessionWindow,
  createXnysRuntimeProvider,
  isOfficialCloseBarTimestamp,
  isOrderAllowedAt,
  loadAllSpecs,
  loadSpec,
  projectSessionClosureLabel,
  resolveClearingTradeDate,
  resolvePriorCloseSession,
  resolvePreviousTradingDate,
  resolveSession,
  verifyCalendarPackage,
} from "../web/strategy-switch-console/application/market_sessions/xnys_calendar.js";
import {
  CSA22_PACKAGES,
  CSA22_PINNED_DIGESTS,
} from "../web/strategy-switch-console/application/market_sessions/data.js";
import {
  countXnysSessionCloses,
  createPinnedCalendarProvider,
  createRuntimeCalendarProvider,
  evaluateFreshness,
  evaluateFreshnessWithRuntimeCalendar,
} from "../web/strategy-switch-console/application/sizing_unit/freshness.js";
import { hasGap } from "../web/strategy-switch-console/performance_math.js";
import { aggregateEquityHistory } from "../web/strategy-switch-console/application/console_api/equity_history.js";
import {
  calendarCells,
  dailyChanges,
  performanceBlocks,
} from "../web/strategy-switch-console/application/console_api/performance.js";
import { applyNativeDailyReturns } from "../web/strategy-switch-console/application/console_api/native_daily_returns.js";
import {
  resolveOperationsMarketSession,
  todaySummary,
} from "../web/strategy-switch-console/application/console_api/operations.js";
import { ribbonSessions } from "../web/strategy-switch-console/application/desk/ribbon.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const Ajv2020 = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats");

const readBytes = (relPath) => readFileSync(new URL(relPath, import.meta.url));
const readJson = (relPath) => JSON.parse(readBytes(relPath).toString("utf8"));
const sha256Bytes = (buf) => createHash("sha256").update(buf).digest("hex");

const calendarSchema = readJson("../schemas/qsl-market-sessions-calendar.v1.schema.json");
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
addFormats(ajv);
const validateCalendarSchema = ajv.compile(calendarSchema);

const pinned2025 = readJson("./fixtures/sa1/csa22_pinned_vectors_2025.json");
const pinned2026 = readJson("./fixtures/sa3/csa22_pinned_vectors_2026.json");
const sa1Demo = readJson("./fixtures/sa1/sa1_demo_cases.json");
const sa1Accept = readJson("./fixtures/sa1/sa1_acceptance_cases.json");

function verifyRawDiskPackage(dirRel, expectedSpecDigest) {
  const manifestBytes = readBytes(`${dirRel}/manifest.json`);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(manifest.spec_digest, expectedSpecDigest);
  const files = manifest.files;
  assert.ok(files && typeof files === "object");
  const expectedFilesCount = Object.keys(files).length;
  assert.equal(expectedFilesCount, 4, `${dirRel} manifest should cover 4 content files`);

  const rawContents = {};
  for (const [name, digest] of Object.entries(files)) {
    const diskName = name === "SPEC.md" ? "spec.md" : name;
    const buf = readBytes(`${dirRel}/${diskName}`);
    rawContents[name] = buf;
    assert.equal(sha256Bytes(buf), digest, `raw disk sha256 mismatch for ${dirRel}/${diskName}`);
  }
  const excName = Object.keys(files).find((n) => n.startsWith("exceptions-"));
  const computedSpecDigest = sha256Bytes(Buffer.concat([rawContents["SPEC.md"], rawContents[excName]]));
  assert.equal(computedSpecDigest, expectedSpecDigest, `${dirRel} SPEC + exceptions digest mismatch`);
  return { manifest, rawContents, excName };
}

const caseArgIndex = process.argv.indexOf("--case");
const requestedCase = caseArgIndex >= 0 ? process.argv[caseArgIndex + 1] : null;

const handlers = {
  async "SA-A04"() {
    // 1. Raw disk SHA-256 verification across all 10 vendored files in specs/csa22-v1 & csa22-v2.
    const v1Disk = verifyRawDiskPackage(
      "../web/strategy-switch-console/specs/csa22-v1",
      CSA22_PINNED_DIGESTS["csa22-v1"],
    );
    const v2Disk = verifyRawDiskPackage(
      "../web/strategy-switch-console/specs/csa22-v2",
      CSA22_PINNED_DIGESTS["csa22-v2"],
    );
    const runnerPath = fileURLToPath(new URL("../web/strategy-switch-console/specs/run_csa22_generator.py", import.meta.url));
    for (const pkgDir of ["../web/strategy-switch-console/specs/csa22-v1", "../web/strategy-switch-console/specs/csa22-v2"]) {
      execFileSync("python3", [runnerPath, "--check", fileURLToPath(new URL(pkgDir, import.meta.url))], { stdio: "pipe" });
    }
    const specs = loadAllSpecs();
    assert.equal(specs["csa22-v1"].spec_digest, CSA22_PINNED_DIGESTS["csa22-v1"]);
    assert.equal(specs["csa22-v2"].spec_digest, CSA22_PINNED_DIGESTS["csa22-v2"]);

    // 2. Field-for-field equivalence across ALL 365 days of 2025 and ALL 365 days of 2026 + schema validation.
    const expected2025 = JSON.parse(v1Disk.rawContents["expected-2025.json"].toString("utf8"));
    const expected2026 = JSON.parse(v2Disk.rawContents["expected-2026.json"].toString("utf8"));
    assert.equal(Object.keys(expected2025.sessions).length, 365);
    assert.equal(Object.keys(expected2026.sessions).length, 365);
    assert.equal(pinned2026.metadata.expected_2026_sha256, v2Disk.manifest.files["expected-2026.json"]);

    for (const [d, exp] of Object.entries(expected2025.sessions)) {
      const actual = resolveSession("XNYS", d, { spec: specs["csa22-v1"] });
      assert.deepEqual(actual, exp, `2025 field mismatch on ${d}`);
      assert.deepEqual(resolveSession("XNYS", d), exp, `auto-select mismatch on ${d}`);
      assert.ok(validateCalendarSchema(actual), `schema invalid on ${d}: ${ajv.errorsText(validateCalendarSchema.errors)}`);
    }
    for (const [d, exp] of Object.entries(expected2026.sessions)) {
      const actual = resolveSession("XNYS", d, { spec: specs["csa22-v2"] });
      assert.deepEqual(actual, exp, `2026 field mismatch on ${d}`);
      assert.deepEqual(resolveSession("XNYS", d), exp, `auto-select mismatch on ${d}`);
      assert.ok(validateCalendarSchema(actual), `schema invalid on ${d}: ${ajv.errorsText(validateCalendarSchema.errors)}`);
    }

    // 3. 1-byte tamper detection fails closed with CalendarDigestError.
    for (const version of ["csa22-v1", "csa22-v2"]) {
      const cleanPkg = CSA22_PACKAGES[version];
      const tamperedExc = {
        ...cleanPkg,
        exceptions_json: cleanPkg.exceptions_json.replace("New Year's Day", "New Year's Eve"),
      };
      assert.throws(() => verifyCalendarPackage(tamperedExc), CalendarDigestError, `tampered ${version} exceptions must fail closed`);
      const tamperedSpec = { ...cleanPkg, spec_markdown: `${cleanPkg.spec_markdown} ` };
      assert.throws(() => loadSpec(tamperedSpec), CalendarDigestError, `tampered ${version} SPEC.md must fail closed`);
    }

    // 4. Scheduled holidays & 2025-01-09 unscheduled closure (verbatim session_state + Rule 7 display derivation).
    const unsched = resolveSession("XNYS", "2025-01-09");
    assert.equal(unsched.session_state, "unscheduled_closure");
    assert.equal(projectSessionClosureLabel(unsched), "closed");
    assert.equal(projectSessionClosureLabel("unscheduled_closure"), "closed");
    assert.equal(projectSessionClosureLabel("closed"), "closed");
    assert.equal(projectSessionClosureLabel("unknown"), "unknown");
    assert.equal(unsched.is_trading_day, false);
    assert.equal(unsched.holiday_name, "National Day of Mourning - President Jimmy Carter");
    assert.equal(unsched.open_utc, null);
    assert.equal(unsched.close_utc, null);
    assert.equal(unsched.order_cutoff_utc, null);
    assert.equal(unsched.order_window, null);
    assert.equal(unsched.blocks_orders, true);
    assert.equal(unsched.blocks_eligibility, true);

    for (const h of ["2025-01-01", "2025-11-27", "2025-12-25", "2026-01-01", "2026-07-03", "2026-11-26", "2026-12-25"]) {
      const hs = resolveSession("XNYS", h);
      assert.equal(hs.session_state, "closed", `${h} should be closed`);
      assert.equal(hs.is_trading_day, false);
      assert.ok(hs.holiday_name);
      assert.equal(hs.blocks_orders, true);
      assert.equal(hs.blocks_eligibility, true);
    }

    // 5. Downstream calendar consumers exclude verified closures & unscheduled closures without false incomplete_month/staleness.
    const jan2025TradingDates = Object.keys(expected2025.sessions)
      .filter((d) => d.startsWith("2025-01-") && expected2025.sessions[d].is_trading_day);
    assert.ok(!jan2025TradingDates.includes("2025-01-09"));
    assert.ok(!jan2025TradingDates.includes("2025-01-01"));
    assert.ok(!jan2025TradingDates.includes("2025-01-20"));

    const natRow = (d, v = "0.002") => ({
      status: "available", method: "native_ibkr_twr", source: "ChangeInNAV.twr",
      unit: "ratio", currency: "USD", period: { from: d, to: d }, value: v,
    });
    const janHistPoints = [
      { date: "2024-12-31", value: 99, externalFlow: 0 },
      ...jan2025TradingDates.map((d, i) => ({ date: d, value: 100 + i, externalFlow: 0 })),
    ];
    const janInput = {
      accounts: [{ platform: "ibkr", account_key: "synthetic-jan", return: { daily: jan2025TradingDates.map((d) => natRow(d)) } }],
      histories: [{ id: "synthetic-jan", currency: "USD", points: janHistPoints }],
      range: "ALL", today: "2025-01-31", year: 2025, month: 1, failed: [], benchmarks: [],
    };
    const janPerf = performanceBlocks({ ...janInput, month: null });
    assert.equal(janPerf.calendar.cells[0].month, "2025-01");
    assert.equal(janPerf.calendar.cells[0].status, "ok", "2025-01 holiday & 2025-01-09 closure must not trigger false incomplete_month");
    const janDayCells = calendarCells(janInput.histories[0].points, 2025, 1, { today: "2025-01-31", exchange: "XNYS" });
    assert.equal(janDayCells.find((c) => c.date === "2025-01-09").unavailable_reason, "market_closed");
    assert.equal(janDayCells.find((c) => c.date === "2025-01-01").unavailable_reason, "market_closed");

    // Non-XNYS / HKD histories retain conservative missing-data & break semantics across US-only closures.
    const hkdCells = calendarCells(janInput.histories[0].points, 2025, 1, { today: "2025-01-31" });
    assert.equal(hkdCells.find((c) => c.date === "2025-01-09").unavailable_reason, "snapshot_missing");
    const hkdPerf = performanceBlocks({
      accounts: [],
      histories: [{ id: "synthetic-hk", currency: "HKD", points: janHistPoints }],
      range: "ALL",
      today: "2025-01-31",
      year: 2025,
      month: null,
      failed: [],
      benchmarks: [],
    });
    assert.equal(hkdPerf.calendar.cells[0].status, "partial");
    assert.equal(hkdPerf.calendar.cells[0].unavailable_reason, "incomplete_month");
    const hkdAgg = aggregateEquityHistory(
      [{ id: "synthetic-hk", currency: "HKD", points: [{ date: "2025-01-08", value: 100, externalFlow: 0 }, { date: "2025-01-10", value: 105, externalFlow: 0 }] }],
      "HKD",
    );
    assert.equal(hkdAgg.points[1].breakBefore, true);
    assert.equal(hasGap({ date: "2025-01-08" }, { date: "2025-01-10" }), true);
    assert.equal(hasGap({ date: "2025-01-08" }, { date: "2025-01-10" }, { exchange: "XNYS" }), false);

    const janNative = applyNativeDailyReturns(performanceBlocks({ ...janInput, month: null }), { ...janInput, month: null });
    assert.equal(janNative.returns.status, "ok");
    assert.equal(janNative.calendar.cells[0].status, "ok");
    assert.equal(janNative.calendar.cells[0].unavailable_reason, null);

    // Reported broker holiday rows remain included in monthly completeness checks without false incomplete_month.
    const janAllWeekdays = Object.keys(expected2025.sessions).filter((d) => {
      if (!d.startsWith("2025-01-")) return false;
      const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
      return wd !== 0 && wd !== 6;
    });
    const janReportedHolidayInput = {
      ...janInput,
      accounts: [{ platform: "ibkr", account_key: "synthetic-jan", return: { daily: janAllWeekdays.map((d) => natRow(d)) } }],
      histories: [],
      month: null,
    };
    const janReportedHoliday = applyNativeDailyReturns(performanceBlocks(janReportedHolidayInput), janReportedHolidayInput);
    assert.equal(janReportedHoliday.calendar.cells[0].status, "ok");
    assert.equal(janReportedHoliday.calendar.cells[0].unavailable_reason, null);
    assert.equal(janReportedHoliday.calendar.cells[0].coverage.observed_days, janAllWeekdays.length);

    // Negative control: dropping regular trading day 2025-01-15 DOES trigger incomplete_month / gap!
    const missingTradingDates = jan2025TradingDates.filter((d) => d !== "2025-01-15");
    const missingInput = {
      ...janInput,
      accounts: [{ platform: "ibkr", account_key: "synthetic-jan", return: { daily: missingTradingDates.map((d) => natRow(d)) } }],
      histories: [{ id: "synthetic-jan", currency: "USD", points: missingTradingDates.map((d, i) => ({ date: d, value: 100 + i, externalFlow: 0 })) }],
      month: null,
    };
    const missingNative = applyNativeDailyReturns(performanceBlocks(missingInput), missingInput);
    assert.equal(missingNative.calendar.cells[0].status, "partial");
    assert.equal(missingNative.calendar.cells[0].unavailable_reason, "incomplete_month");

    // Gapped USD native daily points preserve XNYS closure continuity (2025-01-09) while breaking on missing trading day (2025-01-13).
    const sparseUsdInput = {
      accounts: [{
        platform: "ibkr",
        account_key: "synthetic-sparse",
        return: { daily: ["2025-01-08", "2025-01-10", "2025-01-14"].map((d) => natRow(d)) },
      }],
      histories: [],
      range: "ALL",
      today: "2025-01-14",
      year: 2025,
      month: 1,
      failed: [],
      benchmarks: [],
    };
    const sparseUsdNative = applyNativeDailyReturns(performanceBlocks(sparseUsdInput), sparseUsdInput);
    assert.equal(sparseUsdNative.returns.points.find((p) => p.date === "2025-01-10").breakBefore, false);
    assert.equal(sparseUsdNative.returns.points.find((p) => p.date === "2025-01-14").breakBefore, true);

    // dailyChanges across 2025-01-08 -> 2025-01-10 skips 2025-01-09 unscheduled closure cleanly for XNYS.
    const changesAcrossUnsched = dailyChanges([
      { date: "2025-01-08", value: 100, externalFlow: 0 },
      { date: "2025-01-10", value: 105, externalFlow: 0 },
    ], { exchange: "XNYS" });
    assert.equal(changesAcrossUnsched[1].status, "ok");
    assert.equal(changesAcrossUnsched[1].amount, 5);

    // operations helper & opt-in todaySummary recognize 2025-01-09 closure for equities while preserving unknown out-of-range dates & 24/7 binance.
    assert.equal(resolveOperationsMarketSession("2025-01-09", { platform: "ibkr" }).projected_state, "closed");
    assert.equal(resolveOperationsMarketSession("2025-01-09", { platform: "binance" }).is_trading_day, true);
    const opsSummary = await todaySummary(
      new Request("https://console.example/api/runtime/today"),
      {},
      {
        dailyBindings: async () => [
          { platform: "ibkr", account_key: "a1", target_key: "t1", status: "bound" },
          { platform: "binance", account_key: "b1", target_key: "t2", status: "bound" },
        ],
        daily: async () => Response.json({ account_key: "a1", platform: "ibkr", date: "2025-01-09", record: null }),
      },
      [{ platform: "ibkr", key: "a1" }, { platform: "binance", key: "b1" }],
      Date.parse("2025-01-09T15:00:00Z"),
      { useMarketCalendar: true },
    );
    assert.equal(opsSummary.accounts.find((a) => a.platform === "ibkr").unavailable_reason, "market_closed");
    const opsOutOfRange = await todaySummary(
      new Request("https://console.example/api/runtime/today"),
      {},
      {
        dailyBindings: async () => [
          { platform: "ibkr", account_key: "a1", target_key: "t1", status: "bound" },
        ],
        daily: async () => Response.json({ account_key: "a1", platform: "ibkr", date: "2027-01-05", record: null }),
      },
      [{ platform: "ibkr", key: "a1" }],
      Date.parse("2027-01-05T15:00:00Z"),
      { useMarketCalendar: true },
    );
    assert.equal(opsOutOfRange.accounts.find((a) => a.platform === "ibkr").unavailable_reason, "today_record_missing");

    // desk/ribbon sessions on 2025-01-09 closure vs 2025-11-28 half-day vs out-of-range 2030-01-08.
    const jan9Ribbon = ribbonSessions("2025-01-09", Date.parse("2025-01-09T15:00:00Z"));
    assert.deepEqual(jan9Ribbon.find((s) => s.market === "US"), {
      market: "US",
      state: "closed",
      open_utc: null,
      close_utc: null,
      next_change_at: "2025-01-10T14:30:00Z",
      holiday: "National Day of Mourning - President Jimmy Carter",
    });
    assert.equal(jan9Ribbon.find((s) => s.market === "HK").state, "unknown");
    assert.equal(jan9Ribbon.find((s) => s.market === "CN").state, "unknown");
    const nov28Ribbon = ribbonSessions("2025-11-28", Date.parse("2025-11-28T16:00:00Z"));
    assert.deepEqual(nov28Ribbon.find((s) => s.market === "US"), {
      market: "US",
      state: "open",
      open_utc: "14:30",
      close_utc: "18:00",
      next_change_at: "2025-11-28T18:00:00Z",
      holiday: "Day After Thanksgiving",
    });
    const farRibbon = ribbonSessions("2030-01-08", Date.parse("2030-01-08T15:00:00Z"));
    assert.ok(farRibbon.every((s) => s.state === "unknown" && s.holiday === null));
    console.log("[PASS] SA-A04: C-SA-22 v1/v2 digests, 730-day parity, Rule 7, tamper fail-closed & holiday/closure propagation");
  },

  async "SA-A05"() {
    // 1. EDT/EST early closes & DST transitions across 2025 & 2026.
    const earlyExpectations = [
      { date: "2025-07-03", is_dst: true, open_utc: "2025-07-03T13:30:00.000Z", close_utc: "2025-07-03T17:00:00.000Z" },
      { date: "2025-11-28", is_dst: false, open_utc: "2025-11-28T14:30:00.000Z", close_utc: "2025-11-28T18:00:00.000Z" },
      { date: "2025-12-24", is_dst: false, open_utc: "2025-12-24T14:30:00.000Z", close_utc: "2025-12-24T18:00:00.000Z" },
      { date: "2026-11-27", is_dst: false, open_utc: "2026-11-27T14:30:00.000Z", close_utc: "2026-11-27T18:00:00.000Z" },
      { date: "2026-12-24", is_dst: false, open_utc: "2026-12-24T14:30:00.000Z", close_utc: "2026-12-24T18:00:00.000Z" },
    ];
    for (const item of earlyExpectations) {
      const s = resolveSession("XNYS", item.date);
      assert.equal(s.session_state, "half_day");
      assert.equal(s.is_dst, item.is_dst);
      assert.equal(s.open_utc, item.open_utc);
      assert.equal(s.close_utc, item.close_utc);
      assert.equal(s.order_window.half_open, true);
      const closeMs = Date.parse(item.close_utc);
      assert.equal(isOrderAllowedAt(closeMs - 1, s).allowed, true, `${item.date} close-1ms must be open`);
      assert.equal(isOrderAllowedAt(closeMs, s).allowed, false, `${item.date} exact close_utc must be excluded [open, cutoff)`);
      assert.equal(isOrderAllowedAt(Date.parse(item.open_utc), s).allowed, true);
    }

    assert.equal(resolveSession("XNYS", "2025-03-07").is_dst, false);
    assert.equal(resolveSession("XNYS", "2025-03-10").is_dst, true);
    assert.equal(resolveSession("XNYS", "2025-10-31").is_dst, true);
    assert.equal(resolveSession("XNYS", "2025-11-03").is_dst, false);
    assert.equal(resolveSession("XNYS", "2026-03-06").is_dst, false);
    assert.equal(resolveSession("XNYS", "2026-03-09").is_dst, true);
    assert.equal(resolveSession("XNYS", "2026-10-30").is_dst, true);
    assert.equal(resolveSession("XNYS", "2026-11-02").is_dst, false);

    // 2. Earlier cutoff_local takes precedence; later cutoff_local is capped by close_utc.
    const earlier = resolveSession("XNYS", "2025-07-03", { cutoff_local: "12:00" });
    assert.equal(earlier.cutoff_local, "12:00");
    assert.equal(earlier.order_cutoff_utc, "2025-07-03T16:00:00.000Z");
    assert.equal(isOrderAllowedAt("2025-07-03T16:00:00.000Z", earlier).allowed, false);
    const later = resolveSession("XNYS", "2025-07-03", { cutoff_local: "17:00" });
    assert.equal(later.cutoff_local, "13:00");
    assert.equal(later.order_cutoff_utc, "2025-07-03T17:00:00.000Z");

    // 3. O2 venue-status split & disagreement fail closed.
    const s26Reg = resolveSession("XNYS", "2026-01-05");
    const coreAgree = resolveSession("XNYS", "2026-01-05", { observed_venue_status: "core_session_open" });
    assert.equal(coreAgree.blocks_orders, false);
    assert.equal(coreAgree.blocks_eligibility, false);
    const overnightDisagree = resolveSession("XNYS", "2026-01-05", { observed_venue_status: "extended_overnight_open" });
    assert.equal(overnightDisagree.blocks_orders, true);
    assert.equal(overnightDisagree.blocks_eligibility, true);
    assert.equal(overnightDisagree.venue_disagreement, true);
    assert.equal(isOrderAllowedAt("2026-01-05T15:00:00.000Z", overnightDisagree).allowed, false);
    const closedWithCore = resolveSession("XNYS", "2025-01-09", { observed_venue_status: "core_session_open" });
    assert.equal(closedWithCore.blocks_orders, true);
    assert.equal(closedWithCore.venue_disagreement, true);

    // 4. US 23/5 window classification, official-close bar filter, post-21:00 ET clearing & prior-close isolation.
    const s26Half = resolveSession("XNYS", "2026-11-27");
    assert.equal(classifyUsEquitySessionWindow("2026-01-05T21:00:00.000Z", s26Reg), "core_session_open");
    assert.equal(classifyUsEquitySessionWindow("2026-01-05T22:00:00.000Z", s26Reg), "after_hours_extended");
    assert.equal(classifyUsEquitySessionWindow("2026-01-06T02:15:00.000Z", s26Reg), "extended_overnight_open");
    assert.equal(classifyUsEquitySessionWindow("2026-01-05T12:00:00.000Z", s26Reg), "pre_market_extended");
    assert.equal(classifyUsEquitySessionWindow("2026-11-27T18:00:00.000Z", s26Half), "core_session_open");
    assert.equal(classifyUsEquitySessionWindow("2026-11-27T18:00:59.000Z", s26Half), "after_hours_extended");
    assert.deepEqual(isOfficialCloseBarTimestamp("2026-11-27T18:00:00.000Z", s26Half), {
      valid: true,
      reason: null,
    });
    assert.deepEqual(isOfficialCloseBarTimestamp("2026-11-27T18:00:59.000Z", s26Half), {
      valid: false,
      reason: "extended_hours_overnight_rejected",
    });
    assert.deepEqual(isOfficialCloseBarTimestamp("2026-11-27T18:30:00.000Z", s26Half), {
      valid: false,
      reason: "extended_hours_overnight_rejected",
    });
    assert.deepEqual(isOfficialCloseBarTimestamp("2026-01-05T21:15:00-05:00", s26Reg), {
      valid: false,
      reason: "next_trade_date_contamination",
    });
    assert.deepEqual(isOfficialCloseBarTimestamp("2026-01-05T21:00:00.000Z", s26Reg), {
      valid: true,
      reason: null,
    });
    assert.equal(resolvePriorCloseSession("2026-01-06T02:30:00.000Z").trade_date, "2026-01-05");
    assert.equal(resolvePriorCloseSession("2026-01-02T14:30:00.000Z").trade_date, "2025-12-31");
    assert.equal(resolvePreviousTradingDate("2026-01-02"), "2025-12-31");
    const clearingShift = resolveClearingTradeDate("2026-01-05T21:15:00-05:00");
    assert.equal(clearingShift.trade_date, "2026-01-06");
    assert.equal(clearingShift.clearing_shifted, true);
    assert.equal(clearingShift.belongs_to_prior_eod, false);
    assert.equal(clearingShift.reason, "post_2100_et_next_trade_date");

    // 5. Unsupported venues & out-of-range dates fail closed to unknown.
    for (const v of ["HK", "CN", "XHKG", "SSE"]) {
      const us = resolveSession(v, "2026-01-05");
      assert.equal(us.session_state, "unknown");
      assert.equal(us.reason, "unsupported_venue");
      assert.equal(us.blocks_orders, true);
      assert.equal(us.blocks_eligibility, true);
    }
    for (const d of ["2024-12-31", "2027-01-01"]) {
      const oor = resolveSession("XNYS", d);
      assert.equal(oor.session_state, "unknown");
      assert.equal(oor.reason, "out_of_range");
      assert.equal(oor.blocks_orders, true);
    }
    const v1Only = loadSpec("csa22-v1");
    assert.equal(resolveSession("XNYS", "2026-01-02", { spec: v1Only }).reason, "out_of_range");

    // 6. SA-1 #15 freshness seam equivalence (runtime v1 == pinned 2025; combined == pinned 2025/2026) + 2025->2026 crossover.
    const pinnedProv25 = createPinnedCalendarProvider(pinned2025);
    const pinnedProv26 = createPinnedCalendarProvider(pinned2026);
    const runtimeV1Prov = createRuntimeCalendarProvider({ version: "csa22-v1" });
    const runtimeProv = createRuntimeCalendarProvider();
    const demoChecks = sa1Demo.cases["SA1-D3"].checks.map((check) => ({
      name: check.name,
      observed_at: check.observed_at,
      fetched_at: check.fetched_at,
      evaluated_at: check.evaluated_at,
      last_observed_value: "50000.00",
    }));
    for (const vec of [...demoChecks, ...sa1Accept.cases["SA-A06"].vectors]) {
      const a = evaluateFreshness(vec, { calendarProvider: pinnedProv25 });
      const bV1 = evaluateFreshnessWithRuntimeCalendar(vec, { calendarProvider: runtimeV1Prov });
      assert.deepEqual(bV1, a, `SA-1 #15 csa22-v1 seam drift on ${vec.name}`);
      if (typeof vec.observed_at === "string" && vec.observed_at.startsWith("2025-") && typeof vec.evaluated_at === "string" && vec.evaluated_at.startsWith("2025-")) {
        const b = evaluateFreshnessWithRuntimeCalendar(vec, { calendarProvider: runtimeProv });
        assert.deepEqual(b, a, `SA-1 #15 combined 2025 seam drift on ${vec.name}`);
      }
    }
    const vec26 = {
      observed_at: "2026-01-02T21:00:00.000Z",
      fetched_at: "2026-01-02T21:00:01.000Z",
      evaluated_at: "2026-01-02T21:01:00.000Z",
      last_observed_value: "50000.00",
    };
    assert.deepEqual(
      evaluateFreshnessWithRuntimeCalendar(vec26, { calendarProvider: runtimeProv }),
      evaluateFreshness(vec26, { calendarProvider: pinnedProv26 }),
    );
    // Across 2025-12-31 -> 2026-01-02 (holiday 2026-01-01 skipped), before 2026-01-02 close -> age_sessions = 0 (fresh).
    const crossYearCount = countXnysSessionCloses("2025-12-31T21:00:00.000Z", "2026-01-02T14:30:00.000Z", runtimeProv);
    assert.equal(crossYearCount.covered, true);
    assert.equal(crossYearCount.age_sessions, 0);
    const crossYearFresh = evaluateFreshnessWithRuntimeCalendar({
      observed_at: "2025-12-31T21:00:00.000Z",
      fetched_at: "2026-01-02T14:30:00.000Z",
      evaluated_at: "2026-01-02T14:30:00.000Z",
      last_observed_value: "50000.00",
    });
    assert.equal(crossYearFresh.data_status, "fresh");
    assert.equal(crossYearFresh.age_sessions, 0);

    const directRuntime = createXnysRuntimeProvider();
    assert.deepEqual(directRuntime.getSession("2026-11-26"), resolveSession("XNYS", "2026-11-26"));
    console.log("[PASS] SA-A05: half-days, DST, [open, cutoff), O2 split, 23/5 boundaries & SA-1 #15 cross-year parity");
  },
};

const toRun = requestedCase ? [requestedCase] : Object.keys(handlers);
for (const name of toRun) {
  assert.ok(Object.hasOwn(handlers, name), `Unknown case: ${name}`);
  await handlers[name]();
}
console.log(`sa3_market_sessions_validation: PASS (${toRun.length}/${toRun.length} cases passed)`);
