/** Display-only outcomes; data freshness/completeness remain separate. */
import { runtimeDailyRunIssue } from "../../runtime_daily_contract.js";
export const RUN_STATES = ["succeeded", "failed", "blocked", "no_data", "not_connected", "not_run", "unknown", "read_failed", "incomplete"];
export function runStatus(account) {
  if (["not_connected", "no_data", "read_failed"].includes(account.status)) return account.status;
  const activity = account.activity;
  const runs = account.runs || [];
  if (activity === "blocked") return "blocked";
  if (["failed", "error"].includes(activity)) return "failed";
  if (runs.some(run => run.activity !== "blocked" && runtimeDailyRunIssue(run) === "failure")) return "failed";
  if (runs.some(run => run.activity === "blocked")) return "blocked";
  if (activity === "read_incomplete") {
    const codes = account.read_error_codes;
    if (!Number.isSafeInteger(account.read_error_count) || account.read_error_count < 1
      || !Array.isArray(codes) || codes.length !== account.read_error_count) return "unknown";
    const failed = ["report_read_error", "read_failed", "list_failed", "source_read_error"];
    const partial = ["coverage_unconfirmed", "report_rejected", "read_truncated", "listing_truncated"];
    if (!codes.every(code => failed.includes(code) || partial.includes(code))) return "unknown";
    return codes.some(code => failed.includes(code)) ? "read_failed" : "incomplete";
  }
  if (["not_due", "market_closed", "outside_window", "within_grace"].includes(activity) && !runs.length) return "not_run";
  if (account.completeness === "complete" && ["no_submission", "no_signal", "no_rebalance", "filled"].includes(activity)
    && runs.length && runs.every(run => runtimeDailyRunIssue(run) === null)) return "succeeded";
  return "unknown";
}
export function runStateCounts(accounts) {
  const counts = Object.fromEntries(RUN_STATES.map(state => [state, 0]));
  for (const account of accounts) counts[runStatus(account)]++;
  return counts;
}
