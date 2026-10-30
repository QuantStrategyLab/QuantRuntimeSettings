import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useLanguage, useT } from "../i18n";
import type { Point } from "../api/contracts";
import { formatMoney, maskedAmount } from "../lib/format";
import { usePrefs } from "../app/context";

const WIDTH = 800;
const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 24, left: 64 };

function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/**
 * A break is a real backend gap: an omitted observation or a change in the set
 * of accounts behind the balance. Both end the drawn line instead of joining
 * two different scopes into one continuous total.
 */
function isBreak(point: Point): boolean {
  return point.breakBefore === true || point.membership_changed === true;
}

/** Single-series asset area chart; cash-flow points (externalFlow ≠ 0) get markers. No benchmarks. */
export function AreaChart({
  points,
  currency,
  ariaLabel,
}: {
  points: (Point & { externalFlow?: number | null })[];
  currency?: string | null;
  ariaLabel: string;
}) {
  const language = useLanguage();
  const t = useT();
  const { prefs } = usePrefs();
  const [cursor, setCursor] = useState<number | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(WIDTH);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const { yMin, yMax } = useMemo(() => {
    if (!points.length) return { yMin: 0, yMax: 1 };
    let min = Infinity;
    let max = -Infinity;
    for (const point of points) {
      if (point.value < min) min = point.value;
      if (point.value > max) max = point.value;
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.08;
    return { yMin: min - pad, yMax: max + pad };
  }, [points]);

  const formatValue = (value: number) => (prefs.hideAmounts ? maskedAmount(value) : formatMoney(value, currency, language));
  const ticks = [0, 1, 2, 3, 4].map(i => yMin + ((yMax - yMin) * i) / 4);
  const pad = { ...PAD, left: Math.max(PAD.left, ...ticks.map(value => formatValue(value).length * 8 + 16)) };
  const chartWidth = Math.max(width, pad.left + 80);
  const plotWidth = chartWidth - pad.left - PAD.right;
  const firstTime = points.length ? dayMs(points[0]!.date) : 0;
  const lastTime = points.length ? dayMs(points.at(-1)!.date) : 0;
  const timeSpan = lastTime - firstTime;
  // Real calendar spacing keeps long gaps visible instead of equalizing every record.
  const xFor = (i: number) => {
    if (points.length <= 1 || !(timeSpan > 0)) return pad.left + plotWidth / 2;
    const ratio = (dayMs(points[i]!.date) - firstTime) / timeSpan;
    return pad.left + Math.min(Math.max(ratio, 0), 1) * plotWidth;
  };
  const yFor = (value: number) => PAD.top + (1 - (value - yMin) / (yMax - yMin)) * (HEIGHT - PAD.top - PAD.bottom);

  const linePath = points.map((point, i) => `${isBreak(point) || i === 0 ? "M" : "L"}${xFor(i).toFixed(2)},${yFor(point.value).toFixed(2)}`).join("");
  const segments: number[][] = [];
  points.forEach((point, i) => {
    if (i === 0 || isBreak(point)) segments.push([]);
    segments.at(-1)!.push(i);
  });
  // A one- or two-point segment is a sparse tail, not a filled area: filling it
  // would draw a tall band over a real gap. Only three or more consecutive
  // points get an area; shorter segments keep their real line and points.
  const areaPath = segments.filter(indices => indices.length >= 3).map(indices =>
    `M${xFor(indices[0]).toFixed(2)},${yFor(yMin).toFixed(2)}${indices.map(i => `L${xFor(i).toFixed(2)},${yFor(points[i].value).toFixed(2)}`).join("")}L${xFor(indices.at(-1)!).toFixed(2)},${yFor(yMin).toFixed(2)}Z`,
  ).join("");

  const onMove = (clientX: number) => {
    const frame = frameRef.current;
    if (!frame || points.length === 0) return;
    const rect = frame.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * chartWidth;
    const clamped = Math.min(Math.max(x, pad.left), pad.left + plotWidth);
    const time = timeSpan > 0 ? firstTime + ((clamped - pad.left) / plotWidth) * timeSpan : firstTime;
    let best = 0;
    let bestDelta = Infinity;
    points.forEach((point, i) => {
      const delta = Math.abs(dayMs(point.date) - time);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = i;
      }
    });
    setCursor(best);
  };

  // Same keyboard reading as LineChart: arrows walk the real observations.
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      setCursor(current => Math.max(0, Math.min(points.length - 1, (current ?? 0) + delta)));
    }
  };

  const xTicks = (() => {
    const count = points.length;
    if (count === 0) return [];
    const wanted = chartWidth < 480 ? 2 : chartWidth < 760 ? 3 : 5;
    return [...new Set(Array.from({ length: wanted }, (_, i) =>
      Math.round((i / Math.max(1, wanted - 1)) * (count - 1))))]
      .map(i => ({
        i,
        date: points[i]!.date,
        anchor: i === 0 ? "start" : i === count - 1 ? "end" : "middle",
      }));
  })();

  const current = cursor !== null ? points[cursor] : null;

  return (
    <div className="chart-frame" ref={frameRef}>
      <svg
        className="chart"
        viewBox={`0 0 ${chartWidth} ${HEIGHT}`}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseMove={event => onMove(event.clientX)}
        onMouseLeave={() => setCursor(null)}
        // Touch has no hover: a tap or drag reads the nearest real observation.
        onPointerDown={event => { if (event.pointerType !== "mouse") onMove(event.clientX); }}
        onPointerMove={event => { if (event.pointerType !== "mouse") onMove(event.clientX); }}
        onFocus={() => setCursor(value => value ?? 0)}
        onBlur={() => setCursor(null)}
      >
        {ticks.map((tick, i) => {
          return (
            <g key={i}>
              <line x1={pad.left} x2={chartWidth - PAD.right} y1={yFor(tick)} y2={yFor(tick)} stroke="var(--line)" strokeWidth="1" />
              <text x={pad.left - 6} y={yFor(tick) + 4} textAnchor="end" fontSize="13" fill="var(--muted)">
                {formatValue(tick)}
              </text>
            </g>
          );
        })}
        {xTicks.map(tick => (
          <text
            key={tick.i}
            x={xFor(tick.i)}
            y={HEIGHT - 6}
            textAnchor={tick.anchor}
            fontSize="11"
            fill="var(--muted)"
          >
            {tick.date.slice(5)}
          </text>
        ))}
        {points.length > 0 && (
          <>
            <path d={areaPath} fill="var(--accent)" opacity="0.12" />
            <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {segments.filter(indices => indices.length < 3).flatMap(indices =>
              indices.map(i => (
                <circle
                  key={points[i].date}
                  cx={xFor(i)}
                  cy={yFor(points[i].value)}
                  r={indices.length === 1 ? 4.5 : 3}
                  fill="var(--accent)"
                  stroke="var(--surface)"
                  strokeWidth={indices.length === 1 ? 1.5 : 0}
                />
              )),
            )}
            {points.map((point, i) =>
              point.externalFlow ? (
                <g key={point.date}>
                  <circle cx={xFor(i)} cy={yFor(point.value)} r="4" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2">
                    <title>{`${point.date} · ${t("perf.assets_flow_mark")}`}</title>
                  </circle>
                </g>
              ) : null,
            )}
          </>
        )}
        {cursor !== null && current && (
          <line x1={xFor(cursor)} x2={xFor(cursor)} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="var(--muted)" strokeWidth="1" />
        )}
      </svg>
      {cursor !== null && current && (
        <div className="chart-tooltip" style={{ left: `${Math.min(Math.max((xFor(cursor) / chartWidth) * 100, 8), 80)}%`, top: 8 }}>
          <div className="tooltip-date">{current.date}</div>
          <div className="tooltip-row"><strong>{formatValue(current.value)}</strong></div>
          {current.externalFlow ? <div className="tooltip-row">{t("perf.assets_flow_mark")}: {formatValue(current.externalFlow)}</div> : null}
        </div>
      )}
    </div>
  );
}
