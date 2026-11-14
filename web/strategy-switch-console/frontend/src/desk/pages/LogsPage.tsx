import { useEffect, useMemo, useState } from "react";
import type { Language } from "../../lib/prefs";
import type { DeskApi, DeskResult } from "../api/endpoints.ts";
import type { LogLevel, Logs } from "../contract/types";
import type { N1Ribbon } from "../contract/n1";
import { coverageText, n1ReasonKey, readValue } from "../api/n1.ts";
import { clockOffsetMs, formatAge, serverNowIso } from "../format.ts";
import type { DeskKey, DeskTranslate } from "../i18n/index.ts";
import { levelCounts, runSummary, tapeStateKey, type LevelFilter } from "../logs/model.ts";
import { utcWhen } from "../shell/TopBar.tsx";

export type Loaded<T> = { state: "loading" } | { state: "failed" } | { state: "ready"; result: DeskResult<T> };
const LEVELS: LogLevel[] = ["error", "warn", "info", "debug"];
const LEVEL_KEYS: Record<LevelFilter, DeskKey> = {
  all: "logs.filter.all",
  error: "logs.level.error",
  warn: "logs.level.warn",
  info: "logs.level.info",
  debug: "logs.level.debug",
};

/** Local re-evaluation only: the clock advances, nothing is read again. */
const LOCAL_TICK_MS = 30_000;

export interface LogsNextRun {
  state: "known" | "stale" | "partial" | "expired" | "missing" | "unknown";
  text: string;
  /** Coverage, stale age and the stored observation instant of the read; null when there is none. */
  detail: string | null;
}

/**
 * The snapshot's `next_run` read, kept whole: status, coverage, stored observation instant
 * and stale age. The headline always says "earliest observed scheduled run", which stays
 * true for a partial candidate. A candidate that has passed on the local clock is shown as
 * passed, never as upcoming; this page does not re-read the schedule to replace it.
 */
export function logsNextRun(read: N1Ribbon["next_run"], nowIso: string, t: DeskTranslate, language: Language): LogsNextRun {
  if (read.status === "unknown") return { state: "unknown", text: t("logs.runs.next_unknown", { reason: t(n1ReasonKey(read.reason)) }), detail: null };
  const value = read.value;
  if (!value) return { state: "missing", text: t("logs.runs.next_missing"), detail: null };
  const time = utcWhen(value.due_at, nowIso, language) ?? "--:--";
  if (!(Date.parse(value.due_at) > Date.parse(nowIso))) return { state: "expired", text: t("logs.runs.next_expired", { time }), detail: null };
  const text = t("logs.runs.next", { time, target: value.target_id });
  const params = { coverage: coverageText(read.coverage), observed: utcWhen(read.observed_at, nowIso, language) ?? "--:--" };
  if (read.status === "partial") return { state: "partial", text, detail: t("logs.runs.next_partial", params) };
  if (read.status === "stale") return { state: "stale", text, detail: t("logs.runs.next_stale", { ...params, age: formatAge(read.age_seconds, language) ?? "—" }) };
  return { state: "known", text, detail: t("logs.runs.next_known", params) };
}

/**
 * Logs reads the ribbon once when it opens (a one-time snapshot, in addition to the shell's
 * own polled ribbon; it neither polls nor shares that read). Its local clock is anchored to
 * the snapshot's `generated_at` only to place "now": it expires a passed next-run candidate
 * and dates timestamps, and never refreshes an observation or its age.
 */
export function LogsPage({ api, t, language }: { api: DeskApi; t: DeskTranslate; language: Language }) {
  const [ribbon, setRibbon] = useState<Loaded<N1Ribbon>>({ state: "loading" });
  const [logs, setLogs] = useState<Loaded<Logs>>({ state: "loading" });
  const [level, setLevel] = useState<LevelFilter>("all");
  const [offsetMs, setOffsetMs] = useState<number | null>(null);
  const [clientNow, setClientNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    setRibbon({ state: "loading" });
    setLogs({ state: "loading" });
    api.ribbon().then(
      result => {
        if (!alive) return;
        setOffsetMs(clockOffsetMs(result.data.generated_at, Date.now()));
        setRibbon({ state: "ready", result });
      },
      () => alive && setRibbon({ state: "failed" }),
    );
    api.logs().then(
      result => alive && setLogs({ state: "ready", result }),
      () => alive && setLogs({ state: "failed" }),
    );
    return () => { alive = false; };
  }, [api]);

  useEffect(() => {
    const tick = window.setInterval(() => setClientNow(Date.now()), LOCAL_TICK_MS);
    return () => window.clearInterval(tick);
  }, []);

  return <LogsView ribbon={ribbon} logs={logs} level={level} onLevel={setLevel} nowIso={serverNowIso(offsetMs, clientNow)} t={t} language={language} />;
}

/** Pure render of the Logs page, so the next-run, snapshot and date rules are testable. */
export function LogsView({ ribbon, logs, level, onLevel, nowIso, t, language }: {
  ribbon: Loaded<N1Ribbon>;
  logs: Loaded<Logs>;
  level: LevelFilter;
  onLevel: (level: LevelFilter) => void;
  nowIso: string;
  t: DeskTranslate;
  language: Language;
}) {
  const clock = (iso: string): string => utcWhen(iso, nowIso, language) ?? "--:--";
  const ribbonData = ribbon.state === "ready" ? ribbon.result.data : null;
  const logsData = logs.state === "ready" ? logs.result.data : null;
  // One-time ribbon snapshot: the tape is an N1 read, so an unread tape is not "no runs".
  const tapeRead = ribbonData ? ribbonData.tape : null;
  const tape = tapeRead ? readValue(tapeRead) : null;
  const summary = tape ? runSummary(tape) : null;
  const nextRun = ribbonData ? logsNextRun(ribbonData.next_run, nowIso, t, language) : null;
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
          <p className="mrd-note" data-snapshot="once">{t("logs.runs.snapshot", { time: clock(ribbonData.generated_at) })}</p>
          {nextRun ? (
            <p className="mrd-note" data-next-run={nextRun.state}>
              {nextRun.text}
              {nextRun.detail ? <><br /><small>{nextRun.detail}</small></> : null}
            </p>
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
              onClick={() => onLevel(key)}
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
