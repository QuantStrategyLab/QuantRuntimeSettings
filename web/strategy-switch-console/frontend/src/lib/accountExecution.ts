import type { StrategySummary } from "../api/contracts";
import type { DirectoryConfig } from "./accountDirectory";

type ConfiguredAccount = StrategySummary["strategies"][number]["configured_accounts"][number];

/** Display only. Legacy modes may contain alias inference and cannot certify a value. */
export function accountExecutionMode(account: ConfiguredAccount, _config: DirectoryConfig | null): "live" | "paper" | "dry_run" | "unknown" {
  return account.execution_evidence?.value || "unknown";
}
