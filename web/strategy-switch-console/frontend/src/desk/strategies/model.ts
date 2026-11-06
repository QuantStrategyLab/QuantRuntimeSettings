/**
 * Strategy page model: catalog filters and the five-step switch state machine.
 * The machine is mock-only; no step dispatches anything. Blocked catalog entries
 * never reach the preview step, and a disabled confirm never reaches verify.
 */
import type { Eligibility, Mode, Read, StrategyOption, StrategyRef } from "../contract/types";

export type StrategyFilter = "all" | "eligible" | "paper" | "blocked";
export const STRATEGY_FILTERS: readonly StrategyFilter[] = ["all", "eligible", "paper", "blocked"];

/** "Paper only" covers a no-live entry or an eligible entry whose modes exclude live. */
export function isPaperOnly(option: StrategyOption): boolean {
  if (option.eligibility === "no_live") return true;
  return option.eligibility === "eligible"
    && option.allowed_execution_modes.includes("paper")
    && !option.allowed_execution_modes.includes("live");
}

/** Counts are over catalog entries, not running targets. */
export function catalogCounts(options: readonly StrategyOption[]): Record<StrategyFilter, number> {
  const counts: Record<StrategyFilter, number> = { all: options.length, eligible: 0, paper: 0, blocked: 0 };
  for (const option of options) {
    if (option.eligibility === "eligible") counts.eligible += 1;
    if (option.eligibility === "blocked") counts.blocked += 1;
    if (isPaperOnly(option)) counts.paper += 1;
  }
  return counts;
}

export function filterCatalog(options: readonly StrategyOption[], filter: StrategyFilter): StrategyOption[] {
  if (filter === "eligible") return options.filter(option => option.eligibility === "eligible");
  if (filter === "paper") return options.filter(isPaperOnly);
  if (filter === "blocked") return options.filter(option => option.eligibility === "blocked");
  return [...options];
}

export type SwitchStep = "target" | "strategy" | "preview" | "confirm" | "verify";
export const SWITCH_STEPS: readonly SwitchStep[] = ["target", "strategy", "preview", "confirm", "verify"];

export interface StrategyPreview {
  targetId: string;
  profile: string;
  current: Read<StrategyRef> | null;
  after: StrategyOption;
  mode: Mode | null;
}

export interface StrategyFlowState {
  step: SwitchStep;
  targetId: string | null;
  profile: string | null;
  preview: StrategyPreview | null;
  blockedReason: string | null;
  forbidden: boolean;
}

export const INITIAL_STRATEGY_FLOW: StrategyFlowState = {
  step: "target",
  targetId: null,
  profile: null,
  preview: null,
  blockedReason: null,
  forbidden: false,
};

export type StrategyFlowAction =
  | { type: "select_target"; targetId: string }
  | { type: "select_strategy"; profile: string; eligibility: Eligibility; reason: string | null }
  | { type: "preview_ready"; preview: StrategyPreview }
  | { type: "request_confirm"; allowed: boolean; reason: string | null }
  | { type: "forbidden" }
  | { type: "back" }
  | { type: "reset" };

export function previousStep(step: SwitchStep): SwitchStep {
  const index = SWITCH_STEPS.indexOf(step);
  return index <= 0 ? "target" : SWITCH_STEPS[index - 1];
}

export function strategyFlowReducer(state: StrategyFlowState, action: StrategyFlowAction): StrategyFlowState {
  switch (action.type) {
    case "select_target":
      return { ...INITIAL_STRATEGY_FLOW, step: "strategy", targetId: action.targetId };
    case "select_strategy": {
      if (!state.targetId) return state;
      if (action.eligibility === "blocked") {
        return { ...state, step: "strategy", profile: action.profile, preview: null, blockedReason: action.reason ?? "blocked", forbidden: false };
      }
      return { ...state, step: "preview", profile: action.profile, preview: null, blockedReason: null, forbidden: false };
    }
    case "preview_ready":
      if (state.step !== "preview" || !state.profile || !state.targetId) return state;
      return { ...state, step: "confirm", preview: action.preview, blockedReason: null };
    case "request_confirm":
      if (state.step !== "confirm") return state;
      if (!action.allowed) return { ...state, blockedReason: action.reason ?? "not_enabled" };
      return { ...state, step: "verify", blockedReason: null };
    case "forbidden":
      return { ...state, step: "confirm", forbidden: true, blockedReason: "forbidden" };
    case "back": {
      const step = previousStep(state.step);
      return { ...state, step, preview: state.step === "confirm" ? null : state.preview, blockedReason: null, forbidden: false };
    }
    case "reset":
      return INITIAL_STRATEGY_FLOW;
    default:
      return state;
  }
}
