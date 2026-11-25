import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import {
  CalendarDigestError,
  classifyUsEquitySessionWindow,
  isOfficialCloseBarTimestamp,
  isOrderAllowedAt,
  loadSpec,
  projectSessionClosureLabel,
  resolveClearingTradeDate,
  resolvePriorCloseSession,
  resolveSession,
  verifyCalendarPackage,
} from "../web/strategy-switch-console/application/market_sessions/xnys_calendar.js";
import { CSA22_PACKAGES } from "../web/strategy-switch-console/application/market_sessions/data.js";
import {
  createPinnedCalendarProvider,
  createRuntimeCalendarProvider,
  evaluateFreshness,
  evaluateFreshnessWithRuntimeCalendar,
} from "../web/strategy-switch-console/application/sizing_unit/freshness.js";
import { performanceBlocks } from "../web/strategy-switch-console/application/console_api/performance.js";
import { applyNativeDailyReturns } from "../web/strategy-switch-console/application/console_api/native_daily_returns.js";
import { resolveOperationsMarketSession } from "../web/strategy-switch-console/application/console_api/operations.js";
import { ribbonSessions } from "../web/strategy-switch-console/application/desk/ribbon.js";
import { projectCredentialRecord } from "../web/strategy-switch-console/application/credential_calendar/projector.js";
import { CredentialValidationError } from "../web/strategy-switch-console/application/credential_calendar/validator.js";

const require = createRequire(new URL("../web/strategy-switch-console/package.json", import.meta.url));
const Ajv2020 = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats");

const loadJson = (relPath) => JSON.parse(readFileSync(new URL(relPath, import.meta.url), "utf8"));
const demoFixture = loadJson("./fixtures/sa3/sa3_demo_cases.json");
const pinned2025 = loadJson("./fixtures/sa1/csa22_pinned_vectors_2025.json");
const sa1Accept = loadJson("./fixtures/sa1/sa1_acceptance_cases.json");
const credMatrix = loadJson("./fixtures/sa3/sa3_credential_matrix.json");

const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
addFormats(ajv);
const validateMarketSchema = ajv.compile(loadJson("../schemas/qsl-market-sessions-calendar.v1.schema.json"));
const validateCredSchema = ajv.compile(loadJson("../schemas/qsl-credential-calendar.v1.schema.json"));

const caseArgIndex = process.argv.indexOf("--case");
const requestedCase = caseArgIndex >= 0 ? process.argv[caseArgIndex + 1] : null;

const handlers = {
  async "SA3-D1"() {
    const specCase = demoFixture.cases["SA3-D1"];
    for (const version of specCase.versions) {
      const loaded = loadSpec(version);
      assert.equal(loaded.spec_digest, demoFixture.pinned_digests[version]);
      assert.equal(Object.keys(loaded.sessions).length, specCase.expected_day_counts[version]);
    }
    const exp2025 = loadJson("../web/strategy-switch-console/specs/csa22-v1/expected-2025.json");
    const exp2026 = loadJson("../web/strategy-switch-console/specs/csa22-v2/expected-2026.json");
    for (const [d, row] of Object.entries(exp2025.sessions)) {
      const resolved = resolveSession("XNYS", d);
      assert.deepEqual(resolved, row);
      assert.ok(validateMarketSchema(resolved));
    }
    for (const [d, row] of Object.entries(exp2026.sessions)) {
      const resolved = resolveSession("XNYS", d);
      assert.deepEqual(resolved, row);
      assert.ok(validateMarketSchema(resolved));
    }
    const tampered = {
      ...CSA22_PACKAGES["csa22-v1"],
      exceptions_json: CSA22_PACKAGES["csa22-v1"].exceptions_json.replace("Christmas Day", "Tamper Day"),
    };
    assert.throws(() => verifyCalendarPackage(tampered), CalendarDigestError);
    console.log("[PASS] SA3-D1: C-SA-22 v1/v2 digest binding, 730-day parity & 1-byte tamper rejection");
  },

  async "SA3-D2"() {
    const specCase = demoFixture.cases["SA3-D2"];
    const unsched = resolveSession("XNYS", specCase.unscheduled_closure_date);
    assert.equal(unsched.session_state, "unscheduled_closure");
    assert.equal(projectSessionClosureLabel(unsched), "closed");
    assert.equal(unsched.open_utc, null);
    assert.equal(unsched.close_utc, null);
    assert.equal(unsched.blocks_orders, true);

    for (const d of specCase.holiday_dates) {
      const s = resolveSession("XNYS", d);
      assert.equal(s.session_state, "closed");
      assert.equal(s.is_trading_day, false);
      assert.equal(s.blocks_orders, true);
    }

    const exp2025 = loadJson("../web/strategy-switch-console/specs/csa22-v1/expected-2025.json");
    const novTrading = Object.keys(exp2025.sessions)
      .filter((d) => d.startsWith("2025-11-") && exp2025.sessions[d].is_trading_day);
    const natRow = (d) => ({
      status: "available", method: "native_ibkr_twr", source: "ChangeInNAV.twr",
      unit: "ratio", currency: "USD", period: { from: d, to: d }, value: "0.001",
    });
    const okInput = {
      accounts: [{ platform: "ibkr", account_key: "demo-nov", return: { daily: novTrading.map(natRow) } }],
      histories: [], range: "ALL", today: "2025-11-30", year: 2025, month: null, failed: [], benchmarks: [],
    };
    const okOut = applyNativeDailyReturns(performanceBlocks(okInput), okInput);
    assert.equal(okOut.calendar.cells[10].status, "ok", "2025-11-27 holiday must not cause incomplete_month");
    const missInput = {
      ...okInput,
      accounts: [{
        platform: "ibkr",
        account_key: "demo-nov",
        return: { daily: novTrading.filter((d) => d !== specCase.negative_control_missing_trading_day).map(natRow) },
      }],
    };
    const missOut = applyNativeDailyReturns(performanceBlocks(missInput), missInput);
    assert.equal(missOut.calendar.cells[10].unavailable_reason, "incomplete_month");
    assert.equal(resolveOperationsMarketSession(specCase.unscheduled_closure_date, { platform: "ibkr" }).projected_state, "closed");
    assert.equal(ribbonSessions(specCase.unscheduled_closure_date, Date.parse("2025-01-09T15:00:00Z"))[0].state, "closed");
    console.log("[PASS] SA3-D2: holidays, 2025-01-09 unscheduled closure, O2 block & non-false incomplete_month");
  },

  async "SA3-D3"() {
    const specCase = demoFixture.cases["SA3-D3"];
    for (const h of specCase.half_days) {
      const s = resolveSession("XNYS", h.date);
      assert.equal(s.session_state, "half_day");
      assert.equal(s.is_dst, h.is_dst);
      assert.equal(s.open_utc, h.open_utc);
      assert.equal(s.close_utc, h.close_utc);
      assert.equal(isOrderAllowedAt(h.pre_close, s).allowed, true);
      assert.equal(isOrderAllowedAt(h.at_close, s).allowed, false);
    }
    for (const range of specCase.dst_ranges) {
      const states = range.map((d) => resolveSession("XNYS", d).is_dst);
      assert.notEqual(states[0], states.at(-1));
    }
    const ec = resolveSession("XNYS", specCase.earlier_cutoff.date, { cutoff_local: specCase.earlier_cutoff.cutoff_local });
    assert.equal(ec.order_cutoff_utc, specCase.earlier_cutoff.expected_cutoff_utc);
    assert.equal(resolvePriorCloseSession(specCase.us_23_5_prior_close.decision_instant_utc).trade_date, specCase.us_23_5_prior_close.expected_trade_date);
    assert.equal(resolveClearingTradeDate(specCase.post_2100_clearing.activity_timestamp).trade_date, specCase.post_2100_clearing.expected_trade_date);
    assert.equal(classifyUsEquitySessionWindow("2026-01-06T02:15:00.000Z", resolveSession("XNYS", "2026-01-05")), "extended_overnight_open");
    assert.equal(isOfficialCloseBarTimestamp("2026-01-05T21:15:00-05:00", resolveSession("XNYS", "2026-01-05")).valid, false);
    console.log("[PASS] SA3-D3: EDT/EST half-days, DST shifts, [open, cutoff), earlier cutoff & 23/5 post-21:00 ET");
  },

  async "SA3-D4"() {
    const specCase = demoFixture.cases["SA3-D4"];
    for (const venue of specCase.unsupported_venues) {
      const s = resolveSession(venue, "2025-05-01");
      assert.equal(s.session_state, "unknown");
      assert.equal(s.blocks_orders, true);
      assert.equal(s.blocks_eligibility, true);
    }
    for (const d of specCase.out_of_range_dates) {
      const s = resolveSession("XNYS", d);
      assert.equal(s.session_state, "unknown");
      assert.equal(s.reason, "out_of_range");
      assert.equal(s.blocks_orders, true);
    }
    const disagreement = resolveSession("XNYS", "2026-01-05", { observed_venue_status: "extended_overnight_open" });
    assert.equal(disagreement.venue_disagreement, true);
    assert.equal(disagreement.blocks_orders, true);
    assert.equal(disagreement.blocks_eligibility, true);
    console.log("[PASS] SA3-D4: unsupported venues, out-of-range dates & O2 disagreement fail closed");
  },

  async "SA3-D5"() {
    const pinnedProv = createPinnedCalendarProvider(pinned2025);
    const runtimeV1Prov = createRuntimeCalendarProvider({ version: "csa22-v1" });
    const runtimeProv = createRuntimeCalendarProvider();
    for (const vec of sa1Accept.cases["SA-A06"].vectors) {
      assert.deepEqual(
        evaluateFreshnessWithRuntimeCalendar(vec, { calendarProvider: runtimeV1Prov }),
        evaluateFreshness(vec, { calendarProvider: pinnedProv }),
        `csa22-v1 seam drift on ${vec.name}`,
      );
      if (vec.evaluated_at.startsWith("2025-") && vec.observed_at.startsWith("2025-")) {
        assert.deepEqual(
          evaluateFreshnessWithRuntimeCalendar(vec, { calendarProvider: runtimeProv }),
          evaluateFreshness(vec, { calendarProvider: pinnedProv }),
          `combined 2025 seam drift on ${vec.name}`,
        );
      }
    }
    const cy = demoFixture.cases["SA3-D5"].cross_year_case;
    const crossRes = evaluateFreshnessWithRuntimeCalendar({
      observed_at: cy.observed_at,
      fetched_at: cy.fetched_at,
      evaluated_at: cy.evaluated_at,
      last_observed_value: cy.last_observed_value,
    });
    assert.equal(crossRes.age_sessions, cy.expected_age_sessions);
    assert.equal(crossRes.data_status, cy.expected_data_status);
    console.log("[PASS] SA3-D5: SA-1 #15 seam swap equivalence + 2025-12-31->2026-01-02 cross-year freshness");
  },

  async "SA3-D6"() {
    const seenPlatforms = new Set();
    for (const c of credMatrix.valid_cases) {
      const out = projectCredentialRecord(c.record);
      assert.ok(validateCredSchema(out));
      seenPlatforms.add(out.platform);
      for (const [k, v] of Object.entries(c.expected)) {
        assert.equal(out[k], v, `${c.name}.${k}`);
      }
    }
    assert.equal(seenPlatforms.size, 5);
    console.log("[PASS] SA3-D6: C-SA-26 5-platform UTC boundaries, unknown routing & evidence preservation");
  },

  async "SA3-D7"() {
    const base = credMatrix.valid_cases[0].record;
    for (const neg of credMatrix.negative_cases) {
      const candidate = {
        ...base,
        ...neg.patch,
        ...(neg.patch.typed_metadata
          ? { typed_metadata: { ...(base.typed_metadata || {}), ...neg.patch.typed_metadata } }
          : {}),
      };
      assert.throws(
        () => projectCredentialRecord(candidate),
        CredentialValidationError,
        `expected rejection on ${neg.name}`,
      );
    }
    // Verify Worker-safe pure-JS AST rules (no node:*, no .json imports, no dynamic import/eval) on new SA-3 runtime modules.
    for (const rel of [
      "../web/strategy-switch-console/application/market_sessions/data.js",
      "../web/strategy-switch-console/application/market_sessions/xnys_calendar.js",
      "../web/strategy-switch-console/application/credential_calendar/registry.js",
      "../web/strategy-switch-console/application/credential_calendar/validator.js",
      "../web/strategy-switch-console/application/credential_calendar/projector.js",
    ]) {
      const src = readFileSync(new URL(rel, import.meta.url), "utf8");
      assert.ok(!/\bfrom\s+["']node:/.test(src), `${rel} must not import node:* modules`);
      assert.ok(!/^\s*import\b[^;]*\.json["']/m.test(src), `${rel} must not import .json files in Worker code`);
      assert.ok(!/\b(?:eval|Function|globalThis|Reflect|Proxy)\b/.test(src), `${rel} must not use forbidden globals`);
    }
    console.log("[PASS] SA3-D7: secret/free-form rejection & Worker-safe ADR 0002 module isolation");
  },
};

const toRun = requestedCase ? [requestedCase] : Object.keys(handlers);
for (const name of toRun) {
  assert.ok(Object.hasOwn(handlers, name), `Unknown demo case: ${name}`);
  await handlers[name]();
}
console.log(`sa3_demo_validation: PASS (${toRun.length}/${toRun.length} cases passed)`);
