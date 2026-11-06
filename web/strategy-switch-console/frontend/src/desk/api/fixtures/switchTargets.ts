import type { SwitchTarget, SwitchTargets } from "../../contract/types";
import { NOW } from "./shared.ts";

const READ_AT = "2026-11-02T14:31:12Z";
const known = <T,>(value: T, observed_at = READ_AT) => ({ status: "known" as const, value, observed_at });

const target = (value: SwitchTarget): SwitchTarget => value;

export const ok = {
  ok: true,
  schema_version: "qsl.desk.switch_targets.v1",
  generated_at: NOW,
  targets: [
    target({
      target_id: "ibkr/tqqq",
      platform: "ibkr",
      platform_label: "IBKR",
      account_ref: "U•••0001",
      account_suffix: "0001",
      mode: known("live"),
      domains: ["us_equity"],
      current_strategy: known({ profile: "tqqq_growth_income", label: "TQQQ Growth Income" }),
      execution_modes: ["dry_run", "paper", "live"],
      switchable: { allowed: false, reason_code: "switch_not_connected" },
      pending_request_id: null,
      stop: { supported: true, resume_supported: true },
    }),
    target({
      target_id: "ibkr/soxl",
      platform: "ibkr",
      platform_label: "IBKR",
      account_ref: "U•••0002",
      account_suffix: "0002",
      mode: known("live"),
      domains: ["us_equity"],
      current_strategy: known({ profile: "soxl_soxx_trend_income", label: "Semiconductor Trend Income" }),
      execution_modes: ["dry_run", "paper", "live"],
      switchable: { allowed: false, reason_code: "switch_not_connected" },
      pending_request_id: null,
      stop: { supported: true, resume_supported: true },
    }),
    target({
      target_id: "schwab/core",
      platform: "schwab",
      platform_label: "Schwab",
      account_ref: "S•••0003",
      account_suffix: "0003",
      mode: known("live"),
      domains: ["us_equity"],
      current_strategy: known({ profile: "us_equity_combo_core", label: "US Core Combo" }),
      execution_modes: ["dry_run", "paper", "live"],
      switchable: { allowed: false, reason_code: "switch_not_connected" },
      pending_request_id: null,
      stop: { supported: true, resume_supported: false },
    }),
    target({
      target_id: "longbridge/hk",
      platform: "longbridge",
      platform_label: "LongBridge",
      account_ref: "LB•••0005",
      account_suffix: "0005",
      mode: known("live"),
      domains: ["hk_equity"],
      current_strategy: known({ profile: "hk_global_etf_tactical_rotation", label: "HK ETF Tactical Rotation" }),
      execution_modes: ["dry_run", "paper"],
      switchable: { allowed: false, reason_code: "switch_not_connected" },
      pending_request_id: null,
      stop: { supported: true, resume_supported: true },
    }),
    target({
      target_id: "binance/spot",
      platform: "binance",
      platform_label: "Binance",
      account_ref: "BN•••0006",
      account_suffix: "0006",
      mode: known("live"),
      domains: ["crypto"],
      current_strategy: known({ profile: "crypto_btc_dca", label: "BTC DCA" }),
      execution_modes: ["dry_run", "paper", "live"],
      switchable: { allowed: false, reason_code: "switch_not_connected" },
      pending_request_id: null,
      stop: { supported: false, resume_supported: false },
    }),
    target({
      target_id: "firstrade/income",
      platform: "firstrade",
      platform_label: "Firstrade",
      account_ref: "F•••0004",
      account_suffix: "0004",
      mode: known("live"),
      domains: ["us_equity"],
      current_strategy: known({ profile: "russell_top50_leader_rotation", label: "Russell Top 50 Leader Rotation" }),
      execution_modes: ["dry_run", "paper", "live"],
      switchable: { allowed: false, reason_code: "switch_not_connected" },
      pending_request_id: null,
      stop: { supported: true, resume_supported: true },
    }),
  ],
} satisfies SwitchTargets;

export const degraded = {
  ...ok,
  targets: [
    ok.targets[0],
    {
      ...ok.targets[1],
      mode: { status: "unknown", reason: "read_failed", observed_at: null },
      current_strategy: { status: "unknown", reason: "identity_unverified", observed_at: null },
      switchable: { allowed: false, reason_code: "identity_incomplete" },
    },
    ok.targets[2],
    ok.targets[3],
    ok.targets[4],
    ok.targets[5],
  ],
} satisfies SwitchTargets;

export const empty = {
  ...ok,
  targets: [],
} satisfies SwitchTargets;
