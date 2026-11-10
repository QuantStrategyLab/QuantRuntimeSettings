/**
 * Pure model behind the alerts page: filter counts and the order the owner reads them in.
 * Kept out of the component so the rules can be tested without rendering.
 */
import type {
  AlertDeliverySource, AlertItem, DeliveryReadReason, DeliveryReadStatus, DeliverySenderStatus, Severity,
} from "../contract/types";

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

// ---------------------------------------------------------------- delivery (sender log)

/** Which part of the page is fixture data. Both mock → "all"; one mock → "partial". */
export function alertsFixtureLabel(sources: readonly ("live" | "mock" | null)[]): "none" | "partial" | "all" {
  const known = sources.filter((source): source is "live" | "mock" => source !== null);
  const mock = known.filter(source => source === "mock").length;
  if (mock === 0) return "none";
  return mock === known.length ? "all" : "partial";
}

export interface DeliveryRowView {
  key: string;
  run: { id: number; attempt: number | null } | null;
  senderKey: `alerts.delivery.sender.${DeliverySenderStatus}`;
  /** Sender-side only. A null stays unknown, never "not accepted". */
  acceptedKey: "alerts.delivery.accepted.yes" | "alerts.delivery.accepted.no" | "alerts.delivery.accepted.unknown";
  /** Always the unknown receiver label: this source has no receiver receipt. */
  receiverKey: "alerts.delivery.receiver_unknown";
  dryRun: boolean;
  testMessage: boolean;
  businessDay: string | null;
  reportDate: string | null;
  workflowUpdatedAt: string | null;
  readErrorCode: string | null;
}

export interface DeliverySourceView {
  readKey: `alerts.delivery.read.${DeliveryReadStatus}`;
  readStatus: DeliveryReadStatus;
  reasonKeys: `alerts.delivery.reason.${DeliveryReadReason}`[];
  asOf: string | null;
  rows: DeliveryRowView[];
}

/** Projects the validated `source` block one row at a time: no merging, counting or inference. */
export function deliverySourceView(source: AlertDeliverySource | undefined): DeliverySourceView | null {
  if (!source) return null;
  return {
    readKey: `alerts.delivery.read.${source.read_status}`,
    readStatus: source.read_status,
    reasonKeys: source.read_reason_codes.map(code => `alerts.delivery.reason.${code}` as const),
    asOf: source.as_of,
    rows: source.items.map((item, index) => ({
      key: `${index}:${item.source_run_id ?? "none"}:${item.source_run_attempt ?? "none"}`,
      run: item.source_run_id === null ? null : { id: item.source_run_id, attempt: item.source_run_attempt },
      senderKey: `alerts.delivery.sender.${item.sender_status}`,
      acceptedKey: item.sender_accepted === true ? "alerts.delivery.accepted.yes"
        : item.sender_accepted === false ? "alerts.delivery.accepted.no" : "alerts.delivery.accepted.unknown",
      receiverKey: "alerts.delivery.receiver_unknown",
      dryRun: item.dry_run === true,
      testMessage: item.test_message === true,
      businessDay: item.business_day,
      reportDate: item.report_date,
      workflowUpdatedAt: item.workflow_updated_at,
      readErrorCode: item.read_error_code,
    })),
  };
}
