import { useEffect, useRef, useState } from "react";
import { useT } from "./locales";
import { isAggregateAssetAccount, RETURN_INDEX_LEGEND, shanghaiCalendarDate } from "./presentation";
import type { MarketBenchmarkPoint } from "./presentation";
import type { OverviewAccount } from "./OverviewPage";
import { loadPerformanceData } from "./performanceData";
import type { PerformanceData } from "./performanceData";
import { aggregateEquity, alignReturns, chainReturns, dateMs, hasGap, PERFORMANCE_RANGES, rangeStart, sliceRange } from "./performanceMath";
import type { PerformanceRange, ValuePoint } from "./performanceMath";

const COLORS = ["#2563eb", "#15803d", "#b45309", "#758399", "#9333ea"];
type PlotSeries = { id: string; label: string; points: ValuePoint[]; color: string };
const EMPTY: PerformanceData = { accounts: [], failed: [], omittedCurrencies: [], truncated: false, referenceFx: false, incompleteDates: 0 };

/** The console's existing React/SVG renderer, extended with shared scales. */
export function PerformancePlot({ series, percent, label }: { series: PlotSeries[]; percent: boolean; label: string }) {
  const t = useT();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [cursor, setCursor] = useState<string | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(280, entries[0].contentRect.width)));
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const dates = [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort();
  const points = series.flatMap(s => s.points);
  const selected = cursor && dates.includes(cursor) ? cursor : dates.at(-1);
  const height = 244, left = percent ? 58 : 86, right = width - 12, top = 14, bottom = height - 30;
  const start = dateMs(dates[0] || ""), end = dateMs(dates.at(-1) || "");
  const values = points.map(p => p.value);
  const min = Math.min(...values, ...(percent ? [0] : [])), max = Math.max(...values, ...(percent ? [0] : []));
  const padding = (max - min) * 0.1 || Math.max(Math.abs(max) * .02, percent ? 1 : .01);
  const low = min - padding, high = max + padding;
  const x = (date: string) => end === start ? (left + right) / 2 : left + (dateMs(date) - start) / (end - start) * (right - left);
  const y = (value: number) => bottom - (value - low) / (high - low) * (bottom - top);
  const format = (value: number) => percent ? `${(Math.abs(value) < .005 ? 0 : value).toFixed(2)}%`
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value);
  const formatAxis = (value: number) => percent ? format(value)
    : new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
  const pick = (clientX: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect();
    const at = (clientX - rect.left) * width / rect.width;
    const nearest = dates.reduce((best, d) => Math.abs(x(d) - at) < Math.abs(x(best) - at) ? d : best, dates[0]);
    setCursor(nearest);
  };
  return <div className="performance-plot" ref={container} data-testid={percent ? "returns-plot" : "assets-plot"}>
    {dates.length ? <>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} tabIndex={0}
        aria-describedby={percent ? "returns-interaction" : "assets-interaction"}
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pick(e.clientX, e.currentTarget); }}
        onPointerMove={e => pick(e.clientX, e.currentTarget)}
        onKeyDown={e => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
          e.preventDefault();
          const i = dates.indexOf(selected!);
          setCursor(dates[e.key === "Home" ? 0 : e.key === "End" ? dates.length - 1 : Math.max(0, Math.min(dates.length - 1, i + (e.key === "ArrowLeft" ? -1 : 1)))]);
        }}>
        {[0, 1, 2, 3, 4].map(i => {
          const value = low + (high - low) * i / 4;
          return <g key={i} className="performance-axis"><line x1={left} x2={right} y1={y(value)} y2={y(value)} /><text x={left - 8} y={y(value) + 4} textAnchor="end">{formatAxis(value)}</text></g>;
        })}
        {percent ? <line className="performance-zero" x1={left} x2={right} y1={y(0)} y2={y(0)} /> : null}
        {series.map((s, index) => {
          let path = "";
          s.points.forEach((p, i) => { path += `${i === 0 || hasGap(s.points[i - 1], p) ? "M" : "L"}${x(p.date)},${y(p.value)} `; });
          return <g key={s.id} data-series={s.id}>
            <path className="performance-line" d={path} stroke={s.color} strokeWidth={index === 0 ? 2.7 : 1.6} fill="none" />
            {s.points.map(p => <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r={p.date === selected ? 4 : 2.2} fill={s.color} />)}
          </g>;
        })}
        {selected ? <line className="performance-crosshair" x1={x(selected)} x2={x(selected)} y1={top} y2={bottom} /> : null}
        <g className="performance-axis"><text x={left} y={height - 7}>{dates[0]}</text>{dates.length > 1 ? <text x={right} y={height - 7} textAnchor="end">{dates.at(-1)}</text> : null}</g>
      </svg>
      <div className="performance-readout" role="status" aria-live="polite" aria-atomic="true">
        <time>{selected}</time>
        {series.map(s => { const point = s.points.find(p => p.date === selected); return <span key={s.id}>
          <i style={{ background: s.color }} />{s.label}<strong>{point ? `${percent ? "" : "USD "}${format(point.value)}` : t("当日无记录")}</strong>
        </span>; })}
      </div>
    </> : <div className="performance-empty">{t("所选范围暂无数据；未补零或推算历史。")}</div>}
    <small id={percent ? "returns-interaction" : "assets-interaction"} className="performance-hint">{t("移动光标或轻触查看；键盘左右键切换日期。")}</small>
  </div>;
}

export function PerformanceCharts({ accounts, accountId, onSelectAccount, benchmarks, rates, refreshVersion, now,
  initialData }: {
  accounts: OverviewAccount[]; accountId: string; onSelectAccount: (id: string) => void;
  benchmarks: readonly MarketBenchmarkPoint[]; rates: Readonly<Record<string, string>>; refreshVersion: number; now: number;
  initialData?: PerformanceData;
}) {
  const t = useT();
  const [rangeChoice, setRangeChoice] = useState<PerformanceRange | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<{ key: string; data: PerformanceData } | null>(initialData ? { key: "fixture", data: initialData } : null);
  const epoch = useRef(0);
  const members = accountId === "all" ? accounts.filter(a => isAggregateAssetAccount(a)
    && a.facts?.aggregation_status !== "duplicate" && a.facts?.aggregation_status !== "conflict") : accounts.filter(a => a.id === accountId);
  const requestKey = JSON.stringify([members.map(a => [a.id, a.platformKey, a.accountKey, a.facts?.observed_finished_at, a.facts?.balances.map(b => b.currency)]), rates, refreshVersion]);
  useEffect(() => {
    const current = ++epoch.current;
    void loadPerformanceData(members, rates).then(data => {
      if (epoch.current === current) setLoaded({ key: requestKey, data });
    });
    return () => { if (epoch.current === current) epoch.current++; };
    // requestKey includes scope, source timestamps, currencies, FX and explicit refresh.
  }, [requestKey]);
  const data = initialData || (loaded?.key === requestKey ? loaded.data : null);
  const today = shanghaiCalendarDate(new Date(now).toISOString())!;
  const full = aggregateEquity((data || EMPTY).accounts);
  const range = rangeChoice || (full.points[0]?.date >= rangeStart("1y", today) ? "all" : "1y");
  const sliced = sliceRange(full.points, range, today);
  const twr = chainReturns(sliced);
  const comparison = RETURN_INDEX_LEGEND.map(id => ({ id, points: sliceRange(benchmarks.filter(p => p.seriesId === id).map(p => ({ date: p.observationDate, value: Number(p.close) })).filter(p => p.value > 0), range, today) }));
  const aligned = alignReturns(twr.index, comparison);
  const label = accountId === "all" ? t("全部账户") : accounts.find(a => a.id === accountId)?.title || t("账户");
  const returnSeries: PlotSeries[] = [{ id: "primary", label, points: aligned.primary, color: COLORS[0] },
    ...aligned.benchmarks.filter(s => !hidden.includes(s.id)).map(s => ({ ...s, label: t(s.id), color: COLORS[RETURN_INDEX_LEGEND.indexOf(s.id as typeof RETURN_INDEX_LEGEND[number]) + 1] }))];
  const missing = full.missingAccounts.length;
  const lastDate = full.points.at(-1)?.date;
  const stale = lastDate && dateMs(today) - dateMs(lastDate) > 3 * 86_400_000;
  const short = range !== "all" && full.points[0]?.date > rangeStart(range, today);
  return <section className="chart-panel overview-chart performance-panel" aria-label={t("图表")}>
    <div className="performance-toolbar">
      <label><span>{t("账户")}</span><select aria-label={t("图表账户")} value={accountId} onChange={e => onSelectAccount(e.target.value)}>
        <option value="all">{t("全部账户")}</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.title} · {a.environment}</option>)}
      </select></label>
      <div className="performance-ranges" role="group" aria-label={t("图表范围")}>
        {PERFORMANCE_RANGES.map(r => <button type="button" key={r} aria-pressed={range === r} onClick={() => setRangeChoice(r)}>{r.toUpperCase()}</button>)}
      </div>
    </div>
    <div className="performance-notices" role="status">
      {!data ? <p>{t("加载中…")}</p> : null}
      {data && !full.points.length ? <p>{t("没有共同估值日期，无法绘制当前范围；缺账户不按零计。")}</p> : null}
      {twr.unknownFlow ? <p className="performance-warning">{t("部分数据：现金流未知（{accounts}）；收益可能包含出入金，尚非已校正的 TWR。", { accounts: members.filter(a => data?.accounts.find(row => row.id === a.id)?.points.length).map(a => a.title).join("、") })}</p> : null}
      {data && (missing > 0 || data.failed.length > 0) ? <p className="performance-warning">{t("部分覆盖：{count} 个账户未取得完整估值或汇率；仅显示其余账户。", { count: Math.max(missing, data.failed.length) })}</p> : null}
      {data?.omittedCurrencies.length ? <p>{t("缺汇率未计入：{codes}", { codes: data.omittedCurrencies.join(", ") })}</p> : null}
      {accountId === "all" ? <p>{t("汇总排除模拟账户及已知重复或冲突绑定；账户身份未全部核实。")}</p> : null}
      {data?.referenceFx ? <p>{t("美元估值使用总览现有的最新参考汇率（非历史汇率）；汇率影响未计入历史收益，结果仅供参考。")}</p> : null}
      {stale ? <p className="performance-warning">{t("数据已过期；最后数据日期：{date}。", { date: lastDate })}</p> : lastDate ? <p>{t("最后数据日期：{date}", { date: lastDate })}</p> : null}
      {data?.truncated || short ? <p>{t("历史覆盖自 {date} 起，未覆盖所选完整期间。", { date: full.points[0]?.date || "—" })}</p> : null}
      {full.omittedDates + (data?.incompleteDates || 0) > 0 ? <p>{t("省略 {count} 个估值不完整日期；缺日断线，不插值。", { count: full.omittedDates + (data?.incompleteDates || 0) })}</p> : <p>{t("缺日断线，不插值；提示框中缺失值显示为无记录。")}</p>}
      {twr.invalidPeriod ? <p className="performance-warning">{t("非正期初估值或无效收益期间；后续收益未计算。")}</p> : null}
    </div>
    <div className="performance-section">
      <div className="performance-heading"><h2>{t("累计收益")}</h2><span>{t(sliced.length < 2 ? "观察点不足，尚无期间收益" : twr.unknownFlow ? "部分 · 未校正出入金" : "时间加权收益 TWR")}</span></div>
      <div className="performance-legend" aria-label={t("收益图例")}>
        <span><i style={{ background: COLORS[0] }} />{label}</span>
        {RETURN_INDEX_LEGEND.map((id, i) => <button type="button" key={id} aria-pressed={!hidden.includes(id)}
          onClick={() => setHidden(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id])}>
          <i style={{ background: COLORS[i + 1] }} />{t(id)}
        </button>)}
      </div>
      {aligned.start ? <p className="performance-baseline">{t("共同起点：{date}，归零为 0.00%；隐藏基准不改变起点。", { date: aligned.start })}</p> : null}
      <PerformancePlot series={returnSeries} percent label={t("累计收益")} />
      <div className="performance-benchmark-status">{RETURN_INDEX_LEGEND.map(id => {
        const rows = aligned.benchmarks.find(s => s.id === id)?.points || [];
        const last = rows.at(-1)?.date;
        return <span key={id}>{t(id)}: {last ? t(dateMs(today) - dateMs(last) > 3 * 86_400_000 ? "数据已过期；最后数据日期：{date}。" : "最后数据日期：{date}", { date: last }) : t("比较数据不足或没有共同日期")}</span>;
      })}</div>
    </div>
    <div className="performance-section">
      <div className="performance-heading"><h2>{t("总资产")}</h2><span>USD</span></div>
      <PerformancePlot series={[{ id: "primary", label, points: sliced, color: COLORS[0] }]} percent={false} label={t("总资产")} />
    </div>
    <details className="performance-method"><summary>{t("如何计算？")}</summary>
      <p>{t("有完整现金流时按期末出入金约定逐期连接 TWR；现金流未知时显示未校正估计并标注部分数据。所有曲线从范围内首个共同日期归零，缺日不补值。")}</p>
      <a href="https://github.com/QuantStrategyLab/QuantRuntimeSettings/blob/main/docs/console-performance-charts.md" target="_blank" rel="noreferrer">{t("查看计算方法与数据限制")}</a>
    </details>
  </section>;
}
