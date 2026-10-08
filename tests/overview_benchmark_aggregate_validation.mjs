import assert from "node:assert/strict";
import {
  MARKET_BENCHMARK_INCEPTION_DATE,
  MARKET_BENCHMARK_TIMEZONE,
  buildAggregateAssetSeries,
  buildBenchmarkChartGeometry,
  presentAggregateReturn,
  presentMarketBenchmarkSeries,
  readQualifiedPeriodReturn,
  shanghaiCalendarDate,
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
  { id: "a", points: [
    { observation_date: "2026-10-08", net_assets: "10" },
    { observation_date: "2026-10-09", net_assets: "10.50" },
    { observation_date: "2026-10-10", net_assets: "11" },
  ] },
  { id: "b", points: [
    { observation_date: "2026-10-08", net_assets: "5" },
    { observation_date: "2026-10-09", net_assets: "1.25" },
    { observation_date: "2026-10-11", net_assets: "9" },
  ] },
], inception);
assert.deepEqual(summed.points, [{ observation_date: "2026-10-09", net_assets: "11.75" }]);
assert.equal(summed.omittedPartialDateCount, 2, "2026-10-10 and 2026-10-11 stay gaps");
assert.equal(summed.points.some(point => point.observation_date < inception), false);
assert.equal(summed.points.some(point => point.net_assets === "0"), false);

const conflict = buildAggregateAssetSeries([
  { id: "a", points: [
    { observation_date: "2026-10-09", net_assets: "10" },
    { observation_date: "2026-10-09", net_assets: "11" },
  ] },
  { id: "b", points: [{ observation_date: "2026-10-09", net_assets: "1" }] },
], inception);
assert.deepEqual(conflict.points, [], "disagreeing closes on one date are not averaged into an aggregate");

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

console.log("overview_benchmark_aggregate_validation ok");
