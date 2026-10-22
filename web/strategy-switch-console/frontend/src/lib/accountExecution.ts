import type { StrategySummary } from "../api/contracts";
import { accountOption, type DirectoryConfig } from "./accountDirectory";

type ConfiguredAccount = StrategySummary["strategies"][number]["configured_accounts"][number];

/** Display only: live submission to a paper broker is paper trading, not real funds. */
export function accountExecutionMode(account: ConfiguredAccount, config: DirectoryConfig | null): "live" | "paper" | "dry_run" | "unknown" {
  if (account.dry_run_only === true || account.execution_mode === "dry_run") return "dry_run";
  if (account.execution_mode === "paper") return "paper";
  if (account.execution_mode !== "live") return "unknown";
  const environment = accountOption(config, account.platform, account.account_alias)?.broker_environment;
  if (environment === "paper") return "paper";
  if (environment === "live" && account.live_status === "configured_live" && account.dry_run_only === false) return "live";
  return "unknown";
}
