import {
  DCA_PROFILE_DEFAULTS,
  PLATFORM_CONFIG,
} from "../../config.js";

export const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_CONFIG);
export const LEGACY_CASH_ONLY_EXECUTION_VARIABLE = "CASH_ONLY_EXECUTION";
export const CASH_ONLY_EXECUTION_MODES = ["current", "enabled", "disabled"];
export const INCOME_LAYER_ENABLED_VARIABLE = "INCOME_LAYER_ENABLED";
export const INCOME_LAYER_START_USD_VARIABLE = "INCOME_LAYER_START_USD";
export const INCOME_LAYER_MAX_RATIO_VARIABLE = "INCOME_LAYER_MAX_RATIO";
export const OPTION_OVERLAY_ENABLED_VARIABLE = "OPTION_OVERLAY_ENABLED";
export const RUNTIME_TARGET_ENABLED_VARIABLE = "RUNTIME_TARGET_ENABLED";
export const DCA_MODE_VARIABLE = "DCA_MODE";
export const DCA_BASE_INVESTMENT_VARIABLE = "DCA_BASE_INVESTMENT_USD";
export const IBIT_ZSCORE_EXIT_MODE_VARIABLE = "IBIT_ZSCORE_EXIT_MODE";
export const IBIT_ZSCORE_EXIT_ENABLED_VARIABLE = "IBIT_ZSCORE_EXIT_ENABLED";
export const IBIT_ZSCORE_EXIT_PARKING_SYMBOL_VARIABLE = "IBIT_ZSCORE_EXIT_PARKING_SYMBOL";
export const LEGACY_INCOME_LAYER_CONTROL_FIELDS = [
  "income_threshold_usd",
  "qqqi_income_ratio",
  "income_layer_qqqi_weight",
  "income_layer_spyi_weight",
];
export const LEGACY_INCOME_LAYER_VARIABLES = [
  "INCOME_THRESHOLD_USD",
  "QQQI_INCOME_RATIO",
  "INCOME_LAYER_QQQI_WEIGHT",
  "INCOME_LAYER_SPYI_WEIGHT",
];
export const OPTION_OVERLAY_CONTROL_FIELDS = [
  "option_overlay_enabled",
  "option_growth_overlay_enabled",
  "option_growth_overlay_recipe",
  "option_growth_overlay_start_usd",
  "option_growth_overlay_nav_budget_ratio",
  "option_income_overlay_enabled",
  "option_income_overlay_recipe",
  "option_income_overlay_start_usd",
  "option_income_overlay_nav_risk_ratio",
];
export const OPTION_OVERLAY_VARIABLES = OPTION_OVERLAY_CONTROL_FIELDS.map((field) => field.toUpperCase());
export const OPTION_OVERLAY_PROFILE_FIELDS = [
  ...OPTION_OVERLAY_CONTROL_FIELDS,
  "option_overlay_live_gate",
  "option_overlay_live_status",
];
export const OPTION_OVERLAY_MODES = ["current", "enabled", "disabled"];
export const DCA_PROFILE_CONFIG = Object.fromEntries(
  Object.entries(DCA_PROFILE_DEFAULTS).map(([profile, defaults]) => [
    profile,
    {
      default_mode: defaults.defaultMode || "fixed",
      default_base_investment_usd: defaults.defaultBaseInvestmentUsd || "1000",
    },
  ]),
);
