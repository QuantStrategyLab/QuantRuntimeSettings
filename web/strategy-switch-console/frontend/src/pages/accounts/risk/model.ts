import type { Catalog, Level, Parameter, RiskRequest, Value } from "./contracts";

// Presentation metadata only. Economic values always come from the catalog.
export const displayVersion = "risk-parameter-display.v1";
export const definitionVersion = "r-risk-01.research.v2";
export const displaySteps: Record<string, number | null> = {
  target_annual_volatility: .001, max_drawdown_tolerance: .001, daily_cvar95_loss_limit: .0005,
  two_session_cvar95_budget: .0005, kelly_fraction: null, max_symbol_nominal_weight: .001,
  max_leveraged_etf_nominal_weight: .001, max_effective_risk_exposure: .01,
  max_underlying_effective_exposure: .01, max_gross_nominal_weight: null, cash_floor_ratio: .01,
  m1_fee_reserve_ratio: null, strategy_selection_mode: null, strategy_ids: null,
  strategy_weight_mode: null, strategy_weights: .001, rebalance_method: null,
  rebalance_absolute_band: .001, rebalance_relative_band: .01, breaker_daily_loss: .001,
  breaker_drawdown: .001, stop_loss_ratio: .001, take_profit_ratio: .01, trailing_stop_ratio: .001,
  resume_observation_sessions: 1, resume_daily_loss_fraction_of_trigger: .01,
  resume_cvar_vol_fraction_of_limit: .01, upgrade_cooldown_seconds: null,
  confirmation_ttl_seconds: null, benchmark: null,
};
export const isPercent = (p: Parameter) => ["ratio", "absolute_weight_ratio", "fraction_of_target_weight"].includes(p.unit);
export function formatValue(key: string, value: Value | null | undefined, p: Parameter): string | null {
  if (value === null || value === undefined) return null;
  if (key === "kelly_fraction" && typeof value === "number") return value.toFixed(2);
  if (key === "m1_fee_reserve_ratio") return "2/2001 ≈ 0.09995%";
  if (typeof value === "number") {
    if (isPercent(p)) return `${Number((value * 100).toPrecision(12))}${p.unit === "absolute_weight_ratio" ? " pp" : "%"}`;
    return String(value);
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}
export function parseOverride(input: string, p: Parameter): Value {
  if (p.hard_limits.type === "number" || p.hard_limits.type === "integer") {
    if (!input.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(input.trim())) throw new Error("INVALID_REQUEST");
    const n = Number(input);
    if (!Number.isFinite(n)) throw new Error("INVALID_REQUEST");
    // Never round to the display step. Legal non-step values retain their value.
    return isPercent(p) ? n / 100 : n;
  }
  return input;
}
export function validateOverrides(catalog: Catalog, level: Level, overrides: Record<string, Value>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, value] of Object.entries(overrides)) {
    const p = catalog.parameters[key];
    if (!p?.user_override_allowed) { errors[key] = "OVERRIDE_NOT_ALLOWED"; continue; }
    const h = p.hard_limits;
    if ((h.type === "number" || h.type === "integer") && (typeof value !== "number" || !Number.isFinite(value)
      || (h.type === "integer" && !Number.isSafeInteger(value)))) errors[key] = "INVALID_REQUEST";
    else if (h.enum && !h.enum.includes(value)) errors[key] = "ENUM_VIOLATION";
    else if (typeof value === "number" && ((h.minimum !== undefined && value < h.minimum) || (h.maximum !== undefined && value > h.maximum))) errors[key] = "RISK_PARAM_OUT_OF_RANGE";
  }
  const value = (key: string) => overrides[key] ?? catalog.parameters[key]?.defaults_by_level[level];
  if (Number(value("breaker_drawdown")) > Number(value("max_drawdown_tolerance"))) errors.breaker_drawdown = "RISK_PARAM_OUT_OF_RANGE";
  // Strategy lists/weights require a trusted approved directory and remain locked
  // in this readonly version; a mode switch must not create an empty explicit list.
  if (value("strategy_selection_mode") === "explicit" || value("strategy_weight_mode") === "explicit") errors.strategy_selection_mode = "STRATEGY_DIRECTORY_UNBOUND";
  return errors;
}
export function requestPhase(request: RiskRequest | null, serverTime: string, elapsedMs = 0): string {
  if (!request) return "UNKNOWN";
  if (!["COOLDOWN", "AWAITING_FINAL"].includes(request.status)) return request.status;
  const base = Date.parse(serverTime), until = Date.parse(request.cooldown_until_utc || ""), deadline = Date.parse(request.final_confirmation_deadline_utc || "");
  if (![base, until, deadline, elapsedMs].every(Number.isFinite) || until >= deadline || elapsedMs < 0) return "UNKNOWN";
  const now = base + elapsedMs;
  if (now >= deadline) return "REQUEST_EXPIRED";
  if (now < until) return "COOLDOWN";
  return "AWAITING_FINAL";
}
export function confirmationTokenState(request: RiskRequest, serverTime: string): string {
  if (requestPhase(request, serverTime) === "REQUEST_EXPIRED") return "CONFIRMATION_WINDOW_EXPIRED";
  const now = Date.parse(serverTime), expiry = Date.parse(request.token_expiry_utc || "");
  if (![now, expiry].every(Number.isFinite)) return "UNKNOWN";
  return now >= expiry ? "CONFIRMATION_TOKEN_EXPIRED" : "VALID";
}
