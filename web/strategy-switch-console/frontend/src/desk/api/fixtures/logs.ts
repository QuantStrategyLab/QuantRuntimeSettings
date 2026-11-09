import type { Logs } from "../../contract/types";
import { NOW } from "./shared.ts";

/**
 * §3.19 log tail, synthetic and already redacted by the backend. Messages are verbatim
 * operational text: they are rendered as text and never translated.
 */
export const ok = {
  ok: true,
  schema_version: "qsl.desk.logs.v1",
  generated_at: NOW,
  items: [
    { id: "log_demo_0011", at: "2026-11-02T14:32:07Z", level: "info", source: "control-plane", run_id: null,
      message: "desk read model refreshed (overview, ribbon, alerts)" },
    { id: "log_demo_0010", at: "2026-11-02T14:30:02Z", level: "info", source: "binance/spot", run_id: "run_demo_0005",
      message: "DCA order filled: 1 fill, 0.0012 BTC" },
    { id: "log_demo_0009", at: "2026-11-02T14:26:41Z", level: "warn", source: "longbridge/hk", run_id: "run_demo_0002",
      message: "config drift detected: enabled, reserved_cash_ratio" },
    { id: "log_demo_0008", at: "2026-11-02T14:25:10Z", level: "info", source: "ibkr/tqqq", run_id: "run_demo_0004",
      message: "intraday check: nothing to do" },
    { id: "log_demo_0007", at: "2026-11-02T13:55:22Z", level: "info", source: "ibkr/soxl", run_id: "run_demo_0003",
      message: "rebalance check: nothing to do" },
    { id: "log_demo_0006", at: "2026-11-02T13:55:20Z", level: "warn", source: "control-plane", run_id: "run_demo_0003",
      message: "drawdown near limit: -0.141 against -0.150" },
    { id: "log_demo_0005", at: "2026-11-02T09:05:03Z", level: "error", source: "longbridge/hk", run_id: "run_demo_0002",
      message: "close cycle finished with drift: 2 fields differ" },
    { id: "log_demo_0004", at: "2026-11-02T06:05:01Z", level: "info", source: "schwab/core", run_id: "run_demo_0001",
      message: "pre-open check: nothing to do" },
    { id: "log_demo_0003", at: "2026-11-02T06:00:04Z", level: "info", source: "digest", run_id: "run_demo_0001",
      message: "digest delivered to 1 chat (7 targets, 11 runs)" },
    { id: "log_demo_0002", at: "2026-11-02T06:00:00Z", level: "debug", source: "digest", run_id: "run_demo_0001",
      message: "digest composed from 11 runs" },
    { id: "log_demo_0001", at: "2026-11-02T05:58:30Z", level: "info", source: "account-facts", run_id: null,
      message: "account facts snapshot stored for 6 accounts" },
  ],
  next_cursor: null,
  retention: { days: 90, truncated: false },
  redaction: "applied",
} satisfies Logs;

/** A partial tail: the store returned one page and flagged the retention window as cut. */
export const degraded = {
  ...ok,
  items: ok.items.slice(0, 4),
  next_cursor: "cursor_demo_0004",
  retention: { days: 90, truncated: true },
} satisfies Logs;
