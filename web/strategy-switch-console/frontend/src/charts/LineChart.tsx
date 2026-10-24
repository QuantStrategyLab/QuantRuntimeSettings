import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useLanguage } from "../i18n";
import type { Point } from "../api/contracts";
import { formatPercent } from "../lib/format";
import { nicePercentTicks } from "./ticks";

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  points: Point[];
  /** Main series draws thicker and stays visible by default. */
  primary?: boolean;
}

const WIDTH = 800;
const HEIGHT = 280;
const MIN_WIDTH = 280;
const PAD = { top: 12, right: 12, bottom: 24, left: 48 };

type PreparedPoint = { date: string; value: number; breakBefore: boolean };
type PreparedSeries = Omit<ChartSeries, "points"> & { points: PreparedPoint[] };

function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function isBreak(point: Point): boolean {
  // The backend marks real gaps (including market-aware and membership gaps).
  return point.breakBefore === true || point.membership_changed === true;
}

function toPath(points: Positioned[]): string {
  let path = "";
  for (const point of points) {
    path += `${point.breakBefore || path === "" ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }
  return path;
}

type Positioned = PreparedPoint & { x: number; y: number };

/** Daily changes from cumulative percentages; breaks come only from backend gap flags. */
function dailyPoints(points: Point[], start: string | null): PreparedPoint[] {
  const rows = points.filter(point => !start || point.date >= start);
  const daily: PreparedPoint[] = [];
  let previous: Point | null = null;
  let interrupted = true;
  for (const point of rows) {
    const boundary = isBreak(point);
    if (boundary) interrupted = true;
    const canCompute = previous !== null && !boundary
      && Number.isFinite(previous.value) && previous.value > -100
      && Number.isFinite(point.value) && point.value >= -100;
    if (canCompute) {
      const value = ((1 + point.value / 100) / (1 + previous!.value / 100) - 1) * 100;
      if (Number.isFinite(value)) {
        daily.push({ date: point.date, value, breakBefore: interrupted });
        interrupted = false;
      } else {
        interrupted = true;
      }
    } else {
      interrupted = true;
    }
    previous = Number.isFinite(point.value) ? point : null;
  }
  return daily;
}

/**
 * Prepare series for plotting. Cumulative percentages are server-authoritative: a native
 * TWR chain legitimately starts above zero, so filtering by the common start must never
 * rebase the first point to zero or shift the final compounded value.
 */
export function prepareChartSeries(
  series: ChartSeries[],
  mode: "cumulative" | "daily",
  alignStart: string | null = null,
): { dates: string[]; index: Map<string, number>; series: PreparedSeries[] } {
  const populated = series.filter(item => item.points.length > 0);
  const dateSets = populated.map(item => new Set(item.points.map(point => point.date)));
  const common = populated.length > 0
    ? [...dateSets[0]!].filter(date => dateSets.every(set => set.has(date))).sort()[0] ?? null
    : null;
  const start = alignStart ?? common ?? populated[0]?.points[0]?.date ?? null;

  const preparedSeries: PreparedSeries[] = populated.map(item => {
    if (mode === "daily") return { ...item, points: dailyPoints(item.points, start) };
    const points = item.points
      .filter(point => (!start || point.date >= start) && Number.isFinite(point.value))
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(point => ({
        date: point.date,
        value: point.value,
        // Never infer gaps from date length; the backend knows the market calendar.
        breakBefore: isBreak(point),
      }));
    return { ...item, points };
  });

  const dates = [...new Set(preparedSeries.flatMap(item => item.points.map(point => point.date)))].sort();
  const index = new Map(dates.map((date, i) => [date, i]));
  return { dates, index, series: preparedSeries };
}

/**
 * Multi-series percent chart: legend toggles, crosshair tooltip with date + 2dp values,
 * cumulative/daily modes. Cumulative values keep the server-provided percentages for the
 * alignStart window; the baseline does not move when a legend entry is hidden.
 */
export function LineChart({
  series,
  mode = "cumulative",
  ariaLabel,
  alignStart = null,
  defaultVisible,
}: {
  series: ChartSeries[];
  mode?: "cumulative" | "daily";
  ariaLabel: string;
  /** Backend-provided common start date, when available. */
  alignStart?: string | null;
  /** Series ids visible on first render; primary series always start visible. */
  defaultVisible?: string[];
}) {
  const language = useLanguage();
  const [hidden, setHidden] = useState<Set<string>>(() => {
    const defaults = defaultVisible ? new Set(defaultVisible) : null;
    return new Set(series
      .filter(item => !item.primary && (!defaults || !defaults.has(item.id)))
      .map(item => item.id));
  });
  const [cursor, setCursor] = useState<number | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(WIDTH);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setFrameWidth(entry.contentRect.width);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const prepared = useMemo(
    () => prepareChartSeries(series, mode, alignStart),
    [series, mode, alignStart],
  );

  const visible = prepared.series.filter(item => !hidden.has(item.id) && item.points.length > 0);

  const tickSet = useMemo(() => {
    const values: number[] = [];
    for (const item of visible) for (const point of item.points) values.push(point.value);
    return nicePercentTicks(values, 4);
  }, [visible]);

  const formattedTicks = useMemo(
    () => tickSet.ticks.map(value => ({ value, label: formatPercent(value, language, tickSet.digits) })),
    [tickSet, language],
  );

  const chartWidth = Math.max(frameWidth, MIN_WIDTH);
  const height = chartWidth < 480 ? 220 : HEIGHT;
  const leftPad = Math.max(PAD.left, ...formattedTicks.map(tick => tick.label.length * 7 + 12));
  const plotWidth = Math.max(1, chartWidth - leftPad - PAD.right);
  const plotHeight = height - PAD.top - PAD.bottom;

  const firstTime = prepared.dates.length ? dayMs(prepared.dates[0]!) : 0;
  const lastTime = prepared.dates.length ? dayMs(prepared.dates.at(-1)!) : 0;
  const timeSpan = lastTime - firstTime;
  // Plots use the real calendar scale so missing days read as gaps, not equal steps.
  const xFor = (i: number) => {
    if (prepared.dates.length <= 1 || !(timeSpan > 0)) return leftPad + plotWidth / 2;
    const ratio = (dayMs(prepared.dates[i]!) - firstTime) / timeSpan;
    return leftPad + Math.min(Math.max(ratio, 0), 1) * plotWidth;
  };
  const yFor = (value: number) =>
    PAD.top + (1 - (value - tickSet.min) / (tickSet.max - tickSet.min)) * plotHeight;

  const valueAt = (item: PreparedSeries, date: string) =>
    item.points.find(point => point.date === date)?.value ?? null;

  const nearestIndex = (time: number) => {
    let best = 0;
    let bestDelta = Infinity;
    prepared.dates.forEach((date, i) => {
      const delta = Math.abs(dayMs(date) - time);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = i;
      }
    });
    return best;
  };

  const onMove = (clientX: number) => {
    const frame = frameRef.current;
    if (!frame || prepared.dates.length === 0) return;
    const rect = frame.getBoundingClientRect();
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    const x = Math.min(Math.max(ratio, 0), 1) * chartWidth;
    const clamped = Math.min(Math.max(x, leftPad), leftPad + plotWidth);
    // Cursor snaps to the nearest observation date, not the nearest index slot.
    const time = timeSpan > 0 ? firstTime + ((clamped - leftPad) / plotWidth) * timeSpan : firstTime;
    setCursor(nearestIndex(time));
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (prepared.dates.length === 0) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      setCursor(current => Math.max(0, Math.min(prepared.dates.length - 1, (current ?? 0) + delta)));
    }
  };

  const xTicks = useMemo(() => {
    const count = prepared.dates.length;
    if (count === 0) return [];
    const wanted = chartWidth < 480 ? 2 : chartWidth < 760 ? 3 : 5;
    return [...new Set(Array.from({ length: wanted }, (_, i) =>
      Math.round((i / Math.max(1, wanted - 1)) * (count - 1))))]
      .map(i => ({
        i,
        date: prepared.dates[i]!,
        // Edge labels anchor inward so the first and last dates are not clipped.
        anchor: i === 0 ? "start" : i === count - 1 ? "end" : "middle",
      }));
  }, [prepared.dates, chartWidth]);

  const cursorDate = cursor !== null ? prepared.dates[cursor] : null;
  const tooltipLeft = cursor !== null ? (xFor(cursor) / chartWidth) * 100 : 0;

  return (
    <div>
      <div className="chart-frame" ref={frameRef}>
        <svg
          className="chart"
          viewBox={`0 0 ${chartWidth} ${height}`}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onMouseMove={event => onMove(event.clientX)}
          onMouseLeave={() => setCursor(null)}
          onFocus={() => setCursor(current => current ?? 0)}
          onBlur={() => setCursor(null)}
        >
          {formattedTicks.map(tick => (
            <g key={tick.value}>
              <line x1={leftPad} x2={chartWidth - PAD.right} y1={yFor(tick.value)} y2={yFor(tick.value)} stroke="var(--line)" strokeWidth="1" />
              <text x={leftPad - 6} y={yFor(tick.value) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
                {tick.label}
              </text>
            </g>
          ))}
          <line x1={leftPad} x2={chartWidth - PAD.right} y1={yFor(0)} y2={yFor(0)} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />
          {xTicks.map(tick => (
            <text
              key={tick.i}
              x={xFor(tick.i)}
              y={height - 6}
              textAnchor={tick.anchor}
              fontSize="11"
              fill="var(--muted)"
            >
              {tick.date.slice(5)}
            </text>
          ))}
          {visible.map(item => {
            const positioned: Positioned[] = item.points.map(point => ({
              ...point,
              x: xFor(prepared.index.get(point.date)!),
              y: yFor(point.value),
            }));
            const segments: Positioned[][] = [];
            for (const point of positioned) {
              if (!segments.length || point.breakBefore) segments.push([]);
              segments.at(-1)!.push(point);
            }
            return (
              <g key={item.id}>
                <path
                  d={toPath(positioned)}
                  fill="none"
                  stroke={item.color}
                  strokeWidth={item.primary ? 2.5 : 1.4}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {segments.filter(segment => segment.length === 1).map(([point]) => (
                  <circle key={point.date} cx={point.x} cy={point.y} r="3" fill={item.color} />
                ))}
              </g>
            );
          })}
          {cursor !== null && (
            <line x1={xFor(cursor)} x2={xFor(cursor)} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--muted)" strokeWidth="1" />
          )}
        </svg>
        {cursor !== null && cursorDate && (
          <div className="chart-tooltip" style={{ left: `${Math.min(Math.max(tooltipLeft, 8), 88)}%`, top: 8 }}>
            <div className="tooltip-date">{cursorDate}</div>
            {visible.map(item => (
              <div className="tooltip-row" key={item.id}>
                <span className="legend-swatch" style={{ background: item.color }} />
                <span>{item.label}</span>
                <strong>{valueAt(item, cursorDate) === null ? "—" : formatPercent(valueAt(item, cursorDate), language)}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="chart-legend">
        {prepared.series.map(item => {
          const off = hidden.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              className={off ? "off" : ""}
              aria-pressed={!off}
              onClick={() =>
                setHidden(current => {
                  const next = new Set(current);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.add(item.id);
                  return next;
                })
              }
            >
              <span className="legend-swatch" style={{ background: item.color }} />
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
