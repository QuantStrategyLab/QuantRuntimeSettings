import { useEffect, useMemo, useState } from "react";
import type { Language } from "../../lib/prefs";
import type { DeskApi, DeskResult } from "../api/endpoints.ts";
import type { N1Performance, N1Read } from "../contract/n1";
import { n1ReasonKey, readValue } from "../api/n1.ts";
import type { DeskKey, DeskTranslate } from "../i18n/index.ts";
import { BenchmarkPanel, useNarrow } from "../performance/BenchmarkPanel";
import type { BenchmarkState } from "../performance/BenchmarkPanel";
import { S } from "../performance/perfStyles.ts";
import { parseBenchmarks, portfolioCurve } from "../performance/benchmarks.ts";
import type { Stats } from "../performance/benchmarks.ts";

export type Loaded = { state: "loading" } | { state: "failed" } | { state: "ready"; result: DeskResult<N1Performance> };

/** A metric is shown only from a known (or explicitly stale) backend read of the requested window. */
const knownRatio = (read: N1Read<string>): number | null =>
  (read.status === "known" || read.status === "stale") && /^-?\d+(\.\d+)?$/.test(read.value) ? Number(read.value) : null;

/**
 * Portfolio KPIs come only from backend reads. An unknown metric stays null (the panel shows
 * "—"); it is never recomputed from the curve in the browser, and CAGR has no N1 source.
 */
export function portfolioStatsFor(performance: N1Performance): Stats {
  return {
    ret: knownRatio(performance.risk.return_ratio),
    cagr: null,
    maxDrawdown: knownRatio(performance.risk.max_drawdown_ratio),
  };
}

/**
 * The live N1 Performance path reads no benchmark: `/api/market-benchmark/performance` is not
 * an approved source under the current N1 contract, so a live curve never activates it.
 * Fixture (mock) pages keep their synthetic comparison.
 */
export function benchmarkReadAllowed(source: DeskResult<N1Performance>["source"]): boolean {
  return source === "mock";
}

/** Benchmark state for a loaded page: the API is called only when the source allows it. */
export async function loadBenchmarks(
  api: Pick<DeskApi, "benchmarks">,
  loaded: DeskResult<N1Performance>,
  window: { start: string; end: string },
): Promise<BenchmarkState> {
  if (!benchmarkReadAllowed(loaded.source)) return { phase: "not_requested" };
  try {
    const model = parseBenchmarks(await api.benchmarks(window, loaded.source, loaded.scenario), window);
    return model ? { phase: "ready", model } : { phase: "failed" };
  } catch {
    // Any HTTP 400/503 or network error: every benchmark is unavailable, the portfolio stays.
    return { phase: "failed" };
  }
}

/**
 * The benchmark state a page shows: a source that allows no read is always `not_requested`
 * (never loading or failed), and an allowed source is `loading` until its read settles.
 */
export function shownBenchmarkState(source: DeskResult<N1Performance>["source"], state: BenchmarkState): BenchmarkState {
  if (!benchmarkReadAllowed(source)) return { phase: "not_requested" };
  return state.phase === "not_requested" ? { phase: "loading" } : state;
}

const basisKey = (basis: string) => `basis.${basis}` as DeskKey;

/**
 * The minimum-set metadata the projection carries, shown whether or not a curve exists:
 * requested window, first stored date, the per-target return basis and any truncation.
 */
function HistoryMeta({ data, t }: { data: N1Performance; t: DeskTranslate }) {
  const history = data.history;
  const targets = Object.entries(data.return_basis.per_target).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div data-perf-meta="1">
      <p style={{ ...S.note, marginTop: 8 }} data-meta="window">
        {history.requested_from
          ? t("perf.meta.window", { range: data.range, from: history.requested_from })
          : t("perf.meta.window_all", { range: data.range })}
      </p>
      <p style={S.note} data-meta="first_date">{t("perf.meta.first_date", { date: history.first_date ?? t("read.unknown_mark") })}</p>
      {history.truncated_by ? (
        <p style={S.note} role="status" data-truncated={history.truncated_by}>
          {t("perf.history.truncated", { range: data.range, date: history.first_date ?? t("read.unknown_mark") })}
        </p>
      ) : null}
      <p style={S.note} data-meta="basis">{t("perf.meta.basis", { basis: t(basisKey(data.return_basis.kind)) })}</p>
      {targets.length ? (
        <ul style={S.note} data-meta="basis_targets">
          {targets.map(([target, basis]) => <li key={target}>{t("perf.meta.basis_target", { target, basis: t(basisKey(basis)) })}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

export function PerformancePage({ api, t, language }: { api: DeskApi; t: DeskTranslate; language: Language }) {
  const narrow = useNarrow();
  const [perf, setPerf] = useState<Loaded>({ state: "loading" });
  const [benchmarks, setBenchmarks] = useState<BenchmarkState>({ phase: "not_requested" });

  useEffect(() => {
    let alive = true;
    setPerf({ state: "loading" });
    api.performance().then(
      result => alive && setPerf({ state: "ready", result }),
      () => alive && setPerf({ state: "failed" }),
    );
    return () => { alive = false; };
  }, [api]);

  const loaded = perf.state === "ready" ? perf.result : null;
  const curve = useMemo(() => performanceCurve(loaded), [loaded]);
  const window = curveWindow(curve);

  useEffect(() => {
    if (!loaded || !window) return;
    let alive = true;
    setBenchmarks(benchmarkReadAllowed(loaded.source) ? { phase: "loading" } : { phase: "not_requested" });
    loadBenchmarks(api, loaded, window).then(state => alive && setBenchmarks(state));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, loaded, window?.start, window?.end]);

  return <PerformanceView perf={perf} benchmarks={benchmarks} t={t} language={language} narrow={narrow} />;
}

function performanceCurve(loaded: DeskResult<N1Performance> | null) {
  const equity = loaded ? readValue(loaded.data.equity) : null;
  return equity ? portfolioCurve(equity.dates, equity.portfolio_indexed, equity.gap_dates) : null;
}

function curveWindow(curve: ReturnType<typeof performanceCurve>) {
  return curve ? { start: curve.points[0].date, end: curve.points[curve.points.length - 1].date } : null;
}

/** Pure render of a performance load, so the unknown-curve and containment rules are testable. */
export function PerformanceView({ perf, benchmarks, t, language, narrow }: {
  perf: Loaded;
  benchmarks: BenchmarkState;
  t: DeskTranslate;
  language: Language;
  narrow: boolean;
}) {
  const loaded = perf.state === "ready" ? perf.result : null;
  const curve = performanceCurve(loaded);
  const window = curveWindow(curve);
  const unknownCurve = loaded && loaded.data.equity.status === "unknown" ? loaded.data.equity : null;
  const body = perf.state === "loading" ? <section className="mrd-card" aria-busy="true"><p>{t("perf.loading")}</p></section>
    : unknownCurve ? (
      <section className="mrd-card" role="status" data-read="unknown">
        <p>{t("perf.portfolio_unknown", { reason: t(n1ReasonKey(unknownCurve.reason)) })}</p>
      </section>
    )
    : perf.state === "failed" || !loaded || !curve || !window ? <section className="mrd-card" role="status"><p>{t("perf.portfolio_unavailable")}</p></section>
    : (
      <BenchmarkPanel
        t={t}
        language={language}
        portfolio={curve}
        portfolioStats={portfolioStatsFor(loaded.data)}
        window={window}
        benchmarks={shownBenchmarkState(loaded.source, benchmarks)}
      />
    );
  return (
    <section style={S.page} aria-labelledby="mrd-page-title">
      <div className="mrd-card">
        <h1 id="mrd-page-title" className="mrd-serif" style={S.title(narrow, language === "zh")}>{t("page.performance.headline")}</h1>
        {loaded?.source === "mock" ? <p style={{ ...S.note, marginTop: 8 }}>{t("perf.mock_note")}</p> : null}
        {loaded ? <HistoryMeta data={loaded.data} t={t} /> : null}
      </div>
      {body}
    </section>
  );
}
