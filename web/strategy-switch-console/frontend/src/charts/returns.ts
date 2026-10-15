import type { Point } from "../api/contracts";

/** Recover period returns from cumulative percentages without bridging missing observations. */
export function dailyReturnsFromCumulative(points: Point[]): Point[] {
  const daily: Point[] = [];
  let previous: number | null = null;
  let interrupted = true;
  for (const point of points) {
    const valid = Number.isFinite(point.value) && point.value >= -100;
    const value = valid && previous !== null && previous > -100 && !point.breakBefore
      ? ((1 + point.value / 100) / (1 + previous / 100) - 1) * 100
      : NaN;
    if (Number.isFinite(value)) {
      daily.push({ date: point.date, value, breakBefore: interrupted });
      interrupted = false;
    } else {
      interrupted = true;
    }
    previous = valid ? point.value : null;
  }
  return daily;
}
