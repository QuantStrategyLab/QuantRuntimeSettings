/**
 * Percent-axis ticks on a 1 / 2 / 2.5 / 5 × 10^n grid. Zero is always included
 * so a return chart keeps a meaningful baseline, and the step stays readable
 * (0.5%, 1%, 2.5%, 5%, …) instead of raw min/max fractions.
 */
export interface NicePercentTicks {
  min: number;
  max: number;
  step: number;
  digits: number;
  ticks: number[];
}

const NICE_MULTIPLIERS = [1, 2, 2.5, 5, 10] as const;

function niceStep(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const multiplier = NICE_MULTIPLIERS.find(candidate => normalized <= candidate) ?? 10;
  return multiplier * magnitude;
}

function decimalsFor(step: number): number {
  let digits = Math.max(0, -Math.floor(Math.log10(step)));
  const scaled = step * 10 ** digits;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-9) digits += 1;
  return Math.min(digits, 4);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function nicePercentTicks(values: readonly number[], targetIntervals = 4): NicePercentTicks {
  const finite = values.filter(value => Number.isFinite(value));
  if (finite.length === 0) return { min: -1, max: 1, step: 0.5, digits: 1, ticks: [-1, -0.5, 0, 0.5, 1] };

  let rawMin = Math.min(0, ...finite);
  let rawMax = Math.max(0, ...finite);
  if (rawMin === rawMax) {
    rawMin = -1;
    rawMax = 1;
  } else {
    const padding = (rawMax - rawMin) * 0.05;
    // Do not invent a negative axis when every observed return is positive (or vice versa).
    const allNonNegative = finite.every(value => value >= 0);
    const allNonPositive = finite.every(value => value <= 0);
    rawMin = allNonNegative ? 0 : rawMin - padding;
    rawMax = allNonPositive ? 0 : rawMax + padding;
  }

  const intervals = Math.max(2, targetIntervals);
  let step = niceStep((rawMax - rawMin) / intervals);
  let min = Math.floor(rawMin / step) * step;
  let max = Math.ceil(rawMax / step) * step;
  // Very wide or highly skewed ranges can still produce too many grid lines.
  for (let guard = 0; guard < 8 && (max - min) / step > intervals + 3; guard++) {
    step *= 2;
    min = Math.floor(rawMin / step) * step;
    max = Math.ceil(rawMax / step) * step;
  }

  const digits = decimalsFor(step);
  const ticks: number[] = [];
  const count = Math.round((max - min) / step);
  for (let i = 0; i <= count; i++) ticks.push(round(min + i * step, digits));
  return { min, max, step: round(step, digits), digits, ticks };
}
