import type { Ribbon } from "../../contract/types";
import { NOW } from "./shared.ts";

export const ok = {
  ok: true,
  schema_version: "qsl.desk.ribbon.v1",
  generated_at: NOW,
  date: "2026-11-02",
  console_state: { mode: "live", gateways: { status: "known", value: "all_reachable", observed_at: "2026-11-02T14:31:48Z" } },
  alert_badge: { open_count: 3, critical_count: 1 },
  sessions: [
    { market: "US", state: "open", open_utc: "14:30", close_utc: "21:00", next_change_at: "2026-11-02T21:00:00Z", holiday: null },
    { market: "HK", state: "closed", open_utc: "01:30", close_utc: "08:00", next_change_at: "2026-11-03T01:30:00Z", holiday: null },
    { market: "CN", state: "closed", open_utc: "01:30", close_utc: "07:00", next_change_at: "2026-11-03T01:30:00Z", holiday: null },
  ],
  next_run: { target_id: "ibkr/tqqq", kind: "pre_close_check", due_at: "2026-11-02T20:55:00Z" },
  tape: [
    { id: "sched_demo_0006", at: "2026-11-02T20:55:00Z", target_id: "ibkr/tqqq", label: "pre-close check", kind: "pre_close_check", outcome: null, outcome_detail: null, state: "scheduled" },
    { id: "run_demo_0005", at: "2026-11-02T14:30:00Z", target_id: "binance/spot", label: "BTC DCA", kind: "dca", outcome: "filled", outcome_detail: "1 fill", state: "done" },
    { id: "run_demo_0004", at: "2026-11-02T14:25:00Z", target_id: "ibkr/tqqq", label: "intraday check", kind: "intraday_check", outcome: "no_op", outcome_detail: null, state: "done" },
    { id: "run_demo_0003", at: "2026-11-02T13:55:00Z", target_id: "ibkr/soxl", label: "rebalance check", kind: "rebalance_check", outcome: "no_op", outcome_detail: null, state: "done" },
    { id: "run_demo_0002", at: "2026-11-02T09:05:00Z", target_id: "longbridge/hk", label: "HK close cycle", kind: "close_cycle", outcome: "drift", outcome_detail: "2 fields differ", state: "done" },
    { id: "run_demo_0001", at: "2026-11-02T06:05:00Z", target_id: "schwab/core", label: "pre-open check", kind: "pre_open_check", outcome: "no_op", outcome_detail: null, state: "done" },
  ],
} satisfies Ribbon;

/** Calendar and gateways unreadable; one run missed, one unknown. Unknown never shows as DOWN. */
export const degraded = {
  ...ok,
  console_state: { mode: "live", gateways: { status: "unknown", reason: "read_failed", observed_at: null } },
  alert_badge: { open_count: 4, critical_count: 1 },
  sessions: [
    { market: "US", state: "unknown", open_utc: null, close_utc: null, next_change_at: null, holiday: null },
    { market: "HK", state: "closed", open_utc: "01:30", close_utc: "08:00", next_change_at: "2026-11-03T01:30:00Z", holiday: null },
    { market: "CN", state: "unknown", open_utc: null, close_utc: null, next_change_at: null, holiday: null },
  ],
  next_run: null,
  tape: [
    { id: "run_demo_0005", at: "2026-11-02T14:30:00Z", target_id: "binance/spot", label: "BTC DCA", kind: "dca", outcome: null, outcome_detail: null, state: "unknown" },
    { id: "run_demo_0002", at: "2026-11-02T09:05:00Z", target_id: "longbridge/hk", label: "HK close cycle", kind: "close_cycle", outcome: null, outcome_detail: null, state: "missed" },
  ],
} satisfies Ribbon;
