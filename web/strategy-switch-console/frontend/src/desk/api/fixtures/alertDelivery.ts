import type { AlertDelivery } from "../../contract/types";
import { NOW } from "./shared.ts";

/** §3.18 delivery state of the alert channel, plus the daily digest's last composition. */
export const ok = {
  ok: true,
  schema_version: "qsl.desk.alert_delivery.v1",
  generated_at: NOW,
  channel: { name: "QuantSentinel · Telegram", status: { status: "known", value: "ok", observed_at: "2026-11-02T14:31:50Z" } },
  last_delivery: { at: "2026-11-02T06:00:04Z", outcome: "ok", recipients: 1 },
  digest: { schedule_utc: "06:00", last_composed_at: "2026-11-02T06:00:00Z", targets: 7, runs: 11 },
} satisfies AlertDelivery;

/**
 * The channel could not be read. An unknown delivery is never shown as "failing".
 * Carries the v1 sender-log `source` the live adapter returns: a partial read with
 * synthetic run numbers. Sender acceptance stays sender-side; receiver_ack is unknown.
 * The shared reader sets a source-level diagnostic only when the run listing itself fails,
 * so this partial read carries the explicit "unknown" fallback, separate from row codes.
 */
export const degraded = {
  ...ok,
  channel: { name: "QuantSentinel · Telegram", status: { status: "unknown", reason: "read_failed", observed_at: null } },
  last_delivery: null,
  digest: null,
  source: {
    read_status: "partial",
    read_error_code: "unknown",
    read_reason_codes: ["receipt_missing", "receipt_expired"],
    as_of: "2026-11-02T14:31:00Z",
    items: [
      { source_run_id: 1001, source_run_attempt: 1, workflow_updated_at: "2026-11-02T06:01:10Z", business_day: "2026-11-02",
        report_date: "2026-11-02", sender_status: "delivered", sender_accepted: true, dry_run: false, test_message: false,
        receiver_ack: "unknown", read_error_code: null },
      { source_run_id: 1002, source_run_attempt: 2, workflow_updated_at: null, business_day: "2026-11-01",
        report_date: null, sender_status: "receipt_missing", sender_accepted: null, dry_run: null, test_message: null,
        receiver_ack: "unknown", read_error_code: "public_receipt_missing" },
      { source_run_id: null, source_run_attempt: null, workflow_updated_at: null, business_day: null,
        report_date: null, sender_status: "receipt_expired", sender_accepted: null, dry_run: true, test_message: true,
        receiver_ack: "unknown", read_error_code: null },
    ],
  },
} satisfies AlertDelivery;
