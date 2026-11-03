import type { Accounts, BrokerHealth, CredentialSummary } from "../../contract/types";
import { NOW } from "./shared.ts";

const READ_AT = "2026-11-02T14:31:12Z";
const HEARTBEAT_AT = "2026-11-02T14:31:48Z";
const known = <T,>(value: T, observed_at = READ_AT) => ({ status: "known" as const, value, observed_at });

const credential = (
  kind: CredentialSummary["kind"],
  expiry: CredentialSummary["expiry"],
  phase: CredentialSummary["phase"],
  requires_action: boolean,
  note?: string,
): CredentialSummary => ({ kind, expiry, phase, requires_action, ...(note ? { note } : {}) });

const ibkr: BrokerHealth = {
  platform: "ibkr",
  label: "IBKR",
  targets: [
    { target_id: "ibkr/tqqq", account_ref: "U•••0001" },
    { target_id: "ibkr/soxl", account_ref: "U•••0002" },
  ],
  connectivity: known("up"),
  connectivity_detail: null,
  heartbeat: known({ at: HEARTBEAT_AT }),
  data_freshness: { data_status: "ready", age_seconds: 367 },
  config: { state: "synced", drift_count: 0, checked_at: READ_AT },
  credential: credential("flex_token", { status: "known", at: "2026-11-09T17:30:00Z", source: "operator_registered" }, "7", true),
  last_order: known({ at: "2026-11-02T14:25:00Z", count: 2 }),
};

const schwab: BrokerHealth = {
  platform: "schwab",
  label: "Schwab",
  targets: [{ target_id: "schwab/core", account_ref: "S•••0003" }],
  connectivity: known("up"),
  connectivity_detail: null,
  heartbeat: known({ at: HEARTBEAT_AT }),
  data_freshness: { data_status: "ready", age_seconds: 367 },
  config: { state: "synced", drift_count: 0, checked_at: READ_AT },
  credential: credential("oauth_refresh", { status: "known", at: "2026-11-03T17:30:00Z", source: "broker_metadata" }, "1", true),
  last_order: known({ at: "2026-11-02T06:05:00Z", count: 1 }),
};

const longbridge: BrokerHealth = {
  platform: "longbridge",
  label: "LongBridge",
  targets: [{ target_id: "longbridge/hk", account_ref: "LB•••0005" }],
  connectivity: known("degraded"),
  connectivity_detail: "One heartbeat missed; the last read is still fresh.",
  heartbeat: known({ at: HEARTBEAT_AT }),
  data_freshness: { data_status: "ready", age_seconds: 367 },
  config: { state: "drift", drift_count: 2, checked_at: READ_AT },
  credential: credential("access_token", { status: "known", at: "2026-12-02T00:00:00Z", source: "broker_metadata" }, "30", true),
  last_order: known({ at: "2026-11-02T09:05:00Z", count: 3 }),
};

const firstrade: BrokerHealth = {
  platform: "firstrade",
  label: "Firstrade",
  targets: [{ target_id: "firstrade/income", account_ref: "F•••0004" }],
  connectivity: known("up"),
  connectivity_detail: null,
  heartbeat: known({ at: HEARTBEAT_AT }),
  data_freshness: { data_status: "ready", age_seconds: 367 },
  config: { state: "synced", drift_count: 0, checked_at: READ_AT },
  credential: credential("password", { status: "known", at: "2026-11-01T00:00:00Z", source: "operator_registered" }, "expired", true),
  last_order: known({ at: "2026-10-30T19:45:00Z", count: 4 }),
};

const binance: BrokerHealth = {
  platform: "binance",
  label: "Binance",
  targets: [{ target_id: "binance/spot", account_ref: "BN•••0006" }],
  connectivity: known("up"),
  connectivity_detail: null,
  heartbeat: known({ at: HEARTBEAT_AT }),
  data_freshness: { data_status: "ready", age_seconds: 367 },
  config: { state: "synced", drift_count: 0, checked_at: READ_AT },
  credential: credential("api_key", { status: "unknown", reason: "never_read" }, "unknown", false, "No expiry source yet."),
  last_order: known({ at: "2026-11-02T14:30:00Z", count: 1 }),
};

export const ok = {
  ok: true,
  schema_version: "qsl.desk.accounts.v1",
  generated_at: NOW,
  brokers: [ibkr, schwab, longbridge, firstrade, binance],
} satisfies Accounts;

export const degraded = {
  ...ok,
  brokers: [
    ibkr,
    schwab,
    { ...longbridge, connectivity: { status: "unknown", reason: "read_failed", observed_at: null }, heartbeat: { status: "unknown", reason: "read_failed", observed_at: null }, data_freshness: { data_status: "stale", age_seconds: 140400 }, config: { state: "unknown", drift_count: 0, checked_at: null } },
    firstrade,
    { ...binance, credential: credential("api_key", { status: "unknown", reason: "read_failed" }, "unknown", false), last_order: { status: "unknown", reason: "read_failed", observed_at: null } },
  ],
} satisfies Accounts;

export const empty = {
  ...ok,
  brokers: [],
} satisfies Accounts;
