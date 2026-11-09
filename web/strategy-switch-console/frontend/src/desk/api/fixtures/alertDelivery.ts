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

/** The channel could not be read. An unknown delivery is never shown as "failing". */
export const degraded = {
  ...ok,
  channel: { name: "QuantSentinel · Telegram", status: { status: "unknown", reason: "read_failed", observed_at: null } },
  last_delivery: null,
  digest: null,
} satisfies AlertDelivery;
