import { useEffect, useMemo, useState } from "react";
import type { Language } from "../../lib/prefs";
import type { DeskApi, DeskResult } from "../api/endpoints.ts";
import type { N1Performance, N1Read } from "../contract/n1";
import { n1ReasonKey, readValue } from "../api/n1.ts";
import type { DeskTranslate } from "../i18n/index.ts";
import { BenchmarkPanel, useNarrow } from "../performance/BenchmarkPanel";
import type { BenchmarkState } from "../performance/BenchmarkPanel";
import { S } from "../performance/perfStyles.ts";
import { parseBenchmarks, portfolioCurve } from "../performance/benchmarks.ts";
import type { Stats } from "../performance/benchmarks.ts";

type Loaded = { state: "loading" } | { state: "failed" } | { state: "ready"; result: DeskResult<N1Performance> };

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

export function PerformancePage({ api, t, language }: { api: DeskApi; t: DeskTranslate; language: Language }) {
  const narrow = useNarrow();
  const [perf, setPerf] = useState<Loaded>({ state: "loading" });
  const [benchmarks, setBenchmarks] = useState<BenchmarkState>({ phase: "loading" });

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
  const equity = loaded ? readValue(loaded.data.equity) : null;
  const curve = useMemo(
    () => (equity ? portfolioCurve(equity.dates, equity.portfolio_indexed, equity.gap_dates) : null),
    [equity],
  );
  const window = curve ? { start: curve.points[0].date, end: curve.points[curve.points.length - 1].date } : null;

  useEffect(() => {
    if (!loaded || !window) return;
    let alive = true;
    setBenchmarks({ phase: "loading" });
    api.benchmarks(window, loaded.source, loaded.scenario).then(
      raw => {
        if (!alive) return;
        const model = parseBenchmarks(raw, window);
        setBenchmarks(model ? { phase: "ready", model } : { phase: "failed" });
      },
      // Any HTTP 400/503 or network error: every benchmark is unavailable, the portfolio stays.
      () => alive && setBenchmarks({ phase: "failed" }),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, loaded, window?.start, window?.end]);

  const history = loaded?.data.history ?? null;
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
        benchmarks={benchmarks}
      />
    );
  return (
    <section style={S.page} aria-labelledby="mrd-page-title">
      <div className="mrd-card">
        <h1 id="mrd-page-title" className="mrd-serif" style={S.title(narrow, language === "zh")}>{t("page.performance.headline")}</h1>
        {loaded?.source === "mock" ? <p style={{ ...S.note, marginTop: 8 }}>{t("perf.mock_note")}</p> : null}
        {history?.truncated_by ? (
          <p style={{ ...S.note, marginTop: 8 }} role="status" data-truncated={history.truncated_by}>
            {t("perf.history.truncated", { range: loaded?.data.range ?? "", date: history.first_date ?? t("read.unknown_mark") })}
          </p>
        ) : null}
      </div>
      {body}
    </section>
  );
}
