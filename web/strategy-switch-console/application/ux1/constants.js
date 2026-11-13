export const UX1_CALCULATOR_DEADLINE_MS = 30000;
export const UX1_CALCULATOR_MAX_BYTES = 65536;
export const UX1_RESEARCH_REPOSITORY = "QuantStrategyLab/UsEquityStrategies";
export const UX1_RESEARCH_WORKFLOW_FILE = "ux1-research-preview.yml";
export const UX1_RESEARCH_WORKFLOW_PATH = ".github/workflows/ux1-research-preview.yml";
export const UX1_JOB_BODY_MAX_BYTES = 80 * 1024;
export const UX1_GITHUB_DEADLINE_MS = 8000;
export const UX1_GITHUB_MAX_BYTES = 65536;
export const UX1_JOB_UNKNOWN_AFTER_MS = 30 * 60 * 1000;
export const UX1_PUBLIC_JOB_REASONS = new Set([
  "dispatch_rejected",
  "dispatch_unconfirmed",
  "input_unavailable",
  "calculator_failed",
  "check_required",
  "config_changed",
]);
