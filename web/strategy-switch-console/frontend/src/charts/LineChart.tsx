import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useLanguage } from "../i18n";
import type { Point } from "../api/contracts";
import { dailyReturnsFromCumulative } from "./returns";
import { formatPercent } from "../lib/format";

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
const PAD = { top: 12, right: 12, bottom: 24, left: 48 };

function toPath(points: { x: number; y: number; breakBefore?: boolean }[]): string {
  let path = "";
  for (const point of points) {
    path += `${point.breakBefore || path === "" ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }
  return path;
}

/**
 * Multi-series percent chart: legend toggles, crosshair tooltip with date + 2dp values,
 * cumulative/daily modes; cumulative mode rebases every visible series to 0 at the first common date.
 */
export function LineChart({
  series,
  mode = "cumulative",
  ariaLabel,
}: {
  series: ChartSeries[];
  mode?: "cumulative" | "daily";
  ariaLabel: string;
}) {
  const language = useLanguage();
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(series.filter(item => !item.primary).map(item => item.id)));
  const [cursor, setCursor] = useState<number | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  const prepared = useMemo(() => {
    const dates = [...new Set(series.flatMap(item => item.points.map(point => point.date)))].sort();
    const index = new Map(dates.map((date, i) => [date, i]));
    const preparedSeries = series.map(item => {
      let base: number | null = null;
      const points = item.points.map(point => {
        let value = point.value;
        if (mode === "cumulative") {
          if (base === null) base = value;
          value = value - base;
        }
        return { date: point.date, value, breakBefore: point.breakBefore };
      });
      if (mode === "daily") {
        return { ...item, points: dailyReturnsFromCumulative(item.points) };
      }
      return { ...item, points };
    });
    return { dates, index, series: preparedSeries };
  }, [series, mode]);

  const visible = prepared.series.filter(item => !hidden.has(item.id) && item.points.length > 0);

  const { yMin, yMax } = useMemo(() => {
    let min = 0;
    let max = 0;
    for (const item of visible) {
      for (const point of item.points) {
        if (point.value < min) min = point.value;
        if (point.value > max) max = point.value;
      }
    }
    if (min === max) max = min + 1;
    const pad = (max - min) * 0.08;
    return { yMin: min - pad, yMax: max + pad };
  }, [visible]);

  const xFor = (i: number) => PAD.left + (prepared.dates.length <= 1 ? 0 : (i / (prepared.dates.length - 1)) * (WIDTH - PAD.left - PAD.right));
  const yFor = (value: number) => PAD.top + (1 - (value - yMin) / (yMax - yMin)) * (HEIGHT - PAD.top - PAD.bottom);

  const valueAt = (item: ChartSeries & { points: { date: string; value: number; breakBefore?: boolean }[] }, date: string) =>
    item.points.find(point => point.date === date)?.value ?? null;

  const onMove = (clientX: number) => {
    const frame = frameRef.current;
    if (!frame || prepared.dates.length === 0) return;
    const rect = frame.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    const x = ratio * WIDTH;
    const i = Math.round(((x - PAD.left) / (WIDTH - PAD.left - PAD.right)) * (prepared.dates.length - 1));
    setCursor(Math.max(0, Math.min(prepared.dates.length - 1, i)));
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (prepared.dates.length === 0) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      setCursor(current => Math.max(0, Math.min(prepared.dates.length - 1, (current ?? 0) + delta)));
    }
  };

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i <= 4; i++) ticks.push(yMin + ((yMax - yMin) * i) / 4);
    return ticks;
  }, [yMin, yMax]);

  const xTicks = useMemo(() => {
    const count = prepared.dates.length;
    if (count === 0) return [];
    const wanted = [0, Math.floor(count * 0.25), Math.floor(count * 0.5), Math.floor(count * 0.75), count - 1];
    return [...new Set(wanted)].map(i => ({ i, date: prepared.dates[i] }));
  }, [prepared.dates]);

  const cursorDate = cursor !== null ? prepared.dates[cursor] : null;
  const tooltipLeft = cursor !== null ? (xFor(cursor) / WIDTH) * 100 : 0;

  return (
    <div>
      <div className="chart-frame" ref={frameRef}>
        <svg
          className="chart"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onMouseMove={event => onMove(event.clientX)}
          onMouseLeave={() => setCursor(null)}
          onFocus={() => setCursor(current => current ?? 0)}
          onBlur={() => setCursor(null)}
        >
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={yFor(tick)} y2={yFor(tick)} stroke="var(--line)" strokeWidth="1" />
              <text x={PAD.left - 6} y={yFor(tick) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
                {formatPercent(tick, language, 1)}
              </text>
            </g>
          ))}
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={yFor(0)} y2={yFor(0)} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />
          {xTicks.map(tick => (
            <text key={tick.i} x={xFor(tick.i)} y={HEIGHT - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">
              {tick.date.slice(5)}
            </text>
          ))}
          {visible.map(item => (
            <path
              key={item.id}
              d={toPath(item.points.map(point => ({ x: xFor(prepared.index.get(point.date)!), y: yFor(point.value), breakBefore: point.breakBefore })))}
              fill="none"
              stroke={item.color}
              strokeWidth={item.primary ? 2.5 : 1.4}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {cursor !== null && (
            <line x1={xFor(cursor)} x2={xFor(cursor)} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="var(--muted)" strokeWidth="1" />
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
