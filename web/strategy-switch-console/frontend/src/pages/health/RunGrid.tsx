import { useEffect, useMemo, useState } from "react";
import type { RuntimeDailyRecord, RuntimeDailySnapshot } from "../../api/endpoints";
import { cellKind, type CellKind } from "./status";
import { loadRuntimeDaily } from "../../api/endpoints";
import { useLanguage, useT, type MessageKey } from "../../i18n";
import { formatDate, formatDateTime } from "../../lib/format";
import { Badge, EmptyState, Skeleton, StatusBadge } from "../../components/primitives";

export interface GridAccount {
  account_alias: string;
  platform: string;
}

type CellState =
  | { phase: "loading" }
  | { phase: "ready"; snapshot: RuntimeDailySnapshot }
  | { phase: "error" };

const CELL_LABEL_KEY: Record<CellKind, MessageKey> = {
  ok: "health.grid.ok",
  failed: "health.grid.failed",
  "not-run": "health.grid.not_run",
  "no-record": "health.grid.no_record",
  unknown: "state.unknown",
  incomplete: "health.grid.incomplete",
  stale: "state.stale",
  "read-failed": "state.read_failed",
};

const CELL_ICON: Record<CellKind, string> = {
  ok: "✓",
  failed: "✗",
  "not-run": "–",
  "no-record": "",
  unknown: "?",
  incomplete: "…",
  stale: "~",
  "read-failed": "!",
};

function cellKey(alias: string, date: string): string {
  return `${alias}${date}`;
}

/** Business-date domain is New York; the columns are the most recent business days in that zone. */
function todayInNewYork(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
  const language = useLanguage();
  const dateText = formatDate(selection.date, language);
  let body;
  if (!cell || cell.phase === "loading") {
    body = <Skeleton height={16} width={240} />;
  } else if (cell.phase === "error") {
    body = <span className="health-grid-note">{t("state.read_failed")}</span>;
  } else if (!cell.snapshot.record) {
    body = <span>{t("health.grid.no_record")}</span>;
  } else {
    const record: RuntimeDailyRecord = cell.snapshot.record;
    const runs = record.runs ?? [];
    body = (
      <>
        <div className="health-day-detail-meta">
          <StatusBadge status={record.status} />
          <span>{t("health.run_count")}: {record.runs ? runs.length : "—"}</span>
        </div>
        {runs.length > 0 && (
          <ul className="health-day-runs">
            {runs.map((run, index) => {
              const started = formatDateTime(run.started_at, language).text;
              const finished = formatDateTime(run.finished_at, language).text;
              return (
                <li key={index}>
                  <span className="num">{t("health.detail.started")} {started}</span>
                  <span className="num">{t("health.detail.finished")} {finished}</span>
                  <span>{run.activity || "—"}</span>
                  {run.errors_present === true && <Badge tone="error">{t("health.grid.failed")}</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  }
  return (
    <div className="health-day-detail">
      <div className="health-day-detail-head">
        <strong>{t("health.day_detail")}</strong>
        <span>{selection.account.account_alias}</span>
        <span className="num">{dateText}</span>
      </div>
      {body}
    </div>
  );
}

export function RunGrid({ accounts, epoch }: { accounts: GridAccount[]; epoch: number }) {
  const t = useT();
  const dates = useMemo(() => lastNDates(todayInNewYork(), 14), [epoch]);
  const [cells, setCells] = useState<Record<string, CellState>>({});
  const [historyError, setHistoryError] = useState(false);
  const [selected, setSelected] = useState<Selection | null>(null);

  useEffect(() => {
    if (!accounts.length) return undefined;
    let cancelled = false;
    const initial: Record<string, CellState> = {};
    for (const account of accounts) {
      for (const date of dates) initial[cellKey(account.account_alias, date)] = { phase: "loading" };
    }
    setCells(initial);
    setHistoryError(false);
    setSelected(null);
    (async () => {
      let anyError = false;
      // Batch per date column: one settled batch per day, cells land progressively.
      for (const date of dates) {
        const results = await Promise.allSettled(
          accounts.map(account => loadRuntimeDaily(date, account.platform, account.account_alias)),
        );
        if (cancelled) return;
        const patch: Record<string, CellState> = {};
        results.forEach((result, index) => {
          const key = cellKey(accounts[index].account_alias, date);
          if (result.status === "fulfilled") {
            patch[key] = { phase: "ready", snapshot: result.value };
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

  return (
    <>
      <div className="health-grid">
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
                  {account.account_alias}
                  <span className="card-note"> {account.platform}</span>
                </th>
                {dates.map(date => {
                  const key = cellKey(account.account_alias, date);
                  const cell = cells[key];
                  const isSelected = selected?.account.account_alias === account.account_alias && selected.date === date;
                  if (!cell || cell.phase === "loading") {
                    return (
                      <td key={date}>
                        <Skeleton height={26} width={26} />
                      </td>
                    );
                  }
                  if (cell.phase === "error") {
                    return (
                      <td key={date}>
                        <button
                          type="button"
                          className={`health-cell read-failed${isSelected ? " selected" : ""}`}
                          title={t("state.read_failed")}
                          aria-label={`${account.account_alias} ${date}: ${t("state.read_failed")}`}
                          onClick={() => setSelected({ account, date })}
                        >!</button>
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
                        aria-label={`${account.account_alias} ${date}: ${label}`}
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
      {selected && <DayDetail selection={selected} cell={cells[cellKey(selected.account.account_alias, selected.date)]} />}
    </>
  );
}
