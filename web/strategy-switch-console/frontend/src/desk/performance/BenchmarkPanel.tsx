import { useEffect, useMemo, useState } from "react";
import type { Language } from "../../lib/prefs";
import type { DeskTranslate } from "../i18n/index.ts";
import { BenchmarkChart } from "./BenchmarkChart";
import type { ChartLine } from "./BenchmarkChart";
import {
  BENCH_KEYS, BENCH_META, EXTRA_KEYS, MAIN_KEYS, cagrGapPts, computeStats, excessPts, loadSelection, saveSelection,
} from "./benchmarks.ts";
import type { BenchKey, BenchSeries, BenchmarkModel, PortfolioCurve, Stats } from "./benchmarks.ts";
import { formatDate, formatPct, formatPts } from "./perfFormat.ts";
import { S, signColor } from "./perfStyles.ts";

/** Same 760 px breakpoint as the rest of the desk (desk.css). */
export function useNarrow(): boolean {
  const query = "(max-width: 760px)";
  const [narrow, setNarrow] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
}

export type BenchmarkState =
  | { phase: "loading" }
  | { phase: "failed" }
  | { phase: "ready"; model: BenchmarkModel };

export interface BenchmarkPanelProps {
  t: DeskTranslate;
  language: Language;
  portfolio: PortfolioCurve;
  /** Portfolio stats; the page may pass backend-known values where it has them. */
  portfolioStats: Stats;
  window: { start: string; end: string };
  benchmarks: BenchmarkState;
  /** Test seam: initial selection override; defaults to localStorage. */
  initialSelection?: readonly BenchKey[];
}

/** Why a benchmark has no numbers: the state text shown under its name. */
export function seriesStateKey(series: BenchSeries, windowStart: string): "full" | "from" | "unavailable" {
  if (series.coverage === "full") return "full";
  if (series.coverage === "partial" && series.baseDate && series.baseDate > windowStart) return "from";
  return "unavailable";
}

function Swatch({ token, dash, primary }: { token: string; dash: string; primary?: boolean }) {
  return (
    <svg style={{ flex: "none" }} width="26" height="8" viewBox="0 0 26 8" aria-hidden="true" focusable="false">
      <line x1="1" x2="25" y1="4" y2="4" stroke={`var(${token})`} strokeWidth={primary ? 2.6 : 1.8} strokeDasharray={dash || undefined} strokeLinecap="round" />
    </svg>
  );
}

export function BenchmarkPanel({ t, language, portfolio, portfolioStats, window: range, benchmarks, initialSelection }: BenchmarkPanelProps) {
  const [selected, setSelected] = useState<BenchKey[]>(() => (initialSelection ? [...initialSelection] : loadSelection()));
  const [moreOpen, setMoreOpen] = useState(() => selected.some(key => BENCH_META[key].extra));
  const narrow = useNarrow();
  const model = benchmarks.phase === "ready" ? benchmarks.model : null;

  const toggle = (key: BenchKey) => {
    const next = selected.includes(key) ? selected.filter(item => item !== key) : [...selected, key];
    setSelected(next);
    saveSelection(next);
  };
  const label = (key: BenchKey) => t(`perf.bench.${key}` as never);

  const stats = useMemo(() => {
    const out = {} as Record<BenchKey, { stats: Stats | null; state: "full" | "from" | "unavailable"; series: BenchSeries | null }>;
    for (const key of BENCH_KEYS) {
      const series = model ? model.series[key] : null;
      const state = series ? seriesStateKey(series, range.start) : "unavailable";
      out[key] = { series, state, stats: series && series.coverage === "full" ? computeStats(series.points) : null };
    }
    return out;
  }, [model, range.start]);

  const lines: ChartLine[] = [
    { id: "pf", label: t("perf.portfolio"), token: "--mrd-p", dash: "", primary: true, points: portfolio.points, gapDates: portfolio.gapDates },
    ...BENCH_KEYS.filter(key => selected.includes(key) && stats[key].stats !== null).map(key => ({
      id: key, label: label(key), token: BENCH_META[key].token, dash: BENCH_META[key].dash, primary: false,
      points: stats[key].series?.points ?? [], gapDates: [] as string[],
    })),
  ];

  const spx = stats.spx.stats;
  const gap = cagrGapPts(portfolioStats, spx);
  const lastDates = BENCH_KEYS.flatMap(key => (stats[key].stats && stats[key].series?.lastDate) || []);
  const asOf = lastDates.length ? [...lastDates].sort().at(-1)! : null;
  const basisText = model ? (model.returnBasis === "etf_close_price_return" ? t("perf.basis.etf_close_price_return") : model.returnBasis) : "";
  const shownKeys = moreOpen ? BENCH_KEYS : MAIN_KEYS;

  const chip = (key: BenchKey) => {
    const on = selected.includes(key);
    return (
      <button key={key} type="button" className="mrd-chip" style={S.chip(on)} aria-pressed={on} data-series={key} data-state={stats[key].state} onClick={() => toggle(key)}>
        <span style={S.check(on)} aria-hidden="true">{on ? "✓" : ""}</span>
        <Swatch token={BENCH_META[key].token} dash={BENCH_META[key].dash} />
        <span>{label(key)}</span>
        {!BENCH_META[key].extra ? <small style={S.ticker}>{BENCH_META[key].symbol}</small> : null}
      </button>
    );
  };

  const cell = (value: string) => <td style={S.td(narrow)}>{value}</td>;
  const stateText = (state: "full" | "from" | "unavailable", series: BenchSeries | null) =>
    state === "from" && series?.baseDate ? t("perf.from", { date: formatDate(series.baseDate, language) })
      : state === "unavailable" ? t("perf.unavailable") : null;

  return (
    <section className="mrd-card" style={S.bench} aria-labelledby="mrd-bench-title" data-benchmark-phase={benchmarks.phase}>
      <div>
        <span className="mrd-label" id="mrd-bench-title">{t("perf.chart.title")}</span>
        <div style={S.kpi}>
          <span className="mrd-label">{t("perf.kpi.cagr")}</span>
          <b className="mrd-serif" style={S.kpiValue(narrow)}>{formatPct(portfolioStats.cagr, 1, false)}</b>
          <small style={S.kpiSub} data-testid="cagr-gap">{gap === null ? t("perf.kpi.vs_unavailable") : t("perf.kpi.vs_spx", { d: formatPts(gap) })}</small>
        </div>
      </div>

      {benchmarks.phase === "failed" ? <p style={S.note} role="status">{t("perf.fetch_failed")}</p> : null}

      <div style={S.chips} role="group" aria-label={t("perf.bench.group")}>
        <span className="mrd-chip" style={S.chip(null)}><Swatch token="--mrd-p" dash="" primary /><span>{t("perf.portfolio")}</span></span>
        {MAIN_KEYS.map(chip)}
        <button type="button" className="mrd-chip" style={S.chip(true)} aria-expanded={moreOpen} aria-controls="mrd-bench-extras" onClick={() => setMoreOpen(open => !open)}>
          {t("perf.more")} <span aria-hidden="true">{moreOpen ? "−" : "+"}</span>
        </button>
      </div>
      <div id="mrd-bench-extras" style={S.extras(moreOpen)} hidden={!moreOpen}>
        <div style={S.chips} role="group" aria-label={t("perf.more")}>{EXTRA_KEYS.map(chip)}</div>
        <p style={S.note}>{t("perf.more.note")}</p>
      </div>

      <BenchmarkChart lines={lines} window={range} language={language} ariaLabel={t("perf.chart.aria")} hint={t("perf.readout.none")} />
      <p style={S.note}>
        {asOf ? t("perf.foot", { basis: basisText, date: formatDate(asOf, language) }) : t("perf.foot.none")}
      </p>

      <div style={S.tableWrap}>
        <span className="mrd-label">{t("perf.table.title")}</span>
        <table style={S.table}>
          <thead>
            <tr>
              <th scope="col" style={S.th(true, narrow)}>{t("perf.col.name")}</th>
              <th scope="col" style={S.th(false, narrow)}>{t("perf.col.return")}</th>
              <th scope="col" style={S.th(false, narrow)}>{t("perf.col.cagr")}</th>
              <th scope="col" style={S.th(false, narrow)}>{t("perf.col.mdd")}</th>
              <th scope="col" style={S.th(false, narrow)}>{t("perf.col.excess")}</th>
            </tr>
          </thead>
          <tbody>
            <tr style={S.rowTr(false, true)} data-series="pf">
              <th scope="row" style={S.rowHead(narrow)}><div style={S.name}><Swatch token="--mrd-p" dash="" primary />{t("perf.portfolio")}</div></th>
              {cell(formatPct(portfolioStats.ret))}{cell(formatPct(portfolioStats.cagr))}{cell(formatPct(portfolioStats.maxDrawdown))}{cell("—")}
            </tr>
            {shownKeys.map(key => {
              const row = stats[key];
              const hidden = !selected.includes(key);
              const note = stateText(row.state, row.series);
              const excess = row.stats ? excessPts(portfolioStats.ret, row.stats.ret) : null;
              return (
                <tr key={key} style={S.rowTr(hidden, false)} data-series={key} data-hidden={hidden ? "true" : "false"} data-state={row.state}>
                  <th scope="row" style={S.rowHead(narrow)}><div style={S.name}>
                    <Swatch token={BENCH_META[key].token} dash={BENCH_META[key].dash} />
                    <span>{label(key)}</span>
                    {hidden && !narrow ? <em style={S.tag}>{t("perf.hidden")}</em> : null}
                    {note ? <small style={S.state(narrow)}>{note}</small> : null}
                  </div></th>
                  {cell(formatPct(row.stats?.ret ?? null))}
                  {cell(formatPct(row.stats?.cagr ?? null))}
                  {cell(formatPct(row.stats?.maxDrawdown ?? null))}
                  <td style={S.td(narrow, signColor(excess))} data-sign={excess === null ? "none" : excess < 0 ? "neg" : excess > 0 ? "pos" : "zero"}>
                    {formatPts(excess)}{excess === null ? "" : ` ${t("perf.pts")}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={S.note}>{t("perf.excess.note")}</p>
      </div>
    </section>
  );
}
