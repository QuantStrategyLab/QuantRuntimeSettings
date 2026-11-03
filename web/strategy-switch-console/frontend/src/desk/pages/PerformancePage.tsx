import { useEffect, useMemo, useState } from "react";
import type { Language } from "../../lib/prefs";
import type { DeskApi, DeskResult } from "../api/endpoints.ts";
import type { Performance } from "../contract/types";
import type { DeskTranslate } from "../i18n/index.ts";
import { BenchmarkPanel, useNarrow } from "../performance/BenchmarkPanel";
import type { BenchmarkState } from "../performance/BenchmarkPanel";
import { S } from "../performance/perfStyles.ts";
import { computeStats, parseBenchmarks, portfolioCurve } from "../performance/benchmarks.ts";
import type { Stats } from "../performance/benchmarks.ts";

type Loaded = { state: "loading" } | { state: "failed" } | { state: "ready"; result: DeskResult<Performance> };

const knownRatio = (read: { status: string; value?: unknown } | undefined): number | null =>
  read?.status === "known" && typeof read.value === "string" && /^-?\d+(\.\d+)?$/.test(read.value) ? Number(read.value) : null;

/** Computed from the curve; a backend read that is currently `known` replaces Return and Max drawdown. */
export function portfolioStatsFor(performance: Performance, computed: Stats): Stats {
  return {
    ret: knownRatio(performance.risk.return_ratio) ?? computed.ret,
    cagr: computed.cagr,
    maxDrawdown: knownRatio(performance.risk.max_drawdown_ratio) ?? computed.maxDrawdown,
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
  const curve = useMemo(
    () => (loaded ? portfolioCurve(loaded.data.equity.dates, loaded.data.equity.portfolio_indexed, loaded.data.equity.gap_dates) : null),
    [loaded],
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

  const body = perf.state === "loading" ? <section className="mrd-card" aria-busy="true"><p>{t("perf.loading")}</p></section>
    : perf.state === "failed" || !loaded || !curve || !window ? <section className="mrd-card" role="status"><p>{t("perf.portfolio_unavailable")}</p></section>
    : (
      <BenchmarkPanel
        t={t}
        language={language}
        portfolio={curve}
        portfolioStats={portfolioStatsFor(loaded.data, computeStats(curve.points))}
        window={window}
        benchmarks={benchmarks}
      />
    );
  return (
    <section style={S.page} aria-labelledby="mrd-page-title">
      <div className="mrd-card">
        <h1 id="mrd-page-title" className="mrd-serif" style={S.title(narrow, language === "zh")}>{t("page.performance.headline")}</h1>
        {loaded?.source === "mock" ? <p style={{ ...S.note, marginTop: 8 }}>{t("perf.mock_note")}</p> : null}
      </div>
      {body}
    </section>
  );
}
