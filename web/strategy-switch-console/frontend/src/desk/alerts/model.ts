/**
 * Pure model behind the alerts page: filter counts and the order the owner reads them in.
 * Kept out of the component so the rules can be tested without rendering.
 */
import type { AlertItem, Severity } from "../contract/types";

export type SeverityFilter = "all" | Severity;

/** Open first, then by severity, then by the most recent sighting. */
const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info"];

export function sortAlerts(items: AlertItem[]): AlertItem[] {
  return [...items].sort((left, right) => {
    if (left.status !== right.status) return left.status === "open" ? -1 : 1;
    const severity = SEVERITY_ORDER.indexOf(left.severity) - SEVERITY_ORDER.indexOf(right.severity);
    if (severity !== 0) return severity;
    return right.last_seen_at.localeCompare(left.last_seen_at);
  });
}

/** Counts come from the items on screen, not from a second read of the store. */
export function filterCounts(items: AlertItem[]): Record<SeverityFilter, number> {
  return {
    all: items.length,
    critical: items.filter(item => item.severity === "critical").length,
    warning: items.filter(item => item.severity === "warning").length,
    info: items.filter(item => item.severity === "info").length,
  };
}

/** A resolved alert shows its resolution; an open one shows first and last sighting. */
export function alertWhen(item: AlertItem): { kind: "resolved" | "range" | "once"; first: string; last: string } {
  const clock = (iso: string): string => iso.slice(11, 16);
  if (item.status === "resolved" && item.resolved_at) {
    return { kind: "resolved", first: clock(item.first_seen_at), last: clock(item.resolved_at) };
  }
  if (item.first_seen_at === item.last_seen_at) {
    return { kind: "once", first: clock(item.first_seen_at), last: clock(item.last_seen_at) };
  }
  return { kind: "range", first: clock(item.first_seen_at), last: clock(item.last_seen_at) };
}
