/** Pure chart calculations. See docs/console-performance-charts.md. */
export type PerformanceRange = "1m" | "3m" | "ytd" | "1y" | "all";
export const PERFORMANCE_RANGES = ["1m", "3m", "ytd", "1y", "all"] as const;
export type ValuePoint = { date: string; value: number; breakBefore?: boolean };
// Signed external flow at the END of (previous observation, this observation].
// null/undefined means unknown; zero is accepted only as explicit evidence.
export type EquityPoint = ValuePoint & { externalFlow?: number | null };
export type AccountEquity = { id: string; points: EquityPoint[] };
const DAY = 86_400_000;

export function dateMs(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date ? ms : NaN;
}

export function rangeStart(range: PerformanceRange, today: string): string {
  const ms = dateMs(today);
  if (!Number.isFinite(ms) || range === "all") return "0000-01-01";
  if (range === "ytd") return `${today.slice(0, 4)}-01-01`;
  const date = new Date(ms);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - (range === "1m" ? 1 : range === "3m" ? 3 : 12));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}

/** Conflicting duplicate dates are omitted, never arbitrarily picked. */
export function cleanPoints<T extends ValuePoint>(points: readonly T[]): T[] {
  const dates = new Map<string, T | null>();
  for (const point of points) {
    if (!Number.isFinite(dateMs(point.date)) || !Number.isFinite(point.value)) continue;
    const prior = dates.get(point.date);
    if (prior === undefined) dates.set(point.date, point);
    else if (prior === null || JSON.stringify(prior) !== JSON.stringify(point)) dates.set(point.date, null);
  }
  return [...dates.values()].filter((p): p is T => p !== null).sort((a, b) => a.date.localeCompare(b.date));
}

export function sliceRange<T extends ValuePoint>(points: readonly T[], range: PerformanceRange, today: string): T[] {
  const start = rangeStart(range, today);
  return cleanPoints(points).filter(p => p.date >= start && p.date <= today);
}

export function hasGap(previous: ValuePoint, point: ValuePoint): boolean {
  return point.breakBefore === true || dateMs(point.date) - dateMs(previous.date) > DAY;
}

/** Rebase a positive index/price to percentage return; never fill missing dates. */
export function rebase(points: readonly ValuePoint[], start?: string): ValuePoint[] {
  const rows = cleanPoints(points).filter(p => !start || p.date >= start);
  const base = rows[0]?.value;
  if (!(base > 0)) return [];
  return rows.map((p, i) => ({ ...p, value: i === 0 ? 0 : (p.value / base - 1) * 100,
    breakBefore: i > 0 && hasGap(rows[i - 1], p) }));
}

/** End-flow TWR: 1+r = (V_end - F_end) / V_previous. */
export function chainReturns(points: readonly EquityPoint[]): {
  index: ValuePoint[]; unknownFlow: boolean; invalidPeriod: boolean;
} {
  const rows = cleanPoints(points);
  const index: ValuePoint[] = [];
  let growth = 1;
  let unknownFlow = false;
  let invalidPeriod = false;
  if (rows.length && !(rows[0].value > 0)) return { index, unknownFlow, invalidPeriod: true };
  for (let i = 0; i < rows.length; i++) {
    const point = rows[i];
    if (i > 0) {
      const previous = rows[i - 1];
      const known = typeof point.externalFlow === "number" && Number.isFinite(point.externalFlow);
      unknownFlow ||= !known;
      // Unknown-flow series is explicitly an unadjusted estimate in the UI.
      const end = known ? point.value - point.externalFlow! : point.value;
      if (!(previous.value > 0) || end < 0) { invalidPeriod = true; break; }
      growth *= end / previous.value;
      if (!Number.isFinite(growth)) { invalidPeriod = true; break; }
    }
    index.push({ date: point.date, value: growth, breakBefore: i > 0 && hasGap(rows[i - 1], point) });
  }
  return { index, unknownFlow, invalidPeriod };
}

/** Fixed cohort: no changing membership, carry-forward, or missing-account zeros. */
export function aggregateEquity(accounts: readonly AccountEquity[]): {
  points: EquityPoint[]; missingAccounts: string[]; omittedDates: number;
} {
  const normalized = accounts.map(a => ({ id: a.id, points: cleanPoints(a.points) }));
  const missingAccounts = normalized.filter(a => !a.points.length).map(a => a.id);
  const members = normalized.filter(a => a.points.length);
  const maps = members.map(a => new Map(a.points.map((p, i) => [p.date, { p, i }])));
  const dates = [...new Set(members.flatMap(a => a.points.map(p => p.date)))].sort();
  const points: EquityPoint[] = [];
  let omittedDates = 0;
  for (const date of dates) {
    const values = maps.map(m => m.get(date));
    if (values.some(v => !v)) { omittedDates++; continue; }
    const previous = points.at(-1);
    const flowKnown = values.every((v, i) => v && Number.isFinite(v.p.externalFlow)
      && (!previous || members[i].points[v.i - 1]?.date === previous.date));
    points.push({ date, value: values.reduce((sum, v) => sum + v!.p.value, 0),
      externalFlow: flowKnown ? values.reduce((sum, v) => sum + v!.p.externalFlow!, 0) : null,
      breakBefore: !!previous && (dateMs(date) - dateMs(previous.date) > DAY || values.some(v => v!.p.breakBefore)) });
  }
  return { points, missingAccounts, omittedDates };
}

/** Baseline never changes when the user hides a legend entry. */
export function alignReturns(primary: readonly ValuePoint[], comparisons: readonly { id: string; points: ValuePoint[] }[]) {
  const own = cleanPoints(primary);
  const available = comparisons.map(s => ({ ...s, points: cleanPoints(s.points) })).filter(s => s.points.length);
  const dates = available.map(s => new Set(s.points.map(p => p.date)));
  const common = own.find(p => p.value > 0 && dates.every(d => d.has(p.date)))?.date;
  const start = common || own[0]?.date;
  return {
    start,
    primary: rebase(own, start),
    benchmarks: common ? available.map(s => ({ ...s, points: rebase(s.points, common) })) : [],
    noCommonDate: available.length > 0 && !common,
  };
}
