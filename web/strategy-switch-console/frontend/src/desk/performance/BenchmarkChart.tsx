import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { Language } from "../../lib/prefs";
import { dayMs, nudgeLabels, segments, valueAt, yAxis } from "./benchmarks.ts";
import type { Point } from "./benchmarks.ts";
import { S } from "./perfStyles.ts";
import { formatDate, formatDay, formatMonth, formatPct } from "./perfFormat.ts";

export interface ChartLine {
  id: string;
  label: string;
  /** CSS custom property name, e.g. "--mrd-b1". */
  token: string;
  dash: string;
  primary: boolean;
  points: readonly Point[];
  gapDates: readonly string[];
}

export interface BenchmarkChartProps {
  lines: readonly ChartLine[];
  window: { start: string; end: string };
  language: Language;
  ariaLabel: string;
  hint: string;
}

// SVG paint lives here (not in desk.css) to keep the console's CSS size budget; values are tokens only.
const GRID = { stroke: "var(--mrd-line)", strokeWidth: 1 } as const;
const ZERO = { stroke: "var(--mrd-ink-3)", strokeWidth: 1.2, opacity: 0.6 } as const;
const AXIS = { fill: "var(--mrd-ink-3)", font: "11px var(--font-mono)" } as const;
const END = { font: "600 11.5px var(--font-sans)" } as const;
const AREA = { fill: "var(--mrd-p)", opacity: 0.1 } as const;
const CROSS = { stroke: "var(--mrd-ink-3)", strokeWidth: 1, strokeDasharray: "3 3" } as const;

const HEIGHT_WIDE = 340;
const HEIGHT_NARROW = 250;
const NARROW = 560;

/** Tween a number toward its target in <= 200 ms, or jump when reduced motion is requested. */
function useTween(target: number): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof requestAnimationFrame === "undefined") { current.current = target; setValue(target); return; }
    const from = current.current;
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / 180);
      current.current = from + (target - from) * (1 - (1 - t) ** 3);
      setValue(current.current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

function xTicks(window: { start: string; end: string }, language: Language, narrow: boolean): Array<{ date: string; text: string }> {
  const start = dayMs(window.start);
  const end = dayMs(window.end);
  const days = (end - start) / 86400000;
  if (days < 62) {
    return Array.from({ length: narrow ? 3 : 5 }, (_, i) => {
      const date = new Date(start + ((end - start) * i) / (narrow ? 2 : 4)).toISOString().slice(0, 10);
      return { date, text: formatDay(date, language) };
    });
  }
  const first = new Date(start);
  const months = Math.round(days / 30.44);
  const stride = Math.max(1, Math.ceil(months / (narrow ? 3 : 6)));
  const ticks: Array<{ date: string; text: string }> = [];
  let cursor = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1);
  while (cursor <= end) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    ticks.push({ date, text: formatMonth(date, language) });
    const d = new Date(cursor);
    cursor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + stride, 1);
  }
  return ticks;
}

export function BenchmarkChart({ lines, window: range, language, ariaLabel, hint }: BenchmarkChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    setWidth(Math.max(260, Math.round(node.getBoundingClientRect().width) || 880));
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(260, Math.round(entries[0].contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const narrow = width < NARROW;
  const height = narrow ? HEIGHT_NARROW : HEIGHT_WIDE;
  const gutter = narrow ? 58 : 150;
  const pad = { top: 14, right: gutter, bottom: 26, left: 44 };
  const axis = useMemo(() => yAxis(lines.map(line => line.points)), [lines]);
  const min = useTween(axis.min);
  const max = useTween(axis.max);

  const t0 = dayMs(range.start);
  const t1 = dayMs(range.end);
  const plotW = Math.max(40, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const x = (date: string) => pad.left + (t1 === t0 ? 0 : ((dayMs(date) - t0) / (t1 - t0)) * plotW);
  const y = (value: number) => pad.top + (1 - (value - min) / (max - min || 1)) * plotH;

  const allDates = useMemo(() => [...new Set(lines.flatMap(line => line.points.map(point => point.date)))].sort(), [lines]);
  const activeDate = active && allDates.includes(active) ? active : null;

  const pick = (clientX: number) => {
    const rect = host.current?.getBoundingClientRect();
    if (!rect || !allDates.length) return;
    const target = t0 + ((clientX - rect.left - pad.left) / plotW) * (t1 - t0);
    let best = allDates[0];
    for (const date of allDates) if (Math.abs(dayMs(date) - target) < Math.abs(dayMs(best) - target)) best = date;
    setActive(best);
  };
  const onKey = (event: KeyboardEvent) => {
    if (!allDates.length) return;
    const index = activeDate ? allDates.indexOf(activeDate) : -1;
    if (event.key === "ArrowRight") setActive(allDates[Math.min(allDates.length - 1, index + 1)]);
    else if (event.key === "ArrowLeft") setActive(allDates[Math.max(0, index < 0 ? allDates.length - 1 : index - 1)]);
    else if (event.key === "Escape") setActive(null);
    else return;
    event.preventDefault();
  };

  const labelTops = nudgeLabels(
    lines.map(line => (line.points.length ? y(line.points[line.points.length - 1].value) : 0)),
    narrow ? 14 : 16, pad.top + 6, height - pad.bottom,
  );
  const readout = activeDate
    ? lines.map(line => ({ line, value: valueAt(line.points, activeDate) }))
    : [];
  const flip = activeDate ? x(activeDate) > pad.left + plotW * 0.55 : false;

  return (
    <div style={S.svgBox} ref={host} data-narrow={narrow ? "true" : "false"}>
      {narrow ? <div style={S.readout} aria-live="off">
        {activeDate ? (
          <>
            <b>{formatDate(activeDate, language)}</b>
            {readout.map(({ line, value }) => (
              <span key={line.id} style={S.readoutItem} data-series={line.id}>
                <i style={S.dot(line.token)} aria-hidden="true" />
                {line.label} <em style={S.value}>{formatPct(value)}</em>
              </span>
            ))}
          </>
        ) : <span style={S.hint}>{hint}</span>}
      </div> : null}
      <svg
        style={S.svg}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onPointerMove={(event: PointerEvent) => pick(event.clientX)}
        onPointerDown={(event: PointerEvent) => pick(event.clientX)}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        {axis.ticks.map(tick => (
          <g key={tick}>
            <line style={tick === 0 ? ZERO : GRID} x1={pad.left} x2={pad.left + plotW} y1={y(tick)} y2={y(tick)} />
            <text style={AXIS} x={pad.left - 8} y={y(tick) + 4} textAnchor="end">{formatPct(tick, axis.digits, false)}</text>
          </g>
        ))}
        {xTicks(range, language, narrow).map(tick => (
          <text key={tick.date} style={AXIS} x={x(tick.date)} y={height - 6} textAnchor="middle">{tick.text}</text>
        ))}
        {lines.map(line => {
          const parts = segments(line.points, line.gapDates);
          return (
            <g key={line.id} data-series={line.id} style={{ color: `var(${line.token})` }}>
              {parts.map(([from, to]) => {
                const slice = line.points.slice(from, to + 1);
                if (slice.length < 2) {
                  return <circle key={from} cx={x(slice[0].date)} cy={y(slice[0].value)} r={2} fill="currentColor" />;
                }
                const d = slice.map((point, i) => `${i ? "L" : "M"}${x(point.date).toFixed(1)} ${y(point.value).toFixed(1)}`).join("");
                return (
                  <g key={from}>
                    {line.primary ? <path style={AREA} d={`${d}L${x(slice[slice.length - 1].date).toFixed(1)} ${y(0).toFixed(1)}L${x(slice[0].date).toFixed(1)} ${y(0).toFixed(1)}Z`} /> : null}
                    <path
                      className="mrd-bchart-line"
                      d={d}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={line.primary ? 2.6 : 1.8}
                      strokeDasharray={line.dash || undefined}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </g>
                );
              })}
            </g>
          );
        })}
        {lines.map((line, index) => {
          const last = line.points[line.points.length - 1];
          if (!last) return null;
          const text = narrow ? formatPct(last.value) : `${line.label} ${formatPct(last.value)}`;
          return (
            <text key={line.id} className="mrd-bchart-end" data-series={line.id} x={pad.left + plotW + 8} y={labelTops[index] + 4} style={{ ...END, fill: `var(${line.token})` }}>
              {text}
            </text>
          );
        })}
        {activeDate ? (
          <g>
            <line style={CROSS} x1={x(activeDate)} x2={x(activeDate)} y1={pad.top} y2={pad.top + plotH} />
            {readout.map(({ line, value }) => value === null ? null : (
              <circle key={line.id} data-series={line.id} cx={x(activeDate)} cy={y(value)} r={4} style={{ fill: `var(${line.token})`, stroke: "var(--mrd-panel-2)", strokeWidth: 2 }} />
            ))}
          </g>
        ) : null}
      </svg>
      {activeDate && !narrow ? (
        <div style={{ ...S.tip, ...(flip ? { right: width - x(activeDate) + 12 } : { left: x(activeDate) + 12 }) }} aria-hidden="true">
          <b>{formatDate(activeDate, language)}</b>
          {readout.map(({ line, value }) => (
            <span key={line.id} style={{ ...S.readoutItem, display: "flex" }} data-series={line.id}><i style={S.dot(line.token)} />{line.label}<em style={S.value}>{formatPct(value)}</em></span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
