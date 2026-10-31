import type { RunState, TodayRunSummary } from "../../api/contracts";
import type { RuntimeDailySnapshot } from "../../api/endpoints";
import { runtimeDailyRunIssue } from "../../../../runtime_daily_contract.js";

export type CellKind = "ok" | "failed" | "blocked" | "not-run" | "no-record" | "unknown" | "incomplete" | "stale" | "read-failed";

type SummaryAccount = TodayRunSummary["accounts"][number];

/** The API keeps these activity values distinct; never fold them into one "not run" label. */
const NOT_RUN_ACTIVITIES = ["market_closed", "not_due", "outside_window", "within_grace"] as const;
type NotRunActivity = (typeof NOT_RUN_ACTIVITIES)[number];
const NOT_RUN_ACTIVITY_SET = new Set<string>(NOT_RUN_ACTIVITIES);

export type RunActivityState = RunState | NotRunActivity;

export const RUN_ACTIVITY_STATES: readonly RunActivityState[] = [
  "succeeded", "failed", "blocked", "no_data", "not_connected", "not_run", "unknown", "read_failed", "incomplete",
  "market_closed", "not_due", "outside_window", "within_grace",
];

/**
 * Presentation-only activity state. Failure and blocking checks run before any
 * read or coverage state, so a failed run is never masked by an incomplete or
 * read-failed label.
 */
export function runActivityState(account: SummaryAccount): RunActivityState {
  if (account.status === "not_connected" || account.status === "no_data" || account.status === "read_failed") {
    return account.status;
  }
  const activity = account.activity;
  const runs = account.runs || [];
  if (activity === "blocked") return "blocked";
  if (activity === "failed" || activity === "error") return "failed";
  if (runs.some(run => run.activity !== "blocked" && runtimeDailyRunIssue(run) === "failure")) return "failed";
  if (runs.some(run => run.activity === "blocked")) return "blocked";
  if (activity === "read_incomplete") {
    // `read_incomplete` declares a read problem, so it must be backed by a
    // positive count equal to the code count and only known codes. Anything
    // else is contradictory and resolves to "unknown", never to "incomplete"
    // by fallback and never to success.
    const codes = account.read_error_codes;
    const count = account.read_error_count;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count <= 0) return "unknown";
    if (!Array.isArray(codes) || codes.length !== count) return "unknown";
    const incompleteCodes = ["coverage_unconfirmed", "report_rejected", "read_truncated", "listing_truncated", "schedule_unverified", "target_disabled"];
    const failedCodes = ["report_read_error", "read_failed", "list_failed", "source_read_error"];
    if (!codes.every(code => typeof code === "string"
      && (incompleteCodes.includes(code) || failedCodes.includes(code)))) return "unknown";
    if (codes.some(code => failedCodes.includes(code))) return "read_failed";
    return "incomplete";
  }
  if (activity && NOT_RUN_ACTIVITY_SET.has(activity) && runs.length === 0) return activity as NotRunActivity;
  if (account.completeness === "complete"
    && activity !== null
    && ["no_submission", "no_signal", "no_rebalance", "filled"].includes(activity)
    && runs.length > 0
    && runs.every(run => runtimeDailyRunIssue(run) === null)) return "succeeded";
  return "unknown";
}

export function runActivityCounts(accounts: SummaryAccount[]): Record<RunActivityState, number> {
  const counts = Object.fromEntries(RUN_ACTIVITY_STATES.map(state => [state, 0])) as Record<RunActivityState, number>;
  for (const account of accounts) counts[runActivityState(account)] += 1;
  return counts;
}

/** Specific activity states reuse the shared `state.*` copy; the rest use run-state copy. */
export function runActivityLabelKey(state: string): string {
  return NOT_RUN_ACTIVITY_SET.has(state) ? `state.${state}` : `health.run_state.${state}`;
}

/** Completeness describes the record, not the execution outcome. */
export function cellKind(snapshot: RuntimeDailySnapshot): CellKind {
  const record = snapshot.record;
  if (!record || snapshot.data_status === "unavailable") return "no-record";
  const runs = record.runs ?? [];
  if (record.status === "blocked") return "blocked";
  if (["failed", "error"].includes(record.status) || runs.some(run => run.activity !== "blocked" && runtimeDailyRunIssue(run) === "failure")) return "failed";
  if (runs.some(run => run.activity === "blocked")) return "blocked";
  // A truncated or partially read record still carries valid content; it is
  // reported as incomplete. Only a failed API request is a read failure.
  if (record.status === "read_incomplete") return "incomplete";
  if (snapshot.data_status === "stale") return "stale";
  if (!["fresh", "historical"].includes(snapshot.data_status)) return "unknown";
  if (record.status === "unknown") return "unknown";
  if (record.completeness !== "complete" || record.kind === "incomplete" || record.status === "missing_report") return "incomplete";
  if (record.kind === "schedule" && !runs.length && ["not_due", "market_closed", "outside_window", "within_grace"].includes(record.status)) return "not-run";
  if (record.kind === "run" && ["no_submission", "no_signal", "no_rebalance", "filled"].includes(record.status)
    && runs.length > 0 && runs.every(run => runtimeDailyRunIssue(run) === null)) return "ok";
  return "unknown";
}

/** Count failed accounts only within today's New York summary. */
export function todayFailures(summary: TodayRunSummary): { count: number; complete: boolean } {
  const failureActivities = ["failed", "error"];
  const completeActivities = ["blocked", "no_submission", "no_signal", "no_rebalance", "filled"];
  return {
    count: summary.accounts.filter(account => account.activity !== "blocked" && (failureActivities.includes(account.activity || "")
      || account.runs.some(run => run.activity !== "blocked" && runtimeDailyRunIssue(run) === "failure"))).length,
    complete: summary.status === "ok" && summary.counts.runs !== null && summary.counts.configured > 0
      && summary.counts.observed === summary.counts.configured
      && summary.accounts.length === summary.counts.configured
      && summary.accounts.every(account => account.status === "ok" && account.completeness === "complete"
        && account.run_count !== null && account.run_count === account.runs.length
        && (failureActivities.includes(account.activity || "") || completeActivities.includes(account.activity || "")
          || ["not_due", "market_closed", "outside_window", "within_grace"].includes(account.activity || ""))
        && account.runs.every(run => runtimeDailyRunIssue(run) !== "unconfirmed")),
  };
}
