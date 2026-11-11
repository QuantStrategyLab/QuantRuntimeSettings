/** Bounded sender-log projection. No send, writes, joins or receiver claims. */
import { notificationLog } from "./operations.js";
import { RECEIPT_READ_ERROR_CODES } from "./notification_receipts.js";

const READ_STATUSES = ["complete", "partial", "no_data", "unknown", "read_failed", "not_connected"];
const REASONS = ["run_listing_coverage_unknown", "run_listing_truncated", "run_listing_incomplete",
  "notification_receipts_read_failed", "receipt_missing", "receipt_expired", "sender_skipped",
  "no_completed_workflow_runs", "notification_log_not_connected", "invalid_notification_log"];
const SENDER_STATUSES = ["route_check", "dry_run", "blocked_missing_secrets", "delivered", "send_failed",
  "skipped_duplicate", "blocked_resend_guard", "business_digest_failed", "skipped_empty",
  "receipt_missing", "receipt_expired", "sender_skipped", "read_failed", "unknown"];
const timestamp = value => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19) ? value : null;
};
const date = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && timestamp(`${value}T00:00:00Z`) ? value : null;
const bool = value => typeof value === "boolean" ? value : null;
const id = value => Number.isSafeInteger(value) && value > 0 ? value : null;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

export async function deskDelivery(env, deps, now = Date.now) {
  let log;
  try { log = await notificationLog(env, deps); }
  catch { log = { read_status: "read_failed", read_reason_codes: ["notification_receipts_read_failed"], items: [] }; }
  const valid = object(log) && READ_STATUSES.includes(log.read_status)
    && Array.isArray(log.items) && log.items.length <= 5 && log.items.every(object)
    && Array.isArray(log.read_reason_codes);
  const readStatus = valid ? log.read_status : "unknown";
  const reason = readStatus === "read_failed" ? "read_failed"
    : ["not_connected", "no_data"].includes(readStatus) ? "source_unavailable" : "not_supported";
  return {
    ok: true, schema_version: "qsl.desk.alert_delivery.v1", generated_at: new Date(now()).toISOString(),
    channel: { name: "telegram", status: { status: "unknown", reason } },
    last_delivery: null, digest: null,
    source: {
      read_status: readStatus,
      read_reason_codes: valid ? [...new Set(log.read_reason_codes.filter(code => REASONS.includes(code)))] : ["invalid_notification_log"],
      as_of: valid ? timestamp(log.as_of) : null,
      items: valid ? log.items.map(item => ({
        source_run_id: id(item.source_run_id), source_run_attempt: id(item.source_run_attempt),
        workflow_updated_at: timestamp(item.workflow_updated_at), business_day: date(item.business_day), report_date: date(item.report_date),
        sender_status: SENDER_STATUSES.includes(item.status) ? item.status : "unknown",
        sender_accepted: bool(item.delivered), dry_run: bool(item.dry_run), test_message: bool(item.test_message),
        receiver_ack: "unknown", read_error_code: RECEIPT_READ_ERROR_CODES.includes(item.read_error_code) ? item.read_error_code : null,
      })) : [],
    },
  };
}
