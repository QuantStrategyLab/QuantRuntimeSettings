import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage, useT } from "../i18n";
import type { Point } from "../api/contracts";
import { formatMoney } from "../lib/format";
import { usePrefs } from "../app/context";

const WIDTH = 800;
const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 24, left: 64 };

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

  const formatValue = (value: number) => (prefs.hideAmounts ? "•••" : formatMoney(value, currency, language));
  const ticks = [0, 1, 2, 3, 4].map(i => yMin + ((yMax - yMin) * i) / 4);
  const pad = { ...PAD, left: Math.max(PAD.left, ...ticks.map(value => formatValue(value).length * 8 + 16)) };
  const chartWidth = Math.max(width, pad.left + 80);
  const xFor = (i: number) => pad.left + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (chartWidth - pad.left - PAD.right));
  const yFor = (value: number) => PAD.top + (1 - (value - yMin) / (yMax - yMin)) * (HEIGHT - PAD.top - PAD.bottom);

  const linePath = points.map((point, i) => `${point.breakBefore || i === 0 ? "M" : "L"}${xFor(i).toFixed(2)},${yFor(point.value).toFixed(2)}`).join("");
  const areaPath = points.length
    ? `M${xFor(0).toFixed(2)},${yFor(yMin).toFixed(2)}${points.map((point, i) => `L${xFor(i).toFixed(2)},${yFor(point.value).toFixed(2)}`).join("")}L${xFor(points.length - 1).toFixed(2)},${yFor(yMin).toFixed(2)}Z`
    : "";

  const onMove = (clientX: number) => {
    const frame = frameRef.current;
    if (!frame || points.length === 0) return;
    const rect = frame.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * chartWidth;
    const i = Math.round(((x - pad.left) / (chartWidth - pad.left - PAD.right)) * (points.length - 1));
    setCursor(Math.max(0, Math.min(points.length - 1, i)));
  };

  const current = cursor !== null ? points[cursor] : null;

  return (
    <div className="chart-frame" ref={frameRef}>
      <svg
        className="chart"
        viewBox={`0 0 ${chartWidth} ${HEIGHT}`}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onMouseMove={event => onMove(event.clientX)}
        onMouseLeave={() => setCursor(null)}
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
        {points.length > 0 && (
          <>
            <path d={areaPath} fill="var(--accent)" opacity="0.12" />
            <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
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
