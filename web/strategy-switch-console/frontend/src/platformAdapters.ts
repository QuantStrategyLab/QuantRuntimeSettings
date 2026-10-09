/**
 * Platform adapters: Capability + cash-sign classification hooks.
 * Generic pipeline calls getPlatformAdapter(platform); pages must not guess financing.
 */

import {
  type AccountFactsAccount,
  longBridgeFinancingDetails,
} from "./types.ts";

export type CashSignKind = "non_negative" | "financing" | "deficit" | "unverified";

export type CashSignClassification = {
  kind: CashSignKind;
  /** Mandarin UI note; empty when non_negative. Never soft hedges like「可能」. */
  detail: string;
  evidenceSource: string;
};

export type Capability = {
  canStop: boolean;
  canResume: boolean;
  canEnable: boolean;
  canSaveDraft: boolean;
  canSaveRisk: boolean;
  cashField: "available_cash" | "cash_balance" | null;
  /** True only when account-facts contract can carry platform financing/margin evidence. */
  supportsMarginEvidence: boolean;
  supportsDailyCycle: boolean;
  supportsWalletValuation: boolean;
};

export type NegativeCashInput = {
  facts: AccountFactsAccount | null | undefined;
  hasNonzeroNegativeCash: boolean;
};

export type PlatformAdapter = {
  platform: string;
  capability(): Capability;
  classifyNegativeCash(input: NegativeCashInput): CashSignClassification;
};

const DISABLED_ACTIVATION: Pick<Capability, "canEnable"> = { canEnable: false };

function baseBrokerCapability(cashField: "available_cash" | "cash_balance"): Capability {
  return {
    canStop: true,
    canResume: false,
    ...DISABLED_ACTIVATION,
    canSaveDraft: true,
    canSaveRisk: true,
    cashField,
    supportsMarginEvidence: false,
    supportsDailyCycle: true,
    supportsWalletValuation: false,
  };
}

function unverifiedNegative(source: string, detail: string): CashSignClassification {
  return { kind: "unverified", detail, evidenceSource: source };
}

function nonNegative(): CashSignClassification {
  return { kind: "non_negative", detail: "", evidenceSource: "holdings.cash" };
}

/**
 * LongBridge: negative available_cash + gated financing[] ⇒ 融资占用（已核实）.
 * Official GET /v1/asset/account returns max_finance_amount / remaining_finance_amount /
 * margins / buy_power / risk_level with cash_infos; QRS maps those into financing[].
 * Without financing evidence → 负现金未核实 (never「可能是借的钱」).
 */
const longBridgeAdapter: PlatformAdapter = {
  platform: "longbridge",
  capability() {
    return {
      ...baseBrokerCapability("available_cash"),
      supportsMarginEvidence: true,
      supportsDailyCycle: true,
    };
  },
  classifyNegativeCash({ facts, hasNonzeroNegativeCash }) {
    if (!hasNonzeroNegativeCash) return nonNegative();
    const financing = longBridgeFinancingDetails(facts ?? null);
    if (financing && financing.length > 0) {
      return {
        kind: "financing",
        detail: "融资占用（已核实）",
        evidenceSource: "account-facts.longbridge.financing",
      };
    }
    return unverifiedNegative(
      "account-facts.longbridge.financing",
      "负现金未核实",
    );
  },
};

function cashOnlyUnverifiedAdapter(
  platform: string,
  cashField: "cash_balance" | "available_cash",
  extras: Partial<Capability> = {},
): PlatformAdapter {
  return {
    platform,
    capability() {
      return { ...baseBrokerCapability(cashField), ...extras, supportsMarginEvidence: false };
    },
    classifyNegativeCash({ hasNonzeroNegativeCash }) {
      if (!hasNonzeroNegativeCash) return nonNegative();
      return unverifiedNegative(`account-facts.${platform}`, "负现金未核实");
    },
  };
}

const ibkrAdapter = cashOnlyUnverifiedAdapter("ibkr", "cash_balance");
const schwabAdapter = cashOnlyUnverifiedAdapter("schwab", "cash_balance");
const firstradeAdapter = cashOnlyUnverifiedAdapter("firstrade", "cash_balance");

const binanceAdapter: PlatformAdapter = {
  platform: "binance",
  capability() {
    return {
      canStop: true,
      canResume: true,
      ...DISABLED_ACTIVATION,
      canSaveDraft: true,
      canSaveRisk: true,
      cashField: null,
      supportsMarginEvidence: false,
      supportsDailyCycle: false,
      supportsWalletValuation: true,
    };
  },
  classifyNegativeCash({ hasNonzeroNegativeCash }) {
    if (!hasNonzeroNegativeCash) return nonNegative();
    return unverifiedNegative("account-facts.binance", "负现金未核实");
  },
};

const unsupportedAdapter: PlatformAdapter = {
  platform: "unsupported",
  capability() {
    return {
      canStop: false,
      canResume: false,
      ...DISABLED_ACTIVATION,
      canSaveDraft: false,
      canSaveRisk: false,
      cashField: null,
      supportsMarginEvidence: false,
      supportsDailyCycle: false,
      supportsWalletValuation: false,
    };
  },
  classifyNegativeCash({ hasNonzeroNegativeCash }) {
    if (!hasNonzeroNegativeCash) return nonNegative();
    return unverifiedNegative("account-facts.unsupported", "负现金未核实");
  },
};

const ADAPTERS: Record<string, PlatformAdapter> = {
  longbridge: longBridgeAdapter,
  ibkr: ibkrAdapter,
  schwab: schwabAdapter,
  firstrade: firstradeAdapter,
  binance: binanceAdapter,
};

export function getPlatformAdapter(platform: string | null | undefined): PlatformAdapter {
  const key = String(platform || "").trim().toLowerCase();
  return ADAPTERS[key] || unsupportedAdapter;
}

export function classifyAccountCashSign(
  platform: string | null | undefined,
  facts: AccountFactsAccount | null | undefined,
  hasNonzeroNegativeCash: boolean,
): CashSignClassification {
  return getPlatformAdapter(platform).classifyNegativeCash({ facts, hasNonzeroNegativeCash });
}

export function cashSignNote(classification: CashSignClassification): string {
  return classification.detail;
}
