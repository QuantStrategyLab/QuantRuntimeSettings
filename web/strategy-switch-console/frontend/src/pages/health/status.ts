import type { RuntimeDailySnapshot } from "../../api/endpoints";
import { runtimeDailyRunIssue } from "../../../../runtime_daily_contract.js";

export type CellKind = "ok" | "failed" | "not-run" | "no-record" | "unknown" | "incomplete" | "stale" | "read-failed";

/** Completeness describes the record, not the execution outcome. */
export function cellKind(snapshot: RuntimeDailySnapshot): CellKind {
  const record = snapshot.record;
  if (!record || snapshot.data_status === "unavailable") return "no-record";
  const runs = record.runs ?? [];
  if (["failed", "blocked"].includes(record.status) || runs.some(run => runtimeDailyRunIssue(run) === "failure")) return "failed";
  if (record.status === "read_incomplete") return "read-failed";
  if (snapshot.data_status === "stale") return "stale";
  if (!["fresh", "historical"].includes(snapshot.data_status)) return "unknown";
  if (record.status === "unknown") return "unknown";
  if (record.completeness !== "complete" || record.kind === "incomplete" || record.status === "missing_report") return "incomplete";
  if (record.kind === "schedule" && !runs.length && ["not_due", "market_closed", "outside_window", "within_grace"].includes(record.status)) return "not-run";
  if (record.kind === "run" && ["no_submission", "no_signal", "no_rebalance", "filled"].includes(record.status)
    && runs.length > 0 && runs.every(run => runtimeDailyRunIssue(run) === null)) return "ok";
  return "unknown";
}
