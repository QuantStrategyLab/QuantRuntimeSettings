import { useDisplayNames } from "../../lib/useDisplayNames";
import { useEffect, useMemo, useState } from "react";
import type { RuntimeDailyRecord, RuntimeDailySnapshot } from "../../api/endpoints";
import { cellKind, type CellKind } from "./status";
import { loadRuntimeDaily } from "../../api/endpoints";
import { useLanguage, useT, type MessageKey } from "../../i18n";
import { formatDate, formatDateTime } from "../../lib/format";
import { Badge, EmptyState, Skeleton, StatusBadge } from "../../components/primitives";
import { runtimeDailyBusinessDate } from "../../../../runtime_daily_contract.js";
import type { GridAccount } from "./dailySelection";

type CellState =
  | { phase: "loading" }
  | { phase: "ready"; snapshot: RuntimeDailySnapshot }
  | { phase: "binding-changed" }
  | { phase: "error" };

/**
 * A stored day written under a previous binding is intentionally withheld by
 * the API (409) so a rotation can never silently re-attribute it. That is a
 * distinct, explainable state, not an unreadable date.
 */
function isBindingChanged(error: unknown): boolean {
  const failure = error as { status?: unknown; message?: unknown } | null;
  return failure?.status === 409 && failure?.message === "runtime_daily_binding_changed";
}

const CELL_LABEL_KEY: Record<CellKind, MessageKey> = {
  ok: "health.grid.ok",
  failed: "health.grid.failed",
  blocked: "health.run_state.blocked",
  "not-run": "health.grid.not_run",
  "no-record": "health.grid.no_record",
  unknown: "state.unknown",
  incomplete: "health.grid.incomplete",
  stale: "state.stale",
  "read-failed": "state.read_failed",
  "binding-changed": "health.grid.binding_changed",
};

const CELL_ICON: Record<CellKind, string> = {
  ok: "✓",
  failed: "✗",
  blocked: "⊘",
  "not-run": "–",
  "no-record": "",
  unknown: "?",
  incomplete: "…",
  stale: "~",
  "read-failed": "!",
  "binding-changed": "↻",
};

function cellKey(account: GridAccount, date: string): string {
  return `${account.platform}/${account.account_alias}/${date}`;
}

/** The n most recent New York business days (Mon–Fri), oldest first; holidays keep their real record state. */
function lastNDates(end: string, n: number): string[] {
  const dates: string[] = [];
  let cursor = Date.parse(`${end}T00:00:00Z`);
  while (dates.length < n) {
    const day = new Date(cursor).getUTCDay();
    if (day !== 0 && day !== 6) dates.unshift(new Date(cursor).toISOString().slice(0, 10));
    cursor -= 86_400_000;
  }
  return dates;
}

interface Selection {
  account: GridAccount;
  date: string;
}

function DayDetail({ selection, cell }: { selection: Selection; cell: CellState | undefined }) {
  const t = useT();
  const names = useDisplayNames();
  const language = useLanguage();
  const dateText = formatDate(selection.date, language);
  let body;
  if (!cell || cell.phase === "loading") {
    body = <Skeleton height={16} width={240} />;
  } else if (cell.phase === "binding-changed") {
    body = <span className="health-grid-note health-grid-note-info">{t("health.grid.binding_changed_detail")}</span>;
  } else if (cell.phase === "error") {
    body = <span className="health-grid-note">{t("state.read_failed")}</span>;
  } else if (!cell.snapshot.record) {
    body = <span>{t("health.grid.no_record")}</span>;
  } else {
    const record: RuntimeDailyRecord = cell.snapshot.record;
    const runs = record.runs ?? [];
    const activityCounts = new Map<string, number>();
    for (const run of runs) {
      const labelKey = run.activity === "blocked" ? "health.run_state.blocked" : `state.${run.activity || "unknown"}`;
      const label = t(labelKey);
      activityCounts.set(label, (activityCounts.get(label) || 0) + 1);
    }
    body = (
      <>
        <div className="health-day-detail-meta">
          {record.status === "blocked" ? <Badge tone="warn">{t("health.run_state.blocked")}</Badge> : <StatusBadge status={record.status} />}
          {cellKind(cell.snapshot) === "blocked" && <span>{t(record.block_reason_code ? `reason.${record.block_reason_code}` : "reason.unknown")}</span>}
          <span>{t("health.day_detail_summary", { count: record.runs ? runs.length : 0 })}</span>
          {[...activityCounts].map(([label, count]) => <span key={label} className="card-note">{count} {label}</span>)}
        </div>
        {runs.length > 0 && (
          <details className="health-day-runs">
            <summary>{t("health.day_detail_runs")}</summary>
            <ul>
              {runs.map((run, index) => {
                const started = formatDateTime(run.started_at, language).text;
                const finished = formatDateTime(run.finished_at, language).text;
                return (
                  <li key={index}>
                    <span className="num">{t("health.detail.started")} {started}</span>
                    <span className="num">{t("health.detail.finished")} {finished}</span>
                    <span>{t(run.activity === "blocked" ? "health.run_state.blocked" : `state.${run.activity || "unknown"}`)}</span>
                    {run.errors_present === true && run.activity !== "blocked" && <Badge tone="error">{t("health.grid.failed")}</Badge>}
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </>
    );
  }
  return (
    <div className="health-day-detail">
      <div className="health-day-detail-head">
        <strong>{t("health.day_detail")}</strong>
        <span>{names.account(selection.account.account_alias, selection.account.platform)}</span>
        <span className="num">{dateText}</span>
      </div>
      {body}
    </div>
  );
}

export function RunGrid({ accounts, epoch }: { accounts: GridAccount[]; epoch: number }) {
  const t = useT();
  const names = useDisplayNames();
  const dates = useMemo(() => lastNDates(runtimeDailyBusinessDate(), 14), [epoch]);
  const [cells, setCells] = useState<Record<string, CellState>>({});
  const [historyError, setHistoryError] = useState(false);
  const [selected, setSelected] = useState<Selection | null>(null);

  useEffect(() => {
    if (!accounts.length) return undefined;
    let cancelled = false;
    const initial: Record<string, CellState> = {};
    for (const account of accounts) {
      for (const date of dates) initial[cellKey(account, date)] = { phase: "loading" };
    }
    setCells(initial);
    setHistoryError(false);
    setSelected(null);
    (async () => {
      let anyError = false;
      // Batch per date column: one settled batch per day, cells land progressively.
      for (const date of dates) {
        const results = await Promise.allSettled(
          accounts.map(account => loadRuntimeDaily(date, account.platform, account.account_alias, false)),
        );
        if (cancelled) return;
        const patch: Record<string, CellState> = {};
        results.forEach((result, index) => {
          const key = cellKey(accounts[index], date);
          if (result.status === "fulfilled") {
            patch[key] = { phase: "ready", snapshot: result.value };
          } else if (isBindingChanged(result.reason)) {
            patch[key] = { phase: "binding-changed" };
          } else {
            patch[key] = { phase: "error" };
            anyError = true;
          }
        });
        setCells(prev => ({ ...prev, ...patch }));
      }
      if (!cancelled && anyError) setHistoryError(true);
    })().catch(() => {
      if (!cancelled) setHistoryError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [accounts, dates, epoch]);

  if (!accounts.length) return <EmptyState title={t("state.no_data")} />;

  const legendKinds = Object.keys(CELL_LABEL_KEY) as CellKind[];
  const hasBindingChanged = Object.values(cells).some(cell => cell.phase === "binding-changed");

  return (
    <>
      <p className="health-grid-hint">{t("health.grid_scroll_hint")}</p>
      <div className="health-grid" tabIndex={0} role="region" aria-label={t("health.grid_title")}>
        <table>
          <caption className="sr-only">{t("health.grid_title")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("health.col.account")}</th>
              {dates.map(date => (
                <th key={date} scope="col" className="num">{date.slice(5)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {accounts.map(account => (
              <tr key={`${account.platform}/${account.account_alias}`}>
                <th scope="row">
                  {names.account(account.account_alias, account.platform)}
                  <span className="card-note"> · {names.platform(account.platform)}</span>
                </th>
                {dates.map(date => {
                  const key = cellKey(account, date);
                  const cell = cells[key];
                  const isSelected = selected?.account.platform === account.platform
                    && selected.account.account_alias === account.account_alias && selected.date === date;
                  if (!cell || cell.phase === "loading") {
                    return (
                      <td key={date}>
                        <Skeleton height={26} width={26} />
                      </td>
                    );
                  }
                  if (cell.phase === "binding-changed" || cell.phase === "error") {
                    const kind: CellKind = cell.phase === "error" ? "read-failed" : "binding-changed";
                    const label = t(CELL_LABEL_KEY[kind]);
                    return (
                      <td key={date}>
                        <button
                          type="button"
                          className={`health-cell ${kind}${isSelected ? " selected" : ""}`}
                          title={label}
                          aria-label={`${names.account(account.account_alias, account.platform)} ${date}: ${label}`}
                          onClick={() => setSelected({ account, date })}
                        >{CELL_ICON[kind]}</button>
                      </td>
                    );
                  }
                  const kind = cellKind(cell.snapshot);
                  const label = t(CELL_LABEL_KEY[kind]);
                  return (
                    <td key={date}>
                      <button
                        type="button"
                        className={`health-cell ${kind}${isSelected ? " selected" : ""}`}
                        title={label}
                        aria-label={`${names.account(account.account_alias, account.platform)} ${date}: ${label}`}
                        aria-pressed={isSelected}
                        onClick={() => setSelected({ account, date })}
                      >
                        {CELL_ICON[kind]}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="health-legend">
        {legendKinds.map(kind => (
          <span key={kind}>
            <span className={`health-cell ${kind}`} aria-hidden="true">{CELL_ICON[kind]}</span>
            {t(CELL_LABEL_KEY[kind])}
          </span>
        ))}
      </div>
      {historyError && <p className="health-grid-note">{t("health.grid_read_failed_note")}</p>}
      {hasBindingChanged && <p className="health-grid-note health-grid-note-info">{t("health.grid_binding_changed_note")}</p>}
      {selected && <DayDetail selection={selected} cell={cells[cellKey(selected.account, selected.date)]} />}
    </>
  );
}
