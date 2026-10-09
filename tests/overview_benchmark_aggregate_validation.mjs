import assert from "node:assert/strict";
import {
  MARKET_BENCHMARK_INCEPTION_DATE,
  MARKET_BENCHMARK_TIMEZONE,
  OVERVIEW_USD_RATES,
  amountToUsd,
  buildAggregateAssetSeries,
  buildAssetChartGeometry,
  buildBenchmarkChartGeometry,
  presentAggregateReturn,
  presentMarketBenchmarkSeries,
  readQualifiedPeriodReturn,
  shanghaiCalendarDate,
  sumAmountsToUsd,
} from "../web/strategy-switch-console/frontend/src/presentation.ts";

assert.equal(MARKET_BENCHMARK_INCEPTION_DATE, "2026-10-09");
assert.equal(MARKET_BENCHMARK_TIMEZONE, "Asia/Shanghai");
assert.equal(shanghaiCalendarDate(Date.parse("2026-10-08T16:00:00Z")), "2026-10-09");
assert.equal(shanghaiCalendarDate(Date.parse("2026-10-08T15:59:59Z")), "2026-10-08");

const emptyBenchmark = presentMarketBenchmarkSeries([], "标普500");
assert.equal(emptyBenchmark.role, "market_benchmark");
assert.equal(emptyBenchmark.storedHistory, false);
assert.equal(emptyBenchmark.startDate, "2026-10-09");
assert.deepEqual(emptyBenchmark.points, []);
assert.equal(buildBenchmarkChartGeometry(emptyBenchmark.points).dots.length, 0, "no stored closes means no fabricated price line");

const stored = presentMarketBenchmarkSeries([
  { seriesId: "标普500", observationDate: "2026-10-01", close: "5700.10" },
  { seriesId: "标普500", observationDate: "2026-10-09", close: "5710" },
  { seriesId: "标普500", observationDate: "2026-10-10", close: "5712" },
  { seriesId: "标普500", observationDate: "2026-10-11", close: "0" },
  { seriesId: "标普500", observationDate: "2026-10-12", close: "5730" },
  { seriesId: "标普500", observationDate: "2026-10-12", close: "5731" },
  { seriesId: "纳斯达克100", observationDate: "2026-10-09", close: "20000" },
], "标普500");
assert.equal(stored.storedHistory, true);
assert.equal(stored.startDate, "2026-10-01", "already stored closes stay, including dates before the new inception");
assert.deepEqual(stored.points.map(point => point.observationDate), ["2026-10-01", "2026-10-09", "2026-10-10"]);
assert.equal(stored.points.some(point => point.close === "0"), false, "a zero close is not a stored index level and is not used to fill a gap");
assert.equal(buildBenchmarkChartGeometry(stored.points).segments.length, 1, "only consecutive stored days connect");
assert.equal(presentMarketBenchmarkSeries(stored.points.map(point => ({
  seriesId: "标普500", observationDate: point.observationDate, close: point.close,
})), "标普500").role, "market_benchmark");

const inception = "2026-10-09";
const summed = buildAggregateAssetSeries([
  { id: "a", currency: "USD", points: [
    { observation_date: "2026-10-08", net_assets: "10", currency: "USD" },
    { observation_date: "2026-10-09", net_assets: "10.50", currency: "USD" },
    { observation_date: "2026-10-10", net_assets: "11", currency: "USD" },
  ] },
  { id: "b", currency: "USD", points: [
    { observation_date: "2026-10-08", net_assets: "5", currency: "USD" },
    { observation_date: "2026-10-09", net_assets: "1.25", currency: "USD" },
    { observation_date: "2026-10-11", net_assets: "9", currency: "USD" },
  ] },
  { id: "c", currency: "HKD", points: [
    { observation_date: "2026-10-09", net_assets: "100", currency: "HKD" },
  ] },
], inception);
assert.deepEqual(summed.points, [], "USD and HKD stay in separate series");
const usd = summed.byCurrency.find(item => item.currency === "USD");
const hkd = summed.byCurrency.find(item => item.currency === "HKD");
assert.deepEqual(usd.points.map(point => ({
  observation_date: point.observation_date,
  net_assets: point.net_assets,
  break_before: point.break_before === true,
})), [
  { observation_date: "2026-10-09", net_assets: "11.75", break_before: false },
  { observation_date: "2026-10-10", net_assets: "11", break_before: true },
  { observation_date: "2026-10-11", net_assets: "9", break_before: true },
]);
assert.equal(usd.omittedPartialDateCount, 2, "missing accounts are omitted from that day instead of dropping it");
assert.deepEqual(hkd.points.map(point => point.net_assets), ["100"]);
assert.equal(summed.points.some(point => point.observation_date < inception), false);
assert.equal(usd.points.some(point => point.net_assets === "0"), false);
const summedGeometry = buildAssetChartGeometry(usd.points.map(point => ({
  observation_date: point.observation_date,
  observed_finished_at: point.observation_date,
  currency: "USD",
  net_assets: point.net_assets,
  total_cash: null,
  break_before: point.break_before,
})));
assert.equal(summedGeometry.dots.length, 3);
assert.equal(summedGeometry.segments.length, 0, "a coverage change or missing calendar day breaks the line");

const continuous = buildAggregateAssetSeries([
  { id: "a", points: [
    { observation_date: "2026-10-09", net_assets: "1.00" },
    { observation_date: "2026-10-10", net_assets: "2" },
  ] },
  { id: "b", points: [
    { observation_date: "2026-10-09", net_assets: "3" },
    { observation_date: "2026-10-10", net_assets: "4.00" },
  ] },
], inception);
assert.deepEqual(continuous.points.map(point => point.net_assets), ["4", "6"]);
assert.equal(continuous.points[1].break_before, false);
assert.equal(continuous.omittedPartialDateCount, 0);
assert.equal(buildAssetChartGeometry(continuous.points.map(point => ({
  observation_date: point.observation_date,
  observed_finished_at: point.observation_date,
  currency: "USD",
  net_assets: point.net_assets,
  total_cash: null,
  break_before: point.break_before,
}))).segments.length, 1);

const conflict = buildAggregateAssetSeries([
  { id: "a", points: [
    { observation_date: "2026-10-09", net_assets: "10" },
    { observation_date: "2026-10-09", net_assets: "11" },
  ] },
  { id: "b", points: [{ observation_date: "2026-10-09", net_assets: "1" }] },
], inception);
assert.deepEqual(conflict.points.map(point => point.net_assets), ["1"], "disagreeing amounts are not averaged; that account is omitted");

assert.deepEqual(buildAggregateAssetSeries([], inception).points, []);
assert.equal(presentAggregateReturn([
  { included: true, qualified: null },
  { included: false, qualified: null },
]).reason, "no_qualified_record");
assert.equal(presentAggregateReturn([
  { included: true, qualified: { currency: "USD", periodFrom: "2026-09-01", periodTo: "2026-09-30", sourceValue: "1.5" } },
  { included: true, qualified: null },
]).reason, "incomplete");
assert.equal(presentAggregateReturn([
  { included: true, qualified: { currency: "USD", periodFrom: "2026-09-01", periodTo: "2026-09-30", sourceValue: "1.5" } },
  { included: true, qualified: { currency: "EUR", periodFrom: "2026-09-01", periodTo: "2026-09-30", sourceValue: "2" } },
]).reason, "weighting_unqualified");
const single = presentAggregateReturn([
  { included: true, qualified: { currency: "EUR", periodFrom: "2026-09-01", periodTo: "2026-09-30", sourceValue: "-2.5" } },
  { included: false, qualified: null },
]);
assert.equal(single.status, "available");
assert.equal(single.sourceValue, "-2.5");
assert.equal(single.basis, "single_eligible_account");
assert.equal(readQualifiedPeriodReturn("longbridge", {
  status: "available", currency: "USD", period: { from: "2026-09-01", to: "2026-09-30" }, source_value: "1", source_unit: "percent",
}, true), null, "a non-IBKR payload is not a qualified account return");
assert.equal(readQualifiedPeriodReturn("ibkr", {
  status: "available", currency: "EUR", period: { from: "2026-09-01", to: "2026-09-30" }, source_value: "-2.5", source_unit: "percent",
}, false), null, "a revision mismatch cannot display a qualified return");


assert.deepEqual(OVERVIEW_USD_RATES, {}, "overview does not invent extra FX rates");
assert.equal(amountToUsd("USD", "2095.95"), "2095.95");
assert.equal(amountToUsd("USDT", "133.13"), "133.13", "USDT counts 1:1 with USD");
assert.equal(amountToUsd("SGD", "100"), null, "SGD without a rate is omitted, not zero-filled");
assert.equal(amountToUsd("HKD", "780"), null, "HKD without a rate is omitted, not zero-filled");
assert.equal(amountToUsd("EUR", "10", { EUR: "1.1" }), "11");
assert.equal(amountToUsd("EUR", "10", { EUR: "0" }), null, "a zero rate is unusable and omits the amount");

const usdTotal = sumAmountsToUsd([
  { currency: "USD", amount: "2095.95" },
  { currency: "USDT", amount: "133.13" },
  { currency: "SGD", amount: "100" },
  { currency: "HKD", amount: "780" },
], OVERVIEW_USD_RATES);
assert.equal(usdTotal.amount, "2229.08", "ready USD and USDT sum at 1:1; missing rates stay out of the total");
assert.deepEqual(usdTotal.omittedCurrencies, ["HKD", "SGD"]);

const onlyUnrated = sumAmountsToUsd([
  { currency: "SGD", amount: "50" },
  { currency: "HKD", amount: "10" },
], {});
assert.equal(onlyUnrated.amount, null, "when every currency lacks a rate the USD total is absent, not 0");
assert.deepEqual(onlyUnrated.omittedCurrencies, ["HKD", "SGD"]);

const emptyUsd = sumAmountsToUsd([], OVERVIEW_USD_RATES);
assert.equal(emptyUsd.amount, null);
assert.deepEqual(emptyUsd.omittedCurrencies, []);

console.log("overview_benchmark_aggregate_validation ok");
