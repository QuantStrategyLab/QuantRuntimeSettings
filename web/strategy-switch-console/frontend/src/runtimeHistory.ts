import { presentRuntimeDaily, runtimeDailySelectionEligible, runtimeDailySnapshotMatchesSelection, type RuntimeDailySelection, type RuntimeDailySnapshot } from "./presentation.ts";
import { runtimeDailyRunIssue } from "../../runtime_daily_contract.js";

/** Calendar days in the existing New York business-date domain, not 14 trading days. */
export function runtimeHistoryDates(today: string): string[] {
  const time = Date.parse(`${today}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== today) return [];
  return Array.from({ length: 14 }, (_, index) => new Date(time - (13 - index) * 86_400_000).toISOString().slice(0, 10));
}

export function runtimeHistoryKey(selection: RuntimeDailySelection, date: string): string {
  return JSON.stringify([selection.platform, selection.accountKey, selection.dailyBinding, selection.target || null, date]);
}

export type RuntimeHistoryCell = { tone: "ok" | "partial" | "error" | "unknown"; label: string; details: string[] };

/** Green proves a complete reported cycle; it never claims a fill, profit or enablement. */
export function runtimeHistoryCell(snapshot: RuntimeDailySnapshot | null | undefined, selection: RuntimeDailySelection, date: string, now = Date.now()): RuntimeHistoryCell {
  const view = presentRuntimeDaily(snapshot, selection, date);
  const unknown = { tone: "unknown" as const, label: view.statusLabel, details: view.dryRun ? [...view.statusDetails, "只读演练"] : view.statusDetails };
  if (!runtimeDailySelectionEligible(selection) || !snapshot || !runtimeDailySnapshotMatchesSelection(snapshot, selection, date)
    || snapshot.timezone !== "America/New_York" || !snapshot.record
    || !["fresh", "historical"].includes(snapshot.data_status)) return unknown;
  const record = snapshot.record;
  const observed = Date.parse(record.observed_at);
  if (!Number.isFinite(observed) || observed > now) return { ...unknown, details: [...unknown.details, "周期记录时间异常"] };
  if (["异常", "已阻断"].includes(view.statusLabel)) return { ...unknown, tone: "error" };
  const runIssues = (record.runs || []).map(runtimeDailyRunIssue);
  if (runIssues.includes("failure")) return { tone: "error", label: "异常", details: [...view.statusDetails, "周期记录明细未确认或与汇总冲突"] };
  if (runIssues.includes("unconfirmed")) return { tone: "partial", label: "结果待确认", details: [...view.statusDetails, "周期记录明细未确认或与汇总冲突"] };
  if (["not_due", "market_closed", "outside_window", "within_grace", "missing_report"].includes(record.status)) return unknown;
  const complete = record.completeness === "complete" && Array.isArray(record.runs) && record.runs.length > 0
    && (snapshot.read_error_count ?? 0) === 0 && (snapshot.unmatched_count ?? 0) === 0
    && (record.conflict_count ?? 0) === 0 && record.schedule?.state !== "unevaluable";
  if (!complete || view.statusDetails.length || ["submitted", "broker_acknowledged", "partially_filled", "reconciliation_required", "conflict", "read_incomplete", "insufficient"].includes(record.status)) return { ...unknown, tone: "partial" };
  if (["no_submission", "no_signal", "no_rebalance", "filled"].includes(record.status)) return { ...unknown, tone: "ok" };
  return unknown;
}
