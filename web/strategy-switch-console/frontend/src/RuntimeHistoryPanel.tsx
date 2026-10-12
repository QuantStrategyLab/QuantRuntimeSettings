import { useEffect, useState } from "react";
import { loadRuntimeDaily } from "./api";
import { useT } from "./locales";
import { runtimeDailySelectionEligible, runtimeDailySelectionFromAccount, runtimeDailySnapshotMatchesSelection, type RuntimeDailySnapshot } from "./presentation";
import { runtimeHistoryCell, runtimeHistoryDates, runtimeHistoryKey } from "./runtimeHistory";
import type { OverviewAccount } from "./OverviewPage";

type Entry = { value: RuntimeDailySnapshot | null; error: boolean };

export function RuntimeHistoryPanel({ accounts, today, now, refreshVersion, todaySnapshot }: {
  accounts: OverviewAccount[];
  today: string;
  now: number;
  refreshVersion: number;
  todaySnapshot: (account: OverviewAccount) => RuntimeDailySnapshot | null | undefined;
}) {
  const t = useT();
  const dates = runtimeHistoryDates(today);
  const [history, setHistory] = useState<Record<string, Entry>>({});
  // The descriptor is part of the dependency and key: a binding change cannot reuse another target's history.
  const selectionKey = JSON.stringify(accounts.map(account => runtimeDailySelectionFromAccount(account)));
  useEffect(() => {
    let active = true;
    setHistory({});
    const selections = JSON.parse(selectionKey) as ReturnType<typeof runtimeDailySelectionFromAccount>[];
    const requests = new Map<string, { selection: typeof selections[number]; date: string }>();
    for (const selection of selections.filter(runtimeDailySelectionEligible)) {
      for (const date of runtimeHistoryDates(today).slice(0, -1)) requests.set(runtimeHistoryKey(selection, date), { selection, date });
    }
    const queue = [...requests.entries()];
    let cursor = 0;
    const read = async () => {
      while (active && cursor < queue.length) {
        const [key, { selection, date }] = queue[cursor++];
        let entry: Entry;
        try {
          const value = await loadRuntimeDaily(date, selection.platform!, selection.accountKey!);
          entry = runtimeDailySnapshotMatchesSelection(value, selection, date) ? { value, error: false } : { value: null, error: true };
        } catch { entry = { value: null, error: true }; }
        if (active) setHistory(current => ({ ...current, [key]: entry }));
      }
    };
    // Bound concurrency avoids a burst of 13 requests per account. Today's existing read is reused.
    void Promise.all(Array.from({ length: Math.min(4, queue.length) }, read));
    return () => { active = false; };
  }, [selectionKey, today, refreshVersion]);
  return <section className="overview-panel runtime-history" aria-label={t("近 14 天运行")}>
    <div className="overview-panel-heading"><h2>{t("近 14 天运行")}</h2><small>{t("纽约业务日")}</small></div>
    <div className="runtime-history-rows">
      {accounts.map(account => {
        const selection = runtimeDailySelectionFromAccount(account);
        return <div className="runtime-history-row" key={account.id}>
          <strong>{account.title}</strong>
          <div className="runtime-history-cells">
            {dates.map(date => {
              const entry = history[runtimeHistoryKey(selection, date)];
              const snapshot = date === today ? todaySnapshot(account) : entry?.value;
              const cell = runtimeHistoryCell(account.facts?.identity_mismatch ? null : snapshot, selection, date, now);
              const details = entry?.error ? [t("运行记录读取失败或身份不匹配")] : cell.details.map(detail => t(detail));
              const description = `${date} · ${t(cell.label)}${details.length ? ` · ${details.join("；")}` : ""}`;
              return <span className={`runtime-day is-${cell.tone}`} key={date} title={description} aria-label={`${account.title} · ${description}`}><span>{date.slice(8)}</span><span className="sr-only">{t(cell.label)}</span></span>;
            })}
          </div>
        </div>;
      })}
      {!accounts.length ? <p className="overview-panel-empty">{t("没有账户")}</p> : null}
    </div>
    <ul className="runtime-history-legend"><li><i className="is-ok" />{t("完整周期记录")}</li><li><i className="is-partial" />{t("部分或待确认")}</li><li><i className="is-error" />{t("异常")}</li><li><i className="is-unknown" />{t("未运行 / 未知")}</li></ul>
    <p className="overview-panel-note">{t("灰色表示未到期、未接入或没有可验证记录；不能据此判断账户未运行。")}</p>
  </section>;
}
