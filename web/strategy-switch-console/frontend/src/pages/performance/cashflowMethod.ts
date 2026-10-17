import type { CashflowMethodMeta } from "../../api/contracts";

/**
 * Single source for return-method labels, so the summary cards and the returns
 * curve cannot drift apart.
 *
 * - "absent": legacy response without any method fields — old behavior applies.
 * - "dietz_approx": explicit Modified Dietz + approximate:true.
 * - "unknown": the fields exist but are null, unsupported, or inconsistent.
 *   There is no contract evidence that explicit null/false proves an exact TWR,
 *   so such metadata is never shown as an unqualified TWR.
 */
export type CashflowMethodClass = "absent" | "dietz_approx" | "unknown";

export const DIETZ_APPROX_LABEL_KEY = "perf.method_dietz_approx";
export const UNKNOWN_METHOD_LABEL_KEY = "perf.method_unknown";

export function classifyCashflowMethod(meta: CashflowMethodMeta | null | undefined): CashflowMethodClass {
  if (!meta) return "absent";
  const method = meta.cashflow_method;
  const approximate = meta.approximate;
  if (method === undefined && approximate === undefined) return "absent";
  if (method === "modified_dietz" && approximate === true) return "dietz_approx";
  return "unknown";
}

/** True only when the API explicitly marks the figure as a Modified Dietz approximation. */
export function isApproximateDietz(meta: CashflowMethodMeta | null | undefined): boolean {
  return classifyCashflowMethod(meta) === "dietz_approx";
}
