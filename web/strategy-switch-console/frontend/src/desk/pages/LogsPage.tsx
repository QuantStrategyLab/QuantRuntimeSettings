import { useEffect, useMemo, useState } from "react";
import type { Language } from "../../lib/prefs";
import type { DeskApi, DeskResult } from "../api/endpoints.ts";
import type { LogLevel, Logs } from "../contract/types";
import type { N1Ribbon } from "../contract/n1";
import { coverageText, n1ReasonKey, readValue } from "../api/n1.ts";
import type { DeskKey, DeskTranslate } from "../i18n/index.ts";
import { levelCounts, runSummary, tapeStateKey, type LevelFilter } from "../logs/model.ts";

type Loaded<T> = { state: "loading" } | { state: "failed" } | { state: "ready"; result: DeskResult<T> };
const LEVELS: LogLevel[] = ["error", "warn", "info", "debug"];
const LEVEL_KEYS: Record<LevelFilter, DeskKey> = {
  all: "logs.filter.all",
  error: "logs.level.error",
  warn: "logs.level.warn",
  info: "logs.level.info",
  debug: "logs.level.debug",
};

const clock = (iso: string): string => iso.slice(11, 16);

export function LogsPage({ api, t }: { api: DeskApi; t: DeskTranslate; language: Language }) {
  const [ribbon, setRibbon] = useState<Loaded<N1Ribbon>>({ state: "loading" });
  const [logs, setLogs] = useState<Loaded<Logs>>({ state: "loading" });
  const [level, setLevel] = useState<LevelFilter>("all");

  useEffect(() => {
    let alive = true;
    setRibbon({ state: "loading" });
    setLogs({ state: "loading" });
    api.ribbon().then(
      result => alive && setRibbon({ state: "ready", result }),
      () => alive && setRibbon({ state: "failed" }),
    );
    api.logs().then(
      result => alive && setLogs({ state: "ready", result }),
      () => alive && setLogs({ state: "failed" }),
    );
    return () => { alive = false; };
  }, [api]);

  const ribbonData = ribbon.state === "ready" ? ribbon.result.data : null;
  const logsData = logs.state === "ready" ? logs.result.data : null;
  // Shared ribbon consumer only: the tape is an N1 read, so an unread tape is not "no runs".
  const tapeRead = ribbonData ? ribbonData.tape : null;
  const tape = tapeRead ? readValue(tapeRead) : null;
  const summary = tape ? runSummary(tape) : null;
  const nextRun = ribbonData ? readValue(ribbonData.next_run) : null;
  const counts = useMemo(() => levelCounts(logsData?.items ?? []), [logsData]);
  const visible = useMemo(() => {
    const items = logsData?.items ?? [];
    return level === "all" ? items : items.filter(line => line.level === level);
  }, [logsData, level]);

  const headline = ribbon.state === "failed"
    ? t("logs.ribbon_failed")
    : tapeRead?.status === "unknown" ? t("logs.runs.unknown", { reason: t(n1ReasonKey(tapeRead.reason)) })
    : summary
      ? summary.runs > 0 ? t("logs.summary", { runs: summary.runs, drift: summary.drift })
        : tapeRead?.status === "partial" ? t("logs.runs.partial", { coverage: coverageText(tapeRead.coverage) }) : t("logs.summary.none")
      : t("states.loading");

  return (
    <section className="mrd-logs-page" aria-labelledby="mrd-page-title">
      {[ribbon, logs].some(item => item.state === "ready" && item.result.source === "mock")
        ? <p className="mrd-note mrd-page-note" title={t("mock.title")}>{t("mock.badge")}</p> : null}
      <div className="mrd-card">
        <span className="mrd-label">{t("logs.eyebrow")}</span>
        <h1 id="mrd-page-title" className="mrd-serif mrd-logs-title">{headline}</h1>
        <span className="mrd-note">{t("logs.meta", { days: logsData?.retention.days ?? 90 })}</span>
        {logsData?.retention.truncated ? <p className="mrd-note">{t("logs.truncated")}</p> : null}
      </div>

      {/* The ribbon carries sessions and today's runs; when it fails, say so instead of
          leaving the page on a loading state that never resolves. */}
      {ribbon.state === "failed" ? (
        <div className="mrd-card" role="status">
          <span className="mrd-label">{t("logs.runs.title")}</span>
          <p className="mrd-note">{t("logs.ribbon_failed_detail")}</p>
        </div>
      ) : null}
      {ribbon.state === "loading" ? (
        <div className="mrd-card">
          <span className="mrd-label">{t("logs.runs.title")}</span>
          <p className="mrd-note" aria-busy="true">{t("states.loading")}</p>
        </div>
      ) : null}

      {ribbonData ? (
        <div className="mrd-card mrd-sessions">
          <span className="mrd-label">{t("logs.sessions.title")}</span>
          <ul className="mrd-session-rows">
            {ribbonData.sessions.map(session => (
              <li key={session.market} className="mrd-session-row" data-state={session.state}>
                <span className="mrd-session-market">{t(`market.${session.market}` as DeskKey)}</span>
                <span className="mrd-session-state">{t(`session.state.${session.state}` as DeskKey)}</span>
                <span className="mrd-session-when">
                  {session.close_utc
                    ? t("session.close_utc", { time: session.close_utc })
                    : session.next_change_at ? t("session.next_change", { time: clock(session.next_change_at) }) : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {ribbonData ? (
        <div className="mrd-card mrd-tape">
          <span className="mrd-label">{t("logs.runs.title")}</span>
          <p className="mrd-note">{t("logs.runs.utc_day", { date: ribbonData.date })}</p>
          {nextRun ? (
            <p className="mrd-note">{t("logs.runs.next", { time: clock(nextRun.due_at), target: nextRun.target_id })}</p>
          ) : null}
          {tapeRead?.status === "unknown" ? (
            <p className="mrd-note" role="status" data-read="unknown">{t("logs.runs.unknown", { reason: t(n1ReasonKey(tapeRead.reason)) })}</p>
          ) : !tape || tape.length === 0 ? (
            <p className="mrd-note">{tapeRead?.status === "partial" ? t("logs.runs.partial", { coverage: coverageText(tapeRead.coverage) }) : t("logs.runs.empty")}</p>
          ) : (
            <ul className="mrd-tape-rows">
              {tape.map(entry => (
                <li key={entry.id} className="mrd-tape-row" data-state={entry.state} data-outcome={entry.outcome ?? ""}>
                  <span className="mrd-tape-time">{clock(entry.at)}</span>
                  <span className="mrd-tape-label">{entry.label}</span>
                  <span className="mrd-tape-target">{entry.target_id}</span>
                  <span className="mrd-tape-state">
                    {t(tapeStateKey(entry) as DeskKey)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="mrd-card mrd-log-tail">
        <span className="mrd-label">{t("logs.logs.title")}</span>
        <div className="mrd-seg mrd-level-filter" role="group" aria-label={t("logs.filter.label")}>
          {(["all", ...LEVELS] as LevelFilter[]).map(key => (
            <button
              key={key}
              type="button"
              className="mrd-chip mrd-level-chip"
              aria-pressed={level === key}
              data-level={key}
              onClick={() => setLevel(key)}
            >
              {t(LEVEL_KEYS[key])} · {counts[key]}
            </button>
          ))}
        </div>
        {logs.state === "loading" ? <p className="mrd-note" aria-busy="true">{t("logs.loading")}</p>
          : logs.state === "failed" ? <p className="mrd-note" role="status">{t("states.error")}</p>
          : visible.length === 0 ? <p className="mrd-note">{t("logs.empty")}</p>
          : (
            <ul className="mrd-log-rows">
              {visible.map(line => (
                <li key={line.id} className="mrd-log-row" data-level={line.level}>
                  <span className="mrd-log-time">{clock(line.at)}</span>
                  <span className={`mrd-badge mrd-level-${line.level}`}>{t(`logs.level.${line.level}` as DeskKey)}</span>
                  <span className="mrd-log-source">{line.source}</span>
                  <span className="mrd-log-message">{line.message}</span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}
