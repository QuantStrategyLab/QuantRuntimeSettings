import type { Alerts } from "../../contract/types";
import { NOW } from "./shared.ts";

/**
 * §3.17 alerts, synthetic. Five entries: three open (one critical, two warning) and two
 * resolved (both info). Chips and counts come from the response, never from the item list
 * the page happens to hold.
 */
export const ok = {
  ok: true,
  schema_version: "qsl.desk.alerts.v1",
  generated_at: NOW,
  counts: { open: 3, critical: 1, warning: 2, info: 2, last_7d_total: 34 },
  items: [
    {
      id: "alert_demo_0005", severity: "critical", status: "open", kind: "config_drift",
      target_id: "longbridge/hk", source: "account-facts",
      title: "alerts.mock.config_drift.title",
      detail: "alerts.mock.config_drift.detail",
      first_seen_at: "2026-11-02T14:26:00Z", last_seen_at: "2026-11-02T14:31:00Z", resolved_at: null,
      route: "#/desk/accounts?tab=brokers&target=longbridge/hk", log_ref: { run_id: "run_demo_0002" },
    },
    {
      id: "alert_demo_0004", severity: "warning", status: "open", kind: "credential_expiring",
      target_id: "schwab/core", source: "control-plane",
      title: "alerts.mock.credential_expiring.title",
      detail: "alerts.mock.credential_expiring.detail",
      first_seen_at: "2026-11-02T06:00:00Z", last_seen_at: "2026-11-02T06:00:00Z", resolved_at: null,
      route: "#/desk/accounts?tab=credentials", log_ref: null,
    },
    {
      id: "alert_demo_0003", severity: "warning", status: "open", kind: "drawdown_near_limit",
      target_id: "ibkr/soxl", source: "control-plane",
      title: "alerts.mock.drawdown_near_limit.title",
      detail: "alerts.mock.drawdown_near_limit.detail",
      first_seen_at: "2026-11-02T13:55:00Z", last_seen_at: "2026-11-02T13:55:00Z", resolved_at: null,
      route: "#/desk/switch?target=ibkr/soxl", log_ref: { run_id: "run_demo_0003" },
    },
    {
      id: "alert_demo_0002", severity: "info", status: "resolved", kind: "digest",
      target_id: null, source: "digest",
      title: "alerts.mock.digest.title",
      detail: "alerts.mock.digest.detail",
      first_seen_at: "2026-11-02T06:00:00Z", last_seen_at: "2026-11-02T06:00:04Z", resolved_at: "2026-11-02T06:00:04Z",
      route: null, log_ref: { run_id: "run_demo_0001" },
    },
    {
      id: "alert_demo_0001", severity: "info", status: "resolved", kind: "candidate_ready",
      target_id: null, source: "research",
      title: "alerts.mock.candidate_ready.title",
      detail: "alerts.mock.candidate_ready.detail",
      first_seen_at: "2026-11-01T21:10:00Z", last_seen_at: "2026-11-02T09:00:00Z", resolved_at: "2026-11-02T09:00:00Z",
      route: null, log_ref: null,
    },
  ],
  next_cursor: null,
} satisfies Alerts;

/** The alert store answered only in part: two items, and counts that match what was read. */
export const degraded = {
  ...ok,
  counts: { open: 1, critical: 1, warning: 0, info: 0, last_7d_total: 0 },
  items: [
    {
      id: "alert_demo_0005", severity: "critical", status: "open", kind: "config_drift",
      target_id: "longbridge/hk", source: "account-facts",
      title: "alerts.mock.config_drift.title",
      detail: "alerts.mock.config_drift.detail",
      first_seen_at: "2026-11-02T14:26:00Z", last_seen_at: "2026-11-02T14:31:00Z", resolved_at: null,
      route: "#/desk/accounts?tab=brokers&target=longbridge/hk", log_ref: null,
    },
  ],
  next_cursor: "cursor_demo_0002",
} satisfies Alerts;
