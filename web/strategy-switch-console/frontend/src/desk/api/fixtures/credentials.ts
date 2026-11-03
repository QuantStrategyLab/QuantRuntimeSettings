import type { CredentialItem, Credentials } from "../../contract/types";
import { NOW } from "./shared.ts";

const item = (value: CredentialItem): CredentialItem => value;

export const ok = {
  ok: true,
  schema_version: "qsl.desk.credentials.v1",
  generated_at: NOW,
  items: [
    item({
      id: "cred_ibkr_flex",
      platform: "ibkr",
      label: "IBKR Flex (shared)",
      kind: "flex_token",
      expiry: { status: "known", at: "2026-11-09T17:30:00Z", source: "operator_registered" },
      limit_days: 30,
      phase: "7",
      requires_action: true,
      rotation: { supported: true, route: "/health#credential-rotation" },
      runbook: "docs/credential-maintenance.zh-CN.md",
      last_rotated_at: "2026-09-09T17:30:00Z",
    }),
    item({
      id: "cred_schwab_oauth",
      platform: "schwab",
      label: "Schwab refresh token",
      kind: "oauth_refresh",
      expiry: { status: "known", at: "2026-11-03T17:30:00Z", source: "broker_metadata" },
      limit_days: 7,
      phase: "1",
      requires_action: true,
      rotation: { supported: false, route: null },
      runbook: null,
      last_rotated_at: null,
    }),
    item({
      id: "cred_longbridge_access",
      platform: "longbridge",
      label: "LongBridge access token",
      kind: "access_token",
      expiry: { status: "known", at: "2026-12-02T00:00:00Z", source: "broker_metadata" },
      limit_days: 30,
      phase: "30",
      requires_action: true,
      rotation: { supported: false, route: null },
      runbook: null,
      last_rotated_at: "2026-11-02T00:00:00Z",
    }),
    item({
      id: "cred_firstrade_password",
      platform: "firstrade",
      label: "Firstrade password",
      kind: "password",
      expiry: { status: "known", at: "2026-11-01T00:00:00Z", source: "operator_registered" },
      limit_days: 7,
      phase: "expired",
      requires_action: true,
      rotation: { supported: false, route: null },
      runbook: null,
      last_rotated_at: null,
    }),
    item({
      id: "cred_binance_api",
      platform: "binance",
      label: "Binance API key",
      kind: "api_key",
      expiry: { status: "unknown", reason: "never_read" },
      limit_days: null,
      phase: "unknown",
      requires_action: false,
      rotation: { supported: false, route: null },
      runbook: null,
      last_rotated_at: null,
    }),
    item({
      id: "cred_longbridge_session",
      platform: "longbridge",
      label: "LongBridge session",
      kind: "session",
      expiry: { status: "none" },
      limit_days: null,
      phase: "not_due",
      requires_action: false,
      rotation: { supported: false, route: null },
      runbook: null,
      last_rotated_at: null,
    }),
  ],
} satisfies Credentials;

export const degraded = {
  ...ok,
  items: [
    ok.items[0],
    { ...ok.items[1], expiry: { status: "unknown", reason: "read_failed" }, phase: "unknown", requires_action: false },
    ok.items[2],
    { ...ok.items[3], expiry: { status: "unknown", reason: "source_unavailable" }, phase: "unknown", requires_action: false },
    { ...ok.items[4], expiry: { status: "unknown", reason: "source_unavailable" } },
    ok.items[5],
  ],
} satisfies Credentials;

export const empty = {
  ...ok,
  items: [],
} satisfies Credentials;
