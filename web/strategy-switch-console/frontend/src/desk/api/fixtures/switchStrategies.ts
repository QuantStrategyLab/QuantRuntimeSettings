import type { StrategyOption, SwitchStrategies } from "../../contract/types";
import { NOW } from "./shared.ts";

const option = (value: StrategyOption): StrategyOption => value;

const DOMAINS: Record<string, string> = {
  "ibkr/tqqq": "us_equity",
  "ibkr/soxl": "us_equity",
  "schwab/core": "us_equity",
  "firstrade/income": "us_equity",
  "longbridge/hk": "hk_equity",
  "binance/spot": "crypto",
};

export function domainFor(targetId: string): string {
  return DOMAINS[targetId] ?? "us_equity";
}

export const ok = {
  ok: true,
  schema_version: "qsl.desk.switch_strategies.v1",
  generated_at: NOW,
  target_id: "ibkr/tqqq",
  domain: "us_equity",
  catalog_revision: "demo-2026-11-02",
  strategies: [
    option({
      profile: "tqqq_growth_income",
      label: "TQQQ Growth Income",
      domain: "us_equity",
      eligibility: "eligible",
      reason: null,
      allowed_execution_modes: ["dry_run", "paper", "live"],
      lifecycle_stage: "live",
      option_overlay_enabled: true,
      dca_supported: false,
    }),
    option({
      profile: "tqqq_core_only_p2_v9_benchmark_drawdown_guard",
      label: "TQQQ Benchmark Drawdown Guard",
      domain: "us_equity",
      eligibility: "eligible",
      reason: null,
      allowed_execution_modes: ["dry_run", "paper"],
      lifecycle_stage: "research",
      dca_supported: false,
    }),
    option({
      profile: "soxl_soxx_trend_income",
      label: "Semiconductor Trend Income",
      domain: "us_equity",
      eligibility: "no_live",
      reason: "research_only",
      allowed_execution_modes: ["dry_run", "paper"],
      lifecycle_stage: "paper",
      dca_supported: false,
    }),
    option({
      profile: "nasdaq_sp500_smart_dca",
      label: "NASDAQ/S&P 500 DCA",
      domain: "us_equity",
      eligibility: "eligible",
      reason: null,
      allowed_execution_modes: ["dry_run", "paper", "live"],
      lifecycle_stage: "live",
      dca_supported: true,
    }),
    option({
      profile: "us_equity_combo_core",
      label: "US Core Combo",
      domain: "us_equity",
      eligibility: "eligible",
      reason: null,
      allowed_execution_modes: ["dry_run", "paper", "live"],
      lifecycle_stage: "live",
      dca_supported: false,
    }),
    option({
      profile: "crypto_btc_dca",
      label: "BTC DCA",
      domain: "us_equity",
      eligibility: "blocked",
      reason: "wrong_domain",
      allowed_execution_modes: ["dry_run", "paper"],
      lifecycle_stage: "blocked",
      dca_supported: true,
    }),
  ],
} satisfies SwitchStrategies;

export const degraded = {
  ...ok,
  catalog_revision: "demo-2026-10-31",
} satisfies SwitchStrategies;

export const empty = {
  ...ok,
  strategies: [],
} satisfies SwitchStrategies;

/** The mock catalog follows the selected target; only the domain and target id change. */
export function forTarget(targetId: string, scenario: "ok" | "degraded"): SwitchStrategies {
  const base = scenario === "degraded" ? degraded : ok;
  return { ...base, target_id: targetId, domain: domainFor(targetId) };
}
