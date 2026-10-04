export type AccountFactsReturn = {
  status: "unavailable";
  reason: "external_cashflow_required";
};

export type AccountFactsBalance = {
  currency: string;
  net_assets: string | null;
  total_cash?: string | null;
  source_tag?: "liquidationValue";
  currency_source?: "owner_confirmed";
};

export type LongBridgeAccountFactsCash = {
  currency: string;
  available_cash: string;
  frozen_cash: string;
  settling_cash: string;
};

export type LongBridgeCashDetail = {
  currency: string;
  total_cash?: string;
  available_cash?: string;
  frozen_cash?: string;
  settling_cash?: string;
};

export type LongBridgeFinancingRiskLevel = "0" | "1" | "2" | "3";

export type LongBridgeFinancingRow = {
  currency: string;
  max_finance_amount?: string;
  remaining_finance_amount?: string;
  init_margin?: string;
  maintenance_margin?: string;
  margin_call?: string;
  buy_power?: string;
  risk_level?: LongBridgeFinancingRiskLevel;
};

export type IbkrAccountFactsCash = {
  currency: string;
  cash_balance: string;
  source_tag: "$LEDGER-CashBalance" | "$LEDGER-TotalCashBalance" | "CashBalance" | "TotalCashBalance" | "SettledCash";
};

export type SchwabAccountFactsCash = {
  currency: "USD";
  cash_balance: string;
  source_tag: "cashBalance";
  currency_source: "owner_confirmed";
};

export type SchwabBrokerAccountType = {
  value: string;
  source_tag: "securitiesAccount.type";
};

export type AccountFactsCash = LongBridgeAccountFactsCash | IbkrAccountFactsCash | SchwabAccountFactsCash;

export type AccountFactsAccount = {
  platform: string;
  account_key: string;
  binding_status: "bound" | "missing" | "duplicate";
  identity_status: "partial_identity" | "missing_identity";
  identity_mismatch?: boolean;
  data_status: "fresh" | "stale" | "unavailable";
  broker_environment?: string | null;
  target_id: string | null;
  source_binding_id: string | null;
  account_scope?: string | null;
  observation_date: string | null;
  observed_started_at: string | null;
  observed_finished_at: string | null;
  balances: AccountFactsBalance[];
  cash: AccountFactsCash[];
  financing?: LongBridgeFinancingRow[];
  broker_account_type?: SchwabBrokerAccountType;
  return: AccountFactsReturn;
};

export type AccountFactsTotals = {
  status: "by_currency" | "unavailable";
  reason: string | null;
  by_currency: Array<{
    currency: string;
    net_assets: string;
    available_cash: string;
    account_count: number;
  }>;
};

export type AccountFactsSnapshot = {
  ok: true;
  enabled?: boolean;
  configured?: boolean;
  accounts: AccountFactsAccount[];
  totals: AccountFactsTotals;
  return: AccountFactsReturn;
};

export type BinancePrivateScopeAsset = {
  asset: string;
  free: string;
  locked: string;
};

export type BinanceProviderProductType = {
  value: "SPOT" | "unknown";
  source: "GET /api/v3/account.accountType";
  observed_at: string;
};

export function binanceProviderProductTypeForDisplay(
  report: { provider_product_type?: BinanceProviderProductType } | null | undefined,
  eligibleAccountReport: boolean,
): BinanceProviderProductType | null {
  const productType = report?.provider_product_type;
  if (!eligibleAccountReport || productType?.value !== "SPOT"
      || productType.source !== "GET /api/v3/account.accountType"
      || typeof productType.observed_at !== "string"
      || !Number.isFinite(Date.parse(productType.observed_at))) return null;
  return {
    value: "SPOT",
    source: "GET /api/v3/account.accountType",
    observed_at: productType.observed_at,
  };
}

export type BinancePrivateScopeDisplay = {
  observed_at: string;
  assets: BinancePrivateScopeAsset[];
};

export type AccountFactsHistoryPoint = {
  observation_date: string;
  observed_finished_at: string;
  currency: string;
  net_assets: string;
  total_cash: string | null;
};

export type AccountFactsHistorySeries = {
  ok: true;
  currency: string | null;
  points: AccountFactsHistoryPoint[];
  gap_dates: string[];
  first_sample_date: string | null;
  truncated: boolean;
  retention_days: number;
  note: string | null;
};

export type AccountFactsHistorySnapshot = {
  ok: true;
  enabled?: boolean;
  platform: string;
  account_key: string;
  binding_status: "bound" | "missing" | "duplicate";
  identity_status: "partial_identity" | "missing_identity";
  identity_mismatch?: boolean;
  target_id: string | null;
  source_binding_id: string | null;
  account_scope: string | null;
  series: AccountFactsHistorySeries;
  retention_days?: number;
  return: AccountFactsReturn;
};

export type BinanceWalletHistoryPoint = {
  observation_date: string;
  observed_at: string;
  amount: string;
  break_before?: true;
};

export type BinanceWalletHistorySnapshot = {
  ok: true;
  metric: "wallet_valuation";
  currency: "USDT";
  scope: "provider_returned_wallet_rows";
  points: BinanceWalletHistoryPoint[];
  gap_dates: string[];
  first_sample_date: string | null;
  retention_days: number;
  return: AccountFactsReturn;
};

export function formatAccountFactAmounts(
  rows: Array<{ currency?: string; [field: string]: unknown }> | null | undefined,
  field: string,
): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const validRows = rows.filter((row) => (
    typeof row?.currency === "string" && typeof row?.[field] === "string"
  ));
  if (!validRows.length) return null;
  const parts = validRows
    .map((row) => {
      const currency = row.currency;
      const amount = row[field];
      if (typeof currency !== "string" || typeof amount !== "string" || /^-?0(?:\.0+)?$/.test(amount)) return null;
      return currency + " " + amount;
    })
    .filter((item): item is string => Boolean(item));
  return parts.length ? parts.join(" · ") : "0";
}

export function hasNonzeroNegativeAccountFactAmount(
  rows: Array<{ [field: string]: unknown }> | null | undefined,
  field: string,
): boolean {
  return Array.isArray(rows) && rows.some((row) => {
    const amount = row?.[field];
    return typeof amount === "string" && /^-\d+(?:\.\d+)?$/.test(amount) && /[1-9]/.test(amount);
  });
}

export function longBridgeCashDetails(account: AccountFactsAccount | null | undefined): LongBridgeCashDetail[] | null {
  if (!account || account.platform !== "longbridge" || account.data_status !== "fresh"
    || account.binding_status !== "bound" || account.identity_mismatch === true
    || typeof account.observed_finished_at !== "string"
    || !Number.isFinite(Date.parse(account.observed_finished_at))) return null;
  const cashRows = account.cash.filter((row): row is LongBridgeAccountFactsCash => (
    ("available_cash" in row || "frozen_cash" in row || "settling_cash" in row)
    && typeof row.currency === "string" && row.currency.length > 0
  ));
  const balanceRows = account.balances.filter((row) => typeof row.currency === "string" && row.currency.length > 0);
  const hasDuplicateCurrency = (rows: Array<{ currency: string }>) => (
    new Set(rows.map((row) => row.currency)).size !== rows.length
  );
  if (hasDuplicateCurrency(cashRows) || hasDuplicateCurrency(balanceRows)) return null;
  const currencies = new Set([...balanceRows.map((row) => row.currency), ...cashRows.map((row) => row.currency)]);
  const result: LongBridgeCashDetail[] = [];
  for (const currency of currencies) {
    const balance = balanceRows.find((row) => row.currency === currency);
    const cash = cashRows.find((row) => row.currency === currency);
    const detail: LongBridgeCashDetail = { currency };
    if (typeof balance?.total_cash === "string") detail.total_cash = balance.total_cash;
    if (typeof cash?.available_cash === "string") detail.available_cash = cash.available_cash;
    if (typeof cash?.frozen_cash === "string") detail.frozen_cash = cash.frozen_cash;
    if (typeof cash?.settling_cash === "string") detail.settling_cash = cash.settling_cash;
    if (Object.keys(detail).length > 1) result.push(detail);
  }
  return result.length ? result : null;
}

const LONG_BRIDGE_FINANCING_MONEY_FIELDS = [
  "max_finance_amount",
  "remaining_finance_amount",
  "init_margin",
  "maintenance_margin",
  "margin_call",
  "buy_power",
] as const;

const LONG_BRIDGE_RISK_LEVEL_WIRE = new Set<LongBridgeFinancingRiskLevel>(["0", "1", "2", "3"]);

export function longBridgeRiskLevelLabel(
  level: LongBridgeFinancingRiskLevel,
): "安全" | "中等" | "预警" | "危险" {
  if (level === "0") return "安全";
  if (level === "1") return "中等";
  if (level === "2") return "预警";
  return "危险";
}

export function longBridgeFinancingDetails(
  account: AccountFactsAccount | null | undefined,
): LongBridgeFinancingRow[] | null {
  if (!account || account.platform !== "longbridge" || account.data_status !== "fresh"
    || account.binding_status !== "bound" || account.identity_mismatch === true
    || typeof account.observed_finished_at !== "string"
    || !Number.isFinite(Date.parse(account.observed_finished_at))
    || !Array.isArray(account.financing) || account.financing.length === 0) return null;
  const balanceCurrencies = new Set(
    account.balances
      .map((row) => row.currency)
      .filter((currency): currency is string => typeof currency === "string" && currency.length > 0),
  );
  const seen = new Set<string>();
  let previousCurrency: string | null = null;
  const result: LongBridgeFinancingRow[] = [];
  for (const row of account.financing) {
    if (!row || typeof row.currency !== "string" || !row.currency
        || seen.has(row.currency) || !balanceCurrencies.has(row.currency)) return null;
    if (previousCurrency !== null && row.currency < previousCurrency) return null;
    seen.add(row.currency);
    previousCurrency = row.currency;
    const detail: LongBridgeFinancingRow = { currency: row.currency };
    let hasNativeField = false;
    for (const field of LONG_BRIDGE_FINANCING_MONEY_FIELDS) {
      const value = row[field];
      if (value === undefined) continue;
      if (typeof value !== "string") return null;
      detail[field] = value;
      hasNativeField = true;
    }
    if (row.risk_level !== undefined) {
      if (!LONG_BRIDGE_RISK_LEVEL_WIRE.has(row.risk_level)) return null;
      detail.risk_level = row.risk_level;
      hasNativeField = true;
    }
    if (!hasNativeField) return null;
    result.push(detail);
  }
  return result.length ? result : null;
}

export function accountFactsForRow(
  facts: AccountFactsSnapshot | null | undefined,
  platform: string,
  accountKey: string,
): AccountFactsAccount | null {
  if (!facts?.accounts?.length) return null;
  return facts.accounts.find((item) => item.platform === platform && item.account_key === accountKey) || null;
}

export function totalsUnavailableDetail(reason: string | null | undefined): string {
  void reason;
  return "暂不可用";
}

export function accountFactsDetail(account: AccountFactsAccount | null | undefined): string {
  if (!account) return "暂无数据";
  if (account.identity_mismatch || account.binding_status === "missing" || account.binding_status === "duplicate") {
    return "暂不可用";
  }
  if (account.data_status === "stale") return "数据暂不可用";
  if (account.data_status === "unavailable") return "暂无数据";
  return "";
}

export function accountFactsUpdatedAt(account: AccountFactsAccount | null | undefined): string | null {
  if (!account) return null;
  if (account.data_status !== "fresh" && account.data_status !== "stale") return null;
  return typeof account.observed_finished_at === "string" && account.observed_finished_at ? account.observed_finished_at : null;
}
