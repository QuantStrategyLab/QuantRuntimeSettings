import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAssetChartGeometry,
  chartRangeEmptyNote,
  chartUnavailable,
  filterAssetHistoryByRange,
  formatLocalChangeTime,
  formatOverviewInstant,
  overviewAccountTypeLabel,
  overviewCardStatusDetail,
  parseMoneyForChart,
  presentRuntimeDaily,
  runtimeBusinessDate,
  runtimeDailySelectionEligible,
} from "../web/strategy-switch-console/frontend/src/presentation.ts";
import { accountFactsDetail, formatAccountFactAmounts, totalsUnavailableDetail } from "../web/strategy-switch-console/frontend/src/types.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

assert.equal(parseMoneyForChart("12.5"), 12.5);
assert.equal(parseMoneyForChart("1e9"), null);
assert.equal(parseMoneyForChart("not-a-number"), null);
assert.equal(parseMoneyForChart(`1${"0".repeat(20)}`), null);

const points = [
  { observation_date: "2026-09-01", observed_finished_at: "2026-09-01T10:00:00Z", currency: "USD", net_assets: "10", total_cash: "1" },
  { observation_date: "2026-09-02", observed_finished_at: "2026-09-02T10:00:00Z", currency: "USD", net_assets: "11", total_cash: "1" },
  { observation_date: "2026-09-04", observed_finished_at: "2026-09-04T10:00:00Z", currency: "USD", net_assets: "12", total_cash: "1" },
];
const now = Date.parse("2026-09-04T12:00:00Z");
assert.equal(filterAssetHistoryByRange(points, "all", now).length, 3);
assert.deepEqual(filterAssetHistoryByRange(points, "3m", now).map((row) => row.observation_date), ["2026-09-01", "2026-09-02", "2026-09-04"]);

const geometry = buildAssetChartGeometry(points);
assert.equal(geometry.dots.length, 3);
assert.equal(geometry.segments.length, 1);
assert.match(geometry.segments[0], /^M/);
assert.equal(geometry.segments[0].includes(" L"), true);
assert.equal(geometry.dots[2].date, "2026-09-04");
assert.equal(geometry.minLabel, "10");
assert.equal(geometry.maxLabel, "12");

const single = buildAssetChartGeometry([points[0]]);
assert.equal(single.segments.length, 0);
assert.equal(single.dots.length, 1);

assert.equal(chartUnavailable("return"), "暂不可用");
assert.equal(chartUnavailable("assets"), "暂无资产记录");
assert.equal(chartRangeEmptyNote("all").key, "暂无资产记录");
assert.equal(runtimeBusinessDate(Date.parse("2026-09-29T01:00:00Z")), "2026-09-28");
assert.equal(runtimeBusinessDate(Date.parse("2026-09-29T12:00:00Z")), "2026-09-29");

assert.equal(totalsUnavailableDetail("physical_identity_unverified"), "暂不可用");
assert.equal(formatAccountFactAmounts([
  { currency: "USD", net_assets: "0", available_cash: "-0.000" },
  { currency: "HKD", net_assets: "-0.00000001", available_cash: "0" },
  { currency: "JPY", net_assets: "0.00000001", available_cash: "0.00000001" },
  { currency: "EUR", net_assets: "0.00000000", available_cash: "12.5" },
], "net_assets"), "HKD -0.00000001 · JPY 0.00000001");
assert.equal(formatAccountFactAmounts([
  { currency: "USD", available_cash: "-0.00000001" },
  { currency: "HKD", available_cash: "0" },
  { currency: "JPY", available_cash: "0.00000001" },
  { currency: "EUR", available_cash: "12.5" },
], "available_cash"), "USD -0.00000001 · JPY 0.00000001 · EUR 12.5");
assert.equal(formatAccountFactAmounts([
  { currency: "USD", net_assets: "0" },
  { currency: "HKD", net_assets: "-0.000" },
], "net_assets"), "0");
assert.equal(formatAccountFactAmounts([], "net_assets"), null);
assert.equal(accountFactsDetail(null), "暂无数据");
assert.equal(accountFactsDetail({
  platform: "longbridge",
  account_key: "lb-paper",
  binding_status: "bound",
  identity_status: "partial_identity",
  data_status: "stale",
  target_id: "paper",
  source_binding_id: "a".repeat(64),
  observation_date: "2026-09-28",
  observed_started_at: "2026-09-28T10:00:00Z",
  observed_finished_at: "2026-09-28T10:01:00Z",
  balances: [],
  cash: [],
  return: { status: "unavailable", reason: "external_cashflow_required" },
}), "数据暂不可用");

const longbridgePaperSnapshot = {
  ok: true,
  date: "2026-09-29",
  timezone: "America/New_York",
  account_key: "paper",
  data_status: "fresh",
  record: {
    status: "submitted",
    kind: "run",
    execution_lane: "paper",
    business_date: "2026-09-29",
    observed_at: "2026-09-29T10:00:00Z",
    schedule: { state: "due", expected_window: "inside" },
    runs: [{ run_id: "r1", started_at: "2026-09-29T09:00:00Z", finished_at: "2026-09-29T09:05:00Z", activity: "submitted", execution_lane: "paper" }],
  },
  fills: { source: "not_connected", records: [], count: null },
};

const unmatched = presentRuntimeDaily(longbridgePaperSnapshot, {
  platform: "longbridge",
  accountKey: "other-account",
});
assert.equal(unmatched.accountMatched, false);
assert.equal(unmatched.fillsLabel, "暂无数据");
assert.doesNotMatch(unmatched.statusDetails.join(" "), /LongBridge|not_connected|source-binding/);

// Same key on Binance must not consume LongBridge runtime-daily.
const crossPlatform = presentRuntimeDaily(longbridgePaperSnapshot, {
  platform: "binance",
  accountKey: "paper",
});
assert.equal(runtimeDailySelectionEligible({ platform: "binance", accountKey: "paper" }), false);
assert.equal(crossPlatform.accountMatched, false);
assert.equal(crossPlatform.statusLabel, "—");
assert.equal(crossPlatform.fillsLabel, "暂无数据");
assert.equal(crossPlatform.runStartedAt, null);
assert.equal(crossPlatform.dataStatusLabel, "暂无数据");

// Missing platform must not default to LongBridge and allow the snapshot through.
const missingPlatform = presentRuntimeDaily(longbridgePaperSnapshot, {
  platform: null,
  accountKey: "paper",
});
assert.equal(runtimeDailySelectionEligible({ platform: null, accountKey: "paper" }), false);
assert.equal(missingPlatform.accountMatched, false);
assert.equal(missingPlatform.statusLabel, "—");
assert.equal(missingPlatform.fillsLabel, "暂无数据");

const submitted = presentRuntimeDaily({
  ...longbridgePaperSnapshot,
  account_key: "lb-paper",
}, { platform: "longbridge", accountKey: "lb-paper" });
assert.equal(submitted.accountMatched, true);
assert.equal(submitted.statusLabel, "已提交");
assert.deepEqual(submitted.statusDetails, []);
assert.equal(submitted.dryRun, false);
assert.equal(submitted.fillsLabel, "暂无数据");

const dryRun = presentRuntimeDaily({
  ok: true,
  date: "2026-09-29",
  timezone: "America/New_York",
  account_key: "lb-paper",
  data_status: "historical",
  record: {
    status: "dry_run",
    kind: "run",
    execution_lane: "dry_run",
    business_date: "2026-09-29",
    observed_at: "2026-09-29T10:00:00Z",
    runs: [{ run_id: "r2", started_at: "2026-09-29T09:00:00Z", finished_at: null, activity: "no_action", execution_lane: "dry_run" }],
  },
  fills: { source: "not_connected", records: [], count: null },
}, { platform: "longbridge", accountKey: "lb-paper" });
assert.equal(dryRun.dryRun, true);
assert.equal(dryRun.statusLabel, "只读演练");
assert.deepEqual(dryRun.statusDetails, []);
assert.equal(dryRun.runStartedAt, "2026-09-29T09:00:00Z");
assert.equal(dryRun.runFinishedAt, null);

// Stale LongBridge payload must not surface after selecting another platform with the same key.
const staleAfterSwitch = presentRuntimeDaily(longbridgePaperSnapshot, {
  platform: "binance",
  accountKey: "paper",
});
assert.equal(staleAfterSwitch.accountMatched, false);
assert.equal(staleAfterSwitch.statusLabel, "—");
assert.equal(staleAfterSwitch.runStartedAt, null);

assert.equal(overviewAccountTypeLabel(), "账户类型待确认");
assert.equal(overviewCardStatusDetail("运行目标映射重复，无法唯一匹配"), null);
assert.equal(overviewCardStatusDetail("账户类型为账户设置标记，未由券商原生核实"), null);
assert.equal(overviewCardStatusDetail("账户运行异常"), "账户运行异常");
assert.equal(formatOverviewInstant("2026-09-29T01:00:00.123Z", "zh", "America/New_York"), formatLocalChangeTime(Date.parse("2026-09-29T01:00:00.123Z"), "zh", "America/New_York"));
assert.doesNotMatch(formatOverviewInstant("2026-09-29T01:00:00.123Z", "zh", "America/New_York") || "", /\.\d{3}Z/);

const overview = readFileSync(join(root, "web/strategy-switch-console/frontend/src/OverviewPage.tsx"), "utf8");
assert.match(overview, /historyEpoch/);
assert.match(overview, /runtimeEpoch/);
assert.match(overview, /runtimeBusinessDate/);
assert.match(overview, /runtimeDailySelectionEligible/);
assert.match(overview, /platform:\s*selectedAccount\.platformKey/);
assert.match(overview, /overviewAccountTypeLabel/);
assert.match(overview, /overviewCardStatusDetail/);
assert.match(overview, /formatOverviewInstant/);
assert.match(overview, /setHistory\(null\)/);
assert.match(overview, /setRuntimeDaily\(null\)/);
assert.doesNotMatch(overview, /only_cash|假比较|forged_return/);
assert.doesNotMatch(overview, /t\(account\.environmentSource\)|account\.environmentSource/);
assert.doesNotMatch(overview, /t\(account\.environment\)|t\(account\.statusDetail\)/);
assert.doesNotMatch(overview, /source-binding|partial_identity|not_connected|未知不等于零|尚未接通|外部资金流未接入|原金额保留字符串|不保留旧|未由券商原生核实|映射重复/);
assert.match(overview, /请选择账户/);
assert.match(overview, /暂无资产记录|chartUnavailable/);

console.log("account_history_presentation_validation ok");
