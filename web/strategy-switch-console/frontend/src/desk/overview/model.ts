/**
 * Pure model behind the overview page: signed currency text, the headline counts, the
 * risk meters and the plotting geometry for the equity curve and the 30-day sparklines.
 *
 * Everything here is a pure function of contract data so the honesty rules are testable:
 * an unknown value returns null (the page renders the "unknown" mark), never 0, and a
 * ratio whose limit is missing is not plotted as if it were safe.
 */
import type { BookRow, Decimal, Overview } from "../contract/types";

const MINUS = "\u2212";

export type Tone = "ok" | "warn" | "over" | "unknown";

export function toNumber(value: Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function localeOf(language: "zh" | "en"): string {
  return language === "zh" ? "zh-CN" : "en-US";
}

function grouped(value: number, language: "zh" | "en", decimals: number): string {
  return value.toLocaleString(localeOf(language), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** "+0.59%" / "−6.80%"; null stays null so the caller can print the unknown mark. */
export function formatSignedPercent(ratio: Decimal | null, digits = 2): string | null {
  const value = toNumber(ratio);
  if (value === null) return null;
  const text = Math.abs(value * 100).toFixed(digits);
  if (Number(text) === 0) return `${text}%`;
  return `${value > 0 ? "+" : MINUS}${text}%`;
}

/** "0.96×" for an exposure multiple; null stays null. */
export function formatMultiple(ratio: Decimal | null, digits = 2): string | null {
  const value = toNumber(ratio);
  if (value === null) return null;
  return `${value.toFixed(digits)}×`;
}

export function formatMoney(amount: Decimal | number | null, currency: string, language: "zh" | "en", decimals = 0): string | null {
  const value = toNumber(amount);
  if (value === null) return null;
  const code = String(currency || "").toUpperCase();
  const digits = Number.isInteger(value) ? decimals : Math.max(decimals, 2);
  const text = grouped(value, language, digits);
  return code === "USD" || code === "" ? `$${text}` : `${text} ${code}`;
}

export function formatSignedMoney(amount: Decimal | null, currency: string, language: "zh" | "en", decimals = 0): string | null {
  const value = toNumber(amount);
  if (value === null) return null;
  const text = formatMoney(Math.abs(value), currency, language, decimals);
  if (text === null) return null;
  if (value === 0) return text;
  return `${value > 0 ? "+" : MINUS}${text}`;
}

/**
 * "Six running, five steady, one drifting" — the three numbers share one denominator (the
 * running books) so the sentence adds up. A book whose runtime is unknown is not counted as
 * running; drift on a book that is not running still surfaces through `needs_you`.
 */
export function headlineCounts(book: BookRow[]): { running: number; steady: number; drifting: number; total: number } {
  const running = book.filter(row => row.runtime.status === "known" && row.runtime.value === "running");
  const drifting = running.filter(row => row.config.state === "drift").length;
  return { running: running.length, steady: running.length - drifting, drifting, total: book.length };
}

/**
 * Segmented meter for a ratio against its limit. Both are negatives (drawdown), so the
 * fill is ratio/limit. A missing ratio or limit fills nothing and reads "unknown".
 */
export function meter(ratio: Decimal | null, limit: Decimal | null, cells = 12): { filled: number | null; tone: Tone } {
  const value = toNumber(ratio);
  const cap = toNumber(limit);
  if (value === null || cap === null || cap === 0) return { filled: null, tone: "unknown" };
  const used = Math.min(1, Math.abs(value / cap));
  const filled = Math.max(value === 0 ? 0 : 1, Math.round(used * cells));
  const tone: Tone = used >= 1 ? "over" : used >= 0.8 ? "warn" : "ok";
  return { filled: Math.min(cells, filled), tone };
}

type Series = Overview["equity_curve"];

function extent(values: number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

/**
 * Equity curve geometry in a `width`×`height` viewBox. The portfolio and the benchmark share
 * one scale so their shapes stay comparable; the drawdown band sits in the lower fifth.
 * Returns null when there is nothing plottable, so the caller can say so instead of drawing
 * a flat line at an invented level.
 */
export function curveGeometry(
  series: Series,
  width: number,
  height: number,
  pad = 8,
): {
  portfolioPath: string;
  benchmarkPath: string | null;
  areaPath: string | null;
  drawdownPath: string | null;
  min: number;
  max: number;
  drawdownMin: number | null;
} | null {
  const portfolio = series.portfolio.indexed.map(value => toNumber(value)).filter((value): value is number => value !== null);
  const benchmark = series.benchmark.indexed.map(value => toNumber(value)).filter((value): value is number => value !== null);
  if (portfolio.length < 2) return null;

  const all = portfolio.concat(benchmark);
  const { min: rawMin, max: rawMax } = extent(all);
  const span = rawMax - rawMin || 1;
  const min = rawMin - span * 0.08;
  const max = rawMax + span * 0.08;
  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);
  const x = (index: number, length: number): number => pad + (length === 1 ? 0 : (index / (length - 1)) * innerW);
  const y = (value: number): number => pad + innerH - ((value - min) / (max - min)) * innerH;

  const line = (values: number[]): string =>
    values.map((value, index) => `${index === 0 ? "M" : "L"}${x(index, values.length).toFixed(2)} ${y(value).toFixed(2)}`).join(" ");

  const portfolioPath = line(portfolio);
  const areaPath = `${portfolioPath} L${x(portfolio.length - 1, portfolio.length).toFixed(2)} ${(pad + innerH).toFixed(2)} ` +
    `L${x(0, portfolio.length).toFixed(2)} ${(pad + innerH).toFixed(2)} Z`;

  const drawdowns = series.drawdown.map(value => toNumber(value)).filter((value): value is number => value !== null);
  let drawdownPath: string | null = null;
  let drawdownMin: number | null = null;
  if (drawdowns.length >= 2) {
    drawdownMin = Math.min(...drawdowns, 0);
    const band = innerH * 0.22;
    const base = pad + innerH;
    const depth = drawdownMin === 0 ? 1 : Math.abs(drawdownMin);
    const bandY = (value: number): number => base - (Math.abs(Math.min(0, value)) / depth) * band;
    drawdownPath = drawdowns
      .map((value, index) => `${index === 0 ? "M" : "L"}${x(index, drawdowns.length).toFixed(2)} ${bandY(value).toFixed(2)}`)
      .join(" ");
    drawdownPath += ` L${x(drawdowns.length - 1, drawdowns.length).toFixed(2)} ${base.toFixed(2)} ` +
      `L${x(0, drawdowns.length).toFixed(2)} ${base.toFixed(2)} Z`;
  }

  return { portfolioPath, benchmarkPath: benchmark.length >= 2 ? line(benchmark) : null, areaPath, drawdownPath, min, max, drawdownMin };
}

/** Sparkline path for one book; an empty or single-point series draws nothing. */
export function sparkPath(points: Decimal[], width: number, height: number, pad = 1): string {
  const values = points.map(value => toNumber(value)).filter((value): value is number => value !== null);
  if (values.length < 2) return "";
  const { min, max } = extent(values);
  const span = max - min || 1;
  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);
  return values
    .map((value, index) => {
      const x = pad + (index / (values.length - 1)) * innerW;
      const y = pad + innerH - ((value - min) / span) * innerH;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

/**
 * A book's own 30-day path carries gap dates. A gap means the day was not observed, so the
 * line is broken there rather than drawn straight across the missing days.
 */
export function sparkSegments(points: Decimal[], gapDates: string[], datesFrom: string | null, datesTo: string | null): Decimal[][] {
  if (!datesFrom || !datesTo || gapDates.length === 0) return [points];
  const start = Date.parse(`${datesFrom}T00:00:00Z`);
  const end = Date.parse(`${datesTo}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || points.length === 0) return [points];
  const dayMs = 86400000;
  const totalDays = Math.round((end - start) / dayMs) + 1;
  const observedDays = points.length;
  if (observedDays >= totalDays) return [points];
  // The series lists only observed days, oldest first; walk the calendar and cut at each gap.
  const gaps = new Set(gapDates);
  const segments: Decimal[][] = [];
  let cursor = 0;
  for (let day = 0; day < totalDays && cursor < points.length; day += 1) {
    const date = new Date(start + day * dayMs).toISOString().slice(0, 10);
    if (gaps.has(date)) {
      segments.push([]);
      continue;
    }
    const tail = segments.length === 0 ? null : segments[segments.length - 1];
    if (tail) tail.push(points[cursor]);
    else segments.push([points[cursor]]);
    cursor += 1;
  }
  const filled = segments.filter(segment => segment.length > 1);
  return filled.length > 0 ? filled : [points];
}
