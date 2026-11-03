/**
 * Pure model for the performance page's benchmark lines (no React, no DOM except the injected
 * storage). It adapts the `qsl.performance_benchmarks.v1` response (docs/console-api.md,
 * "Performance benchmark ETF curves") and fails closed: a series that is missing, partial,
 * malformed or not covering the strategy window is "unavailable" and is never drawn as zeros,
 * carried forward or filled. Returns are ETF close price returns (basis comes from the API).
 */
import { nicePercentTicks } from "../../charts/ticks.ts";

export const PERF_BENCH_API = "/api/market-benchmark/performance";
export const PERF_BENCH_STORAGE_KEY = "meridian.perf.benchmarks";

/** Design keys. Main four are on by default; extras are optional and off by default. */
export const MAIN_KEYS = ["spx", "ndx", "rut", "dji"] as const;
export const EXTRA_KEYS = ["sox", "world", "em"] as const;
export const BENCH_KEYS = [...MAIN_KEYS, ...EXTRA_KEYS] as const;
export type BenchKey = (typeof BENCH_KEYS)[number];

export interface BenchMeta {
  symbol: string;
  /** Known API id for the symbol; null when the backend has not named one yet. */
  apiId: string | null;
  /** CSS custom property (defined for light and dark in app/tokens.css). */
  token: string;
  /** SVG stroke-dasharray; "" = solid. Secondary encoding next to colour. */
  dash: string;
  extra: boolean;
}

/** Fixed allow-list: symbols outside it are ignored, whatever the response contains. */
export const BENCH_META: Record<BenchKey, BenchMeta> = {
  spx: { symbol: "SPY", apiId: "sp500", token: "--mrd-b1", dash: "", extra: false },
  ndx: { symbol: "QQQ", apiId: "nasdaq100", token: "--mrd-b2", dash: "7 4", extra: false },
  rut: { symbol: "IWM", apiId: "russell2000", token: "--mrd-b3", dash: "1.5 4", extra: false },
  dji: { symbol: "DIA", apiId: "djia", token: "--mrd-b4", dash: "9 3 2 3", extra: false },
  sox: { symbol: "SOXX", apiId: null, token: "--mrd-x1", dash: "3 3", extra: true },
  world: { symbol: "URTH", apiId: null, token: "--mrd-x2", dash: "12 4", extra: true },
  em: { symbol: "EEM", apiId: null, token: "--mrd-x3", dash: "2 2 8 2", extra: true },
};
const KEY_BY_SYMBOL = new Map(BENCH_KEYS.map(key => [BENCH_META[key].symbol, key] as const));

export type Coverage = "full" | "partial" | "unavailable";

export interface Point {
  date: string;
  value: number;
}

export interface BenchSeries {
  key: BenchKey;
  coverage: Coverage;
  /** Exact anchors from the API; used only for the "From {date}" state text. */
  baseDate: string | null;
  lastDate: string | null;
  /** Empty unless coverage is "full". */
  points: Point[];
}

export interface BenchmarkModel {
  window: { start: string; end: string };
  returnBasis: string;
  series: Record<BenchKey, BenchSeries>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export const dayMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function unavailable(key: BenchKey, coverage: Coverage = "unavailable", baseDate: string | null = null, lastDate: string | null = null): BenchSeries {
  return { key, coverage, baseDate, lastDate, points: [] };
}

/** Every series starts as "unavailable": a series the response does not contain stays so. */
export function emptySeries(): Record<BenchKey, BenchSeries> {
  return Object.fromEntries(BENCH_KEYS.map(key => [key, unavailable(key)])) as Record<BenchKey, BenchSeries>;
}

function parsePoints(raw: unknown, baseDate: string, lastDate: string): Point[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const points: Point[] = [];
  let previous = "";
  for (const item of raw) {
    if (!isObject(item) || !isIsoDate(item.date)) return null;
    const value = item.cumulative_return_ratio;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= -1) return null;
    // Strictly ascending: a duplicate or out-of-order date means the series cannot be trusted.
    if (item.date <= previous || item.date < baseDate || item.date > lastDate) return null;
    previous = item.date;
    points.push({ date: item.date, value });
  }
  if (points[0].date !== baseDate || points[0].value !== 0 || points[points.length - 1].date !== lastDate) return null;
  return points;
}

/**
 * Validates the response against the window that was requested. Returns null when the
 * envelope itself cannot be trusted (wrong schema, wrong window, no usable series list).
 */
export function parseBenchmarks(raw: unknown, requested: { start: string; end: string }): BenchmarkModel | null {
  if (!isObject(raw) || raw.schema_version !== "qsl.performance_benchmarks.v1") return null;
  const window = raw.window;
  if (!isObject(window) || window.start !== requested.start || window.end !== requested.end) return null;
  if (typeof raw.return_basis !== "string" || raw.return_basis === "" || !Array.isArray(raw.series)) return null;
  const series = emptySeries();
  const seen = new Set<BenchKey>();
  for (const item of raw.series) {
    if (!isObject(item) || typeof item.symbol !== "string") continue;
    const key = KEY_BY_SYMBOL.get(item.symbol);
    if (!key) continue; // unknown symbol: ignored
    if (seen.has(key)) { series[key] = unavailable(key); continue; } // duplicate: untrustworthy
    seen.add(key);
    const meta = BENCH_META[key];
    if (meta.apiId !== null && item.id !== meta.apiId) continue; // known symbol under a different id
    if (item.status !== "available" && item.status !== "partial") continue;
    const baseDate = isIsoDate(item.base_date) ? item.base_date : null;
    const lastDate = isIsoDate(item.last_date) ? item.last_date : null;
    if (!baseDate || !lastDate) continue;
    const covers = item.status === "available" && baseDate === requested.start && lastDate === requested.end;
    if (!covers) { series[key] = unavailable(key, "partial", baseDate, lastDate); continue; }
    const points = parsePoints(item.points, baseDate, lastDate);
    series[key] = points ? { key, coverage: "full", baseDate, lastDate, points } : unavailable(key);
  }
  return { window: { start: requested.start, end: requested.end }, returnBasis: raw.return_basis, series };
}

// ------------------------------------------------------------------ stats

export interface Stats {
  ret: number | null;
  cagr: number | null;
  maxDrawdown: number | null;
}

export const MIN_CAGR_DAYS = 30;

/**
 * Return = last cumulative value. CAGR = (1 + Return)^(365.25 / calendar days) - 1 over the
 * strategy window; shown only for windows of at least 30 days. Max drawdown = worst
 * (1 + r) / running peak of (1 + r) - 1 over the points, starting from the base value 1.
 */
export function computeStats(points: readonly Point[]): Stats {
  if (points.length < 2) return { ret: null, cagr: null, maxDrawdown: null };
  const ret = points[points.length - 1].value;
  if (!Number.isFinite(ret) || ret <= -1) return { ret: null, cagr: null, maxDrawdown: null };
  const days = (dayMs(points[points.length - 1].date) - dayMs(points[0].date)) / 86400000;
  const cagr = days >= MIN_CAGR_DAYS ? (1 + ret) ** (365.25 / days) - 1 : null;
  let peak = 1;
  let worst = 0;
  for (const point of points) {
    const wealth = 1 + point.value;
    peak = Math.max(peak, wealth);
    worst = Math.min(worst, wealth / peak - 1);
  }
  return { ret, cagr: Number.isFinite(cagr ?? 0) ? cagr : null, maxDrawdown: worst };
}

/** Excess = portfolio return - benchmark return in percentage points; null unless both are known. */
export function excessPts(portfolio: number | null, benchmark: number | null): number | null {
  return portfolio === null || benchmark === null ? null : (portfolio - benchmark) * 100;
}

/** CAGR KPI subtitle value: CAGR difference to the S&P 500 in points. */
export function cagrGapPts(portfolio: Stats, benchmark: Stats | null): number | null {
  return benchmark ? excessPts(portfolio.cagr, benchmark.cagr) : null;
}

// ------------------------------------------------------------------ portfolio curve

export interface PortfolioCurve {
  points: Point[];
  /** Dates the backend lists as missing; the line breaks across them. */
  gapDates: string[];
}

/** Cumulative return from an indexed series (decimal strings). null when it cannot be trusted. */
export function portfolioCurve(dates: unknown, indexed: unknown, gapDates: unknown = []): PortfolioCurve | null {
  if (!Array.isArray(dates) || !Array.isArray(indexed) || dates.length !== indexed.length || dates.length < 2) return null;
  const base = Number(indexed[0]);
  if (!(base > 0)) return null;
  const points: Point[] = [];
  let previous = "";
  for (let i = 0; i < dates.length; i += 1) {
    const level = typeof indexed[i] === "string" && /^-?\d+(\.\d+)?$/.test(indexed[i]) ? Number(indexed[i]) : NaN;
    if (!isIsoDate(dates[i]) || dates[i] <= previous || !(level > 0)) return null;
    previous = dates[i];
    points.push({ date: dates[i], value: level / base - 1 });
  }
  const gaps = Array.isArray(gapDates) ? gapDates.filter(isIsoDate) : [];
  return { points, gapDates: gaps };
}

/** A line breaks where the spacing exceeds max(5 days, 2.5x the series' median spacing). */
export const BREAK_DAYS = 5;

/** Index ranges [from, to] of consecutive points that may be joined by a line. */
export function segments(points: readonly Point[], gapDates: readonly string[] = []): Array<[number, number]> {
  const spans = points.slice(1).map((point, i) => (dayMs(point.date) - dayMs(points[i].date)) / 86400000);
  const sorted = [...spans].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1;
  const limit = Math.max(BREAK_DAYS, median * 2.5);
  const out: Array<[number, number]> = [];
  let from = 0;
  for (let i = 1; i < points.length; i += 1) {
    const gap = spans[i - 1] > limit || gapDates.some(date => date > points[i - 1].date && date < points[i].date);
    if (gap) { out.push([from, i - 1]); from = i; }
  }
  if (points.length) out.push([from, points.length - 1]);
  return out;
}

// ------------------------------------------------------------------ selection (localStorage)

export const DEFAULT_SELECTION: readonly BenchKey[] = MAIN_KEYS;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Stored value is a JSON array of enabled keys. Corrupt JSON or a wrong type falls back to the default; unknown keys are dropped; [] (all off) is valid. */
export function loadSelection(storage: StorageLike | null = defaultStorage()): BenchKey[] {
  try {
    const text = storage?.getItem(PERF_BENCH_STORAGE_KEY);
    if (text === null || text === undefined) return [...DEFAULT_SELECTION];
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [...DEFAULT_SELECTION];
    const known = new Set<string>(BENCH_KEYS);
    const keys = parsed.filter((item): item is BenchKey => typeof item === "string" && known.has(item));
    return BENCH_KEYS.filter(key => keys.includes(key));
  } catch {
    return [...DEFAULT_SELECTION];
  }
}

export function saveSelection(keys: readonly BenchKey[], storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(PERF_BENCH_STORAGE_KEY, JSON.stringify(BENCH_KEYS.filter(key => keys.includes(key))));
  } catch {
    // Storage may be full or blocked; the page keeps working with in-memory state.
  }
}

// ------------------------------------------------------------------ chart helpers

/** y axis from the visible lines only (always includes 0%): ratio domain plus tick ratios. */
export function yAxis(lines: ReadonlyArray<readonly Point[]>): { min: number; max: number; ticks: number[]; digits: number } {
  const percent = lines.flatMap(line => line.map(point => point.value * 100));
  const nice = nicePercentTicks(percent);
  return { min: nice.min / 100, max: nice.max / 100, ticks: nice.ticks.map(tick => tick / 100), digits: nice.digits };
}

/** Value of a series at exactly `date`; absent dates are absent (no carry-forward, no interpolation). */
export function valueAt(points: readonly Point[], date: string): number | null {
  let low = 0;
  let high = points.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (points[mid].date === date) return points[mid].value;
    if (points[mid].date < date) low = mid + 1; else high = mid - 1;
  }
  return null;
}

/** Spread end labels so they do not overlap; keeps order, clamps to [top, bottom]. */
export function nudgeLabels(ys: readonly number[], gap: number, top: number, bottom: number): number[] {
  const order = ys.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y);
  const placed = order.map(item => item.y);
  for (let i = 0; i < placed.length; i += 1) placed[i] = Math.max(i === 0 ? top : placed[i - 1] + gap, placed[i]);
  for (let i = placed.length - 1; i >= 0; i -= 1) {
    const limit = i === placed.length - 1 ? bottom : placed[i + 1] - gap;
    placed[i] = Math.min(placed[i], limit);
  }
  const result = new Array<number>(ys.length);
  order.forEach((item, i) => { result[item.index] = placed[i]; });
  return result;
}
