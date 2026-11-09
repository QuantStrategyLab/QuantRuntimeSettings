import { useEffect, useState } from "react";
import type { Language } from "../../lib/prefs";
import type { DeskApi, DeskResult } from "../api/endpoints.ts";
import type { BookRow, Overview, Ribbon } from "../contract/types";
import type { DeskKey, DeskTranslate } from "../i18n/index.ts";
import { NeedsYouCard } from "../components/NeedsYouCard.tsx";
import { EmptyState, FreshnessChip, LoadingState, RecoverableErrorState, StalePartialBanner } from "../components/StateBlocks.tsx";
import { useDeskLoad } from "../components/useDeskLoad.ts";
import { useNarrow } from "../components/useNarrow.ts";
import { P } from "../components/deskStyles.ts";
import { tapeStateKey } from "../logs/model.ts";
import {
  curveGeometry, formatMoney, formatMultiple, formatSignedMoney, formatSignedPercent, headlineCounts, meter, sparkPath, sparkSegments,
} from "../overview/model.ts";
import type { Tone } from "../overview/model.ts";

const UNKNOWN = "—";
const METER_CELLS = 10;

/** The nav figure: integral part grouped, decimals in a smaller run. */
function NavFigure({ amount, currency, language }: { amount: string | null; currency: string; language: Language }) {
  const text = formatMoney(amount, currency, language);
  if (text === null) return <span className="mrd-ov-nav mrd-ov-unknown">{UNKNOWN}</span>;
  const split = text.lastIndexOf(".");
  if (split < 0) return <span className="mrd-ov-nav">{text}</span>;
  return (
    <span className="mrd-ov-nav">
      {text.slice(0, split)}
      <span className="mrd-ov-nav-frac">{text.slice(split)}</span>
    </span>
  );
}

function Meter({ filled, tone, label }: { filled: number | null; tone: Tone; label: string }) {
  return (
    <span className="mrd-ov-meter" data-tone={tone} role="img" aria-label={label}>
      {Array.from({ length: METER_CELLS }, (_, index) => (
        <span key={index} className="mrd-ov-cell" data-on={filled !== null && index < filled ? "1" : "0"} />
      ))}
      {filled === null ? <span className="mrd-ov-meter-unknown">{UNKNOWN}</span> : null}
    </span>
  );
}

function BookCard({ row, t, language }: { row: BookRow; t: DeskTranslate; language: Language }) {
  const nav = row.nav.status === "unknown"
    ? null
    : formatMoney(row.nav.usd ?? row.nav.amount, row.nav.usd ? "USD" : row.nav.currency, language);
  const day = row.day_change ? formatSignedPercent(row.day_change.ratio) : null;
  const drawdown = formatSignedPercent(row.drawdown.ratio);
  const limit = formatSignedPercent(row.drawdown.limit_ratio, 0);
  const cells = meter(row.drawdown.ratio, row.drawdown.limit_ratio, METER_CELLS);
  const segments = sparkSegments(
    row.sparkline_30d.points, row.sparkline_30d.gap_dates, row.sparkline_30d.dates_from, row.sparkline_30d.dates_to,
  );
  const paths = segments.map(segment => sparkPath(segment, 120, 32)).filter(path => path !== "");
  const strategy = row.strategy.status === "known" ? row.strategy.value.label : null;
  const run = row.last_run
    ? t("overview.book.last_run", { time: row.last_run.at.slice(11, 16), state: t(tapeStateKey({ state: "done", outcome: row.last_run.outcome }) as DeskKey) })
    : t("overview.book.no_run");

  return (
    <article className="mrd-ov-book" data-config={row.config.state} data-drawdown={row.drawdown.state}>
      <header>
        <span className="mrd-ov-platform">{row.platform_label}</span>
        <span className="mrd-ov-account">{row.account_ref}</span>
      </header>
      <h3 className="mrd-ov-strategy">{strategy ?? t("read.unknown")}</h3>
      <p className="mrd-ov-target">{row.target_id}</p>
      <div className="mrd-ov-book-figures">
        <span className="mrd-ov-book-nav">{nav ?? UNKNOWN}</span>
        <span className="mrd-ov-book-day" data-sign={day === null ? "unknown" : day.startsWith("+") ? "up" : day.startsWith("\u2212") ? "down" : "flat"}>
          {day ?? UNKNOWN}
        </span>
      </div>
      {paths.length > 0 ? (
        <svg className="mrd-ov-spark" viewBox="0 0 120 32" preserveAspectRatio="none" role="img"
          aria-label={t("overview.book.spark", { target: row.target_id })}>
          {paths.map((path, index) => <path key={index} d={path} />)}
        </svg>
      ) : <p className="mrd-ov-spark-empty">{t("overview.book.spark_empty")}</p>}
      <div className="mrd-ov-book-risk">
        <span className="mrd-ov-book-label">{t("overview.risk.drawdown")}</span>
        <Meter filled={cells.filled} tone={cells.tone} label={t("overview.risk.meter", { value: drawdown ?? UNKNOWN, limit: limit ?? UNKNOWN })} />
        <span className="mrd-ov-book-value" data-tone={cells.tone}>{drawdown ?? UNKNOWN}</span>
      </div>
      <p className="mrd-ov-book-meta" data-state={row.config.state}>{t(`config.${row.config.state}` as DeskKey, { count: row.config.drift_count })}</p>
      <p className="mrd-ov-book-meta">{run}</p>
    </article>
  );
}

export function OverviewPage({ api, t, language }: { api: DeskApi; t: DeskTranslate; language: Language }) {
  const overview = useDeskLoad<DeskResult<Overview>>(() => api.overview(), [api]);
  const narrow = useNarrow();
  const [ribbon, setRibbon] = useState<{ state: "loading" } | { state: "failed" } | { state: "ready"; data: Ribbon }>({ state: "loading" });

  useEffect(() => {
    let alive = true;
    api.ribbon().then(
      result => alive && setRibbon({ state: "ready", data: result.data }),
      () => alive && setRibbon({ state: "failed" }),
    );
    return () => { alive = false; };
  }, [api]);

  if (overview.load.state === "loading") {
    return <LoadingState t={t} label={t("overview.title")} startedAt={overview.load.startedAt} onRetry={overview.reload} />;
  }
  if (overview.load.state === "failed") return <RecoverableErrorState t={t} onRetry={overview.reload} />;

  const data = overview.load.result.data;
  const stale = data.freshness.data_status !== "ready";
  const totals = data.totals;
  const counts = headlineCounts(data.book);
  const curve = curveGeometry(data.equity_curve, 720, 220);
  const dayRatio = totals.day_change ? formatSignedPercent(totals.day_change.ratio) : null;
  const dayAmount = totals.day_change ? formatSignedMoney(totals.day_change.amount, data.reporting_currency, language) : null;
  const drawdown = formatSignedPercent(totals.drawdown?.ratio ?? null);
  const drawdownLimit = formatSignedPercent(totals.drawdown?.limit_ratio ?? null, 0);
  const drawdownCells = meter(totals.drawdown?.ratio ?? null, totals.drawdown?.limit_ratio ?? null, METER_CELLS);
  const exposure = formatMultiple(totals.gross_exposure_ratio);
  const leveraged = formatMultiple(totals.leveraged_etf_exposure_ratio);
  const runs = totals.runs_today;
  const signals = ribbon.state === "ready" ? ribbon.data.tape.slice(0, 5) : [];

  const headline = counts.running === 0
    ? t("overview.headline.none")
    : counts.drifting === 0
      ? t("overview.headline.steady", { running: counts.running })
      : t("overview.headline", { running: counts.running, steady: counts.steady, drifting: counts.drifting });

  return (
    <section className="mrd-ov-page" aria-labelledby="mrd-page-title" data-page="overview">
      <div className="mrd-card mrd-ov-hero">
        <div className="mrd-ov-hero-main">
          <span className="mrd-label">{t("overview.eyebrow")}</span>
          <h1 id="mrd-page-title" className="mrd-serif mrd-ov-headline">{headline}</h1>
          <span className="mrd-label mrd-ov-nav-label">
            {t("overview.nav.label", { accounts: totals.coverage.included, total: totals.coverage.total })}
          </span>
          <div className="mrd-ov-navrow">
            <NavFigure amount={totals.nav} currency={data.reporting_currency} language={language} />
            <span className="mrd-ov-range">{data.equity_curve.range}</span>
          </div>
          <p className="mrd-ov-day" data-sign={dayRatio === null ? "unknown" : dayRatio.startsWith("+") ? "up" : dayRatio.startsWith("\u2212") ? "down" : "flat"}>
            {dayRatio === null || dayAmount === null
              ? t("overview.day.unknown")
              : t("overview.day_change", { ratio: dayRatio, amount: dayAmount })}
          </p>
          {totals.status !== "complete" ? (
            <p className="mrd-ov-coverage" role="status">
              {t("states.partial_detail", { included: totals.coverage.included, total: totals.coverage.total })}
            </p>
          ) : null}
        </div>
        <aside className="mrd-ov-hero-side">
          <FreshnessChip state={{ kind: "read", data_status: data.freshness.data_status, age_seconds: data.freshness.age_seconds }} t={t} language={language} />
          {data.snapshot_at ? <span className="mrd-ov-snapshot">{`${data.snapshot_at.slice(11, 16)} UTC`}</span> : null}
          <span className="mrd-ov-snapshot">{t("overview.account_ref_note")}</span>
        </aside>
      </div>

      {stale ? <StalePartialBanner t={t} language={language} ageSeconds={data.freshness.age_seconds} /> : null}
      {data.needs_you.length === 0 && stale ? (
        <section className="mrd-card" style={P.column} role="status">
          <span className="mrd-label">{t("overview.needs.title")}</span>
          <p style={P.muted}>{t("overview.needs.unknown")}</p>
        </section>
      ) : data.needs_you.length === 0 ? (
        <EmptyState t={t} title={t("overview.needs.empty")} />
      ) : (
        <NeedsYouCard items={data.needs_you} t={t} />
      )}

      <div className="mrd-card mrd-ov-risk">
        <span className="mrd-label">{t("overview.risk.title")}</span>
        <div className="mrd-ov-risk-row">
          <div className="mrd-ov-risk-item">
            <span className="mrd-ov-risk-name">{t("overview.risk.drawdown")}</span>
            <Meter filled={drawdownCells.filled} tone={drawdownCells.tone}
              label={t("overview.risk.meter", { value: drawdown ?? UNKNOWN, limit: drawdownLimit ?? UNKNOWN })} />
            <span className="mrd-ov-risk-value" data-tone={drawdownCells.tone}>
              {drawdown ?? UNKNOWN}
              <span className="mrd-ov-risk-limit">{drawdownLimit ? t("overview.risk.limit", { limit: drawdownLimit }) : t("read.unknown")}</span>
            </span>
          </div>
          <div className="mrd-ov-risk-item">
            <span className="mrd-ov-risk-name">{t("overview.risk.exposure")}</span>
            <span className="mrd-ov-risk-value" data-tone={exposure === null ? "unknown" : "ok"}>{exposure ?? UNKNOWN}</span>
          </div>
          <div className="mrd-ov-risk-item">
            <span className="mrd-ov-risk-name">{t("overview.risk.leveraged")}</span>
            <span className="mrd-ov-risk-value" data-tone={leveraged === null ? "unknown" : "ok"}>{leveraged ?? UNKNOWN}</span>
          </div>
          <div className="mrd-ov-risk-item">
            <span className="mrd-ov-risk-name">{t("overview.runs.title")}</span>
            <span className="mrd-ov-risk-value">{t("overview.runs.progress", { done: runs.done, expected: runs.expected })}</span>
          </div>
          {totals.config_drift.count > 0 ? (
            <div className="mrd-ov-risk-item">
              <span className="mrd-ov-risk-name">{t("overview.risk.drift")}</span>
              <span className="mrd-ov-risk-value" data-tone="warn">{t("config.drift", { count: totals.config_drift.count })}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mrd-card mrd-ov-curve-card">
        <div className="mrd-ov-curve-head">
          <span className="mrd-label">{t("overview.curve.title", { range: data.equity_curve.range })}</span>
          <span className="mrd-ov-legend">
            <span className="mrd-ov-key" data-key="portfolio">{t("overview.curve.portfolio")}</span>
            {data.equity_curve.benchmark.id
              ? <span className="mrd-ov-key" data-key="benchmark">{t("overview.curve.benchmark", { label: data.equity_curve.benchmark.label })}</span>
              : <span className="mrd-ov-key" data-key="none">{t("overview.curve.no_benchmark")}</span>}
          </span>
        </div>
        {curve === null ? <p className="mrd-ov-note">{t("overview.curve.empty")}</p> : (
          <svg className="mrd-ov-curve" viewBox="0 0 720 220" preserveAspectRatio="none" role="img"
            aria-label={t("overview.curve.aria", { start: data.equity_curve.history_starts ?? UNKNOWN, low: curve.min.toFixed(1), high: curve.max.toFixed(1) })}>
            {curve.drawdownPath ? <path className="mrd-ov-curve-dd" d={curve.drawdownPath} /> : null}
            <path className="mrd-ov-curve-area" d={curve.areaPath ?? ""} />
            {curve.benchmarkPath ? <path className="mrd-ov-curve-bench" d={curve.benchmarkPath} /> : null}
            <path className="mrd-ov-curve-line" d={curve.portfolioPath} />
          </svg>
        )}
        <p className="mrd-ov-note">
          {t("overview.curve.basis", {
            start: data.equity_curve.history_starts ?? UNKNOWN,
            basis: t(`overview.basis.${data.equity_curve.return_basis}` as DeskKey),
          })}
        </p>
      </div>

      <section className="mrd-ov-books" aria-labelledby="mrd-ov-books-title">
        <h2 id="mrd-ov-books-title" className="mrd-label">{t("overview.book.title")}</h2>
        {data.book.length === 0 ? <p className="mrd-ov-note">{t("overview.book.empty")}</p> : (
          <div className="mrd-ov-book-grid">
            {data.book.map(row => <BookCard key={row.target_id} row={row} t={t} language={language} />)}
          </div>
        )}
      </section>

      <div className="mrd-card mrd-ov-side">
        <div className="mrd-ov-runs">
          <span className="mrd-label">{t("overview.runs.title")}</span>
          {runs.pending.length === 0 ? <p className="mrd-ov-note">{t("overview.runs.none_pending")}</p> : (
            <ul className="mrd-ov-pending">
              {runs.pending.map(item => (
                <li key={`${item.target_id}-${item.due_at}`}>
                  {t("overview.runs.pending", { target: item.target_id, time: `${item.due_at.slice(11, 16)} UTC` })}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mrd-ov-signals">
          <span className="mrd-label">{t("overview.signals.title")}</span>
          {ribbon.state === "failed" ? <p className="mrd-ov-note">{t("states.error")}</p>
            : signals.length === 0 ? <p className="mrd-ov-note">{t("overview.signals.empty")}</p>
            : (
              <ul className="mrd-ov-signal-rows">
                {signals.map(entry => (
                  <li key={entry.id} className="mrd-ov-signal-row" data-state={entry.state} data-outcome={entry.outcome ?? ""}>
                    <span className="mrd-ov-signal-time">{entry.at.slice(11, 16)}</span>
                    <span className="mrd-ov-signal-label">{entry.label}</span>
                    <span className="mrd-ov-signal-state">{t(tapeStateKey(entry) as DeskKey)}</span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>

      {overview.load.result.source === "mock" ? <p style={narrow ? P.muted : P.mono}>{t("mock.title")}</p> : null}
    </section>
  );
}
