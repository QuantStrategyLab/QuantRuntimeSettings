import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  presentActivation,
  presentHealth,
  evidenceFresh,
  evidenceMissing,
  evidenceStale,
  evidenceConflict,
  activationEvidenceFromLegacyLabel,
  healthEvidenceFromLegacyLabel,
} from "../web/strategy-switch-console/frontend/src/accountStatus.ts";
import {
  classifyAccountCashSign,
  cashSignNote,
  getPlatformAdapter,
} from "../web/strategy-switch-console/frontend/src/platformAdapters.ts";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const bindingId = "b".repeat(64);

function lbFacts({ financing = true, negative = true, dataStatus = "fresh", binding = "bound", mismatch = false } = {}) {
  const cash = negative
    ? [{ currency: "USD", available_cash: "-12.50", frozen_cash: "0", settling_cash: "0" }]
    : [{ currency: "USD", available_cash: "12.50", frozen_cash: "0", settling_cash: "0" }];
  const row = {
    platform: "longbridge",
    account_key: "sg",
    binding_status: binding,
    identity_status: "partial_identity",
    identity_mismatch: mismatch,
    data_status: dataStatus,
    broker_environment: "live",
    target_id: "sg",
    source_binding_id: bindingId,
    account_scope: "live",
    observation_date: "2026-10-08",
    observed_started_at: "2026-10-08T12:00:00.000Z",
    observed_finished_at: "2026-10-08T12:01:00.000Z",
    balances: [{ currency: "USD", net_assets: "1000", total_cash: negative ? "-12.50" : "12.50" }],
    cash,
    return: { status: "unavailable", reason: "external_cashflow_required" },
  };
  if (financing) {
    row.financing = [{
      currency: "USD",
      max_finance_amount: "1000",
      remaining_finance_amount: "800",
      buy_power: "500",
      risk_level: "0",
    }];
  }
  return row;
}

assert.equal(presentActivation(evidenceFresh("enabled", "test", "")).label, "已启用");
assert.equal(presentActivation(evidenceFresh("disabled", "test", "")).label, "已停用");
assert.equal(presentActivation(evidenceMissing("test", "启用证据未取得")).label, "异常");
assert.equal(presentActivation(evidenceStale("test", "启用证据已过期")).label, "异常");
assert.equal(presentActivation(evidenceConflict("test", "启用状态冲突")).label, "异常");
assert.equal(presentActivation(activationEvidenceFromLegacyLabel("启用未知")).label, "异常");
assert.equal(presentActivation(activationEvidenceFromLegacyLabel("待确认")).label, "异常");
assert.equal(presentHealth(healthEvidenceFromLegacyLabel("等待周期")).label, "健康");
assert.equal(presentHealth(healthEvidenceFromLegacyLabel("健康未知")).label, "异常");

assert.equal(getPlatformAdapter("longbridge").capability().supportsMarginEvidence, true);
assert.equal(getPlatformAdapter("longbridge").capability().canEnable, false);
assert.equal(getPlatformAdapter("ibkr").capability().supportsMarginEvidence, false);
assert.equal(getPlatformAdapter("binance").capability().canResume, true);

const financed = classifyAccountCashSign("longbridge", lbFacts({ financing: true, negative: true }), true);
assert.equal(financed.kind, "financing");
assert.equal(financed.detail, "融资占用（已核实）");
assert.equal(classifyAccountCashSign("longbridge", lbFacts({ financing: false, negative: true }), true).kind, "unverified");
assert.equal(classifyAccountCashSign("longbridge", lbFacts({ financing: true, negative: true, dataStatus: "stale" }), true).kind, "unverified");
assert.equal(classifyAccountCashSign("ibkr", null, true).detail, "负现金未核实");
assert.equal(classifyAccountCashSign("longbridge", lbFacts({ negative: false }), false).kind, "non_negative");
assert.equal(cashSignNote(classifyAccountCashSign("longbridge", lbFacts({ negative: false }), false)), "");

const overview = readFileSync(join(root, "web/strategy-switch-console/frontend/src/OverviewPage.tsx"), "utf8");
assert.doesNotMatch(overview, /classifyAccountCashSign|cashSignNote|融资占用（已核实）|负现金未核实/);
assert.match(overview, /overviewActivationLabel/);
assert.doesNotMatch(overview, /presentActivation/);
assert.doesNotMatch(overview, /可能是借的钱/);
const adapters = readFileSync(join(root, "web/strategy-switch-console/frontend/src/platformAdapters.ts"), "utf8");
assert.match(adapters, /classifyAccountCashSign/);
assert.match(adapters, /融资占用（已核实）/);
assert.doesNotMatch(overview, /function negativeCashStatusForPlatform/);
assert.doesNotMatch(overview, /启用未知/);
assert.doesNotMatch(overview, /健康未知/);

console.log("account_status_layers_validation ok");
