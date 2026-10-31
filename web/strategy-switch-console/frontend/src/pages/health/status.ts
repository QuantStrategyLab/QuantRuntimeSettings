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

/** The API's own `run_status` vocabulary. The four activity sublabels are not API states. */
const RUN_STATE_SET = new Set<string>([
  "succeeded", "failed", "blocked", "no_data", "not_connected", "not_run", "unknown", "read_failed", "incomplete",
]);

const INCOMPLETE_CODES = ["coverage_unconfirmed", "report_rejected", "read_truncated", "listing_truncated", "schedule_unverified", "target_disabled"];
const FAILED_CODES = ["report_read_error", "read_failed", "list_failed", "source_read_error"];

/** A valid `run_status` from the API, or null when absent/unrecognised (old contract). */
function apiRunStatus(account: SummaryAccount): RunState | null {
  const value = account.run_status;
  return typeof value === "string" && RUN_STATE_SET.has(value) ? value as RunState : null;
}

/**
 * Hard evidence that something failed, as opposed to coverage metadata.
 *
 * `status: "partial"` and `completeness: "incomplete"` are deliberately absent:
 * they describe how much was read, not what happened, and such a record still
 * carries the server's own `run_status`. Only an explicit failure, block or read
 * error can contradict a benign server state.
 */
function explicitFailureEvidence(account: SummaryAccount): boolean {
  if (account.status === "read_failed" || account.status === "not_connected") return true;
  if (account.activity === "failed" || account.activity === "error"
    || account.activity === "blocked" || account.activity === "read_incomplete") return true;
  if (typeof account.read_error_count === "number" && account.read_error_count > 0) return true;
  return (account.runs || []).some(run => run.activity === "blocked" || runtimeDailyRunIssue(run) === "failure");
}

/** Server states that would present the day as fine or as nothing happening. */
const BENIGN_RUN_STATES = new Set<string>(["no_data", "not_run"]);

/** Success is honest only for a complete record that is not declared `no_data`
 *  and carries no failure evidence. */
function successSupported(account: SummaryAccount): boolean {
  return account.status !== "no_data"
    && account.completeness === "complete"
    && !explicitFailureEvidence(account);
}

/**
 * Conservative result for a contradiction. The legacy classifier can itself
 * return `succeeded` (for example on an unexplained read error), so its success
 * is never passed through: an undetermined contradiction is `unknown`.
 */
function conservativeState(account: SummaryAccount): RunActivityState {
  const state = legacyActivityState(account);
  return state === "succeeded" ? "unknown" : state;
}

/**
 * Presentation-only activity state.
 *
 * The API already publishes `run_status` per account (`operations.js` →
 * `run_status.js`), so the frontend consumes it instead of re-deriving the
 * classification and drifting from the producer. Precedence:
 *
 * 1. A genuinely absent `run_status` (old contract) uses the conservative
 *    legacy classifier below.
 * 2. A present value outside the published vocabulary — including `null` and the
 *    empty string — resolves to `unknown`, never to a legacy-derived success.
 * 3. A recognised state is consumed as-is, including for partial or incomplete
 *    records: coverage metadata is not a contradiction.
 * 4. Two exceptions keep the conservative classification: `succeeded` when the
 *    record is not complete or carries failure evidence, and a benign
 *    `no_data`/`not_run` that would conceal explicit failure evidence.
 */
export function runActivityState(account: SummaryAccount): RunActivityState {
  // Widened on purpose: an older response omits the field entirely, while a JSON
  // null or an empty string is present but not a published state.
  const raw: string | null | undefined = account.run_status;
  if (raw === undefined) return legacyActivityState(account);
  const apiState = apiRunStatus(account);
  if (apiState === null) return "unknown";
  if (apiState === "succeeded") return successSupported(account) ? apiState : conservativeState(account);
  if (BENIGN_RUN_STATES.has(apiState) && explicitFailureEvidence(account)) {
    return conservativeState(account);
  }
  // `not_run` is an API state with no reason of its own; the four activity
  // sublabels the API still sends stay visible when nothing ran.
  if (apiState === "not_run" && !(account.runs || []).length
    && account.activity && NOT_RUN_ACTIVITY_SET.has(account.activity)) {
    return account.activity as NotRunActivity;
  }
  return apiState;
}

/**
 * Legacy contract classifier, used only when the payload declares no problem
 * and carries no usable `run_status`. Failure and blocking checks run before
 * any read or coverage state, so a failed run is never masked by an incomplete
 * or read-failed label.
 */
function legacyActivityState(account: SummaryAccount): RunActivityState {
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
    if (!codes.every(code => typeof code === "string"
      && (INCOMPLETE_CODES.includes(code) || FAILED_CODES.includes(code)))) return "unknown";
    if (codes.some(code => FAILED_CODES.includes(code))) return "read_failed";
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
